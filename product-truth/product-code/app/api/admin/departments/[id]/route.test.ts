/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgDepartments: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgDepartments,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, PATCH } from './route'

const routeContext: any = {
  params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
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
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(['fresh-assignment'])
    ;(canMutateOrgDepartments as any).mockReturnValue(true)
  })

  it('没有当前组织部门写权限时，在解析 body 和访问业务表前拒绝 PATCH', async () => {
    ;(canMutateOrgDepartments as any).mockReturnValue(false)
    const json = vi.fn().mockResolvedValue({ name: '新部门名' })

    const res = await PATCH({ json } as any, routeContext)

    expect(res.status).toBe(403)
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('admin-user')
    expect(canMutateOrgDepartments).toHaveBeenCalledWith(['fresh-assignment'], 'org-1')
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

  it('没有当前组织部门写权限时，不访问业务表并拒绝 DELETE', async () => {
    ;(canMutateOrgDepartments as any).mockReturnValue(false)

    const res = await DELETE({ method: 'DELETE' } as any, routeContext)

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('软删除部门的最终 mutation 保留当前组织边界', async () => {
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
  ;['select', 'update', 'eq', 'limit'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.single = vi.fn().mockResolvedValue(result)
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}
