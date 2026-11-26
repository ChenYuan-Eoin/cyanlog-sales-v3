/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionSettings: vi.fn(async () => ({})) }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import {
  canAccessContractAction,
  canManageOrg,
  canMutateOrgDepartments,
  canMutateOrgUsers,
  canReviewContracts,
  getDefaultOrgId,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
  getOrgPermissions,
  getOrgAuthorizationRoleCodes,
  getUserScopedRoleAssignments,
  loadRolePermissionSettingsForScopes,
  getOrgRoleCodes,
  getOrgScopedAssignments,
  listAccessibleUserIds,
  listFreshAccessibleUserIds,
  type ScopedRoleAssignment,
} from './scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'

function makeDefaultOrgQuery(result: unknown | Promise<unknown>) {
  const query: any = {}
  ;['select', 'eq', 'is'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockReturnValue(Promise.resolve(result))
  return query
}

function makeCollectionQuery(result: unknown) {
  const query: any = {
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  ;['select', 'eq', 'in'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  return query
}

function rootBinding(userId: string, orgId: string) {
  return {
    user_id: userId, org_id: orgId, scope_type: 'org', scope_id: orgId, granted_at: null,
    role: { id: 'system-admin', code: 'SUPER_ADMIN', name: '系统超管', permissions: ['*'] },
  }
}

function rootMembership(userId: string, orgId: string) {
  return {
    user_id: userId, org_id: orgId, status: 'active', employment_status: 'active', is_default: true, left_at: null,
    user: { id: userId, status: 'active', login_enabled: true },
    organization: { id: orgId, status: 'active' },
  }
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

  it.each([
    ['view', 'READONLY', ['contract:view']],
    ['view', 'LEGACY_READER', ['contract:read']],
    ['view', 'SALES', ['contract:upload']],
    ['view', 'LEGAL', ['contract:review']],
    ['view', 'ADMIN', []],
    ['view', 'SUPER_ADMIN', []],
    ['create_or_upload', 'SALES', ['contract:upload']],
    ['create_or_upload', 'CONTRACT_CREATOR', ['contract:create']],
    ['create_or_upload', 'CONTRACT_EDITOR', ['contract:write']],
    ['create_or_upload', 'ADMIN', []],
    ['create_or_upload', 'SUPER_ADMIN', []],
    ['review', 'LEGAL', ['contract:review']],
    ['review', 'CONTRACT_EDITOR', ['contract:write']],
    ['review', 'ADMIN', []],
    ['review', 'SUPER_ADMIN', []],
  ] as const)('%s 允许当前组织 %s / %j', (action, roleCode, permissions) => {
    expect(canAccessContractAction([
      assignment('org-a', roleCode, [...permissions]),
    ], 'org-a', action)).toBe(true)
  })

  it.each([
    ['view', 'SALES', ['quote:view']],
    ['create_or_upload', 'LEGAL', ['contract:review']],
    ['create_or_upload', 'READONLY', ['contract:view']],
    ['review', 'SALES', ['contract:upload']],
    ['review', 'READONLY', ['contract:view']],
  ] as const)('%s 拒绝当前组织 %s / %j', (action, roleCode, permissions) => {
    expect(canAccessContractAction([
      assignment('org-a', roleCode, [...permissions]),
    ], 'org-a', action)).toBe(false)
  })

  it('其他组织的管理员与合同通配权限不能跨组织授权任何合同动作', () => {
    const crossOrgAssignments = [
      assignment('org-b', 'SUPER_ADMIN', ['*']),
      assignment('org-b', 'LEGAL', ['contract:*']),
    ]

    expect(canAccessContractAction(crossOrgAssignments, 'org-a', 'view')).toBe(false)
    expect(canAccessContractAction(crossOrgAssignments, 'org-a', 'create_or_upload')).toBe(false)
    expect(canAccessContractAction(crossOrgAssignments, 'org-a', 'review')).toBe(false)
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

describe('fresh mutation access scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bypasses a cached administrator role after revocation', async () => {
    const oldRoleQuery = makeCollectionQuery({
      data: [{
        scope_type: 'org',
        scope_id: 'org-fresh-access',
        granted_at: null,
        role: {
          id: 'role-admin',
          code: 'ADMIN',
          name: '管理员',
          permissions: ['admin:access'],
        },
      }],
      error: null,
    })
    const orgUsersQuery = makeCollectionQuery({
      data: [{ id: 'fresh-access-user' }, { id: 'another-user' }],
      error: null,
    })
    const revokedRoleQuery = makeCollectionQuery({ data: [], error: null })
    const memberSpacesQuery = makeCollectionQuery({ data: [], error: null })

    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(oldRoleQuery)
      .mockReturnValueOnce(orgUsersQuery)
      .mockReturnValueOnce(revokedRoleQuery)
      .mockReturnValueOnce(memberSpacesQuery)

    await expect(listAccessibleUserIds('fresh-access-user', 'org-fresh-access'))
      .resolves.toMatchObject({ userIds: ['fresh-access-user', 'another-user'] })
    await expect(listFreshAccessibleUserIds('fresh-access-user', 'org-fresh-access'))
      .resolves.toMatchObject({ userIds: ['fresh-access-user'] })
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(4)
  })
})


describe('organization role permission overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadOrgRolePermissionSettings).mockResolvedValue({})
  })

  it('保留超管身份但阻止覆盖角色的隐式管理和合同权限', () => {
    const overridden = [{ ...assignment('org-a', 'SUPER_ADMIN', []), permissionsOverridden: true }]
    expect(getOrgRoleCodes(overridden, 'org-a')).toEqual(['SUPER_ADMIN'])
    expect(getOrgAuthorizationRoleCodes(overridden, 'org-a')).toEqual([])
    expect(canManageOrg(overridden, 'org-a')).toBe(false)
    expect(canMutateOrgUsers(overridden, 'org-a')).toBe(false)
    expect(canMutateOrgDepartments(overridden, 'org-a')).toBe(false)
    expect(canAccessContractAction(overridden, 'org-a', 'view')).toBe(false)
    expect(canAccessContractAction(overridden, 'org-a', 'review')).toBe(false)
  })

  it('validates the organization administrator binding and rereads it after revocation on ordinary read paths', async () => {
    const orgId = 'org-with-delegation'
    const role = { id: 'org-management', code: 'ORG_SUPER_ADMIN', name: '组织超级管理员', permissions: ['*'] }
    const exact = { org_id: orgId, scope_type: 'org', scope_id: orgId, granted_at: null, role }
    const foreign = { ...exact, org_id: 'other' }
    const department = { ...exact, scope_type: 'department' }
    const member = makeDefaultOrgQuery({ data: { org_id: orgId }, error: null })
    let granted = true
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => table === 'user_organizations' ? member
      : makeCollectionQuery({ data: [...(granted ? [exact] : []), foreign, department], error: null }))

    const before = await getUserScopedRoleAssignments('org-delegated-user')
    expect(before).toHaveLength(1)
    expect(canManageOrg(before, orgId)).toBe(true)
    expect(canReviewContracts(before, orgId)).toBe(false)
    expect(getOrgAuthorizationRoleCodes(before, orgId)).toEqual([])
    expect(getOrgPermissions(before, orgId)).not.toContain('*')
    expect(member.eq).toHaveBeenCalledWith('organization.status', 'active')
    expect(member.is).toHaveBeenCalledWith('left_at', null)

    granted = false
    expect(await getUserScopedRoleAssignments('org-delegated-user')).toEqual([])
  })

  it('rechecks a cached system super administrator binding after a member is removed from that role', async () => {
    const userId = 'revoked-root'
    const orgId = 'org-with-system-admin'
    const membership = makeDefaultOrgQuery({ data: rootMembership(userId, orgId), error: null })
    let granted = true
    vi.mocked(supabaseAdmin.from).mockImplementation(table => table === 'user_organizations' ? membership
      : makeCollectionQuery({ data: granted ? [rootBinding(userId, orgId)] : [], error: null }))

    const current = await getUserScopedRoleAssignments(userId)
    expect(getOrgRoleCodes(current, orgId)).toEqual(['SUPER_ADMIN'])
    expect(getOrgPermissions(current, orgId)).toEqual(['*'])
    expect(membership.eq).toHaveBeenCalledWith('user_id', userId)
    expect(membership.eq).toHaveBeenCalledWith('is_default', true)

    granted = false
    expect(await getUserScopedRoleAssignments(userId)).toEqual([])
  })

  it.each([
    ['department scope', { scope_type: 'department' }],
    ['space scope', { scope_type: 'space' }],
    ['null scope id', { scope_id: null }],
    ['scope in another organization', { scope_id: 'foreign-org' }],
    ['organizational binding outside the default organization', { org_id: 'foreign-org', scope_id: 'foreign-org' }],
    ['binding for another user', { user_id: 'foreign-user' }],
    ['ambiguous role relation', { role: [rootBinding('unused', 'unused').role, { code: 'OTHER' }] }],
  ])('rejects a system super administrator with %s', async (scenario, binding) => {
    const userId = `root-binding-${scenario}`
    const orgId = 'active-org'
    vi.mocked(supabaseAdmin.from).mockImplementation(table => table === 'user_organizations'
      ? makeDefaultOrgQuery({ data: rootMembership(userId, orgId), error: null })
      : makeCollectionQuery({ data: [{ ...rootBinding(userId, orgId), ...binding }], error: null }))

    expect(await getFreshUserScopedRoleAssignments(userId)).toEqual([])
    expect(await getUserScopedRoleAssignments(userId)).toEqual([])
    expect(loadOrgRolePermissionSettings).not.toHaveBeenCalled()
  })

  it.each([
    ['no default membership', () => null],
    ['non-default membership', (row: ReturnType<typeof rootMembership>) => ({ ...row, is_default: false })],
    ['inactive membership', (row: ReturnType<typeof rootMembership>) => ({ ...row, status: 'suspended' })],
    ['inactive employment', (row: ReturnType<typeof rootMembership>) => ({ ...row, employment_status: 'ended' })],
    ['organization departure', (row: ReturnType<typeof rootMembership>) => ({ ...row, left_at: '2026-11-26T05:00:00Z' })],
    ['inactive organization', (row: ReturnType<typeof rootMembership>) => ({ ...row, organization: { ...row.organization, status: 'inactive' } })],
    ['foreign organization relation', (row: ReturnType<typeof rootMembership>) => ({ ...row, organization: { ...row.organization, id: 'foreign' } })],
    ['inactive account', (row: ReturnType<typeof rootMembership>) => ({ ...row, user: { ...row.user, status: 'inactive' } })],
    ['disabled login', (row: ReturnType<typeof rootMembership>) => ({ ...row, user: { ...row.user, login_enabled: false } })],
  ])('removes cached system authority when the current state has %s', async (scenario, change) => {
    const userId = `root-account-${scenario}`
    const orgId = 'active-org'
    const membership = rootMembership(userId, orgId)
    let current: unknown = membership
    vi.mocked(supabaseAdmin.from).mockImplementation(table => table === 'user_organizations'
      ? makeDefaultOrgQuery({ data: current, error: null })
      : makeCollectionQuery({ data: [rootBinding(userId, orgId)], error: null }))

    expect(getOrgPermissions(await getUserScopedRoleAssignments(userId), orgId)).toEqual(['*'])
    current = change(membership)
    expect(await getUserScopedRoleAssignments(userId)).toEqual([])
  })

  it('does not use cached authorization when the current root eligibility read fails', async () => {
    const userId = 'root-eligibility-unavailable'
    const orgId = 'active-org'
    let failure: Error | null = null
    vi.mocked(supabaseAdmin.from).mockImplementation(table => table === 'user_organizations'
      ? makeDefaultOrgQuery({ data: failure ? null : rootMembership(userId, orgId), error: failure })
      : makeCollectionQuery({ data: [rootBinding(userId, orgId)], error: null }))

    expect(getOrgPermissions(await getUserScopedRoleAssignments(userId), orgId)).toEqual(['*'])
    failure = new Error('root eligibility unavailable')
    await expect(getUserScopedRoleAssignments(userId)).rejects.toThrow('root eligibility unavailable')
  })

  it('角色模板被缓存时仍每次读取当前组织覆盖，并保留组织隔离', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeCollectionQuery({ data: [
      {scope_type:'org',scope_id:'org-override-a',granted_at:null,role:{id:'same-role',code:'CUSTOM',name:'普通角色',permissions:['config:read']}},
      {scope_type:'org',scope_id:'org-override-b',granted_at:null,role:{id:'same-role',code:'CUSTOM',name:'普通角色',permissions:['config:read']}},
    ],error:null}))
    let revoked = false
    vi.mocked(loadOrgRolePermissionSettings).mockImplementation(async orgId => (
      revoked && orgId === 'org-override-a' ? {role_permission_overrides:{'same-role':[]}} : {}
    ))
    const before = await getUserScopedRoleAssignments('override-cache-user')
    expect(getOrgPermissions(before,'org-override-a')).toEqual(['config:read'])
    revoked = true
    const after = await getUserScopedRoleAssignments('override-cache-user')
    expect(getOrgPermissions(after,'org-override-a')).toEqual([])
    expect(getOrgPermissions(after,'org-override-b')).toEqual(['config:read'])
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(loadOrgRolePermissionSettings).toHaveBeenCalledTimes(4)
  })

  it('已缓存模板不会在组织覆盖读取失败时恢复授权', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeCollectionQuery({data:[
      {scope_type:'org',scope_id:'org-unavailable',granted_at:null,role:{id:'r',code:'ADMIN',name:'管理员',permissions:['config:read']}},
    ],error:null}))
    await getUserScopedRoleAssignments('override-failure-user')
    vi.mocked(loadOrgRolePermissionSettings).mockRejectedValueOnce(new Error('permission store unavailable'))
    await expect(getUserScopedRoleAssignments('override-failure-user')).rejects.toThrow('permission store unavailable')
  })

  it('部门和空间作用域根据其实际组织读取覆盖', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeCollectionQuery({data:[{id:'dept-a',org_id:'org-a'}],error:null}))
      .mockReturnValueOnce(makeCollectionQuery({data:[{id:'space-b',org_id:'org-b'}],error:null}))
    vi.mocked(loadOrgRolePermissionSettings).mockImplementation(async orgId => ({orgId}))
    const settings = await loadRolePermissionSettingsForScopes([
      {scopeType:'department',scopeId:'dept-a'}, {scopeType:'space',scopeId:'space-b'},
    ])
    expect(settings.get('department:dept-a')).toEqual({orgId:'org-a'})
    expect(settings.get('space:space-b')).toEqual({orgId:'org-b'})
  })
})
