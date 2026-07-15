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

export async function getAuthUserByToken(token: string): Promise<AuthUser | null> {
  const { data: tokenRecord } = await supabaseAdmin
    .from('auth_tokens')
    .select('user_id, expires_at, user:users(id, email, phone, display_name, org_id, status, login_enabled)')
    .eq('token', token)
    .single()

  if (!tokenRecord) return null
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) return null

  const joinedUser = Array.isArray(tokenRecord.user)
    ? tokenRecord.user[0]
    : tokenRecord.user

  if (
    joinedUser?.id
    && joinedUser.status === 'active'
    && joinedUser.login_enabled === true
  ) {
    return joinedUser as AuthUser
  }

  if (joinedUser?.id) return null

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, display_name, org_id, status, login_enabled')
    .eq('id', tokenRecord.user_id)
    .single()

  return user?.status === 'active' && user.login_enabled === true
    ? user
    : null
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
