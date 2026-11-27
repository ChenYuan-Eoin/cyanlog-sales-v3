import { createHmac, timingSafeEqual } from 'node:crypto'
import { FxiaokeError } from './contracts'
import type { FxiaokeRotationContext } from './credential-rotation'
import { fxiaokeReturnPath } from './return-path'

export const FXIAOKE_OAUTH_CONTEXT_COOKIE = 'fxiaoke_oauth_context'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTEXT_COOKIE = /^([A-Za-z0-9_-]{1,1800})\.([A-Za-z0-9_-]{43})$/

type OAuthContext = { revision: string; next: string | null; trial?: FxiaokeRotationContext }

// The database still owns one-time consumption and expiration. The MAC binds
// this browser context to that exact state without trusting unsigned cookies.
function sign(state: string, payload: string) {
  const master = process.env.ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY || process.env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY || ''
  if (!/^[0-9a-f]{64}$/i.test(master)) {
    throw new FxiaokeError('ENCRYPTION_UNAVAILABLE', '组织凭据加密服务未配置，请联系系统管理员。', 503)
  }
  return createHmac('sha256', Buffer.from(master, 'hex'))
    .update(`icu:fxiaoke:oauth-context:v1:${state}:${payload}`)
    .digest('base64url')
}

export function createFxiaokeOAuthContext(state: string, revision: string, next: string | null, trial?: FxiaokeRotationContext) {
  if (!UUID.test(revision)) {
    throw new FxiaokeError('CREDENTIALS_UNREADABLE', '当前纷享登录未绑定有效凭证版本。', 503)
  }
  const payload = Buffer.from(JSON.stringify(trial ? { revision, trial } : { revision, next: fxiaokeReturnPath(next) })).toString('base64url')
  return `${payload}.${sign(state, payload)}`
}

export function readFxiaokeOAuthContext(state: string, cookie: string | undefined): OAuthContext | null {
  const parts = cookie?.match(CONTEXT_COOKIE)
  if (!parts) return null
  const [, payload, signature] = parts
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(state, payload)))) return null
  try {
    const context = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof context.revision !== 'string' || !UUID.test(context.revision)) return null
    if (context.trial) {
      const { id, sourceId, sourceUpdatedAt } = context.trial
      if (typeof id !== 'string' || !UUID.test(id) || typeof sourceId !== 'string' || !UUID.test(sourceId)
        || typeof sourceUpdatedAt !== 'string' || !Number.isFinite(Date.parse(sourceUpdatedAt))) return null
      return { revision: context.revision, next: null, trial: { id, sourceId, sourceUpdatedAt } }
    }
    return { revision: context.revision, next: fxiaokeReturnPath(context.next) }
  } catch {
    return null
  }
}
