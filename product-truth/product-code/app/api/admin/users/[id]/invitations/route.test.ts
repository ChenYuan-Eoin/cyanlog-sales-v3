/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/org-role-permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))

import { requireAuth } from '@/lib/auth'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, POST } from './route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const context: any = { params: Promise.resolve({ id: userId }) }

function query(result: unknown): any {
  const builder: any = {
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  }
  return builder
}

function request(method: string): any {
  return new Request(`https://example.test/api/admin/users/${userId}/invitations`, { method })
}

describe('/api/admin/users/[id]/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })

    ;(loadCurrentOrganizationRoleAssignments as any).mockResolvedValue({ orgId: orgId, settings: {}, assignments: [{ scopeType: 'org', scopeId: orgId, permissions: ['org:write'] }] })

    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('rotates a pending invitation and returns one new activation code', async () => {
    const invitation = query({ data: { id: 'invitation-1' }, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(invitation)
    const response = await POST(request('POST'), context)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.activationCode).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(invitation.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
    expect(invitation.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(invitation.eq).toHaveBeenCalledWith('user_id', userId)
  })

  it('revokes the pending invitation and its invited membership in one tenant command', async () => {
    const response = await DELETE(request('DELETE'), context)
    expect(response.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_revoke_personnel_invitation_v1', {
      p_actor_id: actorId,
      p_org_id: orgId,
      p_user_id: userId,
      p_reason: 'invitation revoked by administrator',
      p_request_id: null,
    })
  })
})
