// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/fxiaoke/sso', () => ({
  listConfiguredOAuthOrganizationIds: mocks.list,
  resolveConfiguredOAuthOrganization: mocks.resolve,
}))

import { GET } from './route'

describe('GET /api/auth/providers', () => {
  beforeEach(() => {
    mocks.list.mockReset()
    mocks.resolve.mockReset()
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
      providers: [{ id: 'fxiaoke', label: '纷享销客', startUrl: '/api/auth/fxiaoke/start' }],
    })
    expect(JSON.stringify(body)).not.toContain('11111111')
    expect(JSON.stringify(body)).not.toContain('secret-app')
    expect(mocks.resolve).toHaveBeenCalledWith()
  })

  it('returns no provider when none is configured', async () => {
    mocks.list.mockResolvedValue([])
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ providers: [] })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
