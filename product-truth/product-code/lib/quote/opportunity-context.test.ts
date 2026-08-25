// REQ: WP10 阶段2
import { describe, expect, it } from 'vitest'
import { buildOpportunityContext, orderTypeHintFromStage } from './opportunity-context'

describe('buildOpportunityContext（商机上下文快照）', () => {
  it('带出负责人/渠道/阶段/客户行业/等级', () => {
    const ctx = buildOpportunityContext({
      opportunity_name: '华润万家云平台二期',
      owner_name: '李彤',
      stage: 'QUOTING',
      source: 'referral',
      tags: ['重点', '2026'],
      customer_industry: '零售',
      customer_tier: 'A',
    })
    expect(ctx.opportunity_name).toBe('华润万家云平台二期')
    expect(ctx.owner_name).toBe('李彤')
    expect(ctx.channel).toBe('referral')
    expect(ctx.tags).toEqual(['重点', '2026'])
    expect(ctx.customer_industry).toBe('零售')
    expect(ctx.customer_tier).toBe('A')
  })

  it('商机阶段映射订单类型提示（续费/增购/升级）', () => {
    expect(orderTypeHintFromStage('RENEWAL')).toBe('RENEW')
    expect(orderTypeHintFromStage('EXPANSION')).toBe('ADDON')
    expect(orderTypeHintFromStage('UPGRADE')).toBe('UPGRADE')
    expect(orderTypeHintFromStage('QUOTING')).toBeNull()
    expect(orderTypeHintFromStage(null)).toBeNull()
  })

  it('tags 非数组时安全降级为空数组', () => {
    const ctx = buildOpportunityContext({ tags: 'not-array' })
    expect(ctx.tags).toEqual([])
  })
})
