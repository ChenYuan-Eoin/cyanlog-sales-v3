/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import {
  canManageOrg,
  canMutateOrgDepartments,
  canMutateOrgUsers,
  canReviewContracts,
  getDefaultOrgId,
  getFreshDefaultOrgId,
  getOrgPermissions,
  getOrgRoleCodes,
  getOrgScopedAssignments,
  type ScopedRoleAssignment,
} from './scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

function makeDefaultOrgQuery(result: unknown | Promise<unknown>) {
  const query: any = {}
  ;['select', 'eq'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockReturnValue(Promise.resolve(result))
  return query
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function assignment(
  scopeId: string | null,
  roleCode: string,
  permissions: string[]
): ScopedRoleAssignment {
  return {
    scopeType: 'org',
    scopeId,
    grantedAt: null,
    roleId: `${roleCode}-${scopeId}`,
    roleCode,
    roleName: roleCode,
    permissions,
  }
}

describe('exact organization role scope', () => {
  const assignments = [
    assignment('org-a', 'SALES', ['config:read']),
    assignment('org-b', 'SUPER_ADMIN', ['*']),
    assignment(null, 'ADMIN', ['admin:access']),
  ]

  it('只返回当前组织精确绑定，拒绝其他组织和 null legacy scope', () => {
    expect(getOrgScopedAssignments(assignments, 'org-a')).toEqual([assignments[0]])
    expect(getOrgRoleCodes(assignments, 'org-a')).toEqual(['SALES'])
    expect(getOrgPermissions(assignments, 'org-a')).toEqual(['config:read'])
  })

  it('其他组织的 SUPER_ADMIN 和 null ADMIN 不能授权当前组织', () => {
    expect(canManageOrg(assignments, 'org-a')).toBe(false)
    expect(canReviewContracts(assignments, 'org-a')).toBe(false)
  })

  it('当前组织自己的管理员权限仍然生效', () => {
    const currentOrgAdmin = [assignment('org-a', 'ADMIN', ['admin:access', 'contract:review'])]

    expect(canManageOrg(currentOrgAdmin, 'org-a')).toBe(true)
    expect(canReviewContracts(currentOrgAdmin, 'org-a')).toBe(true)
  })

  it('只读 user:view 可查看但不能创建用户或修改角色', () => {
    const viewer = [assignment('org-a', 'AUDITOR', ['user:view'])]

    expect(canManageOrg(viewer, 'org-a')).toBe(true)
    expect(canMutateOrgUsers(viewer, 'org-a')).toBe(false)
  })

  it('当前组织 user:write 可写，其他组织的写权限不可串用', () => {
    expect(canMutateOrgUsers([
      assignment('org-a', 'ORG_ADMIN', ['user:write']),
      assignment('org-b', 'ADMIN', ['*']),
    ], 'org-a')).toBe(true)
    expect(canMutateOrgUsers([
      assignment('org-b', 'ORG_ADMIN', ['user:write']),
    ], 'org-a')).toBe(false)
  })

  it.each([
    ['SUPER_ADMIN', []],
    ['ADMIN', []],
    ['DEPARTMENT_OPERATOR', ['dept:write']],
    ['DEPARTMENT_OPERATOR', ['dept:*']],
    ['ORG_OPERATOR', ['org:write']],
    ['ORG_OPERATOR', ['org:*']],
    ['PLATFORM_OPERATOR', ['*']],
  ])('当前组织 %s / %j 可以维护部门', (roleCode, permissions) => {
    expect(canMutateOrgDepartments([
      assignment('org-a', roleCode as string, permissions as string[]),
    ], 'org-a')).toBe(true)
  })

  it.each([
    ['SALES_OPS', []],
    ['AUDITOR', ['admin:access']],
    ['AUDITOR', ['user:view']],
    ['USER_OPERATOR', ['user:write']],
    ['DEPARTMENT_VIEWER', ['dept:read']],
  ])('当前组织 %s / %j 不能维护部门', (roleCode, permissions) => {
    expect(canMutateOrgDepartments([
      assignment('org-a', roleCode as string, permissions as string[]),
    ], 'org-a')).toBe(false)
  })

  it('其他组织或非组织作用域的部门写权限不能维护当前组织', () => {
    expect(canMutateOrgDepartments([
      assignment('org-b', 'ADMIN', ['dept:*']),
      {
        ...assignment('dept-a', 'DEPARTMENT_OPERATOR', ['dept:write']),
        scopeType: 'department',
      },
      {
        ...assignment('space-a', 'SPACE_OPERATOR', ['*']),
        scopeType: 'space',
      },
    ], 'org-a')).toBe(false)
  })
})

describe('fresh default organization lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('绕过已有旧缓存并让后续 cached getter 读取 fresh 结果', async () => {
    const oldQuery = makeDefaultOrgQuery({ data: { org_id: 'org-old' }, error: null })
    const freshQuery = makeDefaultOrgQuery({ data: { org_id: 'org-new' }, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(oldQuery)
      .mockReturnValueOnce(freshQuery)

    await expect(getDefaultOrgId('fresh-user-1')).resolves.toBe('org-old')
    await expect(getFreshDefaultOrgId('fresh-user-1')).resolves.toBe('org-new')
    await expect(getDefaultOrgId('fresh-user-1')).resolves.toBe('org-new')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('较旧的并发 cached lookup 完成后不能覆盖 fresh 组织', async () => {
    const oldResult = deferred<{ data: { org_id: string }; error: null }>()
    const oldQuery = makeDefaultOrgQuery(oldResult.promise)
    const freshQuery = makeDefaultOrgQuery({ data: { org_id: 'org-new' }, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(oldQuery)
      .mockReturnValueOnce(freshQuery)

    const oldLookup = getDefaultOrgId('fresh-user-race')
    await expect(getFreshDefaultOrgId('fresh-user-race')).resolves.toBe('org-new')
    oldResult.resolve({ data: { org_id: 'org-old' }, error: null })
    await expect(oldLookup).resolves.toBe('org-old')
    await expect(getDefaultOrgId('fresh-user-race')).resolves.toBe('org-new')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })
})
