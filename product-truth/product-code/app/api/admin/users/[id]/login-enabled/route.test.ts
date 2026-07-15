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

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'update', 'delete', 'eq'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.single = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

describe('/api/admin/users/[id]/login-enabled validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(getUserScopedRoleAssignments as any).mockResolvedValue([])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
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

  it('只有 user:view 时拒绝修改登录状态', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const res = await PATCH(makeRequest({ login_enabled: false }), routeContext)

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('禁止登录后撤销该用户全部既有会话', async () => {
    const lookup = makeQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', org_id: 'org-1' },
      error: null,
    })
    const update = makeQuery({ data: null, error: null })
    const revoke = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(revoke)

    const res = await PATCH(makeRequest({ login_enabled: false }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.login_enabled).toBe(false)
    expect(supabaseAdmin.from).toHaveBeenNthCalledWith(3, 'auth_tokens')
    expect(revoke.delete).toHaveBeenCalled()
    expect(revoke.eq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
  })
})
