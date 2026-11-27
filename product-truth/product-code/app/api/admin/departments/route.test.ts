/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/org-role-permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { GET, POST } from './route'

const parentId = '00000000-0000-0000-0000-000000000002'

function createChild() {
  return POST(new Request('https://example.test/api/admin/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '承接组', code: 'TEAM', parent_id: parentId }),
  }) as any)
}

function grant(permissions: string[], scopeType: ScopedRoleAssignment['scopeType'] = 'org', scopeId = 'org-1') {
  vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({ orgId: 'org-1', settings: {}, assignments: [{
    scopeType, scopeId, permissions, roleCode: 'DEPARTMENTS', roleId: 'role-1', roleName: '部门', grantedAt: null,
  }] })
}

function malformedJsonRequest(): any {
  return new Request('https://example.test/api/admin/departments', {
    method: 'POST',
    body: '{bad-json',
  })
}

describe('POST /api/admin/departments validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })

    grant(['dept:write'])
  })

  it('没有当前组织部门写权限时，在解析 body 和访问业务表前拒绝', async () => {
    grant(['dept:directory_view'])
    const json = vi.fn().mockResolvedValue({ name: '销售部', code: 'SALES' })

    const res = await POST({ json } as any)

    expect(res.status).toBe(403)
    expect(loadCurrentOrganizationRoleAssignments).toHaveBeenCalledWith('admin-user')
    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(malformedJsonRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('当前组织部门写权限创建的部门只能落在当前组织', async () => {
    grant(['dept:directory_view', 'dept:edit_structure'])
    const uniqueQuery = makeQuery({ data: null, error: null })
    const insertQuery = makeQuery({
      data: { id: 'dept-1', name: '销售部', code: 'SALES' },
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(uniqueQuery)
      .mockReturnValueOnce(insertQuery)

    const res = await POST(new Request('https://example.test/api/admin/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '销售部', code: 'SALES' }),
    }) as any)

    expect(res.status).toBe(201)
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-1',
      name: '销售部',
      code: 'SALES',
    }))
  })

  it('只在当前组织有效上级下创建子部门', async () => {
    grant(['dept:directory_view', 'dept:edit_structure'])
    const uniqueness = makeQuery({ data: null, error: null })
    const parent = makeQuery({ data: { depth: 2 }, error: null })
    const insert = makeQuery({ data: { id: 'new-dept' }, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(uniqueness).mockReturnValueOnce(parent).mockReturnValueOnce(insert)

    expect((await createChild()).status).toBe(201)
    expect(parent.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(parent.eq).toHaveBeenCalledWith('status', 'active')
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ parent_id: parentId, depth: 3 }))
  })

  it('上级在预检前归档时不会提交子部门', async () => {
    grant(['dept:directory_view', 'dept:edit_structure'])
    const absent = makeQuery({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(absent).mockReturnValueOnce(absent)

    const response = await createChild()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_PARENT_UNAVAILABLE' })
    expect(absent.insert).not.toHaveBeenCalled()
  })

  it('上级在预检后归档时转达事务拒绝', async () => {
    grant(['dept:directory_view', 'dept:edit_structure'])
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeQuery({ data: null, error: null }))
      .mockReturnValueOnce(makeQuery({ data: { depth: 2 }, error: null }))
      .mockReturnValueOnce(makeQuery({ data: null, error: { code: '23514', details: 'DEPARTMENT_PARENT_UNAVAILABLE' } }))

    const response = await createChild()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_PARENT_UNAVAILABLE' })
  })

  it('目录只读授权仅允许读取当前组织的部门树', async () => {
    grant(['dept:directory_view'])
    const query = makeQuery({ data: [{ id: 'dept-1' }], error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(query)

    const read = await GET({} as any)
    const create = await POST(malformedJsonRequest())
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ data: [{ id: 'dept-1' }] })
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(create.status).toBe(403)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it.each([
    [['dept:view'], 'org', 'org-1'],
    [['dept:directory_view'], 'department', 'dept-1'],
    [['dept:directory_view'], 'org', 'org-2'],
  ] as const)('拒绝工作台查看及当前组织级范围以外的部门树权限 %j', async (permissions, scopeType, scopeId) => {
    grant([...permissions], scopeType, scopeId)
    expect((await GET({} as any)).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'insert', 'eq', 'order'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.single = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return query
}
