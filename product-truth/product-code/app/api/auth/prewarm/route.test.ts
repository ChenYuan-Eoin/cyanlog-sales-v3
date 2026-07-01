import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const prewarmRpcResponse = {
  data: {},
  error: null,
  count: null,
  status: 200,
  statusText: 'OK',
  success: true as const,
}

describe('POST /api/auth/prewarm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('预热主登录 RPC 无副作用分支', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue(prewarmRpcResponse)

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(res.headers.get('X-Login-Prewarm-Timing')).toContain('login_rpc')
    expect(res.headers.get('X-Login-Prewarm-Timing')).not.toContain('users_query')
    expect(res.headers.get('X-Login-Prewarm-Timing')).not.toContain('candidate_rpc')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'login_with_password_v1',
      expect.objectContaining({
        p_email: null,
        p_phone: null,
        p_password: null,
        p_ip_address: 'prewarm',
        p_token_id: null,
        p_token: null,
        p_expires_at: null,
      })
    )
  })

  it('预热失败仍返回成功', async () => {
    vi.mocked(supabaseAdmin.rpc).mockImplementation(() => {
      throw new Error('prewarm failed')
    })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })
})
