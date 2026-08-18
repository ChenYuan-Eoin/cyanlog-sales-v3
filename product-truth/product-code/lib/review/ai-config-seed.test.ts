// REQ: F053
// PURPOSE: 六对象资产可编译验证——证明 AI 激活清单在发布后能编译出运行计划
import { describe, expect, it } from 'vitest'
import { compilePublishedAIExecutionPlan } from '@/lib/ai/runtime-plan'
import { buildQuoteReviewAiAssets, assetValuesToConfigRows } from './ai-config-seed'

const ORG = '00000001-0000-0000-0000-000000000000'

describe('ai-config-seed（F053 激活清单）', () => {
  it('六对象资产可编译出 quote.review.assistant 运行计划', () => {
    const values = buildQuoteReviewAiAssets({ baseUrl: 'https://cloud.yiyongai.cn/v1', model: 'gpt-5.5' })
    expect(values).toHaveLength(6)
    const rows = assetValuesToConfigRows(values, ORG)
    const plan = compilePublishedAIExecutionPlan({
      orgId: ORG,
      usePointId: 'quote.review.assistant',
      executionEnvironment: 'hosted',
      rows,
    })
    expect(plan.usePointId).toBe('quote.review.assistant')
    expect(plan.candidates.length).toBeGreaterThan(0)
    expect(plan.candidates[0].modelId).toBe('gpt-5.5')
    expect(plan.candidates[0].endpoint).toContain('cloud.yiyongai.cn')
  })

  it('缺 provider_connection 时编译失败（清单完整性保护）', () => {
    const values = buildQuoteReviewAiAssets({ baseUrl: 'https://cloud.yiyongai.cn/v1', model: 'gpt-5.5' }).filter((v) => v.asset_id !== 'pc_quote_review_cloud')
    const rows = assetValuesToConfigRows(values, ORG)
    expect(() => compilePublishedAIExecutionPlan({ orgId: ORG, usePointId: 'quote.review.assistant', executionEnvironment: 'hosted', rows })).toThrow()
  })
})
