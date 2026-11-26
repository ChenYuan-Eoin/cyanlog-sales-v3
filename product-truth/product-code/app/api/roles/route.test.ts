/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'user-1' })) }))
vi.mock('@/lib/middleware-rest-client', () => ({ createMiddlewareRestClient: vi.fn(), readMiddlewareRpcRows: vi.fn() }))
import { supabaseAdmin } from '@/lib/supabase'
import { createMiddlewareRestClient, readMiddlewareRpcRows } from '@/lib/middleware-rest-client'
import { BUILTIN_PERMISSION_DEFINITIONS } from '@/lib/permission-catalog'
import { ROLE_PERMISSION_PROJECTION_KEYS } from '@/lib/permission-registry'
import { GET, POST } from './route'
import { DELETE, PATCH } from './[id]/metadata/route'

function makeRequest(url = 'https://example.test/api/roles'): any {
  return { method: 'GET', url, headers: new Headers() }
}

const roles = [
  { id: 'role-1', code: 'ADMIN', name: '管理员', permissions: ['config:read', 'config:write'] },
  { id: 'role-2', code: 'SALES', name: '销售', permissions: ['quote:create'] },
]

const currentMember = {
  org_id: 'org-1', status: 'active', employment_status: 'active', is_default: true, left_at: null,
  account: { id: 'user-1', status: 'active', login_enabled: true },
}
const assignment = {
  scope_type: 'org', scope_id: 'org-1', org_id: 'org-1', user_id: 'user-1', granted_at: null,
  role: { owner_org_id: null, id: 'reader', code: 'READ_ONLY', name: '角色只读', permissions: ['role:view', 'user:view'] },
}
const root = { ...assignment, role: { owner_org_id: null, id: 'root', code: 'SUPER_ADMIN', name: '超管', permissions: ['*'] } }

function database({
  settings = {}, error = null, members = [currentMember], assignments = [assignment], globalRoles = roles,
  organizationStatus = 'active', permissionRows = [], permissionError = null, mutationData = null, mutationError = null,
}: { settings?: unknown; error?: Error | null; members?: unknown[]; assignments?: unknown[]; globalRoles?: unknown[]; organizationStatus?: string; permissionRows?: unknown[]; permissionError?: Error | null; mutationData?: unknown; mutationError?: { code: string } | null } = {}) {
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
  let selectedRoles = globalRoles
  const roleQuery: any = {
    select: vi.fn(() => roleQuery), order: vi.fn(() => roleQuery), eq: vi.fn(() => roleQuery),
    not: vi.fn((_field: string, _predicate: string, codes: string) => {
      const excludedCodes = codes.slice(1, -1).split(',')
      selectedRoles = globalRoles.filter(role => !excludedCodes.includes((role as { code: string }).code))
      return roleQuery
    }),
    range: vi.fn(async () => ({ data: selectedRoles, error: null, count: selectedRoles.length })),
  }
  const permissionQuery = {
    select: vi.fn(() => permissionQuery),
    in: vi.fn(async () => ({ data: permissionRows, error: permissionError })),
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === 'user_organizations') return membershipQuery
    if (table === 'organizations') return orgQuery
    if (table === 'user_roles') return assignmentsQuery
    if (table === 'permission_points') return permissionQuery
    throw new Error(`Unexpected table ${table}`)
  }) as any)
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((name: string) => {
    if (name === 'admin_list_org_roles_v1') return roleQuery
    if (name === 'admin_mutate_org_role_v1') {
      return { single: vi.fn(async () => ({ data: mutationData, error: mutationError })) }
    }
    throw new Error(`Unexpected RPC ${name}`)
  }) as never)
  return { roleQuery, orgQuery, assignmentsQuery, membershipQuery, permissionQuery }
}

describe('GET /api/roles organization permissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('当前组织无角色目录查看权限时返回 403', async () => {
    database({ assignments: [] })
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('A002')
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
  })

  it('读取个人生效权限和成员查看依赖，同时保留系统专用分配入口', async () => {
    const settings = { employee_organization_permission_overrides_enabled: true }
    const currentDefinition = BUILTIN_PERMISSION_DEFINITIONS.filter(point => ['user:view', 'role:view'].includes(point.key))
      .map(point => ({
        code: point.key, resource: point.resource, action: point.action, capability_level: point.capabilityLevel,
        enforcement_consumer: point.enforcementConsumer, dependencies: point.dependencies,
        supported_scope_types: ['org'], grant_subject_types: ['role'],
      }))
    vi.mocked(createMiddlewareRestClient).mockReturnValue({
      selectRows: vi.fn().mockResolvedValue(currentDefinition),
    })
    vi.mocked(readMiddlewareRpcRows).mockResolvedValue([
      { permission_code: 'user:view', effect: 'DENY', scope: null },
    ])
    database({ settings })
    expect((await GET(makeRequest())).status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('admin_list_org_roles_v1', expect.anything(), expect.anything())

    vi.mocked(readMiddlewareRpcRows).mockResolvedValue(currentDefinition.map(({ code }) => ({
      permission_code: code, effect: 'ALLOW', scope: { type: 'org' },
    })))
    database({ assignments: [], settings })
    expect((await GET(makeRequest())).status).toBe(200)
    expect((await GET(makeRequest('https://example.test/api/roles?view=assignable'))).status).toBe(403)
    expect(readMiddlewareRpcRows).toHaveBeenCalledWith('employee_permission_overrides_v1', { p_org_id: 'org-1', p_user_id: 'user-1' })
  })

  it.each([['config:read'], ['role:view'], ['user:view']])(
    '配置或单项查看权限 %s 不能读取权限定义或分配选项', async (...permissions) => {
      database({ assignments: [{ ...assignment, role: { ...assignment.role, permissions } }] })
      expect((await GET(makeRequest())).status).toBe(403)
      expect((await GET(makeRequest('https://example.test/api/roles?view=assignable'))).status).toBe(403)
      expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
      expect(supabaseAdmin.from).not.toHaveBeenCalledWith('permission_points')
    },
  )

  it('已有业务角色分配旧授权不能读取分配选项', async () => {
    database({
      assignments: [{ ...assignment, role: { ...assignment.role, permissions: ['user:view', 'user:assign_roles'] } }],
    })
    expect((await GET(makeRequest('https://example.test/api/roles?view=assignable'))).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
  })

  it('系统超管读取精简的普通角色分配选项', async () => {
    const { roleQuery } = database({
      assignments: [root],
      globalRoles: [
        roles[1],
        { id: 'root', code: 'SUPER_ADMIN', name: '平台超管', permissions: ['*'] },
        { id: 'delegated', code: 'ORG_SUPER_ADMIN', name: '组织超管', permissions: ['role:manage'] },
        { id: 'baseline', code: 'FXIAOKE_BASELINE', name: '历史纷享基础', permissions: ['quote:view'] },
      ],
    })
    const res = await GET(makeRequest('https://example.test/api/roles?view=assignable'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ roles: [{ id: 'role-2', code: 'SALES', name: '销售' }] })
    expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('admin_list_org_roles_v1', { p_org_id: 'org-1' }, { count: 'exact' })
    expect(roleQuery.not).toHaveBeenCalledWith('code', 'in', '(SUPER_ADMIN,ORG_SUPER_ADMIN,FXIAOKE_BASELINE)')
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('permission_points')
  })

  it('角色目录只读权限不能用来请求分配选项', async () => {
    database()
    expect((await GET(makeRequest('https://example.test/api/roles?view=assignable'))).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
  })

  it('返回当前组织覆盖后的有效权限、空撤销和真实只读状态', async () => {
    const { roleQuery, orgQuery, assignmentsQuery, membershipQuery } = database({
      settings: {
        role_permission_overrides: { 'role-1': ['config:read'], 'role-2': [] },
        shipping_owner_permission_overrides: { 'role-1': ['shipping:owner_view'], 'role-2': [] },
      },
    })
    const res = await GET(makeRequest('https://example.test/api/roles?limit=20&offset=0'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        org_id: 'org-1',
        roles: [
          { ...roles[0], permissions: ['config:read'], owner_shipping_permissions: ['shipping:owner_view'], permissions_edit_block_reason: null },
          { ...roles[1], permissions: [], owner_shipping_permissions: [], permissions_edit_block_reason: null },
        ],
        permission_keys: expect.arrayContaining(['config:read', 'config:write', 'role:manage']),
        permissions_editable: false,
        can_appoint_system_super_admin: false,
        permissions_edit_block_reason: '仅系统超管可以保存角色授权。',
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
    ['current root with a historical override', root, { role_permission_overrides: { root: [] } }, true],
  ])('计算 %s 的真实 editable 状态', async (_label, grant, settings, editable) => {
    database({ assignments: [assignment, grant], settings })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.permissions_editable).toBe(editable)
    expect(body.data.can_appoint_system_super_admin).toBe(editable)
    expect(body.data.permissions_edit_block_reason).toEqual(editable ? null : expect.any(String))
  })

  it.each([
    null, { id: 'user-1', status: 'active', login_enabled: false },
    { id: 'user-2', status: 'active', login_enabled: true },
    { id: 'user-1', status: 'suspended', login_enabled: true },
  ])('rejects protected role options without the exact active account (%j)', async account => {
    database({ assignments: [root], members: [{ ...currentMember, account }] })
    expect((await GET(makeRequest('https://example.test/api/roles?view=assignable'))).status).toBe(403)
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
      assignments: [root], globalRoles: [{ id: 'baseline', code: 'FXIAOKE_BASELINE', name: '纷享基础', permissions: ['quote:view'] }],
      settings: { shipping_owner_permission_overrides: { baseline: ['shipping:owner_view'] } },
    })
    const res = await GET(makeRequest('https://example.test/api/roles?role_id=baseline'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      org_id: 'org-1',
      permissions_editable: true,
      roles: [{
        id: 'baseline', permissions: [], permissions_overridden: true, owner_shipping_permissions: [],
        permissions_edit_block_reason: expect.stringContaining('仅可核对和撤销'),
      }],
    })
    expect(roleQuery.eq).toHaveBeenCalledWith('id', 'baseline')
  })

  it('separates appointment authority from a system role definition that cannot be edited', async () => {
    database({ assignments: [root], globalRoles: [root.role] })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      can_appoint_system_super_admin: true,
      roles: [{ code: 'SUPER_ADMIN', permissions_edit_block_reason: expect.stringContaining('系统固定') }],
    })
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
  expect(permissionQuery.in).toHaveBeenCalledWith('code', [...ROLE_PERMISSION_PROJECTION_KEYS])
  expect(data.roles[0].permissions).toEqual(['preserved:legacy', 'shipping:manage_connections'])
  expect(data.permission_keys).toContain('shipping:operate')
  if (bothPublished) {
    expect(data.permission_keys).toEqual(expect.arrayContaining(['shipping:manage_connections', 'shipping:*']))
  } else {
    expect(data.permission_keys).not.toContain('shipping:manage_connections')
    expect(data.permission_keys).not.toContain('shipping:*')
  }
  expect(data.permission_keys).not.toContain('preserved:legacy')
  expect(data.shipping_permission_publication).toEqual({
    registered: ['shipping:manage_connections', 'shipping:operate'],
    published: bothPublished ? ['shipping:manage_connections', 'shipping:operate'] : ['shipping:operate'],
  })
  expect(data.permission_catalog[0]).toMatchObject({
    id: 'shipping', items: expect.arrayContaining([expect.objectContaining({ key: 'shipping:operate', selectable: true })]),
  })
})

describe('organization role metadata mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  const context = { params: Promise.resolve({ id: 'role-created' }) }
  const org = { expected_org_id: 'org-1' }
  const revision = { expected_metadata_revision: 0 }
  const created = { id: 'role-created', code: 'CUSTOM_1', name: '收寄审阅', description: null, role_revision: 0 }

  function request(body: object): any {
    return { json: vi.fn(async () => body) }
  }

  it('creates an ordinary role through the current root with metadata-only input', async () => {
    database({ assignments: [root], mutationData: created })
    const response = await POST(request({ ...org, name: '  收寄审阅  ' }))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      org_id: 'org-1',
      role: { id: 'role-created', code: 'CUSTOM_1', name: '收寄审阅', description: null, metadata_revision: 0, metadata_editable: true },
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('admin_mutate_org_role_v1', {
      p_org_id: 'org-1', p_actor_id: 'user-1', p_operation: 'create',
      p_role_id: null, p_name: '收寄审阅', p_description: null, p_expected_revision: null,
    })
  })

  it('denies metadata mutation to readers, a non-system administrator, and invalid owner bindings', async () => {
    for (const invalid of [
      assignment,
      { ...root, role: { ...root.role, code: 'ADMIN' } },
      { ...root, role: { ...root.role, owner_org_id: 'org-2' } },
      { ...root, role: { ...root.role, owner_org_id: 'org-1' } },
    ]) {
      database({ assignments: [invalid] })
      expect((await POST(request({ ...org, name: '收寄审阅' }))).status).toBe(403)
      expect((await DELETE(request({ ...org, ...revision }), context)).status).toBe(403)
    }
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on a stale organization, missing revision, or permission fields', async () => {
    database({ assignments: [root] })
    expect((await POST(request({ expected_org_id: 'org-2', name: '收寄审阅' }))).status).toBe(409)
    expect((await PATCH(request({ ...org, name: '收寄审阅' }), context)).status).toBe(400)
    expect((await POST(request({ ...org, name: '收寄审阅', permissions: ['*'] }))).status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('submits the exact selected revision when renaming or archiving', async () => {
    database({ assignments: [root], mutationData: { ...created, name: '寄件审阅', role_revision: 1 } })
    const renamed = await PATCH(request({ ...org, ...revision, name: '寄件审阅' }), context)
    expect((await renamed.json()).data.role).toMatchObject({ id: 'role-created', name: '寄件审阅', metadata_revision: 1 })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_mutate_org_role_v1', expect.objectContaining({
      p_operation: 'rename', p_expected_revision: 0, p_role_id: 'role-created',
    }))
    const archived = await DELETE(request({ ...org, expected_metadata_revision: 1 }), context)
    expect((await archived.json()).data.role.metadata_editable).toBe(false)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_mutate_org_role_v1', expect.objectContaining({
      p_operation: 'archive', p_expected_revision: 1, p_role_id: 'role-created', p_name: null,
    }))
  })

  it.each([
    ['42501', 403, undefined],
    ['23503', 404, undefined],
    ['23505', 409, undefined],
    ['40001', 409, 'ROLE_METADATA_CHANGED'],
    ['23514', 409, 'ROLE_HAS_BINDINGS'],
  ])('maps locked database rejection %s', async (code, status, reason) => {
    database({ assignments: [root], mutationError: { code } })
    const response = await DELETE(request({ ...org, ...revision }), context)
    expect(response.status).toBe(status)
    if (reason) expect((await response.json()).error.details.reason).toBe(reason)
  })
})
