import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { userHasOrgRoleCode, validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { DELETE, POST } from './route'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/admin/org-role-authority', () => ({
  userHasOrgRoleCode: vi.fn(),
  validateOrgRoleAssignment: vi.fn(),
}))
vi.mock('@/lib/org-role-permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const role = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const scope = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const systemGrant: ScopedRoleAssignment = {
  roleId: role, roleCode: 'SUPER_ADMIN', roleName: 'System administrator', grantedAt: null,
  scopeType: 'org', scopeId: org, permissions: ['role:manage'],
}
const activeAuthority = { orgId: org, settings: {}, assignments: [systemGrant] }

function context(id = target) {
  return { params: Promise.resolve({ id }) }
}

function request(method: 'POST' | 'DELETE', body: object = { role_id: role, scope_type: 'department', scope_id: scope }) {
  return new NextRequest('https://example.test/api/admin/users/test/role-scopes', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-request' },
    body: JSON.stringify(body),
  })
}

describe('scoped role assignment route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, email: null, phone: null, display_name: 'Admin' })
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(activeAuthority)
    vi.mocked(userHasOrgRoleCode).mockResolvedValue(false)
    vi.mocked(validateOrgRoleAssignment).mockResolvedValue({ ok: true, roleIds: [role] })
    rpc.mockResolvedValue({ data: true, error: null })
  })

  it('assigns a department role with only the server-resolved current organization', async () => {
    const response = await POST(request('POST'), context(target.toUpperCase()))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(loadCurrentOrganizationRoleAssignments).toHaveBeenCalledExactlyOnceWith(actor)
    expect(validateOrgRoleAssignment).toHaveBeenCalledExactlyOnceWith([systemGrant], org, [role], { scopeType: 'department', action: 'assign' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_set_role_scope_assignment_v1', {
      p_actor_id: actor, p_org_id: org, p_user_id: target, p_role_id: role,
      p_scope_type: 'department', p_scope_id: scope, p_action: 'assign',
      p_reason: null, p_request_id: 'test-request',
    })
  })

  it('blocks new legacy space assignments before role validation or mutation', async () => {
    const response = await POST(request('POST', {
      role_id: role, scope_type: 'space', scope_id: scope,
    }), context())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN' })
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('closes new historical baseline assignments and keeps scope removal available', async () => {
    vi.mocked(validateOrgRoleAssignment).mockResolvedValueOnce({ ok: false, reason: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' })
    const response = await POST(request('POST'), context())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' })
    expect(rpc).not.toHaveBeenCalled()

    expect((await DELETE(request('DELETE'), context())).status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_set_role_scope_assignment_v1', expect.objectContaining({
      p_role_id: role, p_action: 'revoke',
    }))
  })

  it('reports a department that became unavailable during assignment without claiming success', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', details: 'DEPARTMENT_SCOPE_UNAVAILABLE' } })
    const response = await POST(request('POST'), context())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'DEPARTMENT_SCOPE_UNAVAILABLE',
      error: '所选部门未启用或已变化，请刷新后重新选择。',
    })
  })

  it('revokes an existing legacy space role through DELETE', async () => {
    const response = await DELETE(request('DELETE', {
      role_id: role, scope_type: 'space', scope_id: scope, reason: '  Updated roster  ',
    }), context())
    expect(response.status).toBe(200)
    expect(validateOrgRoleAssignment).toHaveBeenCalledExactlyOnceWith([systemGrant], org, [role], { scopeType: 'space', action: 'revoke' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_set_role_scope_assignment_v1', {
      p_actor_id: actor, p_org_id: org, p_user_id: target, p_role_id: role,
      p_scope_type: 'space', p_scope_id: scope, p_action: 'revoke',
      p_reason: 'Updated roster', p_request_id: 'test-request',
    })
  })

  it.each(['department', 'space'] as const)('revokes only an ordinary %s binding for another system administrator', async scopeType => {
    const ordinaryRole = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    vi.mocked(userHasOrgRoleCode).mockResolvedValue(true)
    vi.mocked(validateOrgRoleAssignment).mockResolvedValue({ ok: true, roleIds: [ordinaryRole] })

    const response = await DELETE(request('DELETE', { role_id: ordinaryRole, scope_type: scopeType, scope_id: scope }), context())
    expect(response.status).toBe(200)
    expect(validateOrgRoleAssignment).toHaveBeenCalledExactlyOnceWith([systemGrant], org, [ordinaryRole], { scopeType, action: 'revoke' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_set_role_scope_assignment_v1', {
      p_actor_id: actor, p_org_id: org, p_user_id: target, p_role_id: ordinaryRole,
      p_scope_type: scopeType, p_scope_id: scope, p_action: 'revoke', p_reason: null, p_request_id: 'test-request',
    })
  })

  it('rejects organization-only role creation at department scope without running the RPC', async () => {
    vi.mocked(validateOrgRoleAssignment).mockResolvedValueOnce({ ok: false, reason: 'ROLE_SCOPE_NOT_SUPPORTED' })
    const response = await POST(request('POST'), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: '该角色需要启用支持部门范围的「查看收寄台账」权限。', code: 'ROLE_SCOPE_NOT_SUPPORTED',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects callers without an active organization or changing their own roles', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValueOnce(null)
    expect((await POST(request('POST'), context())).status).toBe(403)
    expect((await POST(request('POST'), context(actor.toUpperCase()))).status).toBe(403)
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['ADMIN', 'CUSTOM', 'ORG_SUPER_ADMIN'])('rejects unauthorized assignments and revocations for %s', async (roleCode) => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({
      ...activeAuthority, assignments: [{ ...systemGrant, roleCode, permissions: ['user:assign_roles', 'role:manage'] }],
    })
    expect((await POST(request('POST'), context())).status).toBe(403)
    expect((await DELETE(request('DELETE'), context())).status).toBe(403)
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects organization scope, request-supplied organization, protected target and reserved roles', async () => {
    expect((await POST(request('POST', { role_id: role, scope_type: 'org', scope_id: org }), context())).status).toBe(400)
    expect((await POST(request('POST', { role_id: role, scope_type: 'department', scope_id: scope, org_id: org }), context())).status).toBe(400)

    vi.mocked(userHasOrgRoleCode).mockResolvedValueOnce(true)
    const protectedTarget = await POST(request('POST'), context())
    expect(protectedTarget.status).toBe(403)
    expect(await protectedTarget.json()).toMatchObject({ code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' })

    vi.mocked(validateOrgRoleAssignment).mockResolvedValueOnce({ ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' })
    const protectedRole = await POST(request('POST'), context())
    expect(protectedRole.status).toBe(403)
    expect(await protectedRole.json()).toMatchObject({ code: 'ROLE_ESCALATION_FORBIDDEN' })
    vi.mocked(validateOrgRoleAssignment).mockResolvedValueOnce({ ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' })
    expect((await DELETE(request('DELETE'), context())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    [{ data: null, error: { code: '23514' } }, 409, 'INVALID_SCOPE'],
    [{ data: null, error: { code: '23514', details: 'ROLE_SCOPE_NOT_SUPPORTED' } }, 409, 'ROLE_SCOPE_NOT_SUPPORTED'],
    [{ data: null, error: { code: '23514', details: 'SHIPPING_DEPARTMENT_LEDGER_PERMISSION_REQUIRED' } }, 409, 'ROLE_SCOPE_NOT_SUPPORTED'],
    [{ data: null, error: { code: '42501' } }, 403, 'NO_PERMISSION'],
    [{ data: null, error: { code: 'PGRST202' } }, 503, 'SCOPE_ASSIGNMENT_UNAVAILABLE'],
    [{ data: false, error: null }, 409, 'MEMBER_NOT_ELIGIBLE'],
  ])('reports database write failure %j', async (result, status, code) => {
    rpc.mockResolvedValueOnce(result)
    const response = await POST(request('POST'), context())
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code })
  })

  it('reports authentication failure before any membership or role lookup', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
    const response = await POST(request('POST'), context())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(loadCurrentOrganizationRoleAssignments).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
