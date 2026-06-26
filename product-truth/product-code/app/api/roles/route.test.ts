/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

function makeRequest(url = 'https://example.test/api/roles', permissions = 'config:read'): any {
  return {
    method: 'GET',
    url,
    headers: new Headers({
      'x-user-permissions': permissions,
    }),
  }
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
  })

  it('无权限返回 common error envelope', async () => {
    const res = await GET(makeRequest('https://example.test/api/roles', ''))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('角色列表返回 common success envelope 和 meta', async () => {
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
