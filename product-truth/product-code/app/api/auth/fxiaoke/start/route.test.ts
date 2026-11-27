// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  checkTrial: vi.fn(),
  state: vi.fn(),
  authorize: vi.fn(),
  prepare: vi.fn(),
  after: vi.fn(),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: mocks.after,
}))
vi.mock('@/lib/fxiaoke/egress/server', () => ({ transportForOrganization: () => ({ prepareLogin: mocks.prepare }) }))
vi.mock('@/lib/fxiaoke/credential-rotation', () => ({ getFxiaokeRotationTrial: mocks.checkTrial }))
vi.mock('@/lib/fxiaoke/sso', () => ({ resolveConfiguredOAuthOrganization: mocks.resolve }))
vi.mock('@/lib/auth/oauth-state', () => ({
  FXIAOKE_OAUTH_STATE_COOKIE: 'fxiaoke_oauth_state',
  FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS: 300,
  createOAuthState: mocks.state,
}))
vi.mock('@/lib/fxiaoke/oauth', () => ({ buildFxiaokeAuthorizationUrl: mocks.authorize }))

import { GET } from './route'
import { readFxiaokeOAuthContext } from '@/lib/fxiaoke/oauth-state'

const orgId = '11111111-1111-4111-8111-111111111111'
const revision = '33333333-3333-4333-8333-333333333333'
const request = (path = '/api/auth/fxiaoke/start') => new NextRequest(`https://sales.cyanlog.icu${path}`)

describe('Fxiaoke OAuth start', () => {
  beforeEach(() => {
    vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32))
    mocks.after.mockClear()
    mocks.checkTrial.mockReset()
    mocks.resolve.mockReset().mockResolvedValue({ orgId, revision, credentials: { appId: 'FSAID_test' } })
    mocks.state.mockReset().mockResolvedValue({ state: 's'.repeat(32), expiresAt: new Date('2026-10-29T03:05:00Z') })
    mocks.authorize.mockReset().mockReturnValue(new URL('https://open.fxiaoke.com/oauth2.0/authorize?responseType=code'))
  })

  afterEach(() => vi.unstubAllEnvs())

  it('creates a server state and redirects to the fixed Fxiaoke endpoint with an HttpOnly cookie', async () => {
    const response = await GET(request(`/api/auth/fxiaoke/start?org=${orgId}`))
    expect(response.status).toBe(302)
    expect(mocks.resolve).toHaveBeenCalledWith()
    expect(mocks.after).toHaveBeenCalledWith(mocks.prepare)
    expect(response.headers.get('location')).toMatch(/^https:\/\/open\.fxiaoke\.com\/oauth2\.0\/authorize/)
    expect(mocks.state).toHaveBeenCalledWith(orgId, 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback')
    const cookie = response.headers.get('set-cookie') || ''
    expect(cookie).toContain('fxiaoke_oauth_state=ssss')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).toContain('Path=/api/auth/fxiaoke/callback')
    expect(cookie).toContain('Max-Age=300')
  })

  it('binds the selected return path and the effective revision to the one-time state', async () => {
    const next = '/shipping?tab=orders'
    const response = await GET(request(`/api/auth/fxiaoke/start?${new URLSearchParams({ next })}`))
    const context = response.cookies.get('fxiaoke_oauth_context')?.value
    expect(readFxiaokeOAuthContext('s'.repeat(32), context)).toEqual({ revision, next })
    expect(readFxiaokeOAuthContext('t'.repeat(32), context)).toBeNull()
    expect(response.headers.get('location')).not.toContain('shipping')
    expect(response.headers.get('location')).not.toContain(revision)
  })

  it('starts a test using only the signed draft context and fixed callback', async () => {
    const trial = {
      id: '55555555-5555-4555-8555-555555555555', sourceId: '66666666-6666-4666-8666-666666666666',
      sourceUpdatedAt: '2026-11-27T04:00:00.000Z',
    }
    const token = 'a'.repeat(48)
    mocks.checkTrial.mockResolvedValue({ orgId, revision, trial, credentials: { appId: 'FSAID_draft' } })
    const response = await GET(request(`/api/auth/fxiaoke/start?trial=${token}&next=%2Fshipping`))
    expect(response.status).toBe(302)
    expect(mocks.checkTrial).toHaveBeenCalledWith(token)
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ appId: 'FSAID_draft' }))
    expect(readFxiaokeOAuthContext('s'.repeat(32), response.cookies.get('fxiaoke_oauth_context')?.value))
      .toEqual({ revision, trial, next: null })
    expect(response.headers.get('location')).not.toContain(token)
  })

  it('does not fall back to ordinary OAuth for an expired trial link', async () => {
    mocks.checkTrial.mockRejectedValue(new Error('expired'))
    const response = await GET(request('/api/auth/fxiaoke/start?trial=unavailable'))
    expect(response.status).toBe(409)
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.state).not.toHaveBeenCalled()
  })

  it('redirects configuration failures to the login page without exposing internal details', async () => {
    mocks.resolve.mockRejectedValue(new Error('database credential secret'))
    const response = await GET(request())
    expect(response.status).toBe(302)
    expect(mocks.after).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://sales.cyanlog.icu/login?sso_error=SSO_START_FAILED')
    expect(response.headers.get('location')).not.toContain('secret')
  })
})
