import type { NextRequest } from 'next/server'
import { getRequestAuthToken } from './auth-token'
import { supabaseAdmin } from './supabase'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  display_name: string | null
  role?: string
}

export class AuthError extends Error {
  constructor(message: string = 'Unauthorized') {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * 认证依赖不可用与“token 无效”必须分开。
 * 否则 Supabase 网络故障会被错误映射成 401，诱导客户端清空有效登录态。
 */
export class AuthDependencyError extends Error {
  constructor(message: string = 'Authentication dependency unavailable') {
    super(message)
    this.name = 'AuthDependencyError'
  }
}

const AUTH_QUERY_TIMEOUT_MS = 8_000

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = getRequestAuthToken(req)

  if (!token) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AUTH_QUERY_TIMEOUT_MS)

  try {
    const { data: tokenRecord, error: tokenError } = await supabaseAdmin
      .from('auth_tokens')
      .select('user_id, expires_at')
      .eq('token', token)
      .abortSignal(controller.signal)
      .maybeSingle()

    if (tokenError) {
      throw new AuthDependencyError('Authentication token lookup failed')
    }
    if (!tokenRecord) return null
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) return null

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, display_name')
      .eq('id', tokenRecord.user_id)
      .abortSignal(controller.signal)
      .maybeSingle()

    if (userError) {
      throw new AuthDependencyError('Authentication user lookup failed')
    }

    return user
  } catch (error) {
    if (error instanceof AuthDependencyError) throw error
    throw new AuthDependencyError()
  } finally {
    clearTimeout(timeout)
  }
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
