// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ enabled: vi.fn(), validate: vi.fn(), parse: vi.fn(), login: vi.fn(), revoke: vi.fn(), cookies: vi.fn() }))
vi.mock('@/lib/auth/local-account-config', () => ({ isLocalAccountLoginEnabled: mocks.enabled }))
vi.mock('@/lib/auth/local-account', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/auth/local-account')>()
  return { ...real, validateLocalLoginRequest: mocks.validate, parseLocalLoginInput: mocks.parse, loginExistingLocalAccount: mocks.login, revokeLocalLoginSession: mocks.revoke }
})
vi.mock('@/lib/auth/session-response', () => ({ applySystemSessionCookies: mocks.cookies, issueSystemSession: vi.fn() }))
import { POST } from './route'
import { LocalAccountLoginError } from '@/lib/auth/local-account'
const request = () => new NextRequest('https://sales.cyanlog.icu/api/auth/login', { method: 'POST', body: '{}' })
beforeEach(() => {
  mocks.enabled.mockReset().mockReturnValue(true)
  mocks.validate.mockReset().mockReturnValue('203.0.113.1')
  mocks.parse.mockReset().mockResolvedValue({ identifier: 'member@example.test', kind: 'email', password: 'fixture' })
  mocks.login.mockReset().mockResolvedValue({ sessionId: 'session-id', token: 'example-local-session', expiresAt: new Date('2030-01-01'), authContextCookie: 'signed' })
  mocks.cookies.mockReset()
  mocks.revoke.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())
describe('POST /api/auth/login', () => {
  it('returns 404 without checking credentials unless explicitly enabled', async () => {
    mocks.enabled.mockReturnValue(false)
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.login).not.toHaveBeenCalled()
  })
  it('returns only the existing system session and applies its cookie helper', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ token: 'example-local-session', expiresAt: '2030-01-01T00:00:00.000Z' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.cookies).toHaveBeenCalledOnce()
  })
  it.each([['INVALID_REQUEST', 400], ['AUTH_FAILED', 401], ['RATE_LIMITED', 429], ['UNAVAILABLE', 503]] as const)('returns %s without a cookie or credential detail', async (code, status) => {
    mocks.login.mockRejectedValue(new LocalAccountLoginError(code, 23))
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mocks.cookies).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain('fixture')
    if (status === 429) expect(response.headers.get('retry-after')).toBe('23')
  })
  it('revokes a created session if cookie application fails', async () => {
    mocks.cookies.mockImplementationOnce(() => { throw new Error('cookie failed') })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(mocks.revoke).toHaveBeenCalledWith('example-local-session')
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
