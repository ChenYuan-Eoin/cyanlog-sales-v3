import { describe, expect, it } from 'vitest'
import { fxiaokeSessionDeadline, nextFxiaokeSessionDeadline } from './fxiaoke-session'

const now = Date.parse('2026-11-18T04:00:00Z')
const iso = (offset: number) => new Date(now + offset * 60_000).toISOString()

describe('Fxiaoke session deadlines', () => {
  it('rejects expired, absolute-expired, future-created and malformed sessions', () => {
    for (const row of [
      { created_at: iso(-20), expires_at: iso(-1) },
      { created_at: iso(-31 * 24 * 60), expires_at: iso(10) },
      { created_at: iso(1), expires_at: iso(10) },
      { created_at: null, expires_at: iso(10) },
    ]) expect(fxiaokeSessionDeadline(row, now)).toBeNull()
  })
  it('slides activity for seven days and caps the absolute lifetime at thirty days', () => {
    expect(fxiaokeSessionDeadline({ created_at: iso(-20), expires_at: iso(10) }, now)).toBe(Date.parse(iso(10)))
    expect(nextFxiaokeSessionDeadline(iso(-20), now)).toBe(Date.parse(iso(7 * 24 * 60)))
    expect(nextFxiaokeSessionDeadline(iso(-29 * 24 * 60), now)).toBe(Date.parse(iso(24 * 60)))
    expect(fxiaokeSessionDeadline({ created_at: iso(-20), expires_at: iso(7 * 24 * 60) }, now)).toBe(Date.parse(iso(7 * 24 * 60)))
  })
})
