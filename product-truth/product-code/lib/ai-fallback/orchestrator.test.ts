// AI 降级链核心测试
// 覆盖：路由阈值、降级决策、超时、最终兜底

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import {
  FallbackOrchestrator,
  determineStartLevel,
  determineStrategy,
} from './orchestrator'
import type { AiClient, AnalyzeRequest } from './types'

// 测试用 mock client
function makeMockClient(
  source: 'local' | 'cloud' | 'rules',
  behavior: 'success' | 'fail' | 'timeout'
): AiClient {
  return {
    source,
    timeoutMs: 1000,
    call: vi.fn().mockImplementation(async () => {
      if (behavior === 'fail') throw new Error(`${source} failed`)
      if (behavior === 'timeout') {
        await new Promise((r) => setTimeout(r, 50))
        throw new Error('timeout')
      }
      return { data: `result-from-${source}` }
    }),
    healthCheck: vi.fn().mockResolvedValue(true),
  }
}

const baseReq: AnalyzeRequest = {
  text: '测试合同文本',
  pageCount: 10,
  task: 'semantic',
}

describe('determineStartLevel - 路由决策', () => {
  it('页数 ≤ 15 → Level 1（本地）', () => {
    expect(determineStartLevel({ ...baseReq, pageCount: 10 })).toBe(1)
    expect(determineStartLevel({ ...baseReq, pageCount: 15 })).toBe(1)
  })

  it('页数 > 40 → Level 2（云端）', () => {
    expect(determineStartLevel({ ...baseReq, pageCount: 41 })).toBe(2)
    expect(determineStartLevel({ ...baseReq, pageCount: 100 })).toBe(2)
  })

  it('forceCloud → Level 2', () => {
    expect(determineStartLevel({ ...baseReq, forceCloud: true })).toBe(2)
  })
})

describe('determineStrategy - 策略', () => {
  it('页数 ≤ 15 → local-full', () => {
    expect(determineStrategy(5)).toBe('local-full')
    expect(determineStrategy(15)).toBe('local-full')
  })

  it('15 < 页数 ≤ 40 → local-segment', () => {
    expect(determineStrategy(16)).toBe('local-segment')
    expect(determineStrategy(40)).toBe('local-segment')
  })

  it('页数 > 40 → cloud', () => {
    expect(determineStrategy(41)).toBe('cloud')
  })
})

describe('FallbackOrchestrator - 降级链', () => {
  it('Level 1 成功 → 不降级', async () => {
    const local = makeMockClient('local', 'success')
    const cloud = makeMockClient('cloud', 'success')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, cloud, rules)

    const result = await orch.analyze({ ...baseReq, pageCount: 5 })
    expect(result.level).toBe(1)
    expect(result.source).toBe('local')
    expect(result.fallbackReason).toBeUndefined()
    expect(local.call).toHaveBeenCalledOnce()
    expect(cloud.call).not.toHaveBeenCalled()
  })

  it('Level 1 失败 → 降级到 Level 2', async () => {
    const local = makeMockClient('local', 'fail')
    const cloud = makeMockClient('cloud', 'success')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, cloud, rules)

    const result = await orch.analyze({ ...baseReq, pageCount: 5 })
    expect(result.level).toBe(2)
    expect(result.source).toBe('cloud')
    expect(result.fallbackReason).toContain('Level 1')
    expect(local.call).toHaveBeenCalledOnce()
    expect(cloud.call).toHaveBeenCalledOnce()
    expect(rules.call).not.toHaveBeenCalled()
  })

  it('Level 1 + Level 2 都失败 → 兜底到 Level 3', async () => {
    const local = makeMockClient('local', 'fail')
    const cloud = makeMockClient('cloud', 'fail')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, cloud, rules)

    const result = await orch.analyze({ ...baseReq, pageCount: 5 })
    expect(result.level).toBe(3)
    expect(result.source).toBe('rules')
    expect(local.call).toHaveBeenCalledOnce()
    expect(cloud.call).toHaveBeenCalledOnce()
    expect(rules.call).toHaveBeenCalledOnce()
  })

  it('Level 2 未配置 → 跳过到 Level 3', async () => {
    const local = makeMockClient('local', 'fail')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, undefined, rules)

    const result = await orch.analyze({ ...baseReq, pageCount: 5 })
    expect(result.level).toBe(3)
    expect(result.source).toBe('rules')
  })

  it('forceCloud → 跳过 Level 1', async () => {
    const local = makeMockClient('local', 'success')
    const cloud = makeMockClient('cloud', 'success')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, cloud, rules)

    const result = await orch.analyze({ ...baseReq, forceCloud: true })
    expect(result.level).toBe(2)
    expect(local.call).not.toHaveBeenCalled()
    expect(cloud.call).toHaveBeenCalledOnce()
  })

  it('页数 > 40 → 直接进入 Level 2', async () => {
    const local = makeMockClient('local', 'success')
    const cloud = makeMockClient('cloud', 'success')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, cloud, rules)

    const result = await orch.analyze({ ...baseReq, pageCount: 50 })
    expect(result.level).toBe(2)
    expect(local.call).not.toHaveBeenCalled()
  })

  it('记录每次尝试到 attempts', async () => {
    const local = makeMockClient('local', 'fail')
    const cloud = makeMockClient('cloud', 'fail')
    const rules = makeMockClient('rules', 'success')
    const orch = new FallbackOrchestrator(local, cloud, rules)

    await orch.analyze(baseReq)
    const attempts = orch.getAttempts()
    expect(attempts).toHaveLength(3)
    expect(attempts[0].success).toBe(false)
    expect(attempts[1].success).toBe(false)
    expect(attempts[2].success).toBe(true)
  })

  it('耗时记录正确', async () => {
    const local = makeMockClient('local', 'success')
    const orch = new FallbackOrchestrator(local)
    const result = await orch.analyze(baseReq)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })
})

describe('RuleEngineClient - 规则兜底', () => {
  it('匹配违约金规则', async () => {
    const { RuleEngineClient } = await import('./rule-engine')
    const rules = new RuleEngineClient()
    const result: any = await rules.call({
      text: '本合同违约金为 10% 每日',
      pageCount: 1,
      task: 'semantic',
    })
    expect(result.matches.some((m: any) => m.ruleId === 'R001')).toBe(true)
  })

  it('匹配解除合同（关键）', async () => {
    const { RuleEngineClient } = await import('./rule-engine')
    const rules = new RuleEngineClient()
    const result: any = await rules.call({
      text: '若一方违约，另一方有权解除合同',
      pageCount: 1,
      task: 'semantic',
    })
    const r002 = result.matches.find((m: any) => m.ruleId === 'R002')
    expect(r002?.severity).toBe('critical')
  })

  it('无匹配时返回空 matches', async () => {
    const { RuleEngineClient } = await import('./rule-engine')
    const rules = new RuleEngineClient()
    const result: any = await rules.call({
      text: '这是一个普通的合同标题',
      pageCount: 1,
      task: 'semantic',
    })
    expect(result.matches).toHaveLength(0)
    expect(result.summary).toBe('未匹配任何规则')
  })

  it('结果包含降级提示', async () => {
    const { RuleEngineClient } = await import('./rule-engine')
    const rules = new RuleEngineClient()
    const result: any = await rules.call({
      text: '测试',
      pageCount: 1,
      task: 'semantic',
    })
    expect(result.note).toContain('AI 分析不可用')
  })
})
