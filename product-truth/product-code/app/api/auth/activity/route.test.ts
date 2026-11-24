// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), write: vi.fn(), update: vi.fn(), gt: vi.fn(), lt: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: m.auth }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => {
  const read = { eq: () => read, maybeSingle: m.read }
  const write = { eq: () => write, gt: m.gt, lt: m.lt, select: () => ({ maybeSingle: m.write }) }
  m.gt.mockReturnValue(write)
  m.lt.mockReturnValue(write)
  m.update.mockReturnValue(write)
  return { select: () => read, update: m.update }
} } }))
import { GET, POST } from './route'
const request = (method = 'GET', origin = 'https://example.test') => new NextRequest('https://example.test/api/auth/activity', {
  method, headers: { origin, authorization: 'Bearer example-session' },
})

describe('session activity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.auth.mockResolvedValue({ id: 'user-1' })
    m.read.mockResolvedValue({ data: { user_id: 'user-1', auth_method: 'local', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() } })
    m.write.mockResolvedValue({ data: { expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString() } })
  })
  it('reads the current deadline without extending idle time', async () => {
    expect((await GET(request())).status).toBe(200)
    expect(m.update).not.toHaveBeenCalled()
  })
  it('renews authenticated same-origin activity with an atomic expiry guard', async () => {
    const response = await POST(request('POST'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ managed: true, authMethod: 'local' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(m.lt).toHaveBeenCalledWith('expires_at', expect.any(String))
    expect(m.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
    expect(m.update).toHaveBeenCalledWith({ expires_at: expect.any(String) })
  })
  it('rejects cross-origin renewal before reading the session', async () => {
    expect((await POST(request('POST', 'https://other.test'))).status).toBe(403)
    expect(m.auth).not.toHaveBeenCalled()
  })
  it('cannot renew an idle-expired or concurrently revoked session', async () => {
    m.read.mockResolvedValueOnce({ data: { user_id: 'user-1', auth_method: 'local', created_at: new Date().toISOString(), expires_at: new Date(Date.now() - 1).toISOString() } })
    expect((await POST(request('POST'))).status).toBe(401)
    expect(m.update).not.toHaveBeenCalled()
    m.write.mockResolvedValueOnce({ data: null })
    m.read.mockResolvedValueOnce({ data: { user_id: 'user-1', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() } }).mockResolvedValueOnce({ data: null })
    const revoked = await POST(request('POST'))
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get('set-cookie')).toBeNull()
  })
  it('does not issue refreshed cookies when authentication or persistence fails', async () => {
    m.auth.mockRejectedValueOnce(new Error('auth unavailable'))
    const unavailable = await POST(request('POST'))
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('set-cookie')).toBeNull()

    m.write.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })
    const persistenceFailure = await POST(request('POST'))
    expect(persistenceFailure.status).toBe(503)
    expect(persistenceFailure.headers.get('set-cookie')).toBeNull()
  })
  it('renews a local-account session while it remains within the absolute lifetime', async () => {
    m.read.mockResolvedValueOnce({ data: { user_id: 'user-1', auth_method: 'local', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() } })
    expect((await POST(request('POST'))).status).toBe(200)
    expect(m.update).toHaveBeenCalled()
  })
  it('rereads a winning newer renewal without shortening its expiry or overwriting shared account cookies', async () => {
    m.write.mockResolvedValueOnce({ data: null })
    const created = new Date().toISOString()
    const newer = new Date(Date.now() + 7 * 86400000 + 1000).toISOString()
    m.read.mockResolvedValueOnce({ data: { user_id: 'user-1', created_at: created, expires_at: new Date(Date.now() + 60000).toISOString() } })
      .mockResolvedValueOnce({ data: { user_id: 'user-1', created_at: created, expires_at: newer } })
    const response = await POST(request('POST'))
    expect(response.status).toBe(200)
    expect((await response.json()).expiresAt).toBe(newer)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
