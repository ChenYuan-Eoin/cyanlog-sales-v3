import type { NextRequest } from 'next/server'
import { getRequestAuthToken } from './auth-token'
import { supabaseAdmin } from './supabase'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  display_name: string | null
  org_id?: string | null
  role?: string
}

export class AuthError extends Error {
  constructor(message: string = 'Unauthorized') {
    super(message)
    this.name = 'AuthError'
  }
}

async function hasActiveFxiaokeSessionSource(userId: string, orgId: string | null | undefined) {
  if (!orgId) return false
  const [sourceResult, membershipResult] = await Promise.all([
    supabaseAdmin.from('organization_sources')
      .select('authority_scope,connection_state,effective_revision')
      .eq('system_org_id', orgId).eq('provider', 'fxiaoke').eq('status', 'active').limit(2),
    supabaseAdmin.from('user_organizations')
      .select('org_id,employment_status').eq('user_id', userId).eq('org_id', orgId)
      .eq('status', 'active').eq('is_default', true).maybeSingle(),
  ])
  if (sourceResult.error || membershipResult.error
    || membershipResult.data?.employment_status !== 'active') return false
  const sources = sourceResult.data || []
  return sources.length === 1
    && sources[0].authority_scope?.identity === 'authoritative'
    && sources[0].connection_state === 'verified'
    && Boolean(sources[0].effective_revision)
}

export async function getAuthUserByToken(token: string): Promise<AuthUser | null> {
  const { data: tokenRecord } = await supabaseAdmin
    .from('auth_tokens')
    .select('user_id, expires_at, auth_method, user:users(id, email, phone, display_name, org_id, status, login_enabled)')
    .eq('token', token)
    .single()

  if (!tokenRecord) return null
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) return null

  const joinedUser = Array.isArray(tokenRecord.user)
    ? tokenRecord.user[0]
    : tokenRecord.user

  let resolvedUser: AuthUser | null = null
  if (
    joinedUser?.id
    && joinedUser.status === 'active'
    && joinedUser.login_enabled === true
  ) {
    resolvedUser = joinedUser as AuthUser
  }

  if (joinedUser?.id && !resolvedUser) return null

  if (!resolvedUser) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, display_name, org_id, status, login_enabled')
      .eq('id', tokenRecord.user_id)
      .single()
    resolvedUser = user?.status === 'active' && user.login_enabled === true ? user : null
  }

  if (tokenRecord.auth_method === 'fxiaoke' && resolvedUser
    && !await hasActiveFxiaokeSessionSource(resolvedUser.id, resolvedUser.org_id)) return null
  return resolvedUser
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = getRequestAuthToken(req)

  if (!token) return null

  // Session state must be checked for every request. Cross-instance admin
  // revocation cannot safely invalidate an in-memory token cache.
  return getAuthUserByToken(token)
}

export async function requireAuth(req: NextRequest): Promise<AuthUser> {
  const user = await getAuthUser(req)
  if (!user) {
    throw new AuthError()
  }
  return user
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255)
}
