/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/permissions', () => ({
  canAccessOrgAdmin: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getOrgRoleCodes: vi.fn(),
  getUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, POST } from './route'

function makeRequest(): any {
  return new Request('https://example.test/api/admin/org', {
    headers: {
      'x-user-id': 'u-1',
      'x-org-id': 'org-1',
      'x-user-role-codes': 'ADMIN',
      'x-user-permissions': 'admin:access',
    },
  })
}

function makeQuery(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'in', 'neq', 'order', 'limit'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

describe('GET /api/admin/org', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    ;(canAccessOrgAdmin as any).mockReturnValue(true)
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
  })

  it('RPC 成功时返回聚合数据和分段耗时头', async () => {
    const offlineProvider = vi.fn().mockRejectedValue(new Error('optional relay is powered off'))
    vi.stubGlobal('fetch', offlineProvider)
    const payload = {
      organization: { id: 'org-1', name: 'Org', slug: 'org' },
      users: [{ id: 'u-1', display_name: 'Admin' }],
      departments: [{ id: 'd-1', name: '信息技术部' }],
      roles: [{ id: 'r-1', code: 'ADMIN', name: '管理员' }],
      spaces: [],
    }
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: payload, error: null })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(payload)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Org-Payload-Source')).toBe('rpc')
    expect(res.headers.get('X-Org-Timing')).toContain('auth;dur=')
    expect(res.headers.get('X-Org-Timing')).toContain('rpc_payload;dur=')
    expect(res.headers.get('X-Org-Timing')).toContain('total;dur=')
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('get_org_admin_directory_payload_v2', {
      p_org_id: 'org-1',
    })
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(offlineProvider).not.toHaveBeenCalled()
  })

  it('目录聚合读取失败时不回退成缺少目录关系的成功列表', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failed' } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('only falls back to v1 when v2 is missing', async () => {
    const payload = { users: [], roles: [], departments: [], spaces: [] }
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } } as never)
      .mockResolvedValueOnce({ data: payload, error: null } as never)
    const res = await GET(makeRequest())
    expect(await res.json()).toEqual(payload)
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls.map(call => call[0])).toEqual([
      'get_org_admin_directory_payload_v2', 'get_org_admin_directory_payload_v1',
    ])
  })

  it('RPC 失败时回退到查询 fan-out 并标记来源', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function missing' },
    })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      const tableResults: Record<string, any> = {
        departments: {
          data: [{
            id: 'd-1',
            name: '信息技术部',
            code: 'IT',
            depth: 1,
            member_count: 2,
            parent_id: null,
            leader_id: null,
          }],
          error: null,
        },
        roles: {
          data: [{ id: 'r-1', code: 'ADMIN', name: '管理员', sort_order: 1 }],
          error: null,
        },
        sales_spaces: { data: [], error: null },
        organizations: {
          data: { id: 'org-1', name: 'Org', slug: 'org' },
          error: null,
        },
        user_organizations: { data: [], error: null },
        users: { data: [], error: null },
      }
      return makeQuery(tableResults[table] ?? { data: [], error: null })
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Org-Payload-Source')).toBe('fallback')
    expect(res.headers.get('X-Org-Timing')).toContain('auth;dur=')
    expect(res.headers.get('X-Org-Timing')).toContain('fallback_payload;dur=')
    expect(res.headers.get('X-Org-Timing')).toContain('total;dur=')
    expect(body.organization).toEqual({ id: 'org-1', name: 'Org', slug: 'org' })
    expect(body.departments).toEqual([{
      id: 'd-1',
      name: '信息技术部',
      code: 'IT',
      depth: 1,
      member_count: 2,
      parent_id: null,
      parent_name: null,
      leader_id: null,
      leader_name: null,
    }])
    expect(body.users).toEqual([])
    consoleError.mockRestore()
  })

  it('组织聚合接口拒绝写入方法', async () => {
    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET')
    expect(body.code).toBe('ORG_AGGREGATE_READ_ONLY')
  })

  it('显式空授权角色不能回退到原 SUPER_ADMIN 身份重新获得访问', async () => {
    const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions')
    vi.mocked(canAccessOrgAdmin).mockImplementation(actual.canAccessOrgAdmin)
    const req: any = new Request('https://example.test/api/admin/org', {
      headers: {
        'x-user-id': 'u-1',
        'x-org-id': 'org-1',
        'x-user-role-codes': 'SUPER_ADMIN',
        'x-user-authorization-role-codes': '',
        'x-user-permissions': '',
      },
    })

    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(canAccessOrgAdmin).toHaveBeenCalledWith([], [])
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
