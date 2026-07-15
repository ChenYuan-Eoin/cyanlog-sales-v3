/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { userHasOrgRoleCode, validateOrgRoleAssignment } from './org-role-authority'

function actor(permissions: string[]): ScopedRoleAssignment[] {
  return [{
    scopeType: 'org',
    scopeId: 'org-a',
    grantedAt: null,
    roleId: 'actor-role',
    roleCode: 'ADMIN',
    roleName: '管理员',
    permissions,
  }]
}

function mockRoles(data: unknown[], error: unknown = null) {
  const query: any = {}
  query.select = vi.fn().mockReturnValue(query)
  query.in = vi.fn().mockResolvedValue({ data, error })
  ;(supabaseAdmin.from as any).mockReturnValue(query)
  return query
}

function mockUserRoles(data: unknown[], error: unknown = null) {
  const query: any = {}
  query.select = vi.fn().mockReturnValue(query)
  query.eq = vi.fn().mockReturnValue(query)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve({ data, error }).then(resolve, reject)
  )
  ;(supabaseAdmin.from as any).mockReturnValue(query)
  return query
}

describe('validateOrgRoleAssignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('允许组织管理员分配普通业务角色并去重', async () => {
    mockRoles([{ id: 'role-sales', code: 'SALES', permissions: ['contract:view'] }])

    await expect(validateOrgRoleAssignment(
      actor(['user:*']),
      'org-a',
      ['role-sales', 'role-sales']
    )).resolves.toEqual({ ok: true, roleIds: ['role-sales'] })
  })

  it.each([
    ['SUPER_ADMIN', ['contract:view']],
    ['ADMIN', ['*']],
    ['PUBLISHER', ['config:publish']],
  ])('拒绝在线分配越权角色 %s', async (code, permissions) => {
    mockRoles([{ id: 'role-high', code, permissions }])

    await expect(validateOrgRoleAssignment(
      actor(['contract:*']),
      'org-a',
      ['role-high']
    )).resolves.toEqual({ ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' })
  })

  it('角色不存在时失败而不返回可写 ID', async () => {
    mockRoles([])

    await expect(validateOrgRoleAssignment(
      actor(['*']),
      'org-a',
      ['missing-role']
    )).resolves.toEqual({ ok: false, reason: 'ROLE_NOT_FOUND' })
  })
})

describe('userHasOrgRoleCode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('只读取目标用户在当前组织的精确角色绑定', async () => {
    const query = mockUserRoles([{ role: { code: 'SUPER_ADMIN' } }])

    await expect(userHasOrgRoleCode('user-2', 'org-a', 'SUPER_ADMIN')).resolves.toBe(true)
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-2')
    expect(query.eq).toHaveBeenCalledWith('scope_type', 'org')
    expect(query.eq).toHaveBeenCalledWith('scope_id', 'org-a')
  })
})
