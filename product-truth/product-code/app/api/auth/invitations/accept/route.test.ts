/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/admin/org-membership', () => ({
  hashAdminPassword: vi.fn(async () => 'bcrypt-password'),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function request(body: unknown): any {
  return new Request('https://example.test/api/auth/invitations/accept', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'invite-accept-1',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/invitations/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: { org_id: 'org-1', user_id: 'user-1' },
      error: null,
    })
  })

  it('rejects weak passwords before calling the database', async () => {
    const response = await POST(request({ token: 'a'.repeat(32), password: 'short' }))
    expect(response.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('hashes the token and chosen password before the atomic activation command', async () => {
    const response = await POST(request({ token: 'a'.repeat(32), password: 'Correct-Horse-2026' }))
    expect(response.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('accept_personnel_invitation_v1', {
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_password_hash: 'bcrypt-password',
      p_request_id: 'invite-accept-1',
    })
  })

  it('does not expose whether an expired or revoked token ever existed', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: null, error: null })
    const response = await POST(request({ token: 'a'.repeat(32), password: 'Correct-Horse-2026' }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVITATION_INVALID')
  })
})
