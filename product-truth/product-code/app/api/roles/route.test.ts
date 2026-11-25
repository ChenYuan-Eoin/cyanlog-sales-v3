/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'user-1' })) }))
import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

function makeRequest(url = 'https://example.test/api/roles'): any {
  return { method: 'GET', url, headers: new Headers() }
}

const roles = [
  { id: 'role-1', code: 'ADMIN', name: '管理员', permissions: ['config:read', 'config:write'] },
  { id: 'role-2', code: 'SALES', name: '销售', permissions: ['quote:create'] },
]

const currentMember = { org_id: 'org-1', status: 'active', employment_status: 'active', is_default: true, left_at: null }
const assignment = {
  scope_type: 'org', scope_id: 'org-1', org_id: 'org-1', user_id: 'user-1', granted_at: null,
  role: { id: 'reader', code: 'READ_ONLY', name: '配置只读', permissions: ['config:read'] },
}
const root = { ...assignment, role: { id: 'root', code: 'SUPER_ADMIN', name: '超管', permissions: ['*'] } }

function database({
  settings = {}, error = null, members = [currentMember], assignments = [assignment], globalRoles = roles,
  organizationStatus = 'active', permissionRows = [], permissionError = null,
}: { settings?: unknown; error?: Error | null; members?: unknown[]; assignments?: unknown[]; globalRoles?: unknown[]; organizationStatus?: string; permissionRows?: unknown[]; permissionError?: Error | null } = {}) {
  const membershipQuery: any = {
    select: vi.fn(() => membershipQuery), eq: vi.fn(() => membershipQuery),
    limit: vi.fn(async () => ({ data: members, error: null })),
  }
  const orgQuery: any = {
    select: vi.fn(() => orgQuery), eq: vi.fn(() => orgQuery),
    maybeSingle: vi.fn(async () => ({ data: error ? null : { id: 'org-1', status: organizationStatus, settings }, error })),
  }
  const assignmentsQuery: any = {
    select: vi.fn(() => assignmentsQuery), eq: vi.fn(() => assignmentsQuery),
    then(resolve: (data: object) => void) { return Promise.resolve({ data: assignments, error: null }).then(resolve) },
  }
  const roleQuery: any = {
    select: vi.fn(() => roleQuery), order: vi.fn(() => roleQuery), eq: vi.fn(() => roleQuery),
    range: vi.fn(async () => ({ data: globalRoles, error: null, count: globalRoles.length })),
  }
  const permissionQuery = {
    select: vi.fn(() => permissionQuery),
    in: vi.fn(async () => ({ data: permissionRows, error: permissionError })),
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === 'user_organizations') return membershipQuery
    if (table === 'organizations') return orgQuery
    if (table === 'user_roles') return assignmentsQuery
    if (table === 'roles') return roleQuery
    if (table === 'permission_points') return permissionQuery
    throw new Error(`Unexpected table ${table}`)
  }) as any)
  return { roleQuery, orgQuery, assignmentsQuery, membershipQuery, permissionQuery }
}

describe('GET /api/roles organization permissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('当前组织无配置读取或组织管理权限时返回 403', async () => {
    database({ assignments: [] })
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('A002')
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
  })

  it('返回当前组织覆盖后的有效权限、空撤销和真实只读状态', async () => {
    const { roleQuery, orgQuery, assignmentsQuery, membershipQuery } = database({
      settings: { role_permission_overrides: { 'role-1': ['config:read'], 'role-2': [] } },
    })
    const res = await GET(makeRequest('https://example.test/api/roles?limit=20&offset=0'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        org_id: 'org-1',
        roles: [
          { ...roles[0], permissions: ['config:read'], permissions_edit_block_reason: null },
          { ...roles[1], permissions: [], permissions_edit_block_reason: null },
        ],
        permission_keys: expect.arrayContaining(['config:read', 'config:write', 'role:manage']),
        permissions_editable: false,
        permissions_edit_block_reason: expect.stringContaining('仅当前组织的超级管理员'),
      },
      meta: { total: 2, limit: 20, offset: 0, hasMore: false },
    })
    expect(roleQuery.range).toHaveBeenCalledWith(0, 19)
    expect(orgQuery.eq).toHaveBeenCalledWith('id', 'org-1')
    expect(membershipQuery.eq.mock.calls).toEqual([['user_id', 'user-1'], ['is_default', true]])
    expect(assignmentsQuery.eq.mock.calls).toEqual([
      ['org_id', 'org-1'], ['user_id', 'user-1'], ['scope_type', 'org'], ['scope_id', 'org-1'],
    ])
  })

  it.each([
    ['current organization root', root, {}, true],
    ['another organization root', { ...root, org_id: 'org-2' }, {}, false],
    ['department root', { ...root, scope_type: 'department' }, {}, false],
    ['config writer', { ...root, role: { ...root.role, code: 'ADMIN', permissions: ['config:write'] } }, {}, false],
    ['revoked root', root, { role_permission_overrides: { root: [] } }, false],
  ])('计算 %s 的真实 editable 状态', async (_label, grant, settings, editable) => {
    database({ assignments: [assignment, grant], settings })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.permissions_editable).toBe(editable)
    expect(body.data.permissions_edit_block_reason).toEqual(editable ? null : expect.any(String))
  })

  it.each([[], [{ ...currentMember, employment_status: 'ended' }], [currentMember, currentMember]])(
    '不接受缺失、已离职或重复默认成员关系 %#', async (...members) => {
      database({ members })
      const res = await GET(makeRequest())
      expect(res.status).toBe(403)
      expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
    },
  )

  it('不读取已停用组织的角色', async () => {
    database({ organizationStatus: 'inactive' })
    expect((await GET(makeRequest())).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
  })

  it('单角色回读可过滤角色 ID，纷享基础角色返回只读说明', async () => {
    const { roleQuery } = database({
      assignments: [root], globalRoles: [{ id: 'baseline', code: 'FXIAOKE_BASELINE', name: '纷享基础', permissions: [] }],
    })
    const res = await GET(makeRequest('https://example.test/api/roles?role_id=baseline'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      org_id: 'org-1',
      permissions_editable: true,
      roles: [{ id: 'baseline', permissions: ['quote:view', 'contract:view', 'customer:view'], permissions_edit_block_reason: expect.any(String) }],
    })
    expect(roleQuery.eq).toHaveBeenCalledWith('id', 'baseline')
  })

  it('组织设置读取失败时返回 500，不返回全局模板权限', async () => {
    database({ error: new Error('settings unavailable') })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ success: false, error: { code: 'S002' } })
  })
})

it.each([false, true])('advertises the shipping bundle only when both actions are published (both=%s)', async bothPublished => {
  const definition = {
    id: 'one', code: 'shipping:operate', name: '寄件操作', resource: 'shipping', action: 'operate',
    kind: 'atomic', status: 'published', category: 'shipping', supported_scope_types: ['org'], dependencies: [],
    enforcement_consumer: 'lib/shipping/operator-access.ts#requireShippingOperator',
  }
  const { permissionQuery } = database({
    assignments: [root],
    globalRoles: [{ ...roles[1], permissions: ['preserved:legacy', 'shipping:manage_connections'] }],
    permissionRows: [definition, {
      ...definition, id: 'two', code: 'shipping:manage_connections', action: 'manage_connections', status: bothPublished ? 'published' : 'draft',
      enforcement_consumer: 'lib/shipping/connection-authorization.ts',
    }],
  })
  const { data } = await (await GET(makeRequest())).json()
  expect(permissionQuery.in).toHaveBeenCalledWith('code', ['shipping:operate', 'shipping:manage_connections'])
  expect(data.roles[0].permissions).toEqual(['preserved:legacy', 'shipping:manage_connections'])
  expect(data.permission_keys).toContain('shipping:operate')
  if (bothPublished) {
    expect(data.permission_keys).toEqual(expect.arrayContaining(['shipping:manage_connections', 'shipping:*']))
  } else {
    expect(data.permission_keys).not.toContain('shipping:manage_connections')
    expect(data.permission_keys).not.toContain('shipping:*')
  }
  expect(data.permission_keys).not.toContain('preserved:legacy')
  expect(data.permission_catalog[0]).toMatchObject({
    id: 'shipping', items: expect.arrayContaining([expect.objectContaining({ key: 'shipping:operate', selectable: true })]),
  })
})
