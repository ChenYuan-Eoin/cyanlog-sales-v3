/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgUsers: vi.fn(),
  getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}))

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function request(): any {
  return new Request(`https://example.test/api/admin/users/${targetId}/restore`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'rehire-request-1',
    },
    body: JSON.stringify({ reason: 'rehire approved' }),
  })
}

describe('POST /api/admin/users/[id]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })
    ;(getFreshDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([
      { scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN', permissions: ['user:write'] },
    ])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('requires current organization user-write authority', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)
    const response = await POST(request(), { params: Promise.resolve({ id: targetId }) } as any)
    expect(response.status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('restores through the atomic rehire command and keeps login closed', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: targetId }) } as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ id: targetId, status: 'active', login_enabled: false })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_restore_membership_v1', {
      p_actor_id: actorId,
      p_org_id: orgId,
      p_user_id: targetId,
      p_reason: 'rehire approved',
      p_request_id: 'rehire-request-1',
    })
  })

  it('returns conflict when membership is not restorable', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: false, error: null })
    const response = await POST(request(), { params: Promise.resolve({ id: targetId }) } as any)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('NOT_RESTORABLE')
  })
})
