// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  organizations: vi.fn(),
  credentials: vi.fn(),
}))

vi.mock('@/lib/organization-connections', () => ({
  listIdentityLoginConnections: mocks.organizations,
}))

import { resolveConfiguredOAuthOrganization } from './sso'

const first = '00000001-0000-0000-0000-000000000000'
const second = '22222222-2222-4222-8222-222222222222'
const configured = (orgId: string) => ({ orgId, readCredentials: mocks.credentials })
const credentials = { appId: 'FSAID_test', expectedEa: 'example' }

describe('Fxiaoke SSO organization resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizations.mockResolvedValue([configured(first)])
    mocks.credentials.mockResolvedValue(credentials)
  })

  it('resolves exactly one verified organization and refuses to guess across tenants', async () => {
    await expect(resolveConfiguredOAuthOrganization()).resolves.toEqual({ orgId: first, credentials })
    expect(mocks.organizations).toHaveBeenCalledWith('fxiaoke', 2)
    expect(mocks.credentials).toHaveBeenCalledTimes(1)

    mocks.organizations.mockResolvedValue([configured(first), configured(second)])
    await expect(resolveConfiguredOAuthOrganization()).rejects.toMatchObject({
      code: 'SSO_ORGANIZATION_AMBIGUOUS',
      status: 409,
    })
  })

  it('reports missing identity-authoritative connections instead of reading environment credentials', async () => {
    mocks.organizations.mockResolvedValue([])
    await expect(resolveConfiguredOAuthOrganization()).rejects.toMatchObject({
      code: 'CONFIGURATION_REQUIRED',
      status: 409,
      message: expect.stringContaining('身份权威'),
    })
    expect(mocks.credentials).not.toHaveBeenCalled()
  })

  it('rejects non-UUID organization ids returned by malformed storage', async () => {
    mocks.organizations.mockResolvedValue([configured('not-an-organization')])
    await expect(resolveConfiguredOAuthOrganization()).rejects.toMatchObject({
      code: 'SSO_CONFIGURATION_UNAVAILABLE',
      status: 503,
    })
    expect(mocks.credentials).not.toHaveBeenCalled()
  })

  it('fails closed when verified connection discovery is unavailable', async () => {
    mocks.organizations.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveConfiguredOAuthOrganization()).rejects.toMatchObject({
      code: 'SSO_CONFIGURATION_UNAVAILABLE',
      status: 503,
    })
    expect(mocks.credentials).not.toHaveBeenCalled()
  })
})
