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

vi.mock('@/lib/admin/org-membership', () => ({
  assertDepartmentInOrg: vi.fn(),
  createAdminTempPassword: vi.fn(),
  ensureDefaultOrganizationMembership: vi.fn(),
  hashAdminPassword: vi.fn(),
  replaceOrgRoleIds: vi.fn(),
  syncPrimaryDepartmentMembership: vi.fn(),
  syncUserSalesSpaces: vi.fn(),
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
  createAdminTempPassword,
  ensureDefaultOrganizationMembership,
  hashAdminPassword,
  replaceOrgRoleIds,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const orgId = 'org-1'
const userId = '11111111-1111-4111-8111-111111111111'
const primaryDepartmentId = '22222222-2222-4222-8222-222222222222'
const freshAssignments = [{ scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN' }]

function makeRequest(overrides: Record<string, unknown> = {}): any {
  return new Request('https://example.test/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'new.user@example.test',
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
  ;['select', 'insert', 'delete', 'eq'].forEach((method) => {
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
  const userInsert = makeQuery({
    data: {
      id: userId,
      email: 'new.user@example.test',
      display_name: 'New User',
      title: null,
      primary_dept_id: null,
      status: 'active',
    },
    error: null,
  })
  ;(supabaseAdmin.from as any)
    .mockReturnValueOnce(duplicateLookup)
    .mockReturnValueOnce(userInsert)
  return { duplicateLookup, userInsert }
}

describe('POST /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getFreshDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(freshAssignments)
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(canMutateOrgDepartments as any).mockReturnValue(true)
    ;(validateOrgRoleAssignment as any).mockResolvedValue({ ok: true, roleIds: [] })
    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: primaryDepartmentId })
    ;(createAdminTempPassword as any).mockReturnValue('Temp-password')
    ;(hashAdminPassword as any).mockResolvedValue('password-hash')
    ;(ensureDefaultOrganizationMembership as any).mockResolvedValue(undefined)
    ;(syncPrimaryDepartmentMembership as any).mockResolvedValue(undefined)
    ;(syncUserSalesSpaces as any).mockResolvedValue(undefined)
    ;(replaceOrgRoleIds as any).mockResolvedValue([])
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

  it('主部门权限不属于当前组织时在部门查询、插入和 bcrypt 前拒绝', async () => {
    ;(canMutateOrgDepartments as any).mockReturnValue(false)

    const res = await POST(makeRequest({ primary_dept_id: primaryDepartmentId }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_DEPARTMENT_PERMISSION')
    expect(canMutateOrgUsers).toHaveBeenCalledWith(freshAssignments, orgId)
    expect(canMutateOrgDepartments).toHaveBeenCalledWith(freshAssignments, orgId)
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(assertDepartmentInOrg).not.toHaveBeenCalled()
    expect(hashAdminPassword).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有主部门时只要求用户写权限且不调用部门关系 helper', async () => {
    mockSuccessfulUserInsert()

    const res = await POST(makeRequest())

    expect(res.status).toBe(201)
    expect(canMutateOrgDepartments).not.toHaveBeenCalled()
    expect(assertDepartmentInOrg).not.toHaveBeenCalled()
    expect(syncPrimaryDepartmentMembership).not.toHaveBeenCalled()
    expect(syncUserSalesSpaces).not.toHaveBeenCalled()
    expect(ensureDefaultOrganizationMembership).toHaveBeenCalledWith(userId, orgId)
    expect(replaceOrgRoleIds).toHaveBeenCalledWith(userId, orgId, [], 'admin-user')
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
        status: 'active',
      },
      error: null,
    })

    const res = await POST(makeRequest({ primary_dept_id: primaryDepartmentId }))

    expect(res.status).toBe(201)
    expect(assertDepartmentInOrg).toHaveBeenCalledWith(orgId, primaryDepartmentId)
    expect(syncPrimaryDepartmentMembership).toHaveBeenCalledWith(userId, primaryDepartmentId, orgId)
    expect(syncUserSalesSpaces).toHaveBeenCalledWith(userId, orgId, primaryDepartmentId)
  })

  it('关联写失败时补偿删除同时限定用户和组织', async () => {
    mockSuccessfulUserInsert()
    const cleanup = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(cleanup)
    ;(replaceOrgRoleIds as any).mockRejectedValue(new Error('ROLE_ASSIGN_FAILED'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(makeRequest())

    expect(res.status).toBe(500)
    expect(cleanup.delete).toHaveBeenCalledOnce()
    expect(cleanup.eq).toHaveBeenCalledWith('id', userId)
    expect(cleanup.eq).toHaveBeenCalledWith('org_id', orgId)
    consoleError.mockRestore()
  })
})
