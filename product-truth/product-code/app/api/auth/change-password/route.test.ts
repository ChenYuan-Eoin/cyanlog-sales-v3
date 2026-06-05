/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}))

import bcrypt from 'bcryptjs'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeChain(result: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  }
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('参数不完整时返回 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })

    const res = await POST(makeRequest({ currentPassword: '', newPassword: '12345678' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('当前密码错误时返回 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(
      makeChain({ data: { id: 'u1', password_hash: 'hashed-temp', must_change_password: true }, error: null })
    )
    ;(bcrypt.compare as any).mockResolvedValue(false)

    const res = await POST(makeRequest({
      currentPassword: 'wrong-password',
      newPassword: 'NewPassword123!',
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('CURRENT_PASSWORD_INVALID')
  })

  it('修改成功后清除强制改密标记', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(
        makeChain({ data: { id: 'u1', password_hash: 'hashed-temp', must_change_password: true }, error: null })
      )
      .mockReturnValueOnce(
        makeChain({ data: { id: 'u1' }, error: null })
      )
    ;(bcrypt.compare as any).mockResolvedValue(true)
    ;(bcrypt.hash as any).mockResolvedValue('hashed-new')

    const res = await POST(makeRequest({
      currentPassword: 'TempPassword123!',
      newPassword: 'NewPassword123!',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mustChangePassword).toBe(false)
    expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword123!', 12)
  })
})
