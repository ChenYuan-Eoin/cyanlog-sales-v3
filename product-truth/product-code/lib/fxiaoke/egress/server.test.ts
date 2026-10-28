// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const fake = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, inserts: [] as unknown[], wake: vi.fn(), calls: 0 }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {
  from(table: string) {
    fake.calls++
    const filters: ((row: Record<string, unknown>) => boolean)[] = []
    let op = 'read'; let values: Record<string, unknown> = {}; let columns = '*'
    function run() {
      const rows = fake.tables[table] ||= []
      let matches = rows.filter(r => filters.every(f => f(r)))
      if (op === 'insert') { const row = { status: 'queued', ...values }; rows.push(row); fake.inserts.push(structuredClone(row)); matches = [row] }
      if (op === 'upsert') { const row = rows.find(r => r.system_org_id === values.system_org_id); if (row) Object.assign(row, values); else rows.push({ ...values }); matches = rows.filter(r => r.system_org_id === values.system_org_id) }
      if (op === 'update') matches.forEach(r => Object.assign(r, values))
      if (op === 'delete') fake.tables[table] = rows.filter(r => !matches.includes(r))
      return { data: matches.map(r => columns === '*' ? { ...r } : Object.fromEntries(columns.split(',').map(k => [k,r[k]]))), error: null }
    }
    const query = {
      select(c: string) { columns = c; return query },
      eq(k: string, v: unknown) { filters.push(r => r[k] === v); return query },
      gt(k: string, v: string) { filters.push(r => String(r[k]) > v); return query },
      insert(v: Record<string, unknown>) { op='insert'; values=v; return query },
      upsert(v: Record<string, unknown>) { op='upsert'; values=v; return query },
      update(v: Record<string, unknown>) { op='update'; values=v; return query },
      delete() { op='delete'; return query },
      async maybeSingle() { const r = run(); return { ...r, data: r.data[0] || null } },
      then(resolve: (value: ReturnType<typeof run>) => unknown) { return Promise.resolve(run()).then(resolve) },
    }
    return query
  },
  async rpc(_name: string, params: {p_org_id: string}) {
    const row = fake.tables.organization_fxiaoke_egress_jobs?.find(r => r.system_org_id === params.p_org_id && r.status === 'queued' && String(r.expires_at) > new Date().toISOString())
    if (row) Object.assign(row, { status: 'running', lease_token: randomUUID() })
    return { data: row ? [{ ...row }] : [], error: null }
  },
  channel: () => ({ httpSend: fake.wake }), removeChannel: vi.fn().mockResolvedValue('ok'),
} }))
import { authorizeWorker, egressConfig, transportForOrganization, workerClaim, workerComplete } from './server'
import { discoverEnterprise } from '../client'
import { POST } from '@/app/api/admin/organization-sources/fxiaoke/egress/route'
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const token = '12'.repeat(32)
const ip = '192.0.2.10'
const credentials = { appId: 'FSAID_fixture', appSecret: 'example-private-secret', permanentCode: 'fixture-permanent-code' }
beforeEach(() => {
  fake.calls=0; fake.tables={}; fake.inserts=[]; fake.wake.mockReset()
  vi.stubEnv('FXIAOKE_EGRESS_ORG_ID',org); vi.stubEnv('FXIAOKE_EGRESS_ALLOWED_IP',ip)
  vi.stubEnv('FXIAOKE_EGRESS_TOKEN_SHA256',createHash('sha256').update(token).digest('hex'))
  vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY','ab'.repeat(32))
  fake.tables.organization_fxiaoke_egress=[{ system_org_id: org, last_seen_at:new Date().toISOString(),status:'ready' }]
})
afterEach(() => vi.unstubAllEnvs())
it('carries enterprise discovery through encrypted jobs and only broadcasts an empty wake signal',async () => {
  fake.wake.mockImplementation(async () => {
    expect(JSON.stringify(fake.tables)).not.toContain(credentials.appSecret)
    const claim = await workerClaim(egressConfig()!,ip)
    expect(JSON.parse(claim.job!.request.body)).toMatchObject(credentials)
    await workerComplete(egressConfig()!,{ id:claim.job!.id,lease:claim.job!.lease,result:{ status:200,body:JSON.stringify({errorCode:0,appId:credentials.appId,ea:'fixture-enterprise',accessToken:'example-token',openUserId:'FSCID_fixture'}) } })
    expect(JSON.stringify(fake.tables)).not.toContain('example-token')
    return { success:true }
  })
  expect(await discoverEnterprise(credentials,transportForOrganization(org))).toEqual({ ea:'fixture-enterprise' })
  expect(fake.wake).toHaveBeenCalledWith('wake',{}, {timeout:3000})
  expect(fake.tables.organization_fxiaoke_egress_jobs).toHaveLength(0)
  expect(JSON.stringify(fake.inserts)).not.toContain(credentials.appSecret)
})
it.each(['ip_changed','unreachable','stale'])('fails before queuing credentials when worker health is %s',async status => {
  Object.assign(fake.tables.organization_fxiaoke_egress[0],status==='stale'?{last_seen_at:'2000-01-01T00:00:00Z'}:{status})
  await expect(discoverEnterprise(credentials,transportForOrganization(org))).rejects.toMatchObject({code:status==='ip_changed'?'EGRESS_IP_CHANGED':'EGRESS_UNAVAILABLE'})
  expect(fake.inserts).toHaveLength(0); expect(fake.wake).not.toHaveBeenCalled()
})
it('cleans up an aborted request and rejects stale completion instead of replaying',async () => {
  const controller = new AbortController()
  let job: { id:string;lease:string } | null = null
  fake.wake.mockImplementation(async () => { const claim=await workerClaim(egressConfig()!,ip); job=claim.job; controller.abort(); return {success:true} })
  const send=transportForOrganization(org)!
  await expect(send(`https://open.fxiaoke.com/oauth2.0/token?thirdTraceId=${randomUUID()}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...credentials,grantType:'app_secret'}),signal:controller.signal})).rejects.toThrow()
  expect(fake.tables.organization_fxiaoke_egress_jobs).toHaveLength(0)
  await expect(workerComplete(egressConfig()!,{...job!,result:{status:200,body:'{}'}})).rejects.toMatchObject({code:'EGRESS_JOB_EXPIRED'})
})
it('does not claim work from a changed or unreadable egress IP',async () => {
  const result=await workerClaim(egressConfig()!,'192.0.2.11')
  expect(result).toMatchObject({status:'ip_changed',job:null})
  expect(fake.tables.organization_fxiaoke_egress[0]).toMatchObject({system_org_id:org,observed_ip:'192.0.2.11',status:'ip_changed'})
})
it('requires the dedicated machine credential even for a logged-in administrator',async () => {
  const response=await POST(new NextRequest('https://sales.cyanlog.icu/api/admin/organization-sources/fxiaoke/egress',{method:'POST',headers:{cookie:'auth-token=administrator','x-org-id':org},body:JSON.stringify({action:'claim',egressIp:ip})}))
  expect(response.status).toBe(401); expect(fake.calls).toBe(0)
  expect(()=>authorizeWorker(`Bearer ${'34'.repeat(32)}`)).toThrow('身份校验失败')
})
it('ignores caller-supplied organization IDs and rejects cross-tenant or wrong-lease completion',async () => {
  const response=await POST(new NextRequest('https://sales.cyanlog.icu/api/admin/organization-sources/fxiaoke/egress',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-org-id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},body:JSON.stringify({action:'claim',egressIp:ip,orgId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})}))
  expect(response.status).toBe(200)
  expect(fake.tables.organization_fxiaoke_egress).toHaveLength(1)
  expect(fake.tables.organization_fxiaoke_egress[0].system_org_id).toBe(org)
  const foreignLease=randomUUID()
  fake.tables.organization_fxiaoke_egress_jobs=[{id:'11111111-1111-4111-8111-111111111111',system_org_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',status:'running',lease_token:foreignLease,expires_at:new Date(Date.now()+10000).toISOString()}]
  await expect(workerComplete(egressConfig()!,{id:'11111111-1111-4111-8111-111111111111',lease:foreignLease,result:{status:200,body:'{}'}})).rejects.toMatchObject({code:'EGRESS_JOB_EXPIRED'})
})
