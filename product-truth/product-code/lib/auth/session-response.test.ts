// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  userError: null as unknown,
  assignments: [] as unknown[],
  insert: vi.fn(),
  remove: vi.fn(),
  cookie: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getFreshUserScopedRoleAssignments: vi.fn(async () => mocks.assignments),
  getOrgRoleCodes: vi.fn(() => ['SUPER_ADMIN']),
  getOrgAuthorizationRoleCodes: vi.fn(() => ['SUPER_ADMIN']),
  getOrgPermissions: vi.fn(() => []),
}))
vi.mock('@/lib/auth-context-cookie', () => ({
  AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS: 15,
  AUTH_CONTEXT_COOKIE_NAME: 'auth_context',
  createAuthContextCookieValue: mocks.cookie,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => ({ data: mocks.user, error: mocks.userError })),
        }
        return query
      }
      if (table === 'auth_tokens') {
        return { insert: mocks.insert, delete: () => ({ eq: mocks.remove }) }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  },
}))

import { applySystemSessionCookies, issueSystemSession } from './session-response'

const userId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

describe('system session issuance', () => {
  beforeEach(() => {
    mocks.user = { status: 'active', login_enabled: true }
    mocks.userError = null
    mocks.assignments = []
    mocks.insert.mockReset().mockResolvedValue({ error: null })
    mocks.remove.mockReset().mockResolvedValue({ error: null })
    mocks.cookie.mockReset().mockResolvedValue('signed-context')
  })

  it('persists one revocable token and signs the current organization context', async () => {
    const session = await issueSystemSession(userId, orgId)
    expect(session.token).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.authContextCookie).toBe('signed-context')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ token: session.token, user_id: userId }))
    expect(mocks.cookie).toHaveBeenCalledWith(session.token, expect.objectContaining({
      userId,
      orgId,
      roleCodes: ['SUPER_ADMIN'],
      allPermissions: ['*'],
      full: true,
    }))
  })

  it('fails closed when the identity was disabled between mapping and session issue', async () => {
    mocks.user = { status: 'active', login_enabled: false }
    await expect(issueSystemSession(userId, orgId)).rejects.toMatchObject({ code: 'SESSION_USER_DISABLED' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('fails closed when an active member has no effective organization role', async () => {
    const scopedAccess = await import('@/lib/scoped-access')
    vi.mocked(scopedAccess.getOrgRoleCodes).mockReturnValueOnce([])

    await expect(issueSystemSession(userId, orgId)).rejects.toMatchObject({ code: 'SESSION_NO_ROLE' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.cookie).not.toHaveBeenCalled()
  })

  it('sets the existing HttpOnly server token and client handoff cookie', () => {
    const response = NextResponse.json({ ok: true })
    applySystemSessionCookies(response, {
      token: 'session-token',
      expiresAt: new Date('2026-11-05T00:00:00Z'),
      authContextCookie: 'signed-context',
    })
    expect(response.headers.get('set-cookie')).toContain('token=session-token')
    expect(response.headers.get('set-cookie')).toContain('client_token=session-token')
    expect(response.headers.get('set-cookie')).toContain('auth_context=signed-context')
  })
})
