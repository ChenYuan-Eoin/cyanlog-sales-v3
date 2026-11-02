// F003 / WP94. Official Fxiaoke OAuth authorization-code exchange.
import { randomUUID } from 'node:crypto'
import { FxiaokeError, type Credentials } from './contracts'

const OAUTH_ORIGIN = 'https://open.fxiaoke.com'
const IDENTIFIER = /^[A-Za-z0-9_-]{1,255}$/
const CORP_ID = /^FSCID_[A-Za-z0-9_-]{1,128}$/

type OAuthTokenRow = {
  errorCode?: unknown
  errorMessage?: unknown
  openUserId?: unknown
  accessToken?: unknown
  corpId?: unknown
  expiresIn?: unknown
  refreshToken?: unknown
}

function object(value: unknown): OAuthTokenRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as OAuthTokenRow : {}
}

export function buildFxiaokeAuthorizationUrl(input: {
  appId: string
  redirectUrl: string
  state: string
}) {
  if (!IDENTIFIER.test(input.appId)) throw new FxiaokeError('INVALID_CONFIGURATION', '纷享应用 ID 无效。')
  const url = new URL(`${OAUTH_ORIGIN}/oauth2.0/authorize`)
  url.searchParams.set('responseType', 'code')
  url.searchParams.set('appId', input.appId)
  url.searchParams.set('redirectUrl', input.redirectUrl)
  url.searchParams.set('state', input.state)
  url.searchParams.set('thirdTraceId', randomUUID())
  return url
}

export async function exchangeFxiaokeAuthorizationCode(
  credentials: Pick<Credentials, 'appId' | 'appSecret'>,
  input: { code: string; redirectUrl: string },
  request: typeof fetch = fetch
) {
  if (!input.code || input.code.length > 2048 || !/^https?:\/\//.test(input.redirectUrl)) {
    throw new FxiaokeError('INVALID_OAUTH_CALLBACK', '企业登录回调无效，请重新发起登录。', 400)
  }

  let response: Response
  try {
    response = await request(`${OAUTH_ORIGIN}/oauth2.0/token?thirdTraceId=${randomUUID()}`, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        redirectUrl: input.redirectUrl,
        code: input.code,
        grantType: 'authorization_code',
      }),
    })
  } catch (error) {
    // The constrained transport already supplies safe internal categories.
    // Preserve them so a missing/changed egress cannot masquerade as Provider failure.
    if (error instanceof FxiaokeError) throw error
    const cause = error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: { code?: unknown } }).cause
      : undefined
    const code = error instanceof Error && error.name === 'TimeoutError'
      ? 'PROVIDER_TIMEOUT'
      : cause?.code === 'ENOTFOUND'
        ? 'PROVIDER_DNS'
        : 'PROVIDER_UNAVAILABLE'
    throw new FxiaokeError(code, '纷享登录服务暂时不可用，请稍后重试。', 502)
  }

  if (!response.ok) {
    throw new FxiaokeError('PROVIDER_HTTP_ERROR', `纷享登录接口返回 HTTP ${response.status}。`, 502)
  }

  let data: OAuthTokenRow
  try {
    data = object(await response.json())
  } catch {
    throw new FxiaokeError('INVALID_RESPONSE', '纷享登录接口没有返回有效数据。', 502)
  }

  if (data.errorCode !== undefined && data.errorCode !== 0) {
    const code = Number.isSafeInteger(data.errorCode) ? String(data.errorCode) : '未知'
    throw new FxiaokeError('OAUTH_CODE_REJECTED', `纷享拒绝登录授权码（错误码 ${code}），请重新登录。`, 400)
  }

  if (
    typeof data.openUserId !== 'string'
    || !IDENTIFIER.test(data.openUserId)
    || typeof data.corpId !== 'string'
    || !CORP_ID.test(data.corpId)
    || typeof data.accessToken !== 'string'
    || !data.accessToken
    || !Number.isSafeInteger(data.expiresIn)
    || Number(data.expiresIn) <= 0
  ) {
    throw new FxiaokeError('INVALID_TOKEN_RESPONSE', '纷享未返回有效的员工授权身份。', 502)
  }

  // The access token and refresh token remain server-side and are deliberately
  // discarded: the application only needs the verified stable identity to
  // issue its own revocable system session.
  return {
    openUserId: data.openUserId,
    corpId: data.corpId,
    expiresIn: Number(data.expiresIn),
  }
}
