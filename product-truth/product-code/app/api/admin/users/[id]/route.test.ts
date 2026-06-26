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
import { PATCH } from './route'

const routeContext: any = {
  params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
}

function malformedJsonRequest(): any {
  return new Request('https://example.test/api/admin/users/u-1', {
    method: 'PATCH',
    body: '{bad-json',
  })
}

describe('PATCH /api/admin/users/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(canAccessOrgAdmin as any).mockReturnValue(true)
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await PATCH(malformedJsonRequest(), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
