// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), write: vi.fn(), update: vi.fn(), gt: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: m.auth }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => {
  const read = { eq: () => read, maybeSingle: m.read }
  const write = { eq: () => write, gt: m.gt, select: () => ({ maybeSingle: m.write }) }
  m.gt.mockReturnValue(write)
  m.update.mockReturnValue(write)
  return { select: () => read, update: m.update }
} } }))
import { GET, POST } from './route'
const request = (method = 'GET', origin = 'https://example.test') => new NextRequest('https://example.test/api/auth/activity', {
  method, headers: { origin, authorization: 'Bearer example-session' },
})

describe('session activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.auth.mockResolvedValue({ id: 'user-1' })
    m.read.mockResolvedValue({ data: { user_id: 'user-1', auth_method: 'fxiaoke', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() } })
    m.write.mockResolvedValue({ data: { expires_at: new Date(Date.now() + 30 * 60_000).toISOString() } })
  })
  it('reads the current deadline without extending idle time', async () => {
    expect((await GET(request())).status).toBe(200)
    expect(m.update).not.toHaveBeenCalled()
  })
  it('renews authenticated same-origin activity with an atomic expiry guard', async () => {
    expect((await POST(request('POST'))).status).toBe(200)
    expect(m.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
    expect(m.update).toHaveBeenCalledWith({ expires_at: expect.any(String) })
  })
  it('rejects cross-origin renewal before reading the session', async () => {
    expect((await POST(request('POST', 'https://other.test'))).status).toBe(403)
    expect(m.auth).not.toHaveBeenCalled()
  })
  it('cannot renew an idle-expired or concurrently revoked session', async () => {
    m.read.mockResolvedValueOnce({ data: { user_id: 'user-1', auth_method: 'fxiaoke', created_at: new Date().toISOString(), expires_at: new Date(Date.now() - 1).toISOString() } })
    expect((await POST(request('POST'))).status).toBe(401)
    expect(m.update).not.toHaveBeenCalled()
    m.write.mockResolvedValueOnce({ data: null })
    expect((await POST(request('POST'))).status).toBe(401)
  })
  it('leaves local-account expiry unchanged', async () => {
    m.read.mockResolvedValueOnce({ data: { user_id: 'user-1', auth_method: 'local' } })
    expect(await (await POST(request('POST'))).json()).toEqual({ managed: false })
    expect(m.update).not.toHaveBeenCalled()
  })
})
