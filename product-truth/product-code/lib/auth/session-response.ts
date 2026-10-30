// F003 / WP94. Issue the existing revocable system session after a provider
// identity has already passed state, enterprise and organization checks.
import { randomUUID } from 'node:crypto'
import type { NextResponse } from 'next/server'
import {
  AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS,
  AUTH_CONTEXT_COOKIE_NAME,
  createAuthContextCookieValue,
} from '@/lib/auth-context-cookie'
import { CLIENT_AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/auth-token'
import {
  getFreshUserScopedRoleAssignments,
  getOrgAuthorizationRoleCodes,
  getOrgPermissions,
  getOrgRoleCodes,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

export class SessionIssueError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SessionIssueError'
  }
}

type SessionUserRow = {
  status: string
  login_enabled: boolean
}

export type IssuedSystemSession = {
  token: string
  expiresAt: Date
  authContextCookie: string | null
}

export function createSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
}

export async function issueSystemSession(userId: string, orgId: string): Promise<IssuedSystemSession> {
  const [userResult, assignments] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('status,login_enabled')
      .eq('id', userId)
      .maybeSingle(),
    getFreshUserScopedRoleAssignments(userId),
  ])

  if (userResult.error) {
    throw new SessionIssueError('SESSION_USER_UNAVAILABLE', '登录用户状态暂时无法校验。')
  }
  const user = userResult.data as SessionUserRow | null
  if (!user) throw new SessionIssueError('SESSION_USER_NOT_FOUND', '登录用户不存在。')
  if (user.status !== 'active' || user.login_enabled !== true) {
    throw new SessionIssueError('SESSION_USER_DISABLED', '登录用户已停用或禁止登录。')
  }

  const roleCodes = getOrgRoleCodes(assignments, orgId)
  if (roleCodes.length === 0) {
    throw new SessionIssueError('SESSION_NO_ROLE', '登录用户没有可用的组织角色。')
  }
  const authorizationRoleCodes = getOrgAuthorizationRoleCodes(assignments, orgId)
  const allPermissions = getOrgPermissions(assignments, orgId)
  if (authorizationRoleCodes.includes('SUPER_ADMIN') && !allPermissions.includes('*')) {
    allPermissions.push('*')
  }

  const token = randomUUID()
  const expiresAt = createSessionExpiry()
  const { error } = await supabaseAdmin.from('auth_tokens').insert({
    id: randomUUID(),
    token,
    user_id: userId,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new SessionIssueError('SESSION_CREATE_FAILED', '系统会话创建失败。')

  const authContextCookie = await createAuthContextCookieValue(token, {
    userId,
    orgId,
    roleCodes,
    allPermissions,
    full: true,
  })
  if (!authContextCookie) {
    await supabaseAdmin.from('auth_tokens').delete().eq('token', token)
    throw new SessionIssueError('SESSION_SIGNING_FAILED', '系统会话签名暂时不可用。')
  }

  return { token, expiresAt, authContextCookie }
}

export function applySystemSessionCookies(response: NextResponse, session: IssuedSystemSession) {
  const common = {
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: session.expiresAt,
  }
  response.cookies.set('token', session.token, { ...common, httpOnly: true })
  response.cookies.set(CLIENT_AUTH_COOKIE_NAME, session.token, { ...common, httpOnly: false })
  response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, session.authContextCookie!, {
    ...common,
    httpOnly: true,
    maxAge: AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS,
    expires: undefined,
  })
}
