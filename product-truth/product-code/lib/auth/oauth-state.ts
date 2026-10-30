import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const FXIAOKE_OAUTH_STATE_COOKIE = 'fxiaoke_oauth_state'
export const FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS = 5 * 60

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ConsumedOAuthState = {
  orgId: string
  redirectUrl: string
}

export class OAuthStateError extends Error {
  constructor(readonly code: 'OAUTH_STATE_STORE_UNAVAILABLE' | 'OAUTH_STATE_INVALID', message: string) {
    super(message)
    this.name = 'OAuthStateError'
  }
}

export function hashOAuthState(state: string) {
  return createHash('sha256').update(state).digest('hex')
}

export function oauthStatesMatch(cookieState: string | undefined, queryState: string | null) {
  if (!cookieState || !queryState || !STATE_PATTERN.test(cookieState) || !STATE_PATTERN.test(queryState)) return false
  const left = Buffer.from(cookieState)
  const right = Buffer.from(queryState)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function createOAuthState(orgId: string, redirectUrl: string) {
  if (!UUID_PATTERN.test(orgId)) throw new OAuthStateError('OAUTH_STATE_STORE_UNAVAILABLE', '组织标识无效。')
  if (!/^https?:\/\//.test(redirectUrl) || redirectUrl.length > 2048) {
    throw new OAuthStateError('OAUTH_STATE_STORE_UNAVAILABLE', 'OAuth 回调地址无效。')
  }

  const state = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS * 1000)
  const { error } = await supabaseAdmin
    .from('organization_fxiaoke_oauth_states')
    .insert({
      state_hash: hashOAuthState(state),
      system_org_id: orgId,
      redirect_url: redirectUrl,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    })

  if (error) throw new OAuthStateError('OAUTH_STATE_STORE_UNAVAILABLE', '企业登录状态暂时无法创建。')
  return { state, expiresAt }
}

export async function consumeOAuthState(state: string): Promise<ConsumedOAuthState | null> {
  if (!STATE_PATTERN.test(state)) return null
  const { data, error } = await supabaseAdmin.rpc('consume_fxiaoke_oauth_state', {
    p_state_hash: hashOAuthState(state),
  })
  if (error) throw new OAuthStateError('OAUTH_STATE_STORE_UNAVAILABLE', '企业登录状态暂时无法校验。')

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const orgId = typeof row.system_org_id === 'string' ? row.system_org_id : ''
  const redirectUrl = typeof row.redirect_url === 'string' ? row.redirect_url : ''
  if (!UUID_PATTERN.test(orgId) || !/^https?:\/\//.test(redirectUrl)) return null
  return { orgId, redirectUrl }
}
