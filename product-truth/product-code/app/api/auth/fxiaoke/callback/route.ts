// F003 / WP94. Verify the one-time state, provider identity and system tenant
// before issuing the existing revocable application session.
import { NextRequest, NextResponse } from 'next/server'
import {
  FXIAOKE_OAUTH_STATE_COOKIE,
  OAuthStateError,
  consumeOAuthState,
  oauthStatesMatch,
} from '@/lib/auth/oauth-state'
import { applySystemSessionCookies, issueSystemSession } from '@/lib/auth/session-response'
import { discoverEnterprise, readEmployeeIdentity } from '@/lib/fxiaoke/client'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'
import { resolveFxiaokeIdentity } from '@/lib/fxiaoke/identity'
import { exchangeFxiaokeAuthorizationCode } from '@/lib/fxiaoke/oauth'
import { resolveConfiguredOAuthOrganization } from '@/lib/fxiaoke/sso'

export const runtime = 'nodejs'
export const maxDuration = 60

function clearStateCookie(response: NextResponse) {
  response.cookies.set(FXIAOKE_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/fxiaoke/callback',
    maxAge: 0,
    expires: new Date(0),
  })
  return response
}

function loginError(request: NextRequest, code: string) {
  const target = new URL('/login', request.nextUrl.origin)
  target.searchParams.set('sso_error', code)
  const response = NextResponse.redirect(target, 302)
  response.headers.set('Cache-Control', 'no-store')
  return clearStateCookie(response)
}

function successHandoff(request: NextRequest) {
  const nextPath = '/'
  const escapedPath = JSON.stringify(nextPath)
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在进入工作台</title></head><body><p>正在进入工作台…</p><script>(function(){var match=document.cookie.split('; ').find(function(item){return item.indexOf('client_token=')===0});if(match){localStorage.setItem('token',decodeURIComponent(match.slice('client_token='.length)))}window.location.replace(${escapedPath})})()</script></body></html>`
  const response = new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
  response.headers.set('Content-Location', new URL(nextPath, request.nextUrl.origin).toString())
  return response
}

function errorCode(error: unknown) {
  if (error instanceof OAuthStateError) {
    return error.code === 'OAUTH_STATE_INVALID' ? 'SSO_STATE_INVALID' : 'SSO_STATE_UNAVAILABLE'
  }
  if (error instanceof FxiaokeError) {
    if (error.code === 'CROSS_ENTERPRISE_IDENTITY' || error.code === 'ENTERPRISE_MISMATCH') return 'SSO_ENTERPRISE_MISMATCH'
    if (error.code.startsWith('IDENTITY_') || error.code === 'ORGANIZATION_MISMATCH' || error.code === 'BOOTSTRAP_ADMIN_INVALID') return 'SSO_IDENTITY_REJECTED'
    if (error.code === 'CONFIGURATION_REQUIRED' || error.code === 'CREDENTIALS_UNREADABLE' || error.code === 'SSO_ORGANIZATION_AMBIGUOUS' || error.code === 'SSO_ORGANIZATION_INVALID') return 'SSO_CONFIGURATION_INVALID'
    return 'SSO_PROVIDER_FAILED'
  }
  if (error instanceof Error && error.name === 'SessionIssueError') return 'SSO_SESSION_FAILED'
  return 'SSO_CALLBACK_FAILED'
}

type CallbackStage = 'configuration' | 'token_exchange' | 'enterprise_verification' | 'employee_profile' | 'identity_mapping' | 'session_issue'
const SAFE_DIAGNOSTIC_CODES = new Set([
  'SSO_CONFIGURATION_UNAVAILABLE', 'CONFIG_STORAGE_UNAVAILABLE',
  'INVALID_OAUTH_CALLBACK', 'PROVIDER_TIMEOUT', 'PROVIDER_DNS', 'PROVIDER_UNAVAILABLE',
  'PROVIDER_HTTP_ERROR', 'INVALID_RESPONSE', 'OAUTH_CODE_REJECTED', 'INVALID_TOKEN_RESPONSE',
  'PROVIDER_TLS', 'PROVIDER_CONNECTION', 'PROVIDER_UNREACHABLE', 'PROVIDER_REJECTED',
  'TENANT_MISMATCH', 'EMPLOYEE_INACTIVE', 'INVALID_IDENTITY',
  'EGRESS_UNAVAILABLE', 'EGRESS_REQUEST_DENIED', 'EGRESS_IP_CHANGED', 'EGRESS_PROVIDER_UNREACHABLE',
])

function reportFailure(stage: CallbackStage, error: unknown) {
  // Only fixed internal codes and numeric status are safe here. Never log the
  // exception, message, request URL, OAuth code/state, or provider profile.
  const code = error instanceof FxiaokeError && SAFE_DIAGNOSTIC_CODES.has(error.code)
    ? error.code
    : errorCode(error)
  const status = error instanceof FxiaokeError && Number.isInteger(error.status)
    && error.status >= 400 && error.status <= 599 ? error.status : undefined
  console.warn('fxiaoke_sso_callback_failed', { stage, code, ...(status ? { status } : {}) })
}

async function verifyEnterprise(
  orgId: string,
  credentials: Awaited<ReturnType<typeof resolveConfiguredOAuthOrganization>>['credentials'],
  oauthCorpId: string,
) {
  if (credentials.expectedCorpId) {
    if (credentials.expectedCorpId !== oauthCorpId) {
      throw new FxiaokeError('CROSS_ENTERPRISE_IDENTITY', '纷享登录身份不属于当前系统企业。', 403)
    }
    return
  }

  // Legacy rows did not persist the enterprise corp identifier. Verify the
  // application-token enterprise on this callback and never trust the browser.
  const enterprise = await discoverEnterprise(credentials, transportForOrganization(orgId))
  if (enterprise.ea !== credentials.expectedEa || enterprise.corpId !== oauthCorpId) {
    throw new FxiaokeError('CROSS_ENTERPRISE_IDENTITY', '纷享登录身份不属于当前系统企业。', 403)
  }
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state')
  const cookieState = request.cookies.get(FXIAOKE_OAUTH_STATE_COOKIE)?.value

  if (!oauthStatesMatch(cookieState, state) || !state) {
    return loginError(request, 'SSO_STATE_INVALID')
  }

  let consumed: Awaited<ReturnType<typeof consumeOAuthState>>
  try {
    consumed = await consumeOAuthState(state)
  } catch (error) {
    return loginError(request, errorCode(error))
  }
  if (!consumed) return loginError(request, 'SSO_STATE_INVALID')

  const providerError = request.nextUrl.searchParams.get('error')
  const code = request.nextUrl.searchParams.get('code')
  if (providerError) return loginError(request, 'SSO_PROVIDER_DENIED')
  if (!code || code.length > 2048) return loginError(request, 'SSO_CODE_INVALID')

  let stage: CallbackStage = 'configuration'
  try {
    const { orgId, credentials } = await resolveConfiguredOAuthOrganization()
    if (orgId !== consumed.orgId) {
      throw new FxiaokeError('SSO_ORGANIZATION_INVALID', '企业登录状态与当前配置企业不一致。', 409)
    }
    stage = 'token_exchange'
    const identity = await exchangeFxiaokeAuthorizationCode(credentials, {
      code,
      redirectUrl: consumed.redirectUrl,
    }, transportForOrganization(orgId))
    stage = 'enterprise_verification'
    await verifyEnterprise(orgId, credentials, identity.corpId)
    stage = 'employee_profile'
    const profile = await readEmployeeIdentity(
      credentials,
      identity.openUserId,
      transportForOrganization(orgId),
    )
    stage = 'identity_mapping'
    const mapped = await resolveFxiaokeIdentity({
      orgId,
      corpId: identity.corpId,
      externalSubject: identity.openUserId,
      phone: profile.phone,
      employeeNumber: profile.employeeNumber,
      displayName: profile.displayName,
      providerStatus: profile.status,
      lifeStatus: profile.lifeStatus,
      loginDisabled: profile.loginDisabled,
    })
    stage = 'session_issue'
    const session = await issueSystemSession(mapped.userId, mapped.orgId)
    const response = successHandoff(request)
    applySystemSessionCookies(response, session)
    return clearStateCookie(response)
  } catch (error) {
    reportFailure(stage, error)
    return loginError(request, errorCode(error))
  }
}
