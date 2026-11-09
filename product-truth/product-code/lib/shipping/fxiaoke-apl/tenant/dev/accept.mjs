// REQ: F054 / WP97. Disposable local acceptance, never a production data store.
// Real Next routes + real CRM SQL. Only Fxiaoke and PostgREST transport/config are fixtures.
import { PGlite } from '@electric-sql/pglite'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { renderApl } from '../build-apl.mjs'

const appRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)))
const out = process.env.ICU_DEV_EVIDENCE_DIR
if (!out || !process.env.APL_JAVA_BIN || !process.env.APL_GROOVY_CLASSPATH) throw new Error('Set ICU_DEV_EVIDENCE_DIR, APL_JAVA_BIN and APL_GROOVY_CLASSPATH')
mkdirSync(out, { recursive: true })
const db = new PGlite()
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const secret = randomBytes(32).toString('hex')
const sender = { name: '开发寄件中心', phone: '13800000000', province: '上海市', city: '上海市', county: '浦东新区', address: '开发路88号' }
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table organizations(id uuid primary key); create table users(id uuid primary key);
  create table shipping_orders(
    id uuid primary key, org_id uuid not null references organizations(id), order_no text not null unique,
    created_by uuid references users(id), intake_source text not null, confirmation_policy text not null,
    status text not null, sales_ref text, customer_ref text, assignment_status text not null, raw_input text,
    shipment_payload jsonb not null, payload_hash text not null, idempotency_key uuid not null,
    receipt_token_hash text not null unique, next_review_at timestamptz, identity_snapshot jsonb not null default '{}',
    created_at timestamptz not null default now(), unique(intake_source,idempotency_key));
  create table shipping_waybills(id uuid primary key default gen_random_uuid(),shipping_order_id uuid not null unique references shipping_orders(id),waybill_no text not null,provider_order_id text);
  insert into organizations values('${orgId}');
`)
await db.exec(readFileSync(resolve(appRoot, 'supabase/migrations/20261106000001_shipping_crm_intake.sql'), 'utf8'))
let senderAvailable = true
const dbServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const table = url.pathname.split('/').at(-1)
    let data
    if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
      assert.ok(['create_shipping_crm_intake', 'replay_shipping_crm_intake'].includes(table))
      let raw = ''; for await (const chunk of req) raw += chunk
      const args = JSON.parse(raw)
      const keys = Object.keys(args)
      assert.ok(keys.every(key => /^p_[a-z_]+$/.test(key)))
      const result = await db.query(`select public.${table}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value))
      data = result.rows[0].result
    } else if (req.method === 'GET') {
      if (table === 'shipping_sender_profiles') data = senderAvailable ? sender : null
      else if (['shipping_wecom_settings', 'shipping_intake_settings', 'shipping_carrier_connections'].includes(table)) data = null
      else if (table === 'shipping_crm_intake_events') {
        const filters = ['org_id', 'integration_client_id', 'event_key']
        const result = await db.query(`select payload_hash,shipping_order_id from shipping_crm_intake_events where ${filters.map((key, i) => `${key}=$${i + 1}`).join(' and ')}`, filters.map(key => url.searchParams.get(key)?.replace(/^eq\./, '')))
        data = result.rows[0] ?? null
      } else throw new Error('Unexpected dev database read: ' + table)
    } else throw new Error('Unexpected dev database write')
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data))
  } catch (error) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: error.message, code: error.code ?? 'DEV_FIXTURE_ERROR' })) }
})
await new Promise(resolve => dbServer.listen(0, '127.0.0.1', resolve))
const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve))
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
const baseUrl = `http://127.0.0.1:${port}`
const log = createWriteStream(resolve(out, 'next-dev.log'))
const next = spawn(process.execPath, [resolve(appRoot, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: appRoot, env: { ...process.env, NODE_ENV: 'development', VERCEL: '', VERCEL_ENV: '', SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${dbServer.address().port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dev-only-anon', SUPABASE_SERVICE_ROLE_KEY: 'dev-only-service', SHIPPING_CONTEXT_SECRET: secret, SHIPPING_RECEIPT_SECRET: secret, SHIPPING_CRM_CLIENTS_JSON: JSON.stringify([{ clientId: 'dev-client', orgId, enterpriseId: 'dev-tenant', secret }]) }, stdio: ['ignore', 'pipe', 'pipe'],
})
next.stdout.pipe(log); next.stderr.pipe(log)
const results = []
function fixture(name) {
  const config = JSON.parse(readFileSync(new URL('../fxiaoke-approval-intake.example.json', import.meta.url), 'utf8'))
  config.enterpriseId = 'dev-tenant'; config.environment = 'development'; config.endpoint.baseUrl = 'https://dev-fixture.vercel.app'; config.endpoint.clientId = 'dev-client'
  config.workflow.objectApiName = name + 'Obj'; config.rootObject.objectApiName = name + 'Obj'; config.workflow.stages[0].taskName = name + '审批通过'; config.workflow.stages[0].stageId = name + '-approved'
  config.shipmentDetailObject.objectApiName = name + 'DetailObj'; config.shipmentDetailObject.parentRecordId.path = 'parent__c'
  config.shipmentDetailObject.shipment.recipient.name.path = name + '_recipient'
  const root = { _id: name + '-record', account__c: [{ _id: 'dev-account', name: '开发客户' }], modified_time: 'revision-1' }
  const detail = { _id: name + '-detail', parent__c: [{ _id: root._id }], [name + '_recipient']: '开发收件人', recipient_phone: '13900000000', province: '上海市', city: '上海市', county: '浦东新区', address: '开发测试路88号', cargo: '测试文件', weight: 1.5, service_preference: 'standard' }
  return { config, recordId: root._id, detailId: detail._id, instanceId: name + '-instance', taskId: name + '-task', records: { [name + 'Obj:' + root._id]: root, [name + 'DetailObj:' + detail._id]: detail, 'PersonnelObj:dev-employee': { _id: 'dev-employee', name: '开发申请人', mobile: '13700000000', department_id: 'dev-dept', department_name: '开发测试' } } }
}
async function run(f, label, expected) {
  const artifact = renderApl(f.config)
  const codePath = resolve(out, label + '.groovy'); const fixturePath = resolve(out, label + '.json')
  // Ephemeral dev credential only, never a real platform credential.
  writeFileSync(codePath, artifact.source.replace('REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS', secret), { mode: 0o600 })
  writeFileSync(fixturePath, JSON.stringify(f), { mode: 0o600 })
  const child = spawn(process.env.APL_JAVA_BIN, ['-cp', process.env.APL_GROOVY_CLASSPATH, 'groovy.ui.GroovyMain', fileURLToPath(new URL('./apl-runtime.groovy', import.meta.url)), codePath, fixturePath], { env: { ...process.env, ICU_DEV_URL: baseUrl } })
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d }); child.stderr.on('data', d => { stderr += d })
  const exitCode = await new Promise(resolve => child.on('close', resolve))
  writeFileSync(resolve(out, label + '.execution.log'), stdout + stderr)
  let execution; try { execution = JSON.parse(stdout.trim().split('\n').at(-1)) } catch { throw new Error(label + ': Groovy execution failed; see execution log') }
  if (expected.startsWith('APL_')) { assert.notEqual(exitCode, 0, label); assert.ok(execution.error?.includes(expected), label + ': ' + execution.error) }
  else { assert.equal(exitCode, 0, label + ': ' + execution.error); assert.equal(execution.result.status, expected, label) }
  results.push({ label, expected, passed: true, coreSha256: artifact.coreSha256, calls: execution.calls })
  return execution
}
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(baseUrl + '/api/shipping/crm/preflight', { method: 'POST', body: '{}', signal: AbortSignal.timeout(3000) }); if (response.status === 401) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(ready, 'dev server readiness')
  const a = fixture('Contract'), b = fixture('Quote')
  const preflight = await run(a, '01-preflight', 'preflight_ready'); assert.equal(preflight.calls.length, 1)
  assert.equal((await db.query('select count(*)::int as n from shipping_orders')).rows[0].n, 0)
  senderAvailable = false; await run(a, '02-missing-sender', 'preflight_blocked'); senderAvailable = true
  a.config.mode = 'create'
  const created = await run(a, '03-create', 'created')
  const replayed = await run(a, '04-replay', 'replayed'); assert.equal(created.result.orderId, replayed.result.orderId)
  a.records['ContractDetailObj:Contract-detail'].cargo = 'changed'
  await run(a, '05-content-conflict', 'APL_ICU_CALL_FAILED')
  b.config.mode = 'create'; await run(b, '06-other-mapping', 'created')
  b.contextTenant = 'other-tenant'; const denied = await run(b, '07-cross-tenant', 'APL_TENANT_MISMATCH'); assert.equal(denied.calls.length, 0)
  delete b.contextTenant; b.records['QuoteObj:Quote-record'].account__c.push({ _id: 'other', name: 'other' })
  const ambiguous = await run(b, '08-ambiguous-reference', 'APL_MAPPING_AMBIGUOUS'); assert.equal(ambiguous.calls.length, 0)
  const raw = '{}', pathname = '/api/shipping/crm/preflight', timestamp = String(Math.floor(Date.now() / 1000))
  for (const [label, time, signature] of [['09-bad-signature', timestamp, '0'.repeat(64)], ['10-expired-signature', '1000000000', createHmac('sha256', secret).update('1000000000\nPOST\n' + pathname + '\n' + raw).digest('hex')]]) {
    const response = await fetch(baseUrl + pathname, { method: 'POST', headers: { 'x-shipping-crm-client-id': 'dev-client', 'x-shipping-crm-timestamp': time, 'x-shipping-crm-signature': signature }, body: raw })
    assert.equal(response.status, 401, label); results.push({ label, passed: true, status: response.status })
  }
  const rows = await db.query('select o.status,o.intake_source,e.workflow_instance_id,e.replay_count from shipping_orders o join shipping_crm_intake_events e on e.shipping_order_id=o.id order by e.workflow_instance_id')
  assert.equal(rows.rows.length, 2); assert.ok(rows.rows.every(row => row.status === 'awaiting_confirmation' && row.intake_source === 'crm'))
  assert.equal((await db.query('select count(*)::int as n from shipping_waybills')).rows[0].n, 0)
  const report = { environment: 'local-development', real: ['generated Groovy execution', 'Next HTTP routes', 'HMAC authentication', 'CRM business service', 'PGlite CRM migration and RPC persistence'], simulated: ['Fxiaoke context/BPM/object/crypto/http adapters', 'PostgREST transport', 'sender/service configuration'], productionAcceptance: false, results, rows: rows.rows, waybills: 0 }
  writeFileSync(resolve(out, 'acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally {
  next.kill('SIGTERM'); dbServer.closeAllConnections(); await new Promise(resolve => dbServer.close(resolve)); await db.close(); log.end()
}
