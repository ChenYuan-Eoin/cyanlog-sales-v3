/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  getUserScopedRoleAssignments: vi.fn(),
  canMutateOrgUsers: vi.fn(),
}))

vi.mock('@/lib/admin/org-role-authority', () => ({
  validateOrgRoleAssignment: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function malformedJsonRequest(): any {
  return new Request('https://example.test/api/admin/users', {
    method: 'POST',
    body: '{bad-json',
  })
}

describe('POST /api/admin/users validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(getUserScopedRoleAssignments as any).mockResolvedValue([])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(validateOrgRoleAssignment as any).mockResolvedValue({ ok: true, roleIds: [] })
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(malformedJsonRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('只有查看权限时拒绝创建用户', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const res = await POST(malformedJsonRequest())

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
