import { describe, expect, it } from 'vitest'
import type { OrgSummaryUser } from '../types'
import {
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
