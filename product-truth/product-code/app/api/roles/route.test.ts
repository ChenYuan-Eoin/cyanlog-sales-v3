/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'user-1' })) }))
const accessMocks = vi.hoisted(() => ({ userHasOrgConfigAccess: vi.fn() }))
const scopedAccessMocks = vi.hoisted(() => ({
  getDefaultOrgId: vi.fn(), getUserScopedRoleAssignments: vi.fn(), canManageOrg: vi.fn(),
}))
vi.mock('@/lib/configs/access', () => accessMocks)
vi.mock('@/lib/scoped-access', () => scopedAccessMocks)

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

function makeRequest(url = 'https://example.test/api/roles'): any {
  return { method: 'GET', url, headers: new Headers() }
}

const roles = [
  { id: 'role-1', code: 'ADMIN', name: '管理员', permissions: ['config:read', 'config:write'] },
  { id: 'role-2', code: 'SALES', name: '销售', permissions: ['quote:create'] },
]

function database(settings: any = {}, error: Error | null = null) {
  const orgQuery: any = {
    select: vi.fn(() => orgQuery), eq: vi.fn(() => orgQuery),
    maybeSingle: vi.fn(async () => ({ data: error ? null : { settings }, error })),
  }
  const roleQuery: any = {
    select: vi.fn(() => roleQuery), order: vi.fn(() => roleQuery),
    range: vi.fn(async () => ({ data: roles, error: null, count: roles.length })),
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === 'organizations') return orgQuery
    if (table === 'roles') return roleQuery
    throw new Error(`Unexpected table ${table}`)
  }) as any)
  return { roleQuery, orgQuery }
}

describe('GET /api/roles organization permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    scopedAccessMocks.getDefaultOrgId.mockResolvedValue('org-1')
    scopedAccessMocks.getUserScopedRoleAssignments.mockResolvedValue([])
    scopedAccessMocks.canManageOrg.mockReturnValue(false)
  })

  it('当前组织无配置读取或组织管理权限时返回 403', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('A002')
    expect(scopedAccessMocks.canManageOrg).toHaveBeenCalledWith([], 'org-1')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('返回当前组织覆盖后的有效权限、空撤销和真实只读状态', async () => {
    const { roleQuery, orgQuery } = database({ role_permission_overrides: { 'role-1': ['config:read'], 'role-2': [] } })
    const res = await GET(makeRequest('https://example.test/api/roles?limit=20&offset=0'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        roles: [{ ...roles[0], permissions: ['config:read'] }, { ...roles[1], permissions: [] }],
        permission_keys: expect.arrayContaining(['config:read', 'config:write', 'role:manage']),
        permissions_editable: false,
        permissions_edit_block_reason: expect.stringContaining('仅当前组织的超级管理员'),
      },
      meta: { total: 2, limit: 20, offset: 0, hasMore: false },
    })
    expect(roleQuery.range).toHaveBeenCalledWith(0, 19)
    expect(orgQuery.eq).toHaveBeenCalledWith('id', 'org-1')
  })

  it.each([
    ['current organization root', { scopeType: 'org', scopeId: 'org-1', roleCode: 'SUPER_ADMIN', permissions: ['*'] }, true],
    ['another organization root', { scopeType: 'org', scopeId: 'org-2', roleCode: 'SUPER_ADMIN', permissions: ['*'] }, false],
    ['department root', { scopeType: 'dept', scopeId: 'org-1', roleCode: 'SUPER_ADMIN', permissions: ['*'] }, false],
    ['config writer', { scopeType: 'org', scopeId: 'org-1', roleCode: 'ADMIN', permissions: ['config:write'] }, false],
    ['revoked root', { scopeType: 'org', scopeId: 'org-1', roleCode: 'SUPER_ADMIN', permissions: [], permissionsOverridden: true }, false],
  ])('计算 %s 的真实 editable 状态', async (_label, assignment, editable) => {
    database()
    scopedAccessMocks.getUserScopedRoleAssignments.mockResolvedValue([assignment])
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.permissions_editable).toBe(editable)
    expect(body.data.permissions_edit_block_reason).toEqual(editable ? null : expect.any(String))
  })

  it('组织设置读取失败时返回 500，不返回全局模板权限', async () => {
    database({}, new Error('settings unavailable'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ success: false, error: { code: 'S002' } })
  })
})
