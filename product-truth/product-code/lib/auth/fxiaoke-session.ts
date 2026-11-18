// Reuse the revocable session row: expires_at is the idle deadline and
// created_at is the immutable anchor for the absolute authentication lifetime.
export const FXIAOKE_SESSION_IDLE_SECONDS = 30 * 60
export const FXIAOKE_SESSION_MAX_SECONDS = 8 * 60 * 60

export function fxiaokeSessionDeadline(row: { created_at?: string | null; expires_at?: string | null }, now = Date.now()) {
  const created = Date.parse(row.created_at || '')
  const expires = Date.parse(row.expires_at || '')
  const absolute = created + FXIAOKE_SESSION_MAX_SECONDS * 1000
  // Old seven-day sessions must authenticate again, rather than inheriting
  // the shorter policy with an unknown last activity timestamp.
  if (!Number.isFinite(created) || !Number.isFinite(expires)
    || created > now || expires > absolute || expires <= now || absolute <= now) return null
  return Math.min(expires, absolute)
}

export function nextFxiaokeSessionDeadline(createdAt: string, now = Date.now()) {
  return Math.min(now + FXIAOKE_SESSION_IDLE_SECONDS * 1000,
    Date.parse(createdAt) + FXIAOKE_SESSION_MAX_SECONDS * 1000)
}
