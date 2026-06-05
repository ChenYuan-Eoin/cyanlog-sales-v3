// 测试 app/api/auth/login/route.ts
// 覆盖：成功登录、密码错误、rate limit、参数验证

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkLoginRateLimit: vi.fn(),
  recordLoginAttempt: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { checkLoginRateLimit, recordLoginAttempt } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { POST } from './route'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' }),
  }
}

function makeChain(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'insert'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('参数验证', () => {
    it('空 body → 400 VALIDATION_ERROR', async () => {
      const res = await POST(makeRequest({}))
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.code).toBe('VALIDATION_ERROR')
    })

    it('无 email/phone + password → 400', async () => {
      const res = await POST(makeRequest({ password: 'abc' }))
      expect(res.status).toBe(400)
    })

    it('email 格式错误 → 400', async () => {
      const res = await POST(makeRequest({ email: 'not-an-email', password: 'abc' }))
      expect(res.status).toBe(400)
    })

    it('phone 格式错误 → 400', async () => {
      const res = await POST(makeRequest({ phone: '12345', password: 'abc' }))
      expect(res.status).toBe(400)
    })
  })

  describe('rate limit', () => {
    it('rate limit 触发 → 429', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({
        allowed: false,
        reason: 'account_locked',
        retryAfterSeconds: 600,
      })

      const res = await POST(makeRequest({ email: 'test@x.com', password: 'abc' }))
      const body = await res.json()
      expect(res.status).toBe(429)
      expect(body.code).toBe('account_locked')
      expect(res.headers.get('Retry-After')).toBe('600')
    })
  })

  describe('认证失败', () => {
    it('用户不存在 → 401 AUTH_FAILED + 记录失败', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(supabaseAdmin.from as any).mockReturnValue(makeChain({ data: null, error: { code: 'PGRST116' } }))

      const res = await POST(makeRequest({ email: 'nobody@x.com', password: 'abc' }))
      const body = await res.json()
      expect(res.status).toBe(401)
      expect(body.code).toBe('AUTH_FAILED')
      expect(recordLoginAttempt).toHaveBeenCalledWith('nobody@x.com', '127.0.0.1', false)
    })

    it('密码错误 → 401 AUTH_FAILED + 记录失败', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 3 })
      ;(supabaseAdmin.from as any).mockReturnValueOnce(
        makeChain({ data: { id: 'u1', password_hash: 'wrong-hash' }, error: null })
      )
      ;(bcrypt.compare as any).mockResolvedValue(false)

      const res = await POST(makeRequest({ email: 'u@x.com', password: 'wrong' }))
      expect(res.status).toBe(401)
      expect(recordLoginAttempt).toHaveBeenCalledWith('u@x.com', '127.0.0.1', false)
    })
  })

  describe('认证成功', () => {
    it('email + 正确密码 → 200 + token + 记录成功', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(bcrypt.compare as any).mockResolvedValue(true)

      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(
          makeChain({ data: { id: 'u1', email: 'u@x.com', display_name: 'U' }, error: null })
        )
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const res = await POST(makeRequest({ email: 'u@x.com', password: 'right' }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.token).toBeTruthy()
      expect(body.user.id).toBe('u1')
      expect(body.expiresAt).toBeTruthy()
      expect(body.mustChangePassword).toBe(false)
      expect(recordLoginAttempt).toHaveBeenCalledWith('u@x.com', '127.0.0.1', true)
    })

    it('首登临时密码用户返回 mustChangePassword', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(bcrypt.compare as any).mockResolvedValue(true)

      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: 'u2',
              email: 'temp@x.com',
              display_name: 'Temp User',
              password_hash: 'hashed',
              must_change_password: true,
            },
            error: null,
          })
        )
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const res = await POST(makeRequest({ email: 'temp@x.com', password: 'TempPassword123!' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.mustChangePassword).toBe(true)
    })
  })
})
