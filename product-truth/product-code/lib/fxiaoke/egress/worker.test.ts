// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createWorker, readWorkerConfig, readEgressIp } from './worker.mjs'
const config=readWorkerConfig({FXIAOKE_EGRESS_TOKEN:'12'.repeat(32),SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'})
it('uses only the existing project and rejects database privileged keys in the worker',() => {
  expect(()=>readWorkerConfig({FXIAOKE_EGRESS_TOKEN:'12'.repeat(32),SUPABASE_PUBLISHABLE_KEY:'service_role_secret'})).toThrow('INVALID_WORKER_CONFIGURATION')
  expect(config.topic).not.toContain(config.token)
})
it('keeps malformed egress lookups unavailable',async () => {
  expect(await readEgressIp(vi.fn().mockResolvedValue(new Response('当前 IP：192.0.2.10')))).toBe('192.0.2.10')
  expect(await readEgressIp(vi.fn().mockResolvedValue(new Response('999.0.2.10')))).toBeNull()
  expect(await readEgressIp(vi.fn().mockRejectedValue(new Error('network')))).toBeNull()
})
it('performs one real-shaped claim, provider request and completion without logging credentials or responses',async () => {
  const request={url:'https://open.fxiaoke.com/oauth2.0/token?thirdTraceId=11111111-1111-4111-8111-111111111111',headers:{'content-type':'application/json'},body:JSON.stringify({appId:'FSAID_test',appSecret:'example-secret',permanentCode:'private-code',grantType:'app_secret'})}
  const job={id:'11111111-1111-4111-8111-111111111111',lease:'22222222-2222-4222-8222-222222222222',expiresAt:new Date(Date.now()+20000).toISOString(),request}
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('当前 IP：192.0.2.10'))
    .mockResolvedValueOnce(Response.json({data:{status:'ready',job}}))
    .mockResolvedValueOnce(Response.json({errorCode:0,accessToken:'example-returned-token'}))
    .mockResolvedValueOnce(Response.json({data:{accepted:true}}))
  const report=vi.fn()
  expect(await createWorker({config,request:fetcher,report}).tick()).toBe(true)
  expect(fetcher.mock.calls[2][0]).toBe(request.url)
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({action:'complete',id:job.id,lease:job.lease})
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/example-secret|private-code|example-returned-token/)
})
it('does not call Fxiaoke when the server reports changed IP or an expired job',async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('192.0.2.10')).mockResolvedValueOnce(Response.json({data:{status:'ip_changed',job:null}}))
  expect(await createWorker({config,request:fetcher,report:vi.fn()}).tick()).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('stops processing on machine credential revocation instead of retrying forever',async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('192.0.2.10')).mockResolvedValueOnce(new Response('no',{status:401}))
  const worker=createWorker({config,request:fetcher,report:vi.fn()})
  await expect(worker.tick()).rejects.toThrow('WORKER_AUTH_REJECTED')
  expect(worker.isStopped()).toBe(true)
  expect(await worker.tick()).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
