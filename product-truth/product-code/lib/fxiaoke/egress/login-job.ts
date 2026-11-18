// One fixed provider handshake at the organization's allowlisted egress.
import { z } from 'zod'
import { discoverEnterprise, readEmployeeIdentity } from '../client'
import { FxiaokeError, type Credentials } from '../contracts'
import { exchangeFxiaokeAuthorizationCode } from '../oauth'
import { executeRequest, validRequest, type EgressResult } from './protocol.mjs'

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const corp = z.string().regex(/^FSCID_[A-Za-z0-9_-]{1,128}$/)
const secret = z.string().min(1).max(2048).regex(/^[^\r\n]+$/)
const jobSchema = z.strictObject({
  kind: z.literal('employee_login_v1'),
  credentials: z.strictObject({ appId: identifier, appSecret: secret, permanentCode: secret,
    apiUserId: identifier, expectedEa: identifier, expectedCorpId: corp.optional() }),
  code: secret,
  redirectUrl: z.literal('https://sales.cyanlog.icu/api/auth/fxiaoke/callback'),
})
export type LoginJob = z.infer<typeof jobSchema>
export const validLoginJob = (value: unknown): value is LoginJob => jobSchema.safeParse(value).success
const stages = z.enum(['token_exchange', 'enterprise_verification', 'employee_profile'])
type Stage = z.infer<typeof stages>
const resultSchema = z.strictObject({
  corpId: corp,
  openUserId: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
  profile: z.strictObject({ externalSubject: z.string(), directoryUserId: z.string().regex(/^\d+$/),
    phone: z.string().nullable(), employeeNumber: z.string().nullable(), displayName: z.string(),
    status: z.literal('active'), loginDisabled: z.literal(false).nullable(), deleted: z.literal(false),
    lifeStatus: z.string().nullable() }),
}).refine(value => value.openUserId === value.profile.externalSubject
  && (!value.profile.lifeStatus || ['正常', 'normal'].includes(value.profile.lifeStatus.toLowerCase())))
export async function verifyProviderEmployee(credentials: Credentials, input: { code: string; redirectUrl: string },
  request: typeof fetch | undefined, setStage: (stage: Stage, subject?: string) => void) {
  setStage('token_exchange')
  const identity = await exchangeFxiaokeAuthorizationCode(credentials, input, request)
  setStage('enterprise_verification')
  if (credentials.expectedCorpId) {
    if (credentials.expectedCorpId !== identity.corpId) throw new FxiaokeError('CROSS_ENTERPRISE_IDENTITY', '纷享企业不匹配。', 403)
  } else {
    const enterprise = await discoverEnterprise(credentials, request)
    if (enterprise.ea !== credentials.expectedEa || enterprise.corpId !== identity.corpId) {
      throw new FxiaokeError('CROSS_ENTERPRISE_IDENTITY', '纷享企业不匹配。', 403)
    }
  }
  setStage('employee_profile', identity.openUserId)
  const profile = await readEmployeeIdentity(credentials, identity.openUserId, request)
  return { corpId: identity.corpId, openUserId: identity.openUserId, profile }
}

export async function executeLoginJob(job: LoginJob, request: typeof fetch, lifetimeMs: number): Promise<EgressResult> {
  const deadline = Date.now() + lifetimeMs
  let stage: Stage = 'token_exchange'
  let profileSubject: string | undefined
  try {
    const result = await verifyProviderEmployee(job.credentials, job, async (url, init) => {
      const input = { url: String(url), headers: Object.fromEntries(new Headers(init?.headers)), body: init?.body }
      if (init?.method !== 'POST' || !validRequest(input)) throw new FxiaokeError('EGRESS_REQUEST_DENIED', '请求超出登录范围。', 403)
      const remaining = deadline - Date.now()
      if (remaining < 1) throw new FxiaokeError('PROVIDER_TIMEOUT', '纷享登录超时。', 502)
      const reply = await executeRequest(input, request, remaining)
      if ('error' in reply) throw new FxiaokeError(reply.error === 'TIMEOUT' ? 'PROVIDER_TIMEOUT'
        : reply.error === 'NETWORK' ? 'EGRESS_PROVIDER_UNREACHABLE' : 'INVALID_RESPONSE', '未取得有效登录响应。', 502)
      return new Response([204, 205, 304].includes(reply.status) ? null : reply.body, { status: reply.status })
    }, (next, subject) => { stage = next; profileSubject = subject })
    return { status: 200, body: JSON.stringify(resultSchema.parse(result)) }
  } catch (error) {
    const known = error instanceof FxiaokeError
    return { status: known ? error.status : 502, body: JSON.stringify({ stage, code: known ? error.code : 'INVALID_RESPONSE',
      ...(known && error.code === 'IDENTITY_PROFILE_NOT_FOUND' && profileSubject ? { subject: profileSubject } : {}) }) }
  }
}

export async function readLoginReply(response: Response, credentials: Credentials, setStage: (stage: Stage, subject?: string) => void) {
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z.strictObject({ stage: stages, code: z.string().regex(/^[A-Z_]{1,64}$/), subject: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/).optional() }).safeParse(body)
    if (error.success) {
      setStage(error.data.stage, error.data.code === 'IDENTITY_PROFILE_NOT_FOUND' ? error.data.subject : undefined)
      throw new FxiaokeError(error.data.code, '员工身份认证未完成。', response.status)
    }
    throw new FxiaokeError('INVALID_RESPONSE', '登录服务响应无效。', 502)
  }
  const result = resultSchema.safeParse(body)
  if (!result.success) throw new FxiaokeError('INVALID_RESPONSE', '登录身份无效。', 502)
  if (credentials.expectedCorpId && credentials.expectedCorpId !== result.data.corpId) {
    throw new FxiaokeError('CROSS_ENTERPRISE_IDENTITY', '纷享企业不匹配。', 403)
  }
  return result.data
}
