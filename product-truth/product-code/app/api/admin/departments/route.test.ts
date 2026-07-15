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
import { POST } from './route'

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
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(['fresh-assignment'])
    ;(canMutateOrgDepartments as any).mockReturnValue(true)
  })

  it('没有当前组织部门写权限时，在解析 body 和访问业务表前拒绝', async () => {
    ;(canMutateOrgDepartments as any).mockReturnValue(false)
    const json = vi.fn().mockResolvedValue({ name: '销售部', code: 'SALES' })

    const res = await POST({ json } as any)

    expect(res.status).toBe(403)
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('admin-user')
    expect(canMutateOrgDepartments).toHaveBeenCalledWith(['fresh-assignment'], 'org-1')
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
})

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'insert', 'eq'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.single = vi.fn().mockResolvedValue(result)
  return query
}
