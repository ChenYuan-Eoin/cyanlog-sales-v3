// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('consumes one state, verifies enterprise and stable identity, then issues the system session', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('token=session-token')
    expect(mocks.consume).toHaveBeenCalledWith(state)
    expect(mocks.exchange).toHaveBeenCalledWith(credentials, { code: 'authorization-code', redirectUrl })
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
