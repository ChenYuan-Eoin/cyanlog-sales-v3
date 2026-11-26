/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgDepartments: vi.fn(),
  canMutateOrgUsers: vi.fn(),
  getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/admin/org-membership', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/admin/org-membership')>(),
  assertDepartmentInOrg: vi.fn(),
  ensureDefaultOrganizationMembership: vi.fn(),
  initializePrimaryDepartmentMembership: vi.fn(),
  syncUserSalesSpaces: vi.fn(),
}))
vi.mock('@/lib/fxiaoke/identity', () => ({
  normalizeIdentityPhone: vi.fn((value: string) => value ? '+8613900000000' : null),
}))

vi.mock('@/lib/org-role-permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/admin/org-role-authority', () => ({
  validateOrgRoleAssignment: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgDepartments,
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  assertDepartmentInOrg,
  ensureDefaultOrganizationMembership,
  initializePrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const orgId = 'org-1'
const userId = '11111111-1111-4111-8111-111111111111'
const primaryDepartmentId = '22222222-2222-4222-8222-222222222222'
const freshAssignments = [{ scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN' }]
const systemGrant: ScopedRoleAssignment = {
  roleId: userId, roleCode: 'SUPER_ADMIN', roleName: 'System administrator', grantedAt: null,
  scopeType: 'org', scopeId: orgId, permissions: ['role:manage'],
}
const activeAuthority = { orgId, settings: {}, assignments: [systemGrant] }

function makeRequest(overrides: Record<string, unknown> = {}): any {
  return new Request('https://example.test/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'new.user@example.test',
      phone: '13900000000',
      display_name: 'New User',
      role_ids: [],
      ...overrides,
    }),
  })
}

function malformedJsonRequest(): any {
  return new Request('https://example.test/api/admin/users', {
    method: 'POST',
    body: '{bad-json',
  })
}

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'insert', 'update', 'delete', 'eq'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.single = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

function mockSuccessfulUserInsert() {
  const duplicateLookup = makeQuery({ data: null, error: null })
  const duplicatePhoneLookup = makeQuery({ data: null, error: null })
  const userInsert = makeQuery({
    data: {
      id: userId,
      email: 'new.user@example.test',
      display_name: 'New User',
      title: null,
      primary_dept_id: null,
      status: 'inactive',
      login_enabled: false,
    },
    error: null,
  })
  const membershipUpdate = makeQuery({ data: null, error: null })
  const invitationInsert = makeQuery({ data: null, error: null })
  ;(supabaseAdmin.from as any)
    .mockReturnValueOnce(duplicateLookup)
    .mockReturnValueOnce(duplicatePhoneLookup)
    .mockReturnValueOnce(userInsert)
    .mockReturnValueOnce(membershipUpdate)
    .mockReturnValueOnce(invitationInsert)
  return { duplicateLookup, userInsert, membershipUpdate, invitationInsert }
}

describe('POST /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getFreshDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(freshAssignments)
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(canMutateOrgDepartments as any).mockReturnValue(true)
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(null)
    ;(validateOrgRoleAssignment as any).mockResolvedValue({ ok: true, roleIds: [] })
    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: primaryDepartmentId })
    ;(ensureDefaultOrganizationMembership as any).mockResolvedValue(undefined)
    ;(initializePrimaryDepartmentMembership as any).mockResolvedValue(undefined)
    ;(syncUserSalesSpaces as any).mockResolvedValue(undefined)
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(malformedJsonRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(getFreshDefaultOrgId).toHaveBeenCalledWith('admin-user')
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('admin-user')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有当前组织用户写权限时在解析 body 前拒绝', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)
    const json = vi.fn().mockResolvedValue({})

    const res = await POST({ json } as any)

    expect(res.status).toBe(403)
    expect(canMutateOrgUsers).toHaveBeenCalledWith(freshAssignments, orgId)
    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('主部门权限不属于当前组织时在部门查询和插入前拒绝', async () => {
    ;(canMutateOrgDepartments as any).mockReturnValue(false)

    const res = await POST(makeRequest({ primary_dept_id: primaryDepartmentId }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_DEPARTMENT_PERMISSION')
    expect(canMutateOrgUsers).toHaveBeenCalledWith(freshAssignments, orgId)
    expect(canMutateOrgDepartments).toHaveBeenCalledWith(freshAssignments, orgId)
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(assertDepartmentInOrg).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有主部门时只要求用户写权限且不调用部门关系 helper', async () => {
    const { membershipUpdate, invitationInsert } = mockSuccessfulUserInsert()

    const res = await POST(makeRequest())

    expect(res.status).toBe(201)
    expect(canMutateOrgDepartments).not.toHaveBeenCalled()
    expect(assertDepartmentInOrg).not.toHaveBeenCalled()
    expect(initializePrimaryDepartmentMembership).not.toHaveBeenCalled()
    expect(syncUserSalesSpaces).not.toHaveBeenCalled()
    expect(ensureDefaultOrganizationMembership).toHaveBeenCalledWith(userId, orgId)
    expect(membershipUpdate.update).toHaveBeenCalledWith({
      status: 'invited',
      employment_status: 'active',
    })
    expect(invitationInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: orgId,
      user_id: userId,
      role_ids: [],
      status: 'pending',
      delivery_method: 'manual_handoff',
      created_by: 'admin-user',
    }))
  })

  it('新增成员授权可以创建待激活邀请，但不能借邀请预分配角色', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([
      { scopeType: 'org', scopeId: orgId, permissions: ['user:invite'] },
    ])
    const forbidden = await POST(makeRequest({ role_ids: [userId] }))
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).code).toBe('NO_ROLE_ASSIGN_PERMISSION')
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()

    vi.mocked(loadCurrentOrganizationRoleAssignments).mockClear()
    mockSuccessfulUserInsert()
    expect((await POST(makeRequest())).status).toBe(201)
    expect(loadCurrentOrganizationRoleAssignments).not.toHaveBeenCalled()
  })

  it.each(['ADMIN', 'CUSTOM', 'ORG_SUPER_ADMIN'])('rejects invitation role assignments by %s', async (roleCode) => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({
      ...activeAuthority, assignments: [{ ...systemGrant, roleCode, permissions: ['user:assign_roles', 'role:manage'] }],
    })
    const response = await POST(makeRequest({ role_ids: [userId] }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'NO_ROLE_ASSIGN_PERMISSION' })
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('requires the current organization even for a system administrator', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({ ...activeAuthority, orgId: 'other-org' })
    const response = await POST(makeRequest({ role_ids: [userId] }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'NO_ROLE_ASSIGN_PERMISSION' })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('rejects historical baseline on a new invitation before creating any member data', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(activeAuthority)
    vi.mocked(validateOrgRoleAssignment).mockResolvedValue({ ok: false, reason: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' })

    const response = await POST(makeRequest({ role_ids: [userId] }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('preserves verified role preassignment for the active organization system administrator', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(activeAuthority)
    vi.mocked(validateOrgRoleAssignment).mockResolvedValue({ ok: true, roleIds: [userId] })
    const { invitationInsert } = mockSuccessfulUserInsert()

    const response = await POST(makeRequest({ role_ids: [userId] }))

    expect(response.status).toBe(201)
    expect(validateOrgRoleAssignment).toHaveBeenCalledWith([systemGrant], orgId, [userId])
    expect(invitationInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ role_ids: [userId] }))
  })

  it('rolls back the new member and returns 403 when role authority changes before saving their invitation', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(activeAuthority)
    vi.mocked(validateOrgRoleAssignment).mockResolvedValue({ ok: true, roleIds: [userId] })
    const { invitationInsert } = mockSuccessfulUserInsert()
    const cleanup = makeQuery({ data: null, error: null })
    invitationInsert.insert.mockResolvedValueOnce({
      data: null, error: { code: '42501', details: 'PERSONNEL_INVITATION_ROLE_AUTHORITY_REQUIRED' },
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(cleanup)

    const response = await POST(makeRequest({ role_ids: [userId] }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'NO_ROLE_ASSIGN_PERMISSION' })
    expect(supabaseAdmin.from).toHaveBeenLastCalledWith('users')
    expect(cleanup.delete).toHaveBeenCalledOnce()
    expect(cleanup.eq).toHaveBeenCalledWith('id', userId)
    expect(cleanup.eq).toHaveBeenCalledWith('org_id', orgId)
  })

  it('有主部门时使用同一组织双权限并把 orgId 传给关系 helper', async () => {
    const { userInsert } = mockSuccessfulUserInsert()
    userInsert.single.mockResolvedValueOnce({
      data: {
        id: userId,
        email: 'new.user@example.test',
        display_name: 'New User',
        title: null,
        primary_dept_id: primaryDepartmentId,
        status: 'inactive',
        login_enabled: false,
      },
      error: null,
    })

    const res = await POST(makeRequest({ primary_dept_id: primaryDepartmentId }))

    expect(res.status).toBe(201)
    expect(assertDepartmentInOrg).toHaveBeenCalledWith(orgId, primaryDepartmentId)
    expect(initializePrimaryDepartmentMembership).toHaveBeenCalledWith('admin-user', orgId, userId, primaryDepartmentId)
    expect(syncUserSalesSpaces).toHaveBeenCalledWith(userId, orgId, primaryDepartmentId)
  })

  it('初始主部门受到台账授权保护时拒绝并且不创建邀请', async () => {
    const { invitationInsert } = mockSuccessfulUserInsert()
    ;(initializePrimaryDepartmentMembership as any).mockRejectedValueOnce({
      code: '42501', details: 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN',
    })
    const response = await POST(makeRequest({ primary_dept_id: primaryDepartmentId }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN' })
    expect(invitationInsert.insert).not.toHaveBeenCalled()
    expect(syncUserSalesSpaces).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenLastCalledWith('users')
    expect(invitationInsert.delete).toHaveBeenCalledOnce()
    expect(invitationInsert.eq).toHaveBeenCalledWith('id', userId)
    expect(invitationInsert.eq).toHaveBeenCalledWith('org_id', orgId)
  })

  it('关联写失败时补偿删除同时限定用户和组织', async () => {
    const { invitationInsert } = mockSuccessfulUserInsert()
    const cleanup = makeQuery({ data: null, error: null })
    invitationInsert.insert.mockResolvedValueOnce({ data: null, error: new Error('INVITATION_FAILED') })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(cleanup)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(makeRequest())

    expect(res.status).toBe(500)
    expect(cleanup.delete).toHaveBeenCalledOnce()
    expect(cleanup.eq).toHaveBeenCalledWith('id', userId)
    expect(cleanup.eq).toHaveBeenCalledWith('org_id', orgId)
    consoleError.mockRestore()
  })
})
