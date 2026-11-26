/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  canAccessOrgAdmin: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn(),
  getFreshDefaultOrgId: vi.fn(),
  getOrgRoleCodes: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/org-role-permissions', () => ({
  loadOrgRolePermissionContext: vi.fn(), queryOrgRoles: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { canAccessOrgAdmin } from '@/lib/permissions'
import { loadOrgRolePermissionContext, queryOrgRoles } from '@/lib/org-role-permissions'
import { getFreshDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, POST } from './route'

function makeRequest(orgId = 'org-1', roleCode = 'ADMIN', permissions = 'admin:access,user:write,dept:write'): any {
  return new Request('https://example.test/api/admin/org', {
    headers: {
      'x-user-id': 'u-1',
      'x-org-id': orgId,
      'x-user-role-codes': roleCode,
      'x-user-permissions': permissions,
    },
  })
}

function makeQuery(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'in', 'neq', 'is', 'order', 'limit'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

describe('GET /api/admin/org', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.from).mockImplementation(table => table === 'organizations'
      ? makeQuery({ data: { id: 'org-1', status: 'active' }, error: null })
      : makeQuery({ data: [], error: null, count: 0 }))
    ;(canAccessOrgAdmin as any).mockReturnValue(true)
    ;(getFreshDefaultOrgId as any).mockResolvedValue('org-1')
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue(null)
    vi.mocked(queryOrgRoles).mockReturnValue(makeQuery({
      data: [{ id: 'r-1', code: 'ADMIN', name: '管理员', sort_order: 1 }], error: null,
    }))
  })

  it('RPC 成功时返回聚合数据和分段耗时头', async () => {
    const offlineProvider = vi.fn().mockRejectedValue(new Error('optional relay is powered off'))
    vi.stubGlobal('fetch', offlineProvider)
    const payload = {
      organization: { id: 'org-1', name: 'Org', slug: 'org' },
      users: [{ id: 'u-1', display_name: 'Admin' }],
      departments: [
        { id: 'd-1', name: '信息技术部' },
        { id: 'd-2', name: '基础平台组', parent_id: 'd-1', status: 'active' },
        { id: 'd-3', name: '停用小组', parent_id: 'd-1', status: 'inactive' },
      ],
      roles: [{ id: 'r-1', code: 'ADMIN', name: '管理员' }],
      spaces: [{ id: 'existing-space', department_id: 'd-2' }],
    }
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: payload, error: null })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ...payload,
      department_spaces: [
        { department_id: 'd-1', parent_department_id: null, name: '信息技术部', sales_space_ids: [] },
        { department_id: 'd-2', parent_department_id: 'd-1', name: '基础平台组', sales_space_ids: ['existing-space'] },
      ],
      directory_roster: { status: 'unavailable', reason: 'DIRECTORY_UNCONFIRMED' },
      role_membership_stats: {
        effectiveAvailable: true, pendingAvailable: true, activeSpaceIds: [], activeMemberIds: [], systemSuperAdminAssignableMemberIds: [],
      },
      member_access: true,
      member_actions: {
        edit: true, assignRoles: false, invite: true, manageLogin: true, manageEmployment: true,
        removeMembership: true, manageDepartments: true, bindExternalIdentity: false,
      },
      department_access: { canRead: true, canEdit: true, canDelete: true },
    })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Org-Payload-Source')).toBe('rpc')
    expect(res.headers.get('X-Org-Timing')).toContain('auth;dur=')
    expect(res.headers.get('X-Org-Timing')).toContain('rpc_payload;dur=')
    expect(res.headers.get('X-Org-Timing')).toContain('total;dur=')
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('get_org_admin_directory_payload_v2', {
      p_org_id: 'org-1',
    })
    expect(getFreshDefaultOrgId).not.toHaveBeenCalled()
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map(call => call[0])).toEqual([
      'organization_sources', 'organizations', 'sales_spaces', 'user_organizations',
    ])
    expect(offlineProvider).not.toHaveBeenCalled()
  })

  it('exposes role assignment only with fresh system authority in the current organization', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { organization: { id: 'org-1' }, users: [], roles: [], departments: [], spaces: [] }, error: null,
      success: true, count: null, status: 200, statusText: 'OK',
    })
    const authority = {
      settings: {}, orgId: 'org-1', canRead: true, canEdit: true, canEditPlatformRoot: true, actorPermissions: ['role:manage'],
      canListAssignableRoles: true,
    }
    const request = makeRequest('org-1', 'SUPER_ADMIN')

    vi.mocked(loadOrgRolePermissionContext).mockResolvedValueOnce(authority)
    expect(await (await GET(request)).json()).toMatchObject({ member_actions: { assignRoles: true } })

    vi.mocked(loadOrgRolePermissionContext).mockResolvedValueOnce({ ...authority, orgId: 'org-2' })
    expect(await (await GET(request)).json()).toMatchObject({ member_actions: { assignRoles: false, invite: true } })

    vi.mocked(loadOrgRolePermissionContext).mockRejectedValueOnce(new Error('Authority lookup failed'))
    expect(await (await GET(request)).json()).toMatchObject({ member_actions: { assignRoles: false, invite: true } })
  })

  it('目录聚合读取失败时不回退成缺少目录关系的成功列表', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failed' } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map(call => call[0])).toEqual(['organization_sources'])
  })

  it('only falls back to v1 when v2 is missing', async () => {
    const payload = { users: [], roles: [], departments: [], spaces: [] }
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } } as never)
      .mockResolvedValueOnce({ data: payload, error: null } as never)
    const res = await GET(makeRequest())
    expect(await res.json()).toEqual({
      ...payload, department_spaces: [],
      directory_roster: { status: 'unavailable', reason: 'DIRECTORY_UNCONFIRMED' },
      member_access: true,
      member_actions: {
        edit: true, assignRoles: false, invite: true, manageLogin: true, manageEmployment: true,
        removeMembership: true, manageDepartments: true, bindExternalIdentity: false,
      },
      department_access: { canRead: true, canEdit: true, canDelete: true },
      role_membership_stats: {
        effectiveAvailable: false, pendingAvailable: false, activeSpaceIds: [], activeMemberIds: [], systemSuperAdminAssignableMemberIds: [],
      },
    })
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls.map(call => call[0])).toEqual([
      'get_org_admin_directory_payload_v2', 'get_org_admin_directory_payload_v1',
    ])
  })

  it('attaches verified current directory members without counting local accounts or a duplicate directory ID', async () => {
    const orgId = '20000000-0000-4000-8000-000000000001'
    const syncedId = '20000000-0000-4000-8000-000000000002'
    const localId = '20000000-0000-4000-8000-000000000003'
    const identityId = '20000000-0000-4000-8000-000000000004'
    const sourceId = '20000000-0000-4000-8000-000000000005'
    const deptId = '20000000-0000-4000-8000-000000000006'
    const asOf = '2026-11-09T07:54:14Z'
    const synced = {
      id: syncedId,
      display_name: '同步待登录员工',
      primary_dept_id: deptId,
      department_ids: [deptId],
      directory_identity_id: identityId,
      directory_external_id: 'employee-a',
      directory_source: 'fxiaoke',
      directory_status: 'active',
      membership_status: 'invited',
      login_enabled: false,
    }
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: {
      organization: { id: orgId },
      departments: [{ id: deptId, name: '业务部' }],
      users: [synced, synced, {
        ...synced, id: localId, directory_identity_id: null, directory_external_id: null, display_name: '本地账号',
      }],
      roles: [], spaces: [],
    }, error: null } as never)
    vi.mocked(supabaseAdmin.from).mockImplementation(table => {
      if (table === 'organization_sources') return makeQuery({ data: [{
        id: sourceId, system_org_id: orgId, provider: 'fxiaoke', status: 'active', last_successful_sync_at: asOf,
      }], error: null })
      if (table === 'organization_directory_cutover_runs') return makeQuery({ data: [{ id: 'confirmed-run' }], error: null })
      if (table === 'organizations') return makeQuery({ data: { id: orgId, status: 'active' }, error: null })
      if (table === 'user_organizations') return makeQuery({
        data: [{ user_id: localId, is_default: true }, { user_id: 'member-of-another-default-org', is_default: false }],
        count: 2, error: null,
      })
      return makeQuery({ data: [{ id: 'active-space' }], count: 1, error: null })
    })
    const res = await GET(makeRequest(orgId))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.directory_roster).toEqual({ status: 'ready', asOf, members: [{ id: syncedId, departmentIds: [deptId] }] })
    expect(body.users).toHaveLength(3)
    expect(body.role_membership_stats).toEqual({
      effectiveAvailable: true, pendingAvailable: true, activeSpaceIds: ['active-space'],
      activeMemberIds: [localId, 'member-of-another-default-org'], systemSuperAdminAssignableMemberIds: [localId],
    })
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

  it('只读部门授权只查询组织中的部门，不读取成员目录或角色数据', async () => {
    const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions')
    vi.mocked(canAccessOrgAdmin).mockImplementation(actual.canAccessOrgAdmin)
    const departments = makeQuery({ data: [{ id: 'dept-1', name: '部门甲', parent_id: null }], error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(departments)
    const req: any = new Request('https://example.test/api/admin/org', {
      headers: {
        'x-user-id': 'u-1',
        'x-org-id': 'org-1',
        'x-user-permissions': actual.ORG_DEPARTMENT_DIRECTORY_VIEW,
      },
    })

    const response = await GET(req)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      departments: [{ id: 'dept-1', name: '部门甲', parent_name: null }],
      users: [], roles: [], spaces: [], member_access: false,
      department_access: { canRead: true, canEdit: false, canDelete: false },
    })
    expect(body).not.toHaveProperty('directory_roster')
    expect(body).not.toHaveProperty('role_membership_stats')
    expect(supabaseAdmin.from).toHaveBeenCalledExactlyOnceWith('departments')
    expect(departments.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('保存的旧部门维护权限只开放组织部门，角色码不会补发成员维护权限', async () => {
    const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions')
    vi.mocked(canAccessOrgAdmin).mockImplementation(actual.canAccessOrgAdmin)
    const departments = makeQuery({ data: [], error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(departments)
    const response = await GET(makeRequest('org-1', 'ADMIN', 'dept:write'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      users: [], roles: [], member_access: false, department_access: { canRead: true, canEdit: true, canDelete: true },
      member_actions: { edit: false, invite: false, assignRoles: false },
    })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
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
    expect(canAccessOrgAdmin).toHaveBeenCalledWith([])
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
