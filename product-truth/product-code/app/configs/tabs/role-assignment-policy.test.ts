import { describe, expect, it } from 'vitest'
import type { OrgSummaryUser } from '../types'
import {
  editableOrgRoleIds,
  getRoleMutationRestriction,
  partitionRoleMutationTargets,
  userHasProtectedPlatformRole,
} from './role-assignment-policy'

function makeUser(overrides: Partial<OrgSummaryUser> = {}): OrgSummaryUser {
  return {
    id: 'user-1',
    email: 'user-1@example.test',
    display_name: '测试成员',
    title: '',
    primary_dept_name: '测试部门',
    role_names: '销售',
    role_ids: ['role-sales'],
    role_codes: ['SALES'],
    status: 'active',
    ...overrides,
  }
}

describe('role assignment UI policy', () => {
  it('当前身份未确认时禁止所有角色变更', () => {
    const restriction = getRoleMutationRestriction(makeUser(), null)

    expect(restriction).toMatchObject({
      code: 'IDENTITY_UNRESOLVED',
      label: '身份确认中',
    })
  })

  it('当前登录用户不能修改自己的角色', () => {
    const restriction = getRoleMutationRestriction(makeUser({ id: 'actor-1' }), 'actor-1')

    expect(restriction).toMatchObject({
      code: 'SELF_ROLE_MUTATION_FORBIDDEN',
      label: '当前账号角色只读',
    })
  })

  it('SUPER_ADMIN 用户在组织角色界面始终只读', () => {
    const protectedUser = makeUser({
      id: 'root-1',
      role_codes: ['SUPER_ADMIN'],
      role_names: '超级管理员',
    })

    expect(userHasProtectedPlatformRole(protectedUser)).toBe(true)
    expect(getRoleMutationRestriction(protectedUser, 'actor-1')).toMatchObject({
      code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN',
      label: '平台根管理员只读',
    })
  })

  it('也能从组织作用域绑定识别 SUPER_ADMIN', () => {
    const protectedUser = makeUser({
      role_codes: [],
      scoped_roles: [{
        roleId: 'role-root',
        roleName: '超级管理员',
        roleCode: 'SUPER_ADMIN',
        scopeType: 'org',
        scopeId: 'org-1',
        scopeName: '组织',
        grantedAt: null,
      }],
    })

    expect(userHasProtectedPlatformRole(protectedUser)).toBe(true)
  })

  it('批量候选只保留其他普通成员，预先排除自己和平台根管理员', () => {
    const actor = makeUser({ id: 'actor-1' })
    const root = makeUser({ id: 'root-1', role_codes: ['SUPER_ADMIN'] })
    const ordinary = makeUser({ id: 'ordinary-1' })

    const result = partitionRoleMutationTargets([actor, root, ordinary], 'actor-1')

    expect(result.eligible.map((user) => user.id)).toEqual(['ordinary-1'])
    expect(result.restricted.map((user) => user.id)).toEqual(['actor-1', 'root-1'])
  })
})

it('allows only server-verified invitees to edit pre-login roles and keeps prior assignments in replacements', () => {
  const employee = makeUser({
    status: 'inactive', membership_status: 'invited', login_enabled: false,
    can_preassign_org_roles: true,
    pending_org_roles: [{ id: 'role-shipping', code: 'SHIPPING', name: '寄件' }],
  })
  expect(getRoleMutationRestriction(employee, 'actor')).toBeNull()
  expect(editableOrgRoleIds(employee)).toEqual(['role-sales', 'role-shipping'])
  expect(getRoleMutationRestriction({ ...employee, can_preassign_org_roles: undefined }, 'actor')?.code).toBe('MEMBER_NOT_ELIGIBLE')
  expect(getRoleMutationRestriction(employee, employee.id)?.code).toBe('SELF_ROLE_MUTATION_FORBIDDEN')
})

it('keeps exact organization administrator bindings out of ordinary replacements', () => {
  const employee = makeUser({
    role_ids: ['role-sales', 'org-super'],
    scoped_roles: [{
      roleId: 'org-super', roleCode: 'ORG_SUPER_ADMIN', roleName: '组织超级管理员',
      scopeType: 'org', scopeId: 'org-1', scopeName: '组织', grantedAt: null,
    }],
    pending_org_roles: [
      { id: 'pending-admin', code: 'ORG_SUPER_ADMIN', name: '组织超级管理员' },
      { id: 'pending-sales', code: 'OTHER_SALES', name: '销售支持' },
    ],
  })
  expect(editableOrgRoleIds(employee)).toEqual(['role-sales', 'pending-sales'])
  expect(getRoleMutationRestriction(employee, 'actor')).toBeNull()
})
