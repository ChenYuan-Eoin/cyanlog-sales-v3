// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  resolve: vi.fn(),
  exchange: vi.fn(),
  discover: vi.fn(),
  profile: vi.fn(),
  identity: vi.fn(),
  issue: vi.fn(),
  transport: vi.fn(),
}))

vi.mock('@/lib/auth/oauth-state', () => ({
  FXIAOKE_OAUTH_STATE_COOKIE: 'fxiaoke_oauth_state',
  OAuthStateError: class OAuthStateError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
  consumeOAuthState: mocks.consume,
  oauthStatesMatch: (cookie: string | undefined, query: string | null) => Boolean(cookie && query && cookie === query),
}))
vi.mock('@/lib/auth/session-response', () => ({
  issueSystemSession: mocks.issue,
  applySystemSessionCookies: (response: Response & { cookies: { set: (...args: unknown[]) => void } }, session: { token: string }) => {
    response.cookies.set('token', session.token, { httpOnly: true })
  },
}))
vi.mock('@/lib/fxiaoke/sso', () => ({ resolveConfiguredOAuthOrganization: mocks.resolve }))
vi.mock('@/lib/fxiaoke/oauth', () => ({ exchangeFxiaokeAuthorizationCode: mocks.exchange }))
vi.mock('@/lib/fxiaoke/client', () => ({
  discoverEnterprise: mocks.discover,
  readEmployeeIdentity: mocks.profile,
}))
vi.mock('@/lib/fxiaoke/egress/server', () => ({ transportForOrganization: mocks.transport }))
vi.mock('@/lib/fxiaoke/identity', () => ({ resolveFxiaokeIdentity: mocks.identity }))

import { GET } from './route'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'

const state = 's'.repeat(43)
const orgId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const redirectUrl = 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback'
const credentials = {
  appId: 'FSAID_test',
  appSecret: 'secret',
  expectedEa: 'enterprise',
  expectedCorpId: 'FSCID_enterprise',
}

function request(query = `state=${state}&code=authorization-code`) {
  return new NextRequest(`${redirectUrl}?${query}`, { headers: { cookie: `fxiaoke_oauth_state=${state}` } })
}

describe('Fxiaoke OAuth callback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.consume.mockReset().mockResolvedValue({ orgId, redirectUrl })
    mocks.resolve.mockReset().mockResolvedValue({ orgId, credentials })
    mocks.exchange.mockReset().mockResolvedValue({
      openUserId: 'employee-open-id',
      corpId: 'FSCID_enterprise',
      expiresIn: 7200,
    })
    mocks.discover.mockReset()
    mocks.profile.mockReset().mockResolvedValue({
      externalSubject: 'employee-open-id',
      phone: '13900000000',
      employeeNumber: 'E1001',
      displayName: '测试员工',
      status: '启用',
      loginDisabled: false,
      lifeStatus: '正常',
      deleted: false,
    })
    mocks.transport.mockReset().mockReturnValue(undefined)
    mocks.identity.mockReset().mockResolvedValue({ userId, orgId })
    mocks.issue.mockReset().mockResolvedValue({
      token: 'session-token',
      expiresAt: new Date('2026-11-05T00:00:00Z'),
      authContextCookie: 'signed-context',
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('consumes one state, verifies enterprise and stable identity, then issues the system session', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('token=session-token')
    expect(mocks.consume).toHaveBeenCalledWith(state)
    expect(mocks.exchange).toHaveBeenCalledWith(credentials, { code: 'authorization-code', redirectUrl }, undefined)
    expect(mocks.profile).toHaveBeenCalledWith(credentials, 'employee-open-id', undefined)
    expect(mocks.identity).toHaveBeenCalledWith({
      orgId,
      corpId: 'FSCID_enterprise',
      externalSubject: 'employee-open-id',
      phone: '13900000000',
      employeeNumber: 'E1001',
      displayName: '测试员工',
      providerStatus: '启用',
      lifeStatus: '正常',
      loginDisabled: false,
    })
    expect(mocks.issue).toHaveBeenCalledWith(userId, orgId)
    const body = await response.text()
    expect(body).toContain("localStorage.setItem('token'")
    expect(body).not.toContain('session-token')
    expect(body).not.toContain('secret')
  })

  it('routes the authorization-code exchange and profile read through the configured organization transport', async () => {
    const transport = vi.fn()
    mocks.transport.mockReturnValue(transport)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.transport).toHaveBeenCalledWith(orgId)
    expect(mocks.exchange).toHaveBeenCalledWith(credentials, { code: 'authorization-code', redirectUrl }, transport)
    expect(mocks.profile).toHaveBeenCalledWith(credentials, 'employee-open-id', transport)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['exchange', 'token_exchange'],
    ['profile', 'employee_profile'],
  ] as const)('records only safe stage and internal error metadata when %s fails', async (method, stage) => {
    mocks[method].mockRejectedValue(new FxiaokeError('PROVIDER_TIMEOUT',
      'secret authorization-code session-token provider-access-token 13900000000 employee-open-id ' + state, 502))
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('sso_error=SSO_PROVIDER_FAILED')
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('fxiaoke_sso_callback_failed', {
      stage, code: 'PROVIDER_TIMEOUT', status: 502,
    })
    expect(mocks.issue).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/secret|authorization-code|session-token|provider-access-token|13900000000|employee-open-id/)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(state)
  })

  it('never reflects arbitrary exception messages or unrecognized provider error codes in diagnostics', async () => {
    mocks.exchange.mockRejectedValue(new FxiaokeError('secret-provider-code', 'sensitive upstream body', 502))
    await GET(request())
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('fxiaoke_sso_callback_failed', {
      stage: 'token_exchange', code: 'SSO_PROVIDER_FAILED', status: 502,
    })
  })

  it('rejects missing state cookies before consuming server state', async () => {
    const response = await GET(new NextRequest(`${redirectUrl}?state=${state}&code=code`))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('sso_error=SSO_STATE_INVALID')
    expect(mocks.consume).not.toHaveBeenCalled()
  })

  it('rejects a state issued for a different configured organization', async () => {
    mocks.resolve.mockResolvedValue({ orgId: '33333333-3333-4333-8333-333333333333', credentials })
    const response = await GET(request())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('sso_error=SSO_CONFIGURATION_INVALID')
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.identity).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('rejects cross-enterprise identities before mapping or session creation', async () => {
    mocks.exchange.mockResolvedValue({ openUserId: 'employee-open-id', corpId: 'FSCID_other', expiresIn: 7200 })
    const response = await GET(request())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('sso_error=SSO_ENTERPRISE_MISMATCH')
    expect(mocks.identity).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('verifies legacy credentials against the provider application enterprise without persisting browser input', async () => {
    const legacy = { ...credentials, expectedCorpId: undefined }
    mocks.resolve.mockResolvedValue({ orgId, credentials: legacy })
    const transport = vi.fn()
    mocks.transport.mockReturnValue(transport)
    mocks.discover.mockResolvedValue({ ea: 'enterprise', corpId: 'FSCID_enterprise' })
    await GET(request())
    expect(mocks.discover).toHaveBeenCalledWith(legacy, transport)
    expect(mocks.identity).toHaveBeenCalled()
  })
})
