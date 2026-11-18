import { describe, expect, it } from 'vitest'
import { fxiaokeSessionDeadline, nextFxiaokeSessionDeadline } from './fxiaoke-session'

const now = Date.parse('2026-11-18T04:00:00Z')
const iso = (offset: number) => new Date(now + offset * 60_000).toISOString()

describe('Fxiaoke session deadlines', () => {
  it('rejects idle expiry, absolute expiry, malformed and legacy seven-day sessions', () => {
    for (const row of [
      { created_at: iso(-20), expires_at: iso(0) },
      { created_at: iso(-480), expires_at: iso(10) },
      { created_at: iso(-1), expires_at: iso(7 * 24 * 60) },
      { created_at: null, expires_at: iso(10) },
      { created_at: iso(1), expires_at: iso(10) },
    ]) expect(fxiaokeSessionDeadline(row, now)).toBeNull()
  })
  it('limits activity renewal to 30 minutes and never extends past eight hours', () => {
    expect(nextFxiaokeSessionDeadline(iso(-20), now)).toBe(Date.parse(iso(30)))
    expect(nextFxiaokeSessionDeadline(iso(-470), now)).toBe(Date.parse(iso(10)))
    expect(fxiaokeSessionDeadline({ created_at: iso(-20), expires_at: iso(10) }, now)).toBe(Date.parse(iso(10)))
  })
})
