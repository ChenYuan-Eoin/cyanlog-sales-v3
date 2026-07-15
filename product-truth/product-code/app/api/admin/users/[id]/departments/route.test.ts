/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/admin/org-membership', () => ({
  assertDepartmentInOrg: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgUsers: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { assertDepartmentInOrg } from '@/lib/admin/org-membership'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, POST } from './route'

const routeContext: any = {
  params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
}

function makeRequest(body: unknown, url = 'https://example.test/api/admin/users/u-1/departments'): any {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('/api/admin/users/[id]/departments validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(['fresh-assignment'])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: 'dept-a' })
  })

  it('没有当前组织用户写权限时，在解析 body 和访问业务表前拒绝 POST', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)
    const json = vi.fn().mockResolvedValue({ department_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] })

    const res = await POST({ json } as any, routeContext)

    expect(res.status).toBe(403)
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('admin-user')
    expect(canMutateOrgUsers).toHaveBeenCalledWith(['fresh-assignment'], 'org-1')
    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('拒绝空兼职部门列表且不访问数据库', async () => {
    const res = await POST(makeRequest({ department_ids: [] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('请至少选择一个部门')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('拒绝删除请求缺少 department_id 且不访问数据库', async () => {
    const res = await DELETE(makeRequest({}), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('请指定要删除的部门ID')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('兼职部门列表包含其他组织部门时不写入关联', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    const departmentLookup = makeQuery({
      data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(departmentLookup)

    const res = await POST(makeRequest({
      department_ids: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
    }), routeContext)

    expect(res.status).toBe(400)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(departmentLookup.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('当前组织用户写权限只能写入已验证的当前组织兼职部门', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    const departmentIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]
    const departmentLookup = makeQuery({
      data: departmentIds.map((id) => ({ id })),
      error: null,
    })
    const upsertQuery = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(departmentLookup)
      .mockReturnValueOnce(upsertQuery)

    const res = await POST(makeRequest({ department_ids: departmentIds }), routeContext)

    expect(res.status).toBe(200)
    expect(upsertQuery.upsert).toHaveBeenCalledWith(
      departmentIds.map((departmentId) => ({
        user_id: '00000000-0000-0000-0000-000000000001',
        department_id: departmentId,
        is_primary: false,
      })),
      { onConflict: 'user_id,department_id' }
    )
  })

  it('没有当前组织用户写权限时，不访问业务表并拒绝 DELETE', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const res = await DELETE({ method: 'DELETE' } as any, routeContext)

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('拒绝删除其他组织部门关联', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(userLookup)
    ;(assertDepartmentInOrg as any).mockResolvedValue(null)
    const departmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

    const res = await DELETE(makeRequest(
      { department_id: departmentId },
      `https://example.test/api/admin/users/u-1/departments?department_id=${departmentId}`
    ), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_DEPARTMENT')
    expect(assertDepartmentInOrg).toHaveBeenCalledWith('org-1', departmentId)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('删除当前组织兼职部门时最终限定 is_primary=false', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    const deleteQuery = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(deleteQuery)
    const departmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: departmentId })

    const res = await DELETE(makeRequest(
      { department_id: departmentId },
      `https://example.test/api/admin/users/u-1/departments?department_id=${departmentId}`
    ), routeContext)

    expect(res.status).toBe(200)
    expect(deleteQuery.delete).toHaveBeenCalledOnce()
    expect(deleteQuery.eq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
    expect(deleteQuery.eq).toHaveBeenCalledWith('department_id', departmentId)
    expect(deleteQuery.eq).toHaveBeenCalledWith('is_primary', false)
  })
})

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'upsert', 'delete', 'eq', 'in'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.single = vi.fn().mockResolvedValue(result)
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}
