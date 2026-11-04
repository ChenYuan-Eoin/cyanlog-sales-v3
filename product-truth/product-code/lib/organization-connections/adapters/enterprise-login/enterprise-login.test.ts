// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transport: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
}))

vi.mock('@/lib/fxiaoke/egress/server', () => ({
  transportForOrganization: mocks.transport,
}))
vi.mock('@/lib/fxiaoke/oauth', () => ({
  buildFxiaokeAuthorizationUrl: mocks.buildAuthorizationUrl,
  exchangeFxiaokeAuthorizationCode: mocks.exchangeAuthorizationCode,
}))

import { fxiaokeEnterpriseLoginAdapter } from './fxiaoke'

const context = { systemOrgId: '00000000-0000-4000-8000-000000000001' }
const credentials = { appId: 'FSAID_example', appSecret: 'example-secret' }
const verifiedCredentials = {
  ...credentials,
  expectedEa: 'ea_enterprise',
  expectedCorpId: 'FSCID_enterprise',
}
const redirectUrl = 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fxiaoke enterprise login adapter', () => {
  it('builds the provider authorization URL without exposing credentials', () => {
    const authorizationUrl = new URL('https://open.fxiaoke.com/oauth2.0/authorize?state=opaque')
    mocks.buildAuthorizationUrl.mockReturnValue(authorizationUrl)

    expect(fxiaokeEnterpriseLoginAdapter.beginAuthorization(credentials, {
      redirectUrl,
      state: 'opaque-state',
    }, context)).toEqual({ authorizationUrl: authorizationUrl.toString() })
    expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith({
      appId: credentials.appId,
      redirectUrl,
      state: 'opaque-state',
    })
  })

  it('returns only a normalized enterprise and stable subject after callback exchange', async () => {
    const transport = vi.fn()
    mocks.transport.mockReturnValue(transport)
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      openUserId: 'employee-open-id',
      corpId: 'FSCID_enterprise',
      expiresIn: 7200,
      accessToken: 'must-not-leak',
    })

    await expect(fxiaokeEnterpriseLoginAdapter.completeAuthorization(verifiedCredentials, {
      redirectUrl,
      code: 'authorization-code',
      providerError: null,
    }, context)).resolves.toEqual({
      status: 'authenticated',
      connectionExternalTenantId: 'ea_enterprise',
      externalUserId: 'employee-open-id',
    })
    expect(mocks.transport).toHaveBeenCalledWith(context.systemOrgId)
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining(credentials), {
      code: 'authorization-code',
      redirectUrl,
    }, transport)
  })

  it('maps provider denial without attempting a token exchange', async () => {
    await expect(fxiaokeEnterpriseLoginAdapter.completeAuthorization(verifiedCredentials, {
      redirectUrl,
      code: null,
      providerError: 'access_denied',
    }, context)).resolves.toEqual({ status: 'denied' })
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  it('fails closed when stored connection credentials are incomplete', () => {
    expect(() => fxiaokeEnterpriseLoginAdapter.beginAuthorization({ appId: 'FSAID_example' }, {
      redirectUrl,
      state: 'opaque-state',
    }, context)).toThrowError(expect.objectContaining({ code: 'CREDENTIALS_UNREADABLE' }))
  })

  it('rejects an OAuth enterprise that differs from the verified connection', async () => {
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      openUserId: 'employee-open-id',
      corpId: 'FSCID_other_enterprise',
      expiresIn: 7200,
    })

    await expect(fxiaokeEnterpriseLoginAdapter.completeAuthorization(verifiedCredentials, {
      redirectUrl,
      code: 'authorization-code',
      providerError: null,
    }, context)).rejects.toMatchObject({ code: 'ENTERPRISE_MISMATCH', status: 403 })
  })

  it('requires an enterprise-verified connection before exchanging an OAuth code', async () => {
    await expect(fxiaokeEnterpriseLoginAdapter.completeAuthorization(credentials, {
      redirectUrl,
      code: 'authorization-code',
      providerError: null,
    }, context)).rejects.toMatchObject({ code: 'CREDENTIALS_UNREADABLE', status: 503 })
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })
})
