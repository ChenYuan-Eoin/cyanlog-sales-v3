// F003 / WP94: explicitly enabled, existing-member credential admission only.
import { NextRequest, NextResponse } from 'next/server'
import { isLocalAccountLoginEnabled } from '@/lib/auth/local-account-config'
import {
  LocalAccountLoginError,
  loginExistingLocalAccount,
  parseLocalLoginInput,
  revokeLocalLoginSession,
  validateLocalLoginRequest,
} from '@/lib/auth/local-account'
import { applySystemSessionCookies, type IssuedSystemSession } from '@/lib/auth/session-response'

export const runtime = 'nodejs'
export const preferredRegion = 'sin1'
const headers = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  if (!isLocalAccountLoginEnabled()) return NextResponse.json({ error: '登录方式暂未启用。' }, { status: 404, headers })
  let session: IssuedSystemSession | null = null
  try {
    const ip = validateLocalLoginRequest(req)
    const input = await parseLocalLoginInput(req)
    session = await loginExistingLocalAccount(input, ip)
    const response = NextResponse.json({ token: session.token, expiresAt: session.expiresAt.toISOString() }, { headers })
    applySystemSessionCookies(response, session)
    return response
  } catch (error) {
    if (session) {
      try { await revokeLocalLoginSession(session.token) } catch { /* No token or cookie is returned. */ }
    }
    const code = error instanceof LocalAccountLoginError ? error.code : 'UNAVAILABLE'
    const status = code === 'INVALID_REQUEST' ? 400 : code === 'AUTH_FAILED' ? 401 : code === 'RATE_LIMITED' ? 429 : 503
    const message = code === 'INVALID_REQUEST' ? '登录信息格式不正确。'
      : code === 'AUTH_FAILED' ? '账号或密码错误，或当前账号暂不可用。'
      : code === 'RATE_LIMITED' ? '登录尝试过于频繁，请稍后再试。' : '登录服务暂时不可用，请稍后重试。'
    const response = NextResponse.json({ error: message, code }, { status, headers })
    if (error instanceof LocalAccountLoginError && code === 'RATE_LIMITED') {
      response.headers.set('Retry-After', String(error.retryAfter ?? 900))
    }
    return response
  }
}
