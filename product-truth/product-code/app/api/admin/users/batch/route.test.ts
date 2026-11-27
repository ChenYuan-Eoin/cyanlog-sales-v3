import type { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { requireAuth } from '@/lib/auth'
import { createMiddlewareRestClient, readMiddlewareRpcRows } from '@/lib/middleware-rest-client'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { type ScopedRoleAssignment } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

vi.mock('@/lib/admin/org-role-authority', () => ({ validateOrgRoleAssignment: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/middleware-rest-client', () => ({
  createMiddlewareRestClient: vi.fn(),
  readMiddlewareRpcRows: vi.fn(),
}))

vi.mock('@/lib/org-role-permissions', async (original) => ({
  ...await original<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn(), from: vi.fn() } }))

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
  const loginOnly = { ...authority, roleCode: 'CUSTOM', permissions: ['user:view', 'user:manage_login'] }

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


it('applies a personal ALLOW and fresh DENY in the same session without exposing other actions', async () => {
  vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({
    orgId: org, settings: { employee_organization_permission_overrides_enabled: true }, assignments: [],
  })
  vi.mocked(createMiddlewareRestClient).mockReturnValue({
    selectRows: vi.fn().mockResolvedValue([
      { code: 'user:view', resource: 'user', action: 'view', capability_level: 'L3',
        enforcement_consumer: 'lib/permissions.ts#canAccessOrgAdmin',
        supported_scope_types: ['org'], grant_subject_types: ['role'], dependencies: [] },
      { code: 'user:manage_login', resource: 'user', action: 'manage_login', capability_level: 'L3',
        enforcement_consumer: 'lib/admin/member-actions.ts',
        supported_scope_types: ['org'], grant_subject_types: ['role'], dependencies: ['user:view'] },
    ]),
  } as unknown as ReturnType<typeof createMiddlewareRestClient>)
  const allow = (permission_code: string) => ({ permission_code, effect: 'ALLOW', scope: { type: 'org' } })
  const deny = (permission_code: string) => ({ permission_code, effect: 'DENY', scope: null })
  vi.mocked(readMiddlewareRpcRows).mockResolvedValue([allow('user:view'), allow('user:manage_login')])
  const payload = { action: 'suspend', expected_org_id: org, user_ids: [member] }
  mockDatabase([{ user_id: member, outcome: 'saved' }])

  expect((await POST(request(payload))).status).toBe(200)
  expect((await POST(request({ ...payload, action: 'offboard' }))).status).toBe(403)
  vi.mocked(readMiddlewareRpcRows).mockResolvedValue([deny('user:view'), allow('user:manage_login')])
  expect((await POST(request(payload))).status).toBe(403)

  expect(readMiddlewareRpcRows).toHaveBeenNthCalledWith(3, 'employee_permission_overrides_v1', {
    p_org_id: org, p_user_id: actor,
  })
  expect(rpc).toHaveBeenCalledOnce()
})

it('uses one organization-scoped additive command and reports effective, pending and rejected members separately', async () => {
  mockDatabase([
    { user_id: pending, outcome: 'pending' },
    { user_id: actor, outcome: 'SELF_MUTATION_FORBIDDEN' },
    { user_id: member, outcome: 'saved' },
  ])
  const response = await POST(request({ ...assignBody, user_ids: [member, pending, member, actor] }))
  expect(response.status).toBe(200)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_assign_org_member_roles_batch_v1', {
    p_actor_id: actor, p_org_id: org, p_user_ids: [member, pending, actor],
    p_role_ids: [role], p_request_id: 'batch-test', p_decisions: [],
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

it('exposes only the projected personal choice for matching recipients and accepts a retry of that subset', async () => {
  const review = '99999999-9999-4999-8999-999999999999'
  mockDatabase([
    { user_id: member, outcome: 'saved', affected_permissions: ['unrelated'] },
    { user_id: pending, outcome: 'ROLE_PERMISSION_REVIEW_REQUIRED', review_revision: review,
      affected_permissions: [{ permission_code: 'user:view', retainable: true, scope: { type: 'org' } }] },
  ])
  const response = await POST(request({ ...assignBody, user_ids: [member, pending] }))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({
    succeeded: 1, failed: 0, needs_review: 1,
    results: [
      { user_id: member, ok: true },
      { user_id: pending, ok: false, code: 'ROLE_PERMISSION_REVIEW_REQUIRED', error: '请选择个人权限处理方式',
        review_revision: review, affected_permissions: [{ permission_code: 'user:view', retainable: true }] },
    ],
  })

  const decision = { user_id: pending, review_revision: review, choice: 'retain_eligible' }
  expect((await POST(request({ ...assignBody, personal_permissions: [decision] }))).status).toBe(400)
  expect((await POST(request({ ...assignBody, user_ids: [pending], personal_permissions: [decision, decision] }))).status).toBe(400)
  expect(rpc).toHaveBeenCalledOnce()

  mockDatabase([{ user_id: pending, outcome: 'ROLE_OVERRIDE_REVIEW_CHANGED' }])
  const retry = await POST(request({ ...assignBody, user_ids: [pending], personal_permissions: [decision] }))
  expect(retry.status).toBe(200)
  expect(await retry.json()).toMatchObject({ succeeded: 0, failed: 1, results: [
    { user_id: pending, code: 'ROLE_OVERRIDE_REVIEW_CHANGED' },
  ] })
  expect(rpc).toHaveBeenLastCalledWith('admin_assign_org_member_roles_batch_v1', {
    p_actor_id: actor, p_org_id: org, p_user_ids: [pending], p_role_ids: [role], p_request_id: 'batch-test',
    p_decisions: [decision],
  })
})

it('requires the checked native batch function and never retries through the legacy role writer', async () => {
  mockDatabase(null, { code: 'PGRST202' })
  const response = await POST(request(assignBody))
  expect(response.status).toBe(503)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_assign_org_member_roles_batch_v1', expect.anything())
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

it('removes eligible members through the single-member command while reporting the rest individually', async () => {
  const managed = '55555555-5555-4555-8555-555555555555'
  const protectedAdmin = '66666666-6666-4666-8666-666666666666'
  const departed = '77777777-7777-4777-8777-777777777777'
  const sources = '88888888-8888-4888-8888-888888888888'
  const rows: Record<string, unknown[]> = {
    user_organizations: [
      { user_id: member, status: 'active' },
      { user_id: pending, status: 'invited' },
      { user_id: managed, status: 'active' },
      { user_id: protectedAdmin, status: 'active' },
      { user_id: departed, status: 'ended' },
    ],
    organization_sources: [{ id: sources }],
    external_identities: [{ canonical_user_id: managed }],
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(table => {
    // PostgREST query chains resolve to the selected rows.
    const query = Promise.resolve({ data: rows[table], error: null })
    return Object.assign(query, { select: () => query, eq: () => query, in: () => query }) as unknown as ReturnType<typeof supabaseAdmin.from>
  })
  mockDatabase(true)
  mockDatabase(null, { code: '42501' })

  const body = { action: 'remove_membership', expected_org_id: org, user_ids: [member, actor, managed, pending, protectedAdmin, departed] }
  const response = await POST(request(body))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    results: [
      { user_id: member, ok: true },
      { user_id: actor, ok: false, code: 'SELF_MEMBERSHIP_REMOVAL_FORBIDDEN', error: '不能将自己移出当前组织' },
      { user_id: managed, ok: false, code: 'DIRECTORY_MEMBERSHIP_MANAGED', error: '该成员由外部通讯录管理，可在 ICU 办理离职' },
      { user_id: pending, ok: false, code: 'INVITED_MEMBERSHIP_PROTECTED', error: '请先撤销待激活邀请' },
      { user_id: protectedAdmin, ok: false, code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN', error: '平台根管理员不能移出组织' },
      { user_id: departed, ok: false, code: 'MEMBERSHIP_NOT_FOUND', error: '目标成员不存在、已离开或不在当前组织' },
    ],
    succeeded: 1, failed: 5,
  })
  expect(rpc).toHaveBeenCalledTimes(2)
  for (const userId of [member, protectedAdmin]) {
    expect(rpc).toHaveBeenCalledWith('admin_remove_tenant_membership_v1', {
      p_actor_id: actor, p_org_id: org, p_user_id: userId,
      p_reason: 'tenant administrator removed membership', p_request_id: 'batch-test',
    })
  }
})

it('keeps removal separately authorized from employment actions', async () => {
  const authorityWithoutRemoval = { ...authority, roleCode: 'CUSTOM', permissions: ['user:view', 'user:manage_employment'] }
  vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({ orgId: org, settings: {}, assignments: [authorityWithoutRemoval] })
  const body = { action: 'remove_membership', expected_org_id: org, user_ids: [member] }
  expect((await POST(request(body))).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()
  expect(supabaseAdmin.from).not.toHaveBeenCalled()
})
