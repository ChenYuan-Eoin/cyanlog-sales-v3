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
import { DELETE } from './route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const context: any = { params: Promise.resolve({ id: userId }) }

function request(targetId = userId, body: unknown = { reason: 'membership ended' }): any {
  return new Request(`https://example.test/api/admin/users/${targetId}/membership`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'membership-request-1',
    },
    body: JSON.stringify(body),
  })
}

describe('/api/admin/users/[id]/membership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })
    ;(getFreshDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('removes exactly the active tenant membership through the audited command', async () => {
    const response = await DELETE(request(), context)
    expect(response.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_remove_tenant_membership_v1', {
      p_actor_id: actorId,
      p_org_id: orgId,
      p_user_id: userId,
      p_reason: 'membership ended',
      p_request_id: 'membership-request-1',
    })
  })

  it('does not allow an administrator to remove their own membership', async () => {
    const response = await DELETE(request(actorId), {
      params: Promise.resolve({ id: actorId }),
    })
    expect(response.status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('reports last-admin lockout protection as a conflict', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'last active organization control administrator' },
    })
    const response = await DELETE(request(), context)
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.code).toBe('LAST_ADMIN_PROTECTED')
  })
})
