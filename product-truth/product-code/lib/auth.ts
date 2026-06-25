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

type CachedAuth = {
  user: AuthUser | null
  expiresAt: number
}

const AUTH_CACHE_TTL_MS = 15_000
const authCache = new Map<string, CachedAuth>()
const authInflight = new Map<string, Promise<AuthUser | null>>()

function getCachedAuth(token: string): AuthUser | null | undefined {
  const cached = authCache.get(token)
  if (!cached) return undefined
  if (cached.expiresAt < Date.now()) {
    authCache.delete(token)
    return undefined
  }
  return cached.user
}

function setCachedAuth(token: string, user: AuthUser | null) {
  authCache.set(token, {
    user,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  })
}

export function invalidateAuthCache(token: string | null | undefined) {
  if (!token) return
  authCache.delete(token)
  authInflight.delete(token)
}

export function primeAuthCache(token: string | null | undefined, user: AuthUser | null) {
  if (!token) return
  setCachedAuth(token, user)
}

async function fetchAuthUser(token: string): Promise<AuthUser | null> {
  const { data: tokenRecord } = await supabaseAdmin
    .from('auth_tokens')
    .select('user_id, expires_at, user:users(id, email, phone, display_name, org_id)')
    .eq('token', token)
    .single()

  if (!tokenRecord) return null
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) return null

  const joinedUser = Array.isArray(tokenRecord.user)
    ? tokenRecord.user[0]
    : tokenRecord.user

  if (joinedUser?.id) {
    return joinedUser as AuthUser
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, display_name, org_id')
    .eq('id', tokenRecord.user_id)
    .single()

  return user
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = getRequestAuthToken(req)

  if (!token) return null

  const cached = getCachedAuth(token)
  if (cached !== undefined) return cached

  let inflight = authInflight.get(token)
  if (!inflight) {
    inflight = fetchAuthUser(token)
      .then((user) => {
        setCachedAuth(token, user)
        return user
      })
      .finally(() => {
        authInflight.delete(token)
      })
    authInflight.set(token, inflight)
  }

  return inflight
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
