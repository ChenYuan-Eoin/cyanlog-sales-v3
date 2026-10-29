// F003 / WP94. Start only from a fixed server-owned callback and one configured organization.
import { NextRequest, NextResponse } from 'next/server'
import {
  FXIAOKE_OAUTH_STATE_COOKIE,
  FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS,
  createOAuthState,
} from '@/lib/auth/oauth-state'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { buildFxiaokeAuthorizationUrl } from '@/lib/fxiaoke/oauth'
import { resolveConfiguredOAuthOrganization } from '@/lib/fxiaoke/sso'

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

function loginError(request: NextRequest, code: string) {
  const target = new URL('/login', request.nextUrl.origin)
  target.searchParams.set('sso_error', code)
  const response = NextResponse.redirect(target, 302)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: NextRequest) {
  try {
    const { orgId, credentials } = await resolveConfiguredOAuthOrganization()
    const redirectUrl = callbackUrl(request)
    if (!credentials.appId) {
      throw new FxiaokeError('CREDENTIALS_UNREADABLE', '纷享企业登录配置不完整。', 503)
    }

    const { state, expiresAt } = await createOAuthState(orgId, redirectUrl)
    const authorizationUrl = buildFxiaokeAuthorizationUrl({
      appId: credentials.appId,
      redirectUrl,
      state,
    })
    const response = NextResponse.redirect(authorizationUrl, 302)
    response.headers.set('Cache-Control', 'no-store')
    response.cookies.set(FXIAOKE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/fxiaoke/callback',
      maxAge: FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS,
      expires: expiresAt,
    })
    return response
  } catch (error) {
    if (error instanceof FxiaokeError) {
      const code = error.code === 'CONFIGURATION_REQUIRED'
        ? 'SSO_NOT_CONFIGURED'
        : error.code === 'SSO_ORGANIZATION_AMBIGUOUS'
          ? 'SSO_CONFIGURATION_AMBIGUOUS'
          : 'SSO_CONFIGURATION_INVALID'
      return loginError(request, code)
    }
    return loginError(request, 'SSO_START_FAILED')
  }
}
