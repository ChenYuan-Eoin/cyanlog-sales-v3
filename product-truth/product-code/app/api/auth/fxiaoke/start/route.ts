// F003 / WP94. Start only from a fixed server-owned callback and one configured organization.
import { after, NextRequest, NextResponse } from 'next/server'
import {
  FXIAOKE_OAUTH_STATE_COOKIE,
  FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS,
  createOAuthState,
} from '@/lib/auth/oauth-state'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { getFxiaokeRotationTrial } from '@/lib/fxiaoke/credential-rotation'
import { buildFxiaokeAuthorizationUrl } from '@/lib/fxiaoke/oauth'
import { createFxiaokeOAuthContext, FXIAOKE_OAUTH_CONTEXT_COOKIE } from '@/lib/fxiaoke/oauth-state'
import { fxiaokeReturnPath } from '@/lib/fxiaoke/return-path'
import { resolveConfiguredOAuthOrganization } from '@/lib/fxiaoke/sso'

import { transportForOrganization } from '@/lib/fxiaoke/egress/server'

export const runtime = 'nodejs'

function callbackUrl(request: NextRequest) {
  const configured = process.env.FXIAOKE_OAUTH_REDIRECT_URL?.trim()
  const url = configured
    ? new URL(configured)
    : new URL('/api/auth/fxiaoke/callback', request.nextUrl.origin)
  if (url.pathname !== '/api/auth/fxiaoke/callback' || url.search || url.hash) {
    throw new FxiaokeError('SSO_REDIRECT_INVALID', '企业登录回调地址配置无效。', 503)
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new FxiaokeError('SSO_REDIRECT_INVALID', '企业登录回调地址必须使用 HTTPS。', 503)
  }
  return url.toString()
}

function loginError(request: NextRequest, code: string, next: string | null) {
  const target = new URL('/login', request.nextUrl.origin)
  target.searchParams.set('sso_error', code)
  if (next && next !== '/') target.searchParams.set('next', next)
  const response = NextResponse.redirect(target, 302)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: NextRequest) {
  const trialToken = request.nextUrl.searchParams.get('trial')
  const next = fxiaokeReturnPath(request.nextUrl.searchParams.get('next'))
  try {
    const rotation = trialToken === null ? null : await getFxiaokeRotationTrial(trialToken)
    const { orgId, revision, credentials } = rotation || await resolveConfiguredOAuthOrganization()
    const redirectUrl = callbackUrl(request)
    if (!credentials.appId) {
      throw new FxiaokeError('CREDENTIALS_UNREADABLE', '纷享企业登录配置不完整。', 503)
    }

    const { state, expiresAt } = await createOAuthState(orgId, redirectUrl)
    const context = createFxiaokeOAuthContext(state, revision, next, rotation?.trial)
    const authorizationUrl = buildFxiaokeAuthorizationUrl({
      appId: credentials.appId,
      redirectUrl,
      state,
    })
    const response = NextResponse.redirect(authorizationUrl, 302)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/fxiaoke/callback',
      maxAge: FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS,
      expires: expiresAt,
    }
    response.cookies.set(FXIAOKE_OAUTH_STATE_COOKIE, state, cookieOptions)
    response.cookies.set(FXIAOKE_OAUTH_CONTEXT_COOKIE, context, cookieOptions)
    // The employee is now going to the provider. The worker can refresh its
    // egress IP and TLS connection before the one-time authorization code returns.
    const transport = transportForOrganization(orgId)
    if (transport) after(transport.prepareLogin)
    return response
  } catch (error) {
    if (trialToken !== null) {
      return new NextResponse('纷享员工验证链接已失效或暂不可用。请联系管理员重新发起。', {
        status: 409, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      })
    }
    if (error instanceof FxiaokeError) {
      const code = error.code === 'CONFIGURATION_REQUIRED'
        ? 'SSO_NOT_CONFIGURED'
        : error.code === 'SSO_ORGANIZATION_AMBIGUOUS'
          ? 'SSO_CONFIGURATION_AMBIGUOUS'
          : 'SSO_CONFIGURATION_INVALID'
      return loginError(request, code, next)
    }
    return loginError(request, 'SSO_START_FAILED', next)
  }
}
