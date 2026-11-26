import type { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { requireAuth } from '@/lib/auth'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { getFreshDefaultOrgId, getFreshUserScopedRoleAssignments, type ScopedRoleAssignment } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

vi.mock('@/lib/admin/org-role-authority', () => ({ validateOrgRoleAssignment: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/org-role-permissions', async (original) => ({
  ...await original<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/scoped-access', async (original) => ({
  ...await original<typeof import('@/lib/scoped-access')>(),
  getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }))

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'
const pending = '33333333-3333-4333-8333-333333333333'
const role = '44444444-4444-4444-8444-444444444444'
const authority: ScopedRoleAssignment = {
  roleId: role, roleName: 'System administrator', roleCode: 'SUPER_ADMIN', grantedAt: null,
  scopeType: 'org', scopeId: org, permissions: ['*'],
}
const rpc = vi.mocked(supabaseAdmin.rpc)
const assignBody = { action: 'assign_roles', expected_org_id: org, user_ids: [member], role_ids: [role] }

function request(body: unknown) {
  return new Request('https://example.test/api/admin/users/batch', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'batch-test' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function mockDatabase(data: unknown, error: unknown = null) {
  rpc.mockResolvedValueOnce({ data, error } as Awaited<ReturnType<typeof supabaseAdmin.rpc>>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ id: actor, email: null, phone: null, display_name: null })
  vi.mocked(getFreshDefaultOrgId).mockResolvedValue(org)
  vi.mocked(getFreshUserScopedRoleAssignments).mockResolvedValue([authority])
  vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({ orgId: org, settings: {}, assignments: [authority] })
  vi.mocked(validateOrgRoleAssignment).mockResolvedValue({ ok: true, roleIds: [role] })
})

it('rejects invalid parameters and a changed organization before mutation', async () => {
  let response = await POST(request({ ...assignBody, user_ids: [member, 'invalid'] }))
  expect(response.status).toBe(400)
  response = await POST(request({ ...assignBody, action: 'offboard' }))
  expect(response.status).toBe(400)
  response = await POST(request({ ...assignBody, expected_org_id: foreignOrg }))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'ORGANIZATION_CHANGED' })
  expect(rpc).not.toHaveBeenCalled()
})

it('enforces separate lifecycle permissions and requires the canonical administrator for batch role assignment', async () => {
  const loginOnly = { ...authority, roleCode: 'CUSTOM', permissions: ['user:manage_login'] }
  vi.mocked(getFreshUserScopedRoleAssignments).mockResolvedValue([loginOnly])
  vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({ orgId: org, settings: {}, assignments: [loginOnly] })
  const lifecycleBody = { expected_org_id: org, user_ids: [member] }
  expect((await POST(request({ ...lifecycleBody, action: 'offboard' }))).status).toBe(403)
  expect((await POST(request(assignBody))).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()

  mockDatabase([{ user_id: member, outcome: 'saved' }])
  expect((await POST(request({ ...lifecycleBody, action: 'suspend' }))).status).toBe(200)
  expect(rpc).toHaveBeenCalledWith('admin_apply_org_member_batch_v1', {
    p_actor_id: actor, p_org_id: org, p_user_ids: [member], p_action: 'suspend', p_role_ids: [], p_request_id: 'batch-test',
  })
})

it('uses one organization-scoped additive command and reports effective, pending and rejected members separately', async () => {
  mockDatabase([
    { user_id: pending, outcome: 'pending' },
    { user_id: actor, outcome: 'SELF_MUTATION_FORBIDDEN' },
    { user_id: member, outcome: 'saved' },
  ])
  const response = await POST(request({ ...assignBody, user_ids: [member, pending, member, actor] }))
  expect(response.status).toBe(200)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_apply_org_member_batch_v1', {
    p_actor_id: actor, p_org_id: org, p_user_ids: [member, pending, actor], p_action: 'assign_roles',
    p_role_ids: [role], p_request_id: 'batch-test',
  })
  expect(await response.json()).toEqual({
    results: [
      { user_id: member, ok: true },
      { user_id: pending, ok: true, pending: true },
      { user_id: actor, ok: false, code: 'SELF_MUTATION_FORBIDDEN', error: '不能批量修改当前账号' },
    ],
    succeeded: 2, failed: 1,
  })
})

it('rejects roles that became unavailable and never reports an incomplete mutation response as success', async () => {
  mockDatabase(null, { code: '23503', details: 'ORG_ROLE_NOT_FOUND' })
  let response = await POST(request(assignBody))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'ROLE_ASSIGNMENT_CHANGED' })
  mockDatabase([{ user_id: pending, outcome: 'saved' }])
  response = await POST(request(assignBody))
  expect(response.status).toBe(500)
  expect(await response.json()).toMatchObject({ code: 'MEMBER_BATCH_UNCONFIRMED' })
})
