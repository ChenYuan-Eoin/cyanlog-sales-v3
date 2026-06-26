/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/permissions', () => ({
  canAccessOrgAdmin: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'
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
    ;(canAccessOrgAdmin as any).mockReturnValue(true)
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
})
