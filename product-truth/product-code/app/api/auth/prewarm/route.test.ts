/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeUserQuery(result: unknown) {
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

describe('POST /api/auth/prewarm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('预热 users 查询、登录候选 RPC 和主登录 RPC 无副作用分支', async () => {
    const query = makeUserQuery({ data: { id: 'u-1' }, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(query)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: {}, error: null })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('users')
    expect(query.select).toHaveBeenCalledWith('id')
    expect(query.limit).toHaveBeenCalledWith(1)
    expect(query.maybeSingle).toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'get_login_candidate_v1',
      expect.objectContaining({
        p_email: '__prewarm__@invalid.local',
        p_ip_address: 'prewarm',
        p_account_limit: 5,
        p_ip_limit: 15,
      })
    )
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
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      throw new Error('prewarm failed')
    })

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })
})
