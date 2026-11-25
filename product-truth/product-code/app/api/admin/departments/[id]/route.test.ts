/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/scoped-access')>(),
  getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import {
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, PATCH } from './route'

const departmentId = '00000000-0000-0000-0000-000000000001'
const oldParentId = '00000000-0000-0000-0000-000000000002'
const newParentId = '00000000-0000-0000-0000-000000000003'
const routeContext = { params: Promise.resolve({ id: departmentId }) }

function grant(permissions: string[]) {
  vi.mocked(getFreshUserScopedRoleAssignments).mockResolvedValue([{
    scopeType: 'org', scopeId: 'org-1', permissions, roleCode: 'DEPARTMENTS', roleId: 'role-1', roleName: '部门', grantedAt: null,
  }])
}

function patchDepartment(body: object) {
  return PATCH(new Request(`https://example.test/api/admin/departments/${departmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any, routeContext)
}

function malformedJsonRequest(): any {
  return new Request('https://example.test/api/admin/departments/d-1', {
    method: 'PATCH',
    body: '{bad-json',
  })
}

describe('PATCH /api/admin/departments/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getFreshDefaultOrgId as any).mockResolvedValue('org-1')
    grant(['dept:write'])
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { leaderId: null, userId: null }, error: null } as never)
  })

  it('没有当前组织部门写权限时，在解析 body 和访问业务表前拒绝 PATCH', async () => {
    grant(['dept:directory_view'])
    const json = vi.fn().mockResolvedValue({ name: '新部门名' })

    const res = await PATCH({ json } as any, routeContext)

    expect(res.status).toBe(403)
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('admin-user')
    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await PATCH(malformedJsonRequest(), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('更新部门的最终 mutation 保留当前组织边界', async () => {
    grant(['dept:directory_view', 'dept:edit_structure'])
    const lookup = makeQuery({
      data: { id: 'dept-1', depth: 0, parent_id: null },
      error: null,
    })
    const update = makeQuery({
      data: { id: 'dept-1', name: '新部门名' },
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(update)

    const res = await PATCH(new Request('https://example.test/api/admin/departments/dept-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新部门名' }),
    }) as any, routeContext)

    expect(res.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ name: '新部门名' }))
    expect(update.eq).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000001')
    expect(update.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('保持上级不变时让部门编辑者修改资料，不重写上级或深度', async () => {
    const lookup = makeQuery({ data: { id: departmentId, depth: 3, parent_id: oldParentId }, error: null })
    const update = makeQuery({ data: { id: departmentId }, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup).mockReturnValueOnce(update)

    const response = await patchDepartment({ name: '改名', sort_order: 2, leader_id: null, parent_id: oldParentId })
    expect(response.status).toBe(200)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(update.update).toHaveBeenCalledExactlyOnceWith({ name: '改名', sort_order: 2, leader_id: null })
  })

  it('上级字段与当前值一致且没有其他修改时返回当前信息', async () => {
    const existing = { id: departmentId, name: '销售部', depth: 3, parent_id: oldParentId }
    const lookup = makeQuery({ data: existing, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup)

    const response = await patchDepartment({ parent_id: oldParentId })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: existing })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(lookup.update).not.toHaveBeenCalled()
  })

  it.each([
    ['42501', 403, 'NO_PERMISSION'],
    ['PGRST202', 503, 'DEPARTMENT_LEAD_ACCESS_UNAVAILABLE'],
  ])('改动部门上级在权限查询返回 %s 时停止', async (code, status, responseCode) => {
    const lookup = makeQuery({ data: { id: departmentId, parent_id: oldParentId }, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: null, error: { code } } as never)

    const response = await patchDepartment({ parent_id: null })
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: responseCode })
    expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('admin_get_department_lead_access_v1', {
      p_actor_id: 'admin-user', p_org_id: 'org-1', p_department_id: departmentId,
    })
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(lookup.update).not.toHaveBeenCalled()
  })

  it('防止部门成为自己的上级', async () => {
    const lookup = makeQuery({ data: { id: departmentId, parent_id: oldParentId }, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup)

    expect((await patchDepartment({ parent_id: departmentId })).status).toBe(400)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('限制新上级为同组织启用部门，并以读取到的旧上级作为更新条件', async () => {
    const lookup = makeQuery({ data: { id: departmentId, parent_id: null }, error: null })
    const parent = makeQuery({ data: { depth: 3, path: `/${newParentId}/` }, error: null })
    const update = makeQuery({ data: { id: departmentId, parent_id: newParentId }, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup).mockReturnValueOnce(parent).mockReturnValueOnce(update)

    expect((await patchDepartment({ parent_id: newParentId })).status).toBe(200)
    expect(parent.eq.mock.calls).toEqual([['id', newParentId], ['org_id', 'org-1'], ['status', 'active']])
    expect(update.update).toHaveBeenCalledExactlyOnceWith({ parent_id: newParentId, depth: 4 })
    expect(update.eq.mock.calls).toEqual([['id', departmentId], ['org_id', 'org-1'], ['status', 'active']])
    expect(update.is).toHaveBeenCalledExactlyOnceWith('parent_id', null)
  })

  it('同组织启用上级查询无结果时拒绝改隶', async () => {
    const lookup = makeQuery({ data: { id: departmentId, parent_id: oldParentId }, error: null })
    const parent = makeQuery({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup).mockReturnValueOnce(parent)

    expect((await patchDepartment({ parent_id: newParentId })).status).toBe(400)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('并发改变当前上级或停用部门时返回冲突', async () => {
    const lookup = makeQuery({ data: { id: departmentId, parent_id: oldParentId }, error: null })
    const update = makeQuery({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(lookup).mockReturnValueOnce(update)

    const response = await patchDepartment({ parent_id: null })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_MOVE_CHANGED' })
    expect(update.eq).toHaveBeenCalledWith('parent_id', oldParentId)
  })

  it('没有当前组织部门写权限时，不访问业务表并拒绝 DELETE', async () => {
    grant(['dept:directory_view'])

    const res = await DELETE({ method: 'DELETE' } as any, routeContext)

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('维护权限与删除权限分开，两个动作都需要查看部门树', async () => {
    grant(['dept:directory_view', 'dept:edit_structure'])
    expect((await DELETE({ method: 'DELETE' } as any, routeContext)).status).toBe(403)
    grant(['dept:directory_view', 'dept:delete_structure'])
    expect((await patchDepartment({ name: '新部门名' })).status).toBe(403)
    grant(['dept:edit_structure', 'dept:delete_structure'])
    expect((await patchDepartment({ name: '新部门名' })).status).toBe(403)
    expect((await DELETE({ method: 'DELETE' } as any, routeContext)).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('软删除部门的最终 mutation 保留当前组织边界', async () => {
    grant(['dept:directory_view', 'dept:delete_structure'])
    const lookup = makeQuery({
      data: { id: 'dept-1', member_count: 0, name: '销售部' },
      error: null,
    })
    const children = makeQuery({ data: [], error: null })
    const update = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(children)
      .mockReturnValueOnce(update)

    const res = await DELETE({ method: 'DELETE' } as any, routeContext)

    expect(res.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith({ status: 'inactive' })
    expect(update.eq).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000001')
    expect(update.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })
})

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'update', 'eq', 'is', 'limit'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.single = vi.fn().mockResolvedValue(result)
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}
