// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  state: vi.fn(),
  authorize: vi.fn(),
}))
vi.mock('@/lib/fxiaoke/sso', () => ({ resolveConfiguredOAuthOrganization: mocks.resolve }))
vi.mock('@/lib/auth/oauth-state', () => ({
  FXIAOKE_OAUTH_STATE_COOKIE: 'fxiaoke_oauth_state',
  FXIAOKE_OAUTH_STATE_MAX_AGE_SECONDS: 300,
  createOAuthState: mocks.state,
}))
vi.mock('@/lib/fxiaoke/oauth', () => ({ buildFxiaokeAuthorizationUrl: mocks.authorize }))

import { GET } from './route'

const orgId = '11111111-1111-4111-8111-111111111111'
const request = (path = '/api/auth/fxiaoke/start') => new NextRequest(`https://sales.cyanlog.icu${path}`)

describe('Fxiaoke OAuth start', () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue({ orgId, credentials: { appId: 'FSAID_test' } })
    mocks.state.mockReset().mockResolvedValue({ state: 's'.repeat(32), expiresAt: new Date('2026-10-29T03:05:00Z') })
    mocks.authorize.mockReset().mockReturnValue(new URL('https://open.fxiaoke.com/oauth2.0/authorize?responseType=code'))
  })

  it('creates a server state and redirects to the fixed Fxiaoke endpoint with an HttpOnly cookie', async () => {
    const response = await GET(request(`/api/auth/fxiaoke/start?org=${orgId}`))
    expect(response.status).toBe(302)
    expect(mocks.resolve).toHaveBeenCalledWith()
    expect(response.headers.get('location')).toMatch(/^https:\/\/open\.fxiaoke\.com\/oauth2\.0\/authorize/)
    expect(mocks.state).toHaveBeenCalledWith(orgId, 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback')
    const cookie = response.headers.get('set-cookie') || ''
    expect(cookie).toContain('fxiaoke_oauth_state=ssss')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).toContain('Path=/api/auth/fxiaoke/callback')
    expect(cookie).toContain('Max-Age=300')
  })

  it('redirects configuration failures to the login page without exposing internal details', async () => {
    mocks.resolve.mockRejectedValue(new Error('database credential secret'))
    const response = await GET(request())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://sales.cyanlog.icu/login?sso_error=SSO_START_FAILED')
    expect(response.headers.get('location')).not.toContain('secret')
  })
})
