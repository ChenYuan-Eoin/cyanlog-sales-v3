/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const organizationSourceMocks = vi.hoisted(() => {
  class OrganizationSourceError extends Error {
    code: string
    status: number

    constructor(code: string, message: string, status = 409) {
      super(message)
      this.name = 'OrganizationSourceError'
      this.code = code
      this.status = status
    }
  }

  return {
    ensureOrganizationSource: vi.fn(),
    loadOrganizationSources: vi.fn(),
    recordOrganizationSourceSyncResult: vi.fn(),
    selectPrimaryOrganizationSource: vi.fn(),
    upsertExternalIdentity: vi.fn(),
    OrganizationSourceError,
  }
})

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgDepartments: vi.fn(),
  canMutateOrgUsers: vi.fn(),
  getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/admin/org-membership', () => ({
  ensureDefaultOrganizationMembership: vi.fn(),
  syncPrimaryDepartmentMembership: vi.fn(),
  syncUserSalesSpaces: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/organization-sources', () => organizationSourceMocks)

const connectionMocks = vi.hoisted(() => {
  class OrganizationConnectionError extends Error {
    code: string
    status: number

    constructor(code: string, message: string, status = 409) {
      super(message)
      this.name = 'OrganizationConnectionError'
      this.code = code
      this.status = status
    }
  }

  return {
    loadVerifiedConnection: vi.fn(),
    OrganizationConnectionError,
  }
})

vi.mock('@/lib/organization-connections', () => connectionMocks)

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgDepartments,
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  ensureDefaultOrganizationMembership,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import { supabaseAdmin } from '@/lib/supabase'
import { loadVerifiedConnection } from '@/lib/organization-connections'
import {
  ensureOrganizationSource,
  loadOrganizationSources,
  recordOrganizationSourceSyncResult,
  selectPrimaryOrganizationSource,
  upsertExternalIdentity,
} from '@/lib/organization-sources'
import { POST } from './route'

const orgId = 'org-1'
const assignments = [{ scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN' }]
const databaseDepartmentId = 'department-db-1'
const existingUserId = 'user-db-1'

function makeRequest(): any {
  return new Request('https://example.test/api/access/feishu/sync', { method: 'POST' })
}

function makeQuery(result: { data?: unknown; error?: unknown }): any {
  const query: any = {}
  ;['select', 'eq', 'order', 'in', 'update', 'insert', 'upsert'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.single = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

function mockTableQueues(queues: Record<string, any[]>) {
  const mutableQueues = Object.fromEntries(
    Object.entries(queues).map(([table, tableQueries]) => [table, [...tableQueries]])
  )
  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    const query = mutableQueues[table]?.shift()
    if (!query) {
      throw new Error(`Unexpected Supabase table call: ${table}`)
    }
    return query
  })
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const primarySource = {
  id: 'source-1',
  systemOrgId: orgId,
  provider: 'feishu',
  externalTenantId: 'tenant-1',
  priority: 1,
  status: 'active',
  connectionState: 'verified',
  connectionRevision: 'configuration-revision-1',
  draftCheckStatus: 'preview_ready',
  authorityScope: {},
  syncMode: 'authoritative',
  lastSuccessfulSyncAt: null,
  lastError: null,
  createdAt: '',
  updatedAt: '',
}

function configureVerifiedFeishuConnection(priority = 1) {
  const configuredSource = { ...primarySource, priority }
  ;(loadOrganizationSources as any).mockResolvedValue([configuredSource])
  ;(selectPrimaryOrganizationSource as any).mockReturnValue(configuredSource)
  ;(loadVerifiedConnection as any).mockResolvedValue({
    sourceId: primarySource.id,
    provider: 'feishu',
    revision: primarySource.connectionRevision,
    credentials: { appId: 'app-id', appSecret: 'example-app-secret' },
    summary: {},
  })
}

function feishuUser(): {
  user_id: string
  name: string
  email: string
  department_ids: string[]
  mobile?: string
  job_title?: string
} {
  return {
    user_id: 'employee-1',
    name: 'Feishu User',
    email: 'feishu.user@example.test',
    department_ids: ['department-ext-1'],
  }
}

function mockDirectoryFetch(user: ReturnType<typeof feishuUser> | null = feishuUser()) {
  const fetchMock = vi.mocked(fetch as any)
  fetchMock
    .mockResolvedValueOnce(jsonResponse({
      code: 0,
      msg: 'ok',
      tenant_access_token: 'tenant-token',
    }))
    .mockResolvedValueOnce(jsonResponse({
      code: 0,
      msg: 'ok',
      data: {
        items: [{
          department_id: 'department-ext-1',
          parent_department_id: '0',
          name: 'Sales',
        }],
        has_more: false,
      },
    }))
    .mockResolvedValueOnce(jsonResponse({
      code: 0,
      msg: 'ok',
      data: { items: [], has_more: false },
    }))
    .mockResolvedValueOnce(jsonResponse({
      code: 0,
      msg: 'ok',
      data: { items: user ? [user] : [], has_more: false },
    }))
    .mockResolvedValueOnce(jsonResponse({
      code: 0,
      msg: 'ok',
      data: { items: [], has_more: false },
    }))
  return fetchMock
}

function departmentQueries() {
  return [
    makeQuery({
      data: [{
        id: databaseDepartmentId,
        external_id: 'department-ext-1',
        path: `/${databaseDepartmentId}/`,
        depth: 0,
      }],
      error: null,
    }),
    makeQuery({ data: null, error: null }),
    makeQuery({ data: null, error: null }),
  ]
}

function existingUserLookup(status: 'inactive' | 'suspended' = 'inactive') {
  return makeQuery({
    data: [{
      id: existingUserId,
      employee_id: 'employee-1',
      email: 'feishu.user@example.test',
      phone: null,
      status,
    }],
    error: null,
  })
}

describe('POST /api/access/feishu/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    ;(requireAuth as any).mockResolvedValue({ id: 'u-1' })
    ;(getFreshDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(assignments)
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(canMutateOrgDepartments as any).mockReturnValue(true)
    ;(ensureDefaultOrganizationMembership as any).mockResolvedValue(undefined)
    ;(syncPrimaryDepartmentMembership as any).mockResolvedValue(undefined)
    ;(syncUserSalesSpaces as any).mockResolvedValue(undefined)
    configureVerifiedFeishuConnection()
    ;(ensureOrganizationSource as any).mockResolvedValue(primarySource)
    ;(upsertExternalIdentity as any).mockResolvedValue(undefined)
      ;(selectPrimaryOrganizationSource as any).mockImplementation((sources: Array<any>) => {
      const primary = sources.filter((source) => (
        source.status === 'active' && source.priority === 1
      ))
      if (primary.length === 0) {
        throw new organizationSourceMocks.OrganizationSourceError(
          'SOURCE_REQUIRED',
          '当前组织没有已启用的主组织来源。',
          400,
        )
      }
      return primary[0]
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('未登录时零副作用返回标准鉴权错误', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authError)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' })
    expect(getFreshDefaultOrgId).not.toHaveBeenCalled()
    expect(getFreshUserScopedRoleAssignments).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it.each([
    ['用户写权限只来自其他组织', false, true],
    ['部门写权限只来自其他组织', true, false],
  ])('%s 时在环境、外部请求和业务表前拒绝', async (_label, userWrite, departmentWrite) => {
    configureVerifiedFeishuConnection()
    ;(canMutateOrgUsers as any).mockReturnValue(userWrite)
    ;(canMutateOrgDepartments as any).mockReturnValue(departmentWrite)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('FORBIDDEN')
    expect(getFreshDefaultOrgId).toHaveBeenCalledWith('u-1')
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('u-1')
    expect(canMutateOrgUsers).toHaveBeenCalledWith(assignments, orgId)
    expect(canMutateOrgDepartments).toHaveBeenCalledWith(assignments, orgId)
    expect(fetch).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(ensureDefaultOrganizationMembership).not.toHaveBeenCalled()
  })

  it('缺少已启用主来源时 fail closed 且不访问外部或业务表', async () => {
    ;(loadOrganizationSources as any).mockResolvedValue([])

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('FEISHU_SOURCE_REQUIRED')
    expect(loadVerifiedConnection).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('主来源连接未验证时 fail closed 且不读取飞书目录', async () => {
    ;(loadVerifiedConnection as any).mockRejectedValue(new connectionMocks.OrganizationConnectionError(
      'CONFIGURATION_REQUIRED',
      '当前组织连接尚无已验证的生效配置。',
      409,
    ))

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('CONFIGURATION_REQUIRED')
    expect(loadVerifiedConnection).toHaveBeenCalledWith({
      orgId,
      provider: 'feishu',
      sourceId: primarySource.id,
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('uses the verified shared connection instead of legacy Feishu environment credentials', async () => {
    vi.stubEnv('FEISHU_APP_ID', 'legacy-wrong-app')
    vi.stubEnv('FEISHU_APP_SECRET', 'legacy-wrong-secret')
    const fetchMock = vi.mocked(fetch as any).mockResolvedValueOnce(jsonResponse({ code: 999, msg: 'invalid app' }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await POST(makeRequest())

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      app_id: 'app-id',
      app_secret: 'example-app-secret',
    })
    expect(loadVerifiedConnection).toHaveBeenCalledWith({
      orgId,
      provider: 'feishu',
      sourceId: primarySource.id,
    })
    consoleError.mockRestore()
  })

  it('persisted primary source must be an authoritative Feishu source', async () => {
    ;(loadOrganizationSources as any).mockResolvedValue([{
      ...primarySource,
      provider: 'wecom',
      connectionState: 'verified',
    }])

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('FEISHU_SOURCE_INVALID')
    expect(loadVerifiedConnection).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('飞书上游失败时保留同步域上下文', async () => {
    ;(loadOrganizationSources as any).mockResolvedValue([{
      id: 'source-1',
      provider: 'feishu',
      externalTenantId: orgId,
      priority: 1,
      status: 'active',
      syncMode: 'authoritative',
    }])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(fetch as any).mockResolvedValueOnce(jsonResponse({ code: 999, msg: 'invalid app' }))

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.code).toBe('FEISHU_SYNC_FAILED')
    expect(body.connector).toBe('feishu')
    expect(body.scope).toBe('departments_and_members')
    expect(body.error).toBe('invalid app')
    expect(loadOrganizationSources).toHaveBeenCalledWith(orgId)
    expect(recordOrganizationSourceSyncResult).toHaveBeenCalledWith({
      systemOrgId: orgId,
      sourceId: 'source-1',
      error: 'invalid app',
    })
    consoleError.mockRestore()
  })

  it('请求飞书部门列表时使用不超过上游限制的 page_size', async () => {
    configureVerifiedFeishuConnection()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.mocked(fetch as any)
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tenant-token',
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 999, msg: 'department failed' }))

    await POST(makeRequest())

    const departmentUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(departmentUrl.searchParams.get('page_size')).toBe('50')
    consoleError.mockRestore()
  })

  it('飞书只返回 root 或 0 个部门时保留 partial 语义', async () => {
    configureVerifiedFeishuConnection()
    mockTableQueues({
      departments: [makeQuery({ data: [], error: null })],
      users: [makeQuery({ data: [], error: null })],
      user_roles: [makeQuery({ data: [], error: null })],
    })
    vi.mocked(fetch as any)
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tenant-token',
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        msg: 'ok',
        data: { items: [], has_more: false },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        msg: 'ok',
        data: { items: [], has_more: false },
      }))

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.sync_status).toBe('partial')
    expect(body.message).toBe('飞书返回 0 个可访问部门')
    expect(body.departments.failed).toBe(1)
    expect(body.members.failed).toBe(0)
  })

  it('部门已提交但已有用户查询失败时返回可识别 partial 和真实部门计数', async () => {
    configureVerifiedFeishuConnection()
    mockDirectoryFetch()
    const committedDepartmentQueries = departmentQueries()
    mockTableQueues({
      departments: committedDepartmentQueries,
      users: [makeQuery({ data: null, error: { message: 'users unavailable' } })],
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.code).toBe('FEISHU_MEMBER_SYNC_PARTIAL')
    expect(body.sync_status).toBe('partial')
    expect(body.departments).toMatchObject({ imported: 0, updated: 1, failed: 0, total: 1 })
    expect(body.members).toMatchObject({
      status: 'unknown',
      completed: false,
      candidate_count: 1,
      failed: 1,
      failed_at: 'database_write',
    })
    expect(body.error).toBe('读取已有成员失败')
    expect(committedDepartmentQueries[1].update).toHaveBeenCalledOnce()
    expect(committedDepartmentQueries[2].update).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('部门已提交但 SUPER_ADMIN 保护查询失败时不编造成员成功计数', async () => {
    configureVerifiedFeishuConnection()
    mockDirectoryFetch()
    mockTableQueues({
      departments: departmentQueries(),
      users: [existingUserLookup()],
      user_roles: [makeQuery({ data: null, error: { message: 'roles unavailable' } })],
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.code).toBe('FEISHU_MEMBER_SYNC_PARTIAL')
    expect(body.sync_status).toBe('partial')
    expect(body.departments.updated).toBe(1)
    expect(body.members.status).toBe('unknown')
    expect(body.members).not.toHaveProperty('imported')
    expect(body.members).not.toHaveProperty('updated')
    expect(body.members).not.toHaveProperty('skipped')
    expect(body.error).toBe('读取受保护根管理员失败')
    expect(ensureDefaultOrganizationMembership).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it.each(['inactive', 'suspended'] as const)(
    '更新已有 %s 用户时不覆盖其账号状态',
    async (status) => {
      configureVerifiedFeishuConnection()
      mockDirectoryFetch()
      const userUpdate = makeQuery({ data: null, error: null })
      mockTableQueues({
        departments: departmentQueries(),
        users: [existingUserLookup(status), userUpdate],
        user_roles: [makeQuery({ data: [], error: null })],
      })

      const res = await POST(makeRequest())

      expect(res.status).toBe(200)
      expect(userUpdate.update).toHaveBeenCalledOnce()
      expect(userUpdate.update.mock.calls[0][0]).not.toHaveProperty('status')
      expect(userUpdate.update.mock.calls[0][0]).toMatchObject({
        org_id: orgId,
        employee_id: 'employee-1',
        primary_dept_id: databaseDepartmentId,
      })
      expect(syncPrimaryDepartmentMembership).toHaveBeenCalledWith(
        existingUserId,
        databaseDepartmentId,
        orgId
      )
    }
  )

  it('新飞书用户仅在 insert 时初始化 active 状态', async () => {
    configureVerifiedFeishuConnection()
    mockDirectoryFetch()
    const userInsert = makeQuery({ data: { id: 'new-user-db-1' }, error: null })
    mockTableQueues({
      departments: departmentQueries(),
      users: [makeQuery({ data: [], error: null }), userInsert],
      user_roles: [makeQuery({ data: [], error: null })],
    })

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(userInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: orgId,
      employee_id: 'employee-1',
      status: 'active',
    }))
    expect(syncPrimaryDepartmentMembership).toHaveBeenCalledWith(
      'new-user-db-1',
      databaseDepartmentId,
      orgId
    )
    expect(upsertExternalIdentity).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'source-1',
      systemOrgId: orgId,
      externalUserId: 'employee-1',
      canonicalUserId: 'new-user-db-1',
      matchStatus: 'matched',
      matchMethod: 'none',
    }))
  })

  it('补充来源只填充缺失资料，不写部门层级、主部门、任职或角色', async () => {
    configureVerifiedFeishuConnection(2)
    ;(canMutateOrgDepartments as any).mockReturnValue(false)
    mockDirectoryFetch({
      ...feishuUser(),
      mobile: '138 0000 0001',
      job_title: '销售经理',
    })
    const userUpdate = makeQuery({ data: null, error: null })
    mockTableQueues({
      users: [
        makeQuery({
          data: [{
            id: existingUserId,
            employee_id: 'authoritative-employee-1',
            email: 'feishu.user@example.test',
            phone: null,
            display_name: 'Authoritative Name',
            title: null,
            avatar_url: null,
            status: 'active',
          }],
          error: null,
        }),
        userUpdate,
      ],
      user_roles: [makeQuery({ data: [], error: null })],
    })

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      source_authority: 'enrichment',
      organization_structure_written: false,
      members: { imported: 0, updated: 1, skipped: 0 },
    })
    expect(userUpdate.update).toHaveBeenCalledWith({
      phone: '13800000001',
      title: '销售经理',
      updated_at: expect.any(String),
    })
    expect(userUpdate.eq).toHaveBeenCalledWith('org_id', orgId)
    expect((supabaseAdmin.from as any).mock.calls.some(([table]: [string]) => table === 'departments'))
      .toBe(false)
    expect(ensureDefaultOrganizationMembership).not.toHaveBeenCalled()
    expect(syncPrimaryDepartmentMembership).not.toHaveBeenCalled()
    expect(syncUserSalesSpaces).not.toHaveBeenCalled()
    expect(upsertExternalIdentity).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'source-1',
      externalUserId: 'employee-1',
      canonicalUserId: existingUserId,
      matchStatus: 'matched',
      matchMethod: 'email',
    }))
  })

  it('补充来源同一标识命中多个账号时保留冲突且不合并成员', async () => {
    configureVerifiedFeishuConnection(2)
    mockDirectoryFetch()
    mockTableQueues({
      users: [makeQuery({
        data: [
          {
            id: 'user-a',
            employee_id: 'employee-a',
            email: 'feishu.user@example.test',
            phone: null,
            display_name: '同名成员A',
            title: null,
            avatar_url: null,
            status: 'active',
          },
          {
            id: 'user-b',
            employee_id: 'employee-b',
            email: 'feishu.user@example.test',
            phone: null,
            display_name: '同名成员B',
            title: null,
            avatar_url: null,
            status: 'active',
          },
        ],
        error: null,
      })],
      user_roles: [makeQuery({ data: [], error: null })],
    })

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sync_status).toBe('partial')
    expect(body.members).toMatchObject({ imported: 0, updated: 0, skipped: 1, failed: 1 })
    expect(upsertExternalIdentity).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'source-1',
      externalUserId: 'employee-1',
      canonicalUserId: null,
      matchStatus: 'conflict',
      matchMethod: 'none',
      profileSnapshot: expect.objectContaining({
        candidateUserIds: ['user-a', 'user-b'],
      }),
    }))
    expect(ensureDefaultOrganizationMembership).not.toHaveBeenCalled()
    expect(syncPrimaryDepartmentMembership).not.toHaveBeenCalled()
  })

  it('补充来源未命中既有成员时不创建账号或成员关系', async () => {
    configureVerifiedFeishuConnection(2)
    mockDirectoryFetch()
    const usersLookup = makeQuery({ data: [], error: null })
    mockTableQueues({
      users: [usersLookup],
      user_roles: [makeQuery({ data: [], error: null })],
    })

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sync_status).toBe('partial')
    expect(body.members).toMatchObject({ imported: 0, updated: 0, skipped: 1, failed: 1 })
    expect(usersLookup.insert).not.toHaveBeenCalled()
    expect(usersLookup.update).not.toHaveBeenCalled()
    expect(ensureDefaultOrganizationMembership).not.toHaveBeenCalled()
    expect(upsertExternalIdentity).toHaveBeenCalledWith(expect.objectContaining({
      externalUserId: 'employee-1',
      canonicalUserId: null,
      matchStatus: 'unresolved',
      matchMethod: 'none',
    }))
  })

  it('authoritative source offboards identities absent from a complete snapshot but protects root admins', async () => {
    configureVerifiedFeishuConnection()
    mockDirectoryFetch()
    mockTableQueues({
      departments: departmentQueries(),
      users: [makeQuery({ data: [], error: null }), makeQuery({ data: { id: 'new-user-db-1' }, error: null })],
      user_roles: [
        makeQuery({ data: [], error: null }),
        makeQuery({ data: [{ user_id: 'protected-root', role: { code: 'SUPER_ADMIN' } }], error: null }),
      ],
      external_identities: [
        makeQuery({
          data: [
            { external_user_id: 'departed-employee', canonical_user_id: 'departed-user' },
            { external_user_id: 'protected-root', canonical_user_id: 'protected-root' },
          ],
          error: null,
        }),
        makeQuery({ data: null, error: null }),
      ],
    })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.members.offboarded_from_source).toBe(1)
    expect(body.members.departure_failed).toBe(0)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_offboard_member_v1',
      expect.objectContaining({
        p_org_id: orgId,
        p_user_id: 'departed-user',
        p_reason: 'authoritative organization source departure',
      }),
    )
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith(
      'admin_offboard_member_v1',
      expect.objectContaining({ p_user_id: 'protected-root' }),
    )
  })

  it('匹配当前组织 SUPER_ADMIN 时跳过所有用户及关系写入', async () => {
    configureVerifiedFeishuConnection()
    mockDirectoryFetch()
    mockTableQueues({
      departments: departmentQueries(),
      users: [existingUserLookup()],
      user_roles: [makeQuery({
        data: [{ user_id: existingUserId, role: { code: 'SUPER_ADMIN' } }],
        error: null,
      })],
    })

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.members.updated).toBe(0)
    expect(body.members.skipped).toBe(1)
    expect((supabaseAdmin.from as any).mock.calls.filter(([table]: [string]) => table === 'users'))
      .toHaveLength(1)
    expect(ensureDefaultOrganizationMembership).not.toHaveBeenCalled()
    expect(syncPrimaryDepartmentMembership).not.toHaveBeenCalled()
    expect(syncUserSalesSpaces).not.toHaveBeenCalled()
  })
})
