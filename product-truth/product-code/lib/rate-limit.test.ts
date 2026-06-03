// 测试 lib/rate-limit.ts
// 重点：getClientIp 纯函数 + rate limit 决策

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getClientIp, checkLoginRateLimit, recordLoginAttempt } from './rate-limit'

/**
 * 构造 supabase 链式 mock，所有方法都返回 this（链式）
 * 然后通过 mockReturnValueOnce 单独控制每次终止值
 */
function makeChain() {
  const chain: any = {}
  ;['select', 'eq', 'gte', 'order', 'insert', 'update', 'single', 'maybeSingle'].forEach(
    (m) => {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
  )
  return chain
}

describe('Rate Limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getClientIp - 纯函数', () => {
    it('优先使用 cf-connecting-ip（Cloudflare）', () => {
      const req = {
        headers: new Headers({
          'cf-connecting-ip': '1.2.3.4',
          'x-real-ip': '5.6.7.8',
        }),
      }
      expect(getClientIp(req)).toBe('1.2.3.4')
    })

    it('次选 x-real-ip（反向代理）', () => {
      const req = {
        headers: new Headers({ 'x-real-ip': '5.6.7.8' }),
      }
      expect(getClientIp(req)).toBe('5.6.7.8')
    })

    it('再选 x-forwarded-for 第一个', () => {
      const req = {
        headers: new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }),
      }
      expect(getClientIp(req)).toBe('1.1.1.1')
    })

    it('都未设置时返回 unknown', () => {
      const req = { headers: new Headers({}) }
      expect(getClientIp(req)).toBe('unknown')
    })
  })

  describe('checkLoginRateLimit - 允许', () => {
    it('无失败记录时允许', async () => {
      // 账号查询和 IP 查询都返回空
      const accountChain = makeChain()
      const ipChain = makeChain()
      accountChain.order.mockResolvedValueOnce({ data: [] })
      ipChain.gte.mockResolvedValueOnce({ data: [] })
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(accountChain)
        .mockReturnValueOnce(ipChain)

      const result = await checkLoginRateLimit('new@test.com', '1.2.3.4')
      expect(result.allowed).toBe(true)
      expect(result.remainingAttempts).toBe(5)
    })

    it('失败次数 < 5 时允许登录', async () => {
      const accountFailures = [
        { id: '1', attempted_at: new Date().toISOString() },
        { id: '2', attempted_at: new Date().toISOString() },
        { id: '3', attempted_at: new Date().toISOString() },
      ]
      const accountChain = makeChain()
      const ipChain = makeChain()
      accountChain.order.mockResolvedValueOnce({ data: accountFailures })
      ipChain.gte.mockResolvedValueOnce({ data: accountFailures })
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(accountChain)
        .mockReturnValueOnce(ipChain)

      const result = await checkLoginRateLimit('user@test.com', '1.2.3.4')
      expect(result.allowed).toBe(true)
    })
  })

  describe('checkLoginRateLimit - 拒绝', () => {
    it('账号失败次数 >= 5 时锁定', async () => {
      const now = Date.now()
      const accountFailures = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        attempted_at: new Date(now - i * 60000).toISOString(),
      }))
      const accountChain = makeChain()
      const ipChain = makeChain()
      accountChain.order.mockResolvedValueOnce({ data: accountFailures })
      ipChain.gte.mockResolvedValueOnce({ data: [] })
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(accountChain)
        .mockReturnValueOnce(ipChain)

      const result = await checkLoginRateLimit('user@test.com', '1.2.3.4')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('account_locked')
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    })

    it('IP 失败次数 >= 15 时锁定', async () => {
      const ipFailures = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        attempted_at: new Date().toISOString(),
      }))
      const accountChain = makeChain()
      const ipChain = makeChain()
      accountChain.order.mockResolvedValueOnce({ data: [] })
      ipChain.gte.mockResolvedValueOnce({ data: ipFailures })
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(accountChain)
        .mockReturnValueOnce(ipChain)

      const result = await checkLoginRateLimit('user@test.com', '1.2.3.4')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('ip_locked')
    })
  })

  describe('recordLoginAttempt', () => {
    it('成功调用数据库 insert', async () => {
      const insertChain = makeChain()
      insertChain.insert.mockResolvedValueOnce({ data: null, error: null })
      ;(supabaseAdmin.from as any).mockReturnValue(insertChain)

      await recordLoginAttempt('user@test.com', '1.2.3.4', true)
      expect(supabaseAdmin.from).toHaveBeenCalledWith('login_attempts')
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'user@test.com',
          ip_address: '1.2.3.4',
          success: true,
        })
      )
    })

    it('记录失败尝试', async () => {
      const insertChain = makeChain()
      insertChain.insert.mockResolvedValueOnce({ data: null, error: null })
      ;(supabaseAdmin.from as any).mockReturnValue(insertChain)

      await recordLoginAttempt('user@test.com', '1.2.3.4', false)
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      )
    })
  })
})
