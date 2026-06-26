// 测试 app/api/ai/analyze/route.ts
// 覆盖：参数验证、降级链集成、错误处理
// 迁移到 reviewWithFailover 后的新测试

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFailoverResult } = vi.hoisted(() => ({
  mockFailoverResult: {
    risks: [{ level: 'red', title: 'test', description: 'test', suggestion: 'test' }],
    summary: 'mock summary',
    provider: 'local',
    degraded: false,
  },
}))

vi.mock('@/lib/ai/failover', () => ({
  reviewWithFailoverSync: vi.fn().mockResolvedValue(mockFailoverResult),
}))

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn().mockResolvedValue('org-1'),
}))

import { POST } from './route'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/ai/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('参数验证', () => {
    it('空 body → 400', async () => {
      const res = await POST(makeRequest({}))
      expect(res.status).toBe(400)
    })

    it('text 缺失 → 400', async () => {
      const res = await POST(makeRequest({ pageCount: 10 }))
      expect(res.status).toBe(400)
    })

    it('pageCount 超出范围 → 400', async () => {
      const res = await POST(makeRequest({ text: 'abc', pageCount: 0 }))
      expect(res.status).toBe(400)
    })

    it('text 超长 → 400', async () => {
      const longText = 'a'.repeat(100001)
      const res = await POST(makeRequest({ text: longText, pageCount: 5 }))
      expect(res.status).toBe(400)
    })
  })

  describe('降级链集成', () => {
    it('正常调用 → 200 with provider info', async () => {
      const res = await POST(makeRequest({ text: '合同内容', pageCount: 5 }))
      const body = await res.json()
      expect(res.status).toBe(200)
      // 测试环境无真实模型，会降级到 manual-fallback
      expect(body.provider).toBeDefined()
      expect(typeof body.degraded).toBe('boolean')
    })

    it('返回结构符合 schema', async () => {
      const res = await POST(makeRequest({ text: 'x', pageCount: 5 }))
      const body = await res.json()
      expect(body).toHaveProperty('level')
      expect(body).toHaveProperty('source')
      expect(body).toHaveProperty('result')
      expect(body).toHaveProperty('degraded')
    })
  })

  describe('错误处理', () => {
    it('降级链抛出 → 500 INTERNAL_ERROR', async () => {
      const { reviewWithFailoverSync } = await import('@/lib/ai/failover')
      vi.mocked(reviewWithFailoverSync).mockRejectedValueOnce(new Error('all failed'))

      const res = await POST(makeRequest({ text: 'x', pageCount: 5 }))
      expect(res.status).toBe(500)
    })

    it('请求体非 JSON → 400 VALIDATION_ERROR 且不进入鉴权和模型链路', async () => {
      const { reviewWithFailoverSync } = await import('@/lib/ai/failover')
      const { getAuthUser } = await import('@/lib/auth')
      const req: any = {
        json: async () => {
          throw new Error('invalid json')
        },
        method: 'POST',
        headers: new Headers(),
      }
      const res = await POST(req)
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.code).toBe('VALIDATION_ERROR')
      expect(getAuthUser).not.toHaveBeenCalled()
      expect(reviewWithFailoverSync).not.toHaveBeenCalled()
    })
  })
})
