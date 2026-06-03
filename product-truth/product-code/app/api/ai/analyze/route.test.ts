// 测试 app/api/ai/analyze/route.ts
// 覆盖：参数验证、降级链集成、错误处理

// 测试 app/api/ai/analyze/route.ts
// 覆盖：参数验证、降级链集成、错误处理

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

const { mockOrchestratorInstance } = vi.hoisted(() => ({
  mockOrchestratorInstance: {
    analyze: vi.fn(),
    getAttempts: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('@/lib/ai-fallback/orchestrator', () => ({
  // 使用 function 关键字使其可作为构造器
  FallbackOrchestrator: vi.fn(function () {
    return mockOrchestratorInstance
  }),
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
      const res = await POST(makeRequest({ pageCount: 10, task: 'semantic' }))
      expect(res.status).toBe(400)
    })

    it('pageCount 超出范围 → 400', async () => {
      const res = await POST(makeRequest({ text: 'abc', pageCount: 0, task: 'semantic' }))
      expect(res.status).toBe(400)
    })

    it('task 枚举错误 → 400', async () => {
      const res = await POST(makeRequest({ text: 'abc', pageCount: 5, task: 'invalid' }))
      expect(res.status).toBe(400)
    })

    it('text 超长 → 400', async () => {
      const longText = 'a'.repeat(100001)
      const res = await POST(makeRequest({ text: longText, pageCount: 5, task: 'semantic' }))
      expect(res.status).toBe(400)
    })
  })

  describe('降级链集成', () => {
    it('Level 1 成功 → 200 with attempts', async () => {
      mockOrchestratorInstance.analyze.mockResolvedValueOnce({
        level: 1,
        source: 'local',
        result: { data: 'analyzed' },
        duration: 1234,
      })
      mockOrchestratorInstance.getAttempts.mockReturnValueOnce([
        { level: 1, source: 'local', success: true, duration: 1234 },
      ])

      const res = await POST(makeRequest({ text: '合同内容', pageCount: 5, task: 'semantic' }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.level).toBe(1)
      expect(body.source).toBe('local')
      expect(body.attempts).toHaveLength(1)
    })

    it('Level 1 失败降级到 Level 2 → 200 with fallbackReason', async () => {
      mockOrchestratorInstance.analyze.mockResolvedValueOnce({
        level: 2,
        source: 'cloud',
        result: { data: 'cloud-analyzed' },
        duration: 2500,
        fallbackReason: 'Level 1 failed, fallback to level 2',
      })
      mockOrchestratorInstance.getAttempts.mockReturnValueOnce([
        { level: 1, source: 'local', success: false, duration: 45000, error: 'timeout' },
        { level: 2, source: 'cloud', success: true, duration: 2500 },
      ])

      const res = await POST(makeRequest({ text: 'x', pageCount: 5, task: 'semantic' }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.level).toBe(2)
      expect(body.fallbackReason).toContain('Level 1')
      expect(body.attempts).toHaveLength(2)
    })

    it('forceCloud=true → 直接进入 Level 2', async () => {
      mockOrchestratorInstance.analyze.mockResolvedValueOnce({
        level: 2,
        source: 'cloud',
        result: {},
        duration: 1000,
      })
      mockOrchestratorInstance.getAttempts.mockReturnValueOnce([
        { level: 2, source: 'cloud', success: true, duration: 1000 },
      ])

      const res = await POST(makeRequest({
        text: 'x', pageCount: 5, task: 'semantic', forceCloud: true,
      }))
      expect(res.status).toBe(200)
    })
  })

  describe('错误处理', () => {
    it('orchestrator 抛出 → 500 FALLBACK_FAILED', async () => {
      mockOrchestratorInstance.analyze.mockRejectedValueOnce(new Error('all levels failed'))

      const res = await POST(makeRequest({ text: 'x', pageCount: 5, task: 'semantic' }))
      const body = await res.json()
      expect(res.status).toBe(500)
      expect(body.code).toBe('FALLBACK_FAILED')
      expect(body.error).toContain('all levels failed')
    })

    it('请求体非 JSON → 500 INTERNAL_ERROR', async () => {
      const req: any = {
        json: async () => {
          throw new Error('invalid json')
        },
        method: 'POST',
        headers: new Headers(),
      }
      const res = await POST(req)
      expect(res.status).toBe(500)
    })
  })

  describe('环境配置', () => {
    it('无 AI_GATEWAY_URL 时 cloud 客户端为 undefined（仅本地+规则）', async () => {
      delete process.env.AI_GATEWAY_URL
      delete process.env.AI_GATEWAY_API_KEY
      delete process.env.AI_MODEL

      mockOrchestratorInstance.analyze.mockResolvedValueOnce({
        level: 1,
        source: 'local',
        result: {},
        duration: 100,
      })

      const res = await POST(makeRequest({ text: 'x', pageCount: 5, task: 'semantic' }))
      expect(res.status).toBe(200)
    })
  })
})
