import type { NextRequest } from 'next/server'
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

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ||
    req.cookies.get('token')?.value

  if (!token) return null

  const { data: tokenRecord } = await supabaseAdmin
    .from('auth_tokens')
    .select('user_id, expires_at')
    .eq('token', token)
    .single()

  if (!tokenRecord) return null
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) return null

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, display_name')
    .eq('id', tokenRecord.user_id)
    .single()

  return user
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
