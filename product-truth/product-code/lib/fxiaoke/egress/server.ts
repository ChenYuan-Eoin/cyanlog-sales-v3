// WP91: constrained outbound worker. All database access remains on the web server.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { supabaseAdmin } from '@/lib/supabase'
import { decryptCredentials, encryptCredentials } from '../crypto'
import { FxiaokeError } from '../contracts'
import { validRequest, validResult, type EgressRequest } from './protocol.mjs'

import { validLoginJob, type LoginJob, readLoginReply } from './login-job'
import type { Credentials } from '../contracts'

const JOBS = 'organization_fxiaoke_egress_jobs'
const HOSTS = 'organization_fxiaoke_egress'
const unavailable = () => new FxiaokeError('EGRESS_UNAVAILABLE', '纷享网络接入服务尚未就绪，请联系系统管理员检查后台服务和出口白名单。', 503)
export function egressConfig() {
  const orgId = process.env.FXIAOKE_EGRESS_ORG_ID
  const tokenHash = process.env.FXIAOKE_EGRESS_TOKEN_SHA256
  const allowedIp = process.env.FXIAOKE_EGRESS_ALLOWED_IP
  if (!orgId && !tokenHash && !allowedIp) return null
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId) || !tokenHash || !/^[0-9a-f]{64}$/.test(tokenHash) || !allowedIp || isIP(allowedIp) !== 4) throw unavailable()
  return { orgId, tokenHash, allowedIp, topic: `fxiaoke-egress-${createHash('sha256').update(`wake:${tokenHash}`).digest('hex')}` }
}
export function authorizeWorker(authorization: string | null) {
  const config = egressConfig()
  const token = authorization?.match(/^Bearer ([a-f0-9]{64,128})$/)?.[1]
  if (!config || !token || !timingSafeEqual(Buffer.from(createHash('sha256').update(token).digest('hex')), Buffer.from(config.tokenHash))) {
    throw new FxiaokeError('UNAUTHORIZED_WORKER', '网络接入服务身份校验失败。', 401)
  }
  return config
}
function dbError(error: unknown) { if (error) throw unavailable() }
export async function workerClaim(config: NonNullable<ReturnType<typeof egressConfig>>, observedIp: unknown) {
  const ip = typeof observedIp === 'string' && isIP(observedIp) === 4 ? observedIp : null
  const status = !ip ? 'unreachable' : ip === config.allowedIp ? 'ready' : 'ip_changed'
  const heartbeat = await supabaseAdmin.from(HOSTS).upsert({ system_org_id: config.orgId, observed_ip: ip, status, last_seen_at: new Date().toISOString() })
  dbError(heartbeat.error)
  if (status !== 'ready') return { status, job: null, topic: config.topic }
  const claimed = await supabaseAdmin.rpc('claim_fxiaoke_egress_job', { p_org_id: config.orgId })
  dbError(claimed.error)
  const row = claimed.data?.[0]
  if (!row) return { status, job: null, topic: config.topic }
  const request: unknown = JSON.parse(decryptCredentials(`${config.orgId}:${row.id}:request`, row.request_ciphertext))
  if (!validRequest(request) && !validLoginJob(request)) throw unavailable()
  return { status, topic: config.topic, job: { id: row.id, lease: row.lease_token, expiresAt: row.expires_at, request } }
}
export async function workerComplete(config: NonNullable<ReturnType<typeof egressConfig>>, body: Record<string, unknown>) {
  if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.lease !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.lease) || !validResult(body.result)) {
    throw new FxiaokeError('INVALID_WORKER_RESULT', '网络接入服务返回无效结果。')
  }
  const update = await supabaseAdmin.from(JOBS).update({ status: 'finished', request_ciphertext: null,
    response_ciphertext: encryptCredentials(`${config.orgId}:${body.id}:response`, JSON.stringify(body.result)) })
    .eq('id', body.id).eq('system_org_id', config.orgId).eq('lease_token', body.lease).eq('status', 'running')
    .gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  dbError(update.error)
  if (!update.data) throw new FxiaokeError('EGRESS_JOB_EXPIRED', '此网络请求已过期或已处理。', 409)
  return { accepted: true }
}
type EgressConfig = NonNullable<ReturnType<typeof egressConfig>>
async function sendToWorker(config: EgressConfig, input: EgressRequest | LoginJob, signal?: AbortSignal | null) {
  const { orgId } = config
  signal?.throwIfAborted()
  const health = await supabaseAdmin.from(HOSTS).select('last_seen_at,status').eq('system_org_id', orgId).maybeSingle()
  dbError(health.error)
  if (health.data?.status === 'ip_changed') throw new FxiaokeError('EGRESS_IP_CHANGED', '纷享接入主机的出口 IP 已变化，请联系系统管理员核对并更新纷享白名单。', 503)
  if (!health.data || health.data.status !== 'ready' || Date.now() - Date.parse(health.data.last_seen_at) > 90000) throw unavailable()
  const id = randomUUID()
  const inserted = await supabaseAdmin.from(JOBS).insert({ id, system_org_id: orgId, expires_at: new Date(Date.now() + 20000).toISOString(),
    request_ciphertext: encryptCredentials(`${orgId}:${id}:request`, JSON.stringify(input)) })
  dbError(inserted.error)
  try {
    // The public wake signal contains no job ID, tenant ID, credentials, or response data.
    async function wakeWorker() {
      const channel = supabaseAdmin.channel(config.topic)
      try { return (await channel.httpSend('wake', {}, { timeout: 1500 })).success }
      catch { return false }
      finally { await supabaseAdmin.removeChannel(channel) }
    }
    const started = Date.now()
    await wakeWorker()
    let wakeRepeated = false
    const deadline = Date.now() + 18000
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      const result = await supabaseAdmin.from(JOBS).select('status,response_ciphertext').eq('id', id).eq('system_org_id', orgId).maybeSingle()
      dbError(result.error)
      if (!result.data) throw unavailable()
      if (result.data.status === 'finished') {
        const reply: unknown = JSON.parse(decryptCredentials(`${orgId}:${id}:response`, result.data.response_ciphertext))
        if (!validResult(reply)) throw unavailable()
        if ('error' in reply) throw new FxiaokeError('EGRESS_PROVIDER_UNREACHABLE', '纷享接入主机未能取得接口响应，请联系系统管理员检查网络。', 502)
        return new Response([204,205,304].includes(reply.status) ? null : reply.body, { status: reply.status, headers: { 'Content-Type': 'application/json' } })
      }
      const elapsed = Date.now() - started
      if (result.data.status === 'queued' && !wakeRepeated && elapsed >= 300) {
        wakeRepeated = true
        await wakeWorker()
        continue
      }
      if (result.data.status === 'queued' && elapsed >= 1800) {
        throw new FxiaokeError('EGRESS_NOT_CLAIMED', '专用登录服务尚未接收请求。', 503)
      }
      await delay(elapsed < 1800 ? 100 : 250, undefined, { signal: signal ?? undefined })
    }
    throw unavailable()
  } finally {
    // Failed/aborted requests cannot be replayed later. The claim RPC also removes expired jobs.
    await supabaseAdmin.from(JOBS).delete().eq('id', id).eq('system_org_id', orgId)
  }
}

export function transportForOrganization(orgId: string) {
  const config = egressConfig()
  if (!config || config.orgId !== orgId) return undefined
  const send: typeof fetch = async (url, init) => {
    const input = { url: String(url), headers: Object.fromEntries(new Headers(init?.headers)), body: init?.body }
    if (init?.method !== 'POST' || !validRequest(input)) throw new FxiaokeError('EGRESS_REQUEST_DENIED', '此纷享接口不在允许范围内。', 403)
    return sendToWorker(config, input, init.signal)
  }
  return Object.assign(send, {
    async verifyEmployee(credentials: Credentials, input: { code: string; redirectUrl: string }, setStage: Parameters<typeof readLoginReply>[2]) {
      const { appId, appSecret, permanentCode, apiUserId, expectedEa, expectedCorpId } = credentials
      const job = { kind: 'employee_login_v1', credentials: { appId, appSecret, permanentCode, apiUserId, expectedEa, ...(expectedCorpId ? { expectedCorpId } : {}) }, code: input.code, redirectUrl: input.redirectUrl }
      if (!validLoginJob(job)) throw new FxiaokeError('EGRESS_REQUEST_DENIED', '员工登录请求无效。', 403)
      const response = await sendToWorker(config, job, AbortSignal.timeout(15_000))
      return readLoginReply(response, credentials, setStage)
    },
  })
}
