// F003 / WP94. Verify the one-time state, provider identity and system tenant
// before issuing the existing revocable application session.
import { NextRequest, NextResponse } from 'next/server'
import {
  FXIAOKE_OAUTH_STATE_COOKIE,
  OAuthStateError,
  consumeOAuthState,
  oauthStatesMatch,
} from '@/lib/auth/oauth-state'
import { applySystemSessionCookies, issueSystemSession, SessionIssueError, type IssuedSystemSession } from '@/lib/auth/session-response'
import { verifyProviderEmployee } from '@/lib/fxiaoke/egress/login-job'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { completeFxiaokeCredentialRotation, loadFxiaokeTrialCredentials } from '@/lib/fxiaoke/credential-rotation'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'
import { resolveFxiaokeIdentity } from '@/lib/fxiaoke/identity'
import { FXIAOKE_OAUTH_CONTEXT_COOKIE, readFxiaokeOAuthContext } from '@/lib/fxiaoke/oauth-state'
import { resolveConfiguredOAuthOrganization } from '@/lib/fxiaoke/sso'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function clearStateCookie(response: NextResponse) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/fxiaoke/callback',
    maxAge: 0,
    expires: new Date(0),
  }
  response.cookies.set(FXIAOKE_OAUTH_STATE_COOKIE, '', cookieOptions)
  response.cookies.set(FXIAOKE_OAUTH_CONTEXT_COOKIE, '', cookieOptions)
  return response
}

function loginError(request: NextRequest, code: string, nextPath?: string | null, clearCookies = true) {
  const target = new URL('/login', request.nextUrl.origin)
  target.searchParams.set('sso_error', code)
  if (nextPath && nextPath !== '/') target.searchParams.set('next', nextPath)
  const response = NextResponse.redirect(target, 302)
  response.headers.set('Cache-Control', 'no-store')
  return clearCookies ? clearStateCookie(response) : response
}

function rotationResult(verified: boolean, status: number) {
  return clearStateCookie(new NextResponse(verified
    ? '纷享员工验证已通过。请告知管理员回到 ICU 连接凭证页确认启用。'
    : '纷享员工验证未完成。请用管理员选定的员工账号重试，或请管理员重新发起。', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  }))
}

function successHandoff(request: NextRequest, nextPath: string) {
  const escapedPath = JSON.stringify(nextPath).replaceAll('<', '\\u003c')
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
    if (error.code === 'EGRESS_NOT_CLAIMED' || error.code === 'EGRESS_UNAVAILABLE') return 'SSO_DISPATCH_UNAVAILABLE'
    if (error.code === 'CROSS_ENTERPRISE_IDENTITY' || error.code === 'ENTERPRISE_MISMATCH') return 'SSO_ENTERPRISE_MISMATCH'
    if (error.code === 'IDENTITY_DISABLED' || error.code === 'EMPLOYEE_INACTIVE') return 'SSO_ACCOUNT_DISABLED'
    if (error.code === 'IDENTITY_BINDING_REQUIRED' || error.code === 'IDENTITY_CONFLICT' || error.code === 'IDENTITY_UNMAPPED') return 'SSO_ACCOUNT_PENDING'
    if (error.code === 'SSO_CONFIGURATION_CHANGED') return 'SSO_CONFIGURATION_CHANGED'
    if (error.code.startsWith('IDENTITY_') || error.code === 'ORGANIZATION_MISMATCH' || error.code === 'BOOTSTRAP_ADMIN_INVALID') return 'SSO_IDENTITY_REJECTED'
    if (error.code === 'CONFIGURATION_REQUIRED' || error.code === 'CREDENTIALS_UNREADABLE' || error.code === 'SSO_ORGANIZATION_AMBIGUOUS' || error.code === 'SSO_ORGANIZATION_INVALID') return 'SSO_CONFIGURATION_INVALID'
    return 'SSO_PROVIDER_FAILED'
  }
  if (error instanceof Error && error.name === 'SessionIssueError') return 'SSO_SESSION_FAILED'
  return 'SSO_CALLBACK_FAILED'
}

type CallbackStage = 'configuration' | 'token_exchange' | 'enterprise_verification' | 'employee_profile' | 'identity_mapping' | 'session_issue' | 'login_audit'
const SAFE_DIAGNOSTIC_CODES = new Set([
  'SSO_CONFIGURATION_UNAVAILABLE', 'CONFIG_STORAGE_UNAVAILABLE',
  'INVALID_OAUTH_CALLBACK', 'PROVIDER_TIMEOUT', 'PROVIDER_DNS', 'PROVIDER_UNAVAILABLE',
  'PROVIDER_HTTP_ERROR', 'INVALID_RESPONSE', 'OAUTH_CODE_REJECTED', 'INVALID_TOKEN_RESPONSE',
  'PROVIDER_TLS', 'PROVIDER_CONNECTION', 'PROVIDER_UNREACHABLE', 'PROVIDER_REJECTED',
  'TENANT_MISMATCH', 'EMPLOYEE_INACTIVE', 'INVALID_IDENTITY',
  'IDENTITY_PROFILE_RESPONSE_INVALID', 'IDENTITY_PROFILE_NOT_FOUND', 'IDENTITY_PROFILE_AMBIGUOUS',
  'EGRESS_UNAVAILABLE', 'EGRESS_NOT_CLAIMED', 'EGRESS_REQUEST_DENIED', 'EGRESS_IP_CHANGED', 'EGRESS_PROVIDER_UNREACHABLE',
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

export async function GET(request: NextRequest) {
  const started = performance.now()
  const state = request.nextUrl.searchParams.get('state')
  const cookieState = request.cookies.get(FXIAOKE_OAUTH_STATE_COOKIE)?.value

  if (!oauthStatesMatch(cookieState, state) || !state) {
    return loginError(request, 'SSO_STATE_INVALID', null, false)
  }

  let oauthContext: ReturnType<typeof readFxiaokeOAuthContext>
  try {
    oauthContext = readFxiaokeOAuthContext(state, request.cookies.get(FXIAOKE_OAUTH_CONTEXT_COOKIE)?.value)
  } catch {
    return loginError(request, 'SSO_CONFIGURATION_INVALID')
  }
  if (!oauthContext) return loginError(request, 'SSO_STATE_INVALID')

  const trial = oauthContext.trial
  const fail = (code: string, status = 409) => trial
    ? rotationResult(false, status) : loginError(request, code, oauthContext.next)

  let consumed: Awaited<ReturnType<typeof consumeOAuthState>>
  try {
    consumed = await consumeOAuthState(state)
  } catch (error) {
    return fail(errorCode(error))
  }
  if (!consumed) return fail('SSO_STATE_INVALID')

  const providerError = request.nextUrl.searchParams.get('error')
  const code = request.nextUrl.searchParams.get('code')
  if (providerError) return fail('SSO_PROVIDER_DENIED')
  if (!code || code.length > 2048) return fail('SSO_CODE_INVALID', 400)

  const progress: { stage: CallbackStage } = { stage: 'configuration' }
  let session: IssuedSystemSession | null = null
  const profileLookup: { orgId?: string; subject?: string; apiUserId?: string } = {}
  try {
    const { orgId, revision, credentials } = trial
      ? { orgId: consumed.orgId, revision: oauthContext.revision,
          credentials: await loadFxiaokeTrialCredentials(consumed.orgId, oauthContext.revision, trial) }
      : await resolveConfiguredOAuthOrganization()
    if (orgId !== consumed.orgId) {
      throw new FxiaokeError('SSO_ORGANIZATION_INVALID', '企业登录状态与当前配置企业不一致。', 409)
    }
    if (revision !== oauthContext.revision) {
      throw new FxiaokeError('SSO_CONFIGURATION_CHANGED', '纷享登录配置已变更，请重新发起登录。', 409)
    }
    const transport = transportForOrganization(orgId)
    progress.stage = 'token_exchange'
    const input = { code, redirectUrl: consumed.redirectUrl }
    const setStage: Parameters<typeof verifyProviderEmployee>[3] = (next, subject) => {
      progress.stage = next
      if (subject) Object.assign(profileLookup, { orgId, subject, apiUserId: credentials.apiUserId })
    }
    const { corpId, profile } = transport?.verifyEmployee
      ? await transport.verifyEmployee(credentials, input, setStage)
      : await verifyProviderEmployee(credentials, input, transport, setStage)
    progress.stage = 'identity_mapping'
    if (trial) {
      const verified = await completeFxiaokeCredentialRotation({
        orgId, trialId: trial.id, revision, externalUserId: profile.directoryUserId,
      })
      return rotationResult(verified, verified ? 200 : 409)
    }
    const mapped = await resolveFxiaokeIdentity({
      orgId,
      corpId,
      externalSubject: profile.directoryUserId,
      phone: profile.phone,
      employeeNumber: profile.employeeNumber,
      displayName: profile.displayName,
      providerStatus: profile.status,
      lifeStatus: profile.lifeStatus,
      loginDisabled: profile.loginDisabled,
    })
    progress.stage = 'session_issue'
    session = await issueSystemSession(mapped.userId, mapped.orgId, 'fxiaoke')
    progress.stage = 'login_audit'
    const audit = await supabaseAdmin.rpc('record_fxiaoke_sso_login_v1', {
      p_org_id: mapped.orgId,
      p_user_id: mapped.userId,
      p_external_user_id: profile.directoryUserId,
      p_session_id: session.sessionId,
    })
    if (audit.error || audit.data !== true) {
      throw new SessionIssueError('SESSION_AUDIT_FAILED', '纷享登录审计未完成。')
    }
    const response = successHandoff(request, oauthContext.next || '/')
    response.headers.set('Server-Timing', `fxiaoke_login;dur=${Math.round(performance.now() - started)}`)
    applySystemSessionCookies(response, session)
    return clearStateCookie(response)
  } catch (error) {
    if (session) {
      // The browser must not receive a session whose success audit failed.
      try { await supabaseAdmin.from('auth_tokens').delete().eq('id', session.sessionId) } catch { /* no token reaches the browser */ }
    }
    reportFailure(progress.stage, error)
    if (progress.stage === 'employee_profile' && error instanceof FxiaokeError
      && error.code === 'IDENTITY_PROFILE_NOT_FOUND' && profileLookup.subject && profileLookup.orgId) {
      // Diagnose identifier drift without recording the OAuth subject, employee
      // profile, provider token or any credential in Production logs.
      let mapping: 'present' | 'absent' | 'unknown' = 'unknown'
      try {
        const { data, error: lookupError } = await supabaseAdmin.from('external_identities')
          .select('id')
          .eq('system_org_id', profileLookup.orgId)
          .eq('external_user_id', profileLookup.subject)
          .limit(1)
        if (!lookupError) mapping = data?.length ? 'present' : 'absent'
      } catch { /* Keep the original login rejection when diagnosis is unavailable. */ }
      console.warn('fxiaoke_sso_profile_empty_diagnostic', {
        subjectFormat: /^\d+$/.test(profileLookup.subject) ? 'numeric'
          : profileLookup.subject.startsWith('FSUID_') ? 'fsuid' : 'other',
        matchesConfiguredApiUser: profileLookup.subject === profileLookup.apiUserId,
        directoryMapping: mapping,
      })
    }
    return fail(errorCode(error))
  }
}
