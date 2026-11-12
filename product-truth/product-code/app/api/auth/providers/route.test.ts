// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn(), verified: vi.fn() }))
vi.mock('@/lib/fxiaoke/sso', () => ({
  listConfiguredOAuthOrganizationIds: mocks.list,
  resolveConfiguredOAuthOrganization: mocks.resolve,
}))
vi.mock('@/lib/organization-connections', () => ({ listVerifiedConnectionOrganizationIds: mocks.verified }))

import { GET } from './route'

describe('GET /api/auth/providers', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('LOCAL_ACCOUNT_LOGIN_ENABLED', '')
    mocks.list.mockReset()
    mocks.resolve.mockReset()
    mocks.verified.mockReset()
  })

  it('shows a live Fxiaoke entry without exposing the organization ID', async () => {
    mocks.list.mockResolvedValue(['11111111-1111-4111-8111-111111111111'])
    mocks.resolve.mockResolvedValue({
      orgId: '11111111-1111-4111-8111-111111111111',
      credentials: { appId: 'secret-app' },
    })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({
      localAccountEnabled: false,
      providers: [{ id: 'fxiaoke', label: '纷享销客', startUrl: '/api/auth/fxiaoke/start' }],
    })
    expect(JSON.stringify(body)).not.toContain('11111111')
    expect(JSON.stringify(body)).not.toContain('secret-app')
    expect(mocks.resolve).toHaveBeenCalledWith()
  })

  it('returns no provider when none is configured', async () => {
    mocks.list.mockResolvedValue([])
    mocks.verified.mockResolvedValue([])
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ providers: [], localAccountEnabled: false, providerStatus: 'not_configured' })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('reports a paused login when the connection is verified but identity authority is off', async () => {
    mocks.list.mockResolvedValue([])
    mocks.verified.mockResolvedValue(['11111111-1111-4111-8111-111111111111'])
    const response = await GET()
    expect(await response.json()).toEqual({ providers: [], localAccountEnabled: false, providerStatus: 'paused' })
    expect(mocks.verified).toHaveBeenCalledWith('fxiaoke', 1)
  })

  it('discovers enabled account login even when Fxiaoke configuration fails', async () => {
    vi.stubEnv('LOCAL_ACCOUNT_LOGIN_ENABLED', 'true')
    mocks.list.mockRejectedValue(new Error('provider unavailable'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      providers: [], localAccountEnabled: true, providerStatus: 'unavailable',
      error: '企业统一登录暂时不可用，请联系管理员。',
    })
  })

})
