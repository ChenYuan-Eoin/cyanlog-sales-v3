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

function makeRequest(body: unknown): any {
  return new Request('https://example.test/api/admin/users/u-1/login-enabled', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('/api/admin/users/[id]/login-enabled validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(canAccessOrgAdmin as any).mockReturnValue(true)
  })

  it('拒绝非布尔 login_enabled 且不访问数据库', async () => {
    const res = await PATCH(makeRequest({ login_enabled: 'false' }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      code: 'VALIDATION_ERROR',
      error: 'login_enabled 必须为布尔值',
    })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
