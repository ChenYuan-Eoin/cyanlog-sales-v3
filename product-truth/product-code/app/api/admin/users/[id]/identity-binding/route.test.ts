// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  org: vi.fn(),
  assignments: vi.fn(),
  canMutate: vi.fn(),
  authorizationRoles: vi.fn(),
  credentials: vi.fn(),
  discover: vi.fn(),
  transport: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgUsers: mocks.canMutate,
  getFreshDefaultOrgId: mocks.org,
  getFreshUserScopedRoleAssignments: mocks.assignments,
  getOrgAuthorizationRoleCodes: mocks.authorizationRoles,
}))
vi.mock('@/lib/fxiaoke/settings', () => ({ loadOAuthCredentials: mocks.credentials }))
vi.mock('@/lib/fxiaoke/client', () => ({ discoverEnterprise: mocks.discover }))
vi.mock('@/lib/fxiaoke/egress/server', () => ({ transportForOrganization: mocks.transport }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))

import { POST } from './route'

const orgId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const targetId = '33333333-3333-4333-8333-333333333333'
const parameters = { params: Promise.resolve({ id: targetId }) }
const credentials = {
  appId: 'FSAID_test',
  appSecret: 'fixture-secret',
  permanentCode: 'fixture-permanent',
  expectedEa: 'fixture-ea',
  expectedCorpId: 'FSCID_enterprise',
  apiUserId: 'fixture-user',
}

function request(body: unknown) {
  return new NextRequest(`https://example.test/api/admin/users/${targetId}/identity-binding`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'binding-1' },
    body: JSON.stringify(body),
  })
}

describe('admin Fxiaoke identity pre-binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ id: actorId })
    mocks.org.mockResolvedValue(orgId)
    mocks.assignments.mockResolvedValue([])
    mocks.canMutate.mockReturnValue(true)
    mocks.authorizationRoles.mockReturnValue(['SUPER_ADMIN'])
    mocks.credentials.mockResolvedValue(credentials)
    mocks.discover.mockResolvedValue({ ea: 'fixture-ea', corpId: 'FSCID_enterprise' })
    mocks.transport.mockReturnValue(undefined)
    mocks.rpc.mockResolvedValue({
      data: { mapping_id: 'mapping-1', user_id: targetId, match_status: 'matched' },
      error: null,
    })
  })

  it('requires an exact-org super administrator', async () => {
    mocks.authorizationRoles.mockReturnValue(['ADMIN'])
    const response = await POST(request({ external_subject: 'employee-open-id' }), parameters)
    expect(response.status).toBe(403)
    expect(mocks.credentials).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects invalid external subjects before provider access', async () => {
    const response = await POST(request({ external_subject: 'contains spaces' }), parameters)
    expect(response.status).toBe(400)
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('discovers the enterprise server-side and records an audited manual mapping', async () => {
    const response = await POST(request({ external_subject: 'employee-open-id' }), parameters)
    expect(response.status).toBe(200)
    expect(mocks.discover).toHaveBeenCalledWith(credentials, undefined)
    expect(mocks.rpc).toHaveBeenCalledWith('admin_bind_fxiaoke_identity_v1', {
      p_actor_id: actorId,
      p_org_id: orgId,
      p_user_id: targetId,
      p_external_tenant_id: 'FSCID_enterprise',
      p_external_subject: 'employee-open-id',
      p_request_id: 'binding-1',
    })
    expect((await response.json()).success).toBe(true)
  })

  it('maps uniqueness conflicts to manual-review 409', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505' } })
    const response = await POST(request({ external_subject: 'employee-open-id' }), parameters)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('IDENTITY_CONFLICT')
  })
})
