/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/org-role-permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadOrgRolePermissionSettings: vi.fn(async () => ({})),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { userHasOrgRoleCode, validateOrgRoleAssignment } from './org-role-authority'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'

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
    ['ORG_SUPER_ADMIN', ['role:manage']],
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

  it('普通分配入口拒绝使用平台账号授予组织超管', async () => {
    mockRoles([{ id: 'org-root', code: 'ORG_SUPER_ADMIN', permissions: ['role:manage'] }])
    await expect(validateOrgRoleAssignment(actor(['*']), 'org-a', ['org-root']))
      .resolves.toEqual({ ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' })
  })

  it('角色不存在时失败而不返回可写 ID', async () => {
    mockRoles([])

    await expect(validateOrgRoleAssignment(
      actor(['*']),
      'org-a',
      ['missing-role']
    )).resolves.toEqual({ ok: false, reason: 'ROLE_NOT_FOUND' })
  })

  it('verifies each returned role identity instead of trusting the number of rows', async () => {
    mockRoles([
      { id: 'requested-1', code: 'SALES', permissions: [] },
      { id: 'requested-1', code: 'SALES', permissions: [] },
    ])

    await expect(validateOrgRoleAssignment(actor([]), 'org-a', ['requested-1', 'requested-2']))
      .resolves.toEqual({ ok: false, reason: 'ROLE_NOT_FOUND' })
  })

  it.each(['department', 'space'] as const)('allows canonical shipping role cleanup at %s but rejects new binding', async (scopeType) => {
    mockRoles([{ id: 'shipping-role', code: 'SHIPPING_OPERATOR', permissions: ['shipping:operate'] }])

    await expect(validateOrgRoleAssignment(actor([]), 'org-a', ['shipping-role'], { scopeType, action: 'assign' }))
      .resolves.toEqual({ ok: false, reason: 'ROLE_SCOPE_NOT_SUPPORTED' })
    await expect(validateOrgRoleAssignment(actor([]), 'org-a', ['shipping-role'], { scopeType, action: 'revoke' }))
      .resolves.toEqual({ ok: true, roleIds: ['shipping-role'] })
    expect(loadOrgRolePermissionSettings).not.toHaveBeenCalled()
    await expect(validateOrgRoleAssignment(actor([]), 'org-a', ['SHIPPING-ROLE']))
      .resolves.toEqual({ ok: true, roleIds: ['shipping-role'] })
  })

  it('preserves department assignments for a mixed role with other department permissions', async () => {
    mockRoles([{ id: 'mixed-role', code: 'FIELD_TEAM', permissions: ['shipping:operate', 'contract:view'] }])

    await expect(validateOrgRoleAssignment(actor([]), 'org-a', ['mixed-role'], { scopeType: 'department', action: 'assign' }))
      .resolves.toEqual({ ok: true, roleIds: ['mixed-role'] })
  })

  it('closes new baseline invitations and scoped grants while preserving scope revocation and DB-checked retention', async () => {
    mockRoles([{ id: 'retired', code: 'FXIAOKE_BASELINE', permissions: ['quote:view'] }])
    const expected = { ok: false, reason: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' }
    await expect(validateOrgRoleAssignment(actor(['*']), 'org-a', ['retired'])).resolves.toEqual(expected)
    await expect(validateOrgRoleAssignment(actor(['*']), 'org-a', ['retired'], { scopeType: 'department', action: 'assign' }))
      .resolves.toEqual(expected)
    await expect(validateOrgRoleAssignment(actor(['*']), 'org-a', ['retired'], { scopeType: 'space', action: 'revoke' }))
      .resolves.toEqual({ ok: true, roleIds: ['retired'] })
    await expect(validateOrgRoleAssignment(actor(['*']), 'org-a', ['retired'], { action: 'replace' }))
      .resolves.toEqual({ ok: true, roleIds: ['retired'] })
  })

  it('按组织覆盖后的权限防止借分配业务角色获得管理员权限', async () => {
    mockRoles([{ id: 'role-sales', code: 'SALES', permissions: ['contract:view'] }])
    vi.mocked(loadOrgRolePermissionSettings).mockResolvedValueOnce({ role_permission_overrides: { 'role-sales': ['role:manage'] } })
    await expect(validateOrgRoleAssignment(actor(['user:*']), 'org-a', ['role-sales']))
      .resolves.toEqual({ ok: false, reason: 'ROLE_ESCALATION_FORBIDDEN' })
  })
})

describe('userHasOrgRoleCode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('只读取目标用户在当前组织的精确角色绑定', async () => {
    const query = mockUserRoles([{ role: { code: 'SUPER_ADMIN' } }])

    await expect(userHasOrgRoleCode('user-2', 'org-a', 'SUPER_ADMIN')).resolves.toBe(true)
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-2')
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-a')
    expect(query.eq).toHaveBeenCalledWith('scope_type', 'org')
    expect(query.eq).toHaveBeenCalledWith('scope_id', 'org-a')
  })
})
