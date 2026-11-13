const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const v = require('./shipping-auth-intake-verifier')

const nativeFetch = global.fetch
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const expected = { commit: 'a'.repeat(40), deploymentId: 'dpl_intake' }

function fixture(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-intake-proof-'))
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }))
  const attachment = Buffer.from('redacted existing Chrome screenshot')
  fs.writeFileSync(path.join(runtime, 'chrome.png'), attachment)
  const payload = {
    contract_version: v.CONTRACT, source: 'trusted_existing_chrome_operator', environment: 'production',
    origin: 'https://sales.cyanlog.icu', url: 'https://sales.cyanlog.icu/shipping', ...{
      commit: expected.commit, deployment_id: expected.deploymentId,
    },
    browser_context: 'existing_user_chrome', existing_tab_id: 'chrome-123', new_tabs: 0, new_browser_contexts: 0,
    attestation_type: 'trusted_operator_browser', trust_boundary: 'operator_attestation_not_machine_proof',
    attestation_method: 'codex_chrome_control_existing_session', attested_by: 'codex', attested_at: new Date().toISOString(),
    no_business_writes: true, carrier_calls: false, result: 'pass', actions: [...v.ACTIONS],
    observations: v.ACTIONS.map(action => ({ action, result: 'pass', detail: `Observed read-only ${action} path in existing Chrome.` })),
    attachments: [{ path: 'chrome.png', sha256: sha(attachment) }],
  }
  function save() {
    const bytes = Buffer.from(JSON.stringify(payload))
    fs.writeFileSync(path.join(runtime, 'operator.json'), bytes)
    return { artifact_path: 'operator.json', sha256: sha(bytes), payload: structuredClone(payload) }
  }
  return { runtime, payload, save }
}

test('contract permits only a read-only existing-Chrome replay', t => {
  const f = fixture(t)
  assert.deepEqual(v.ITEMS, ['sales_intake', 'shipping_access'])
  assert.deepEqual(v.ACTIONS, ['employee_single_intake', 'employee_multi_intake', 'owner_records', 'operator_workbench'])
  assert.doesNotThrow(() => v.operatorPayload(f.payload, expected))
  for (const change of [
    value => { value.new_tabs = 1 },
    value => { value.carrier_calls = true },
    value => { value.no_business_writes = false },
    value => { value.actions.reverse() },
    value => { value.attested_at = new Date(Date.now() + 3600_000).toISOString() },
  ]) {
    const changed = structuredClone(f.payload); change(changed)
    assert.throws(() => v.operatorPayload(changed, expected))
  }
})

test('Production-first exception stays on the approved code tree and read-only scope', () => {
  const approval = {
    type: 'final_production_release_authorization', source: 'user_explicit', state: 'approved',
    preview_order_exception: true, preview_status: 'not_passed', code_release_authorized: true,
    database_write_authorized: false, production_database_write_authorized: false, carrier_calls_authorized: false,
    approved_candidate: 'a'.repeat(40), approved_product_tree: 'b'.repeat(40), rollback_commit: 'c'.repeat(40),
  }
  const scope = { approval, activeId: 'WP35', featureId: 'F054', runtimeProfile: 'shipping_workspace',
    contractVersion: v.CONTRACT, productTree: approval.approved_product_tree, candidateIsAncestor: true,
    changedPaths: ['governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js'] }
  assert.deepEqual(v.productionFirstExceptionBlockers(scope), [])
  assert.ok(v.productionFirstExceptionBlockers({ ...scope, changedPaths: ['product-truth/product-code/app/shipping/page.tsx'] }).length)
  assert.ok(v.productionFirstExceptionBlockers({ ...scope, productTree: 'd'.repeat(40) }).length)
  assert.ok(v.productionFirstExceptionBlockers({ ...scope, approval: { ...approval, carrier_calls_authorized: true } }).length)
})

test('verifier collects only five anonymous GET probes and binds raw receipts', async t => {
  const f = fixture(t)
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, ...options })
    const isPage = !String(url).includes('/api/')
    const retired = String(url).includes('/api/shipping/public/')
    return new Response(isPage ? '' : retired ? '{"error":"Retired","code":"AUTHENTICATED_INTAKE_REQUIRED"}' : '{"error":"Unauthorized"}', {
      status: isPage ? 307 : retired ? 410 : 401,
      headers: isPage ? { location: '/login' } : { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  t.after(() => { global.fetch = nativeFetch })
  const proof = await v.verify({ runtime: f.runtime, operator: f.save(), ...expected })
  assert.equal(calls.length, 5)
  assert.ok(calls.every(call => call.method === 'GET' && call.credentials === 'omit' && call.redirect === 'manual'))
  assert.deepEqual(v.productionEvidenceBlockers(proof, { ...expected, runtime: f.runtime }), [])
  const changed = structuredClone(proof)
  changed.verifier.payload.probes[0].status = 200
  assert.ok(v.productionEvidenceBlockers(changed, { ...expected, runtime: f.runtime }).length)
  const rebinding = structuredClone(proof)
  rebinding.shipping_access.payload.source_operator_sha256 = '0'.repeat(64)
  assert.ok(v.productionEvidenceBlockers(rebinding, { ...expected, runtime: f.runtime }).length)
  const now = Date.now
  Date.now = () => now() + 24 * 3600_000
  t.after(() => { Date.now = now })
  assert.deepEqual(v.productionEvidenceBlockers(proof, { ...expected, runtime: f.runtime }), [])
})
