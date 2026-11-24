// Reuse the revocable session row: expires_at is the sliding idle deadline and
// created_at is the immutable anchor for the absolute authentication lifetime.
// The browser may stay signed in for a normal work week without interruption;
// active use slides the idle deadline while the absolute lifetime limits abuse.
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60
export const SESSION_ABSOLUTE_MAX_SECONDS = 30 * 24 * 60 * 60
export const FXIAOKE_SESSION_IDLE_SECONDS = SESSION_IDLE_SECONDS
export const FXIAOKE_SESSION_MAX_SECONDS = SESSION_ABSOLUTE_MAX_SECONDS

export function sessionDeadline(row: { created_at?: string | null; expires_at?: string | null }, now = Date.now()) {
  const created = Date.parse(row.created_at || '')
  const expires = Date.parse(row.expires_at || '')
  const absolute = created + SESSION_ABSOLUTE_MAX_SECONDS * 1000
  if (!Number.isFinite(created) || !Number.isFinite(expires)
    || created > now || expires > absolute || expires <= now || absolute <= now) return null
  return Math.min(expires, absolute)
}

export function nextSessionDeadline(createdAt: string, now = Date.now()) {
  return Math.min(now + SESSION_IDLE_SECONDS * 1000,
    Date.parse(createdAt) + SESSION_ABSOLUTE_MAX_SECONDS * 1000)
}

// Compatibility names for existing Fxiaoke callers and tests.
export const fxiaokeSessionDeadline = sessionDeadline
export const nextFxiaokeSessionDeadline = nextSessionDeadline
