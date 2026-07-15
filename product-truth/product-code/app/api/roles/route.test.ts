/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
}))

const scopedAccessMocks = vi.hoisted(() => ({
  getUserScopedRoleAssignments: vi.fn(),
  canManageOrg: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)
vi.mock('@/lib/scoped-access', () => scopedAccessMocks)

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

function makeRequest(url = 'https://example.test/api/roles'): any {
  return { method: 'GET', url, headers: new Headers() }
}

function makeRolesQuery(result: any) {
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockReturnValue(chain)
  chain.range = vi.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    scopedAccessMocks.getUserScopedRoleAssignments.mockResolvedValue([])
    scopedAccessMocks.canManageOrg.mockReturnValue(false)
  })

  it('当前组织无配置读取或组织管理权限时返回 403', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(scopedAccessMocks.canManageOrg).toHaveBeenCalledWith([], 'org-1')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('角色列表返回只读边界、common success envelope 和 meta', async () => {
    const roles = [
      { id: 'role-1', code: 'ADMIN', name: '管理员', permissions: ['config:read', 'config:write'] },
      { id: 'role-2', code: 'SALES', name: '销售', permissions: ['config:read'] },
    ]
    const query = makeRolesQuery({ data: roles, error: null, count: 2 })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest('https://example.test/api/roles?limit=20&offset=0'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        roles,
        permission_keys: ['config:read', 'config:write'],
        permissions_editable: false,
        permissions_edit_block_reason: expect.stringContaining('全局只读模板'),
      },
      meta: {
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
    })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('roles')
    expect(query.range).toHaveBeenCalledWith(0, 19)
  })
})
