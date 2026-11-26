// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  org: vi.fn(),
  assignments: vi.fn(),
  rpc: vi.fn(),
  localLogin: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/scoped-access', () => ({
  getFreshDefaultOrgId: mocks.org,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))
vi.mock('@/lib/auth/local-account-config', () => ({ isLocalAccountLoginEnabled: mocks.localLogin }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))

import { PATCH } from './route'

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const revision = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const systemGrant = { scopeType: 'org', scopeId: orgId, roleCode: 'SUPER_ADMIN', permissions: ['*'] }

function request(enabled = true, origin = 'https://sales.cyanlog.icu') {
  return new NextRequest('https://sales.cyanlog.icu/api/admin/organization-sources/fxiaoke/sso', {
    method: 'PATCH',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled, connectionRevision: revision }),
  })
}

describe('Fxiaoke SSO authority action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ id: actorId })
    mocks.org.mockResolvedValue(orgId)
    mocks.assignments.mockResolvedValue([systemGrant])
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    mocks.localLogin.mockReturnValue(true)
  })

  it('uses the server-resolved organization and an expected connection revision', async () => {
    const result = await PATCH(request())
    expect(result.status, JSON.stringify(await result.clone().json())).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('set_fxiaoke_identity_authority_v1', {
      p_actor_id: actorId,
      p_org_id: orgId,
      p_connection_revision: revision,
      p_enabled: true,
    })
  })

  it.each([
    { ...systemGrant, roleCode: 'ORG_SUPER_ADMIN' },
    { ...systemGrant, roleCode: 'ADMIN', permissions: ['org:source_view', 'org:source_connect', 'org:source_preview', 'org:source_apply'] },
    { ...systemGrant, scopeId: 'foreign-org' },
    { ...systemGrant, scopeType: 'department' },
    { ...systemGrant, permissions: [] },
  ])('rejects a noncanonical system grant without changing authority %#', async (grant) => {
    mocks.assignments.mockResolvedValue([grant])
    expect((await PATCH(request())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin request without changing authority', async () => {
    expect((await PATCH(request(true, 'https://attacker.example'))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('leaves SSO closed when the database preflight rejects the change', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    const result = await PATCH(request())
    expect(result.status).toBe(409)
    expect((await result.json()).error).toContain('在职纷享成员')
  })

  it('does not close the only enterprise login when no local recovery entry is open', async () => {
    mocks.localLogin.mockReturnValue(false)
    const result = await PATCH(request(false))
    expect(result.status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
