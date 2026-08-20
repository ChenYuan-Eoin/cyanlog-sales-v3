// REQ: WP10 阶段2
// PURPOSE: 商机上下文快照构建（纯函数）——负责人/订单类型/市场/渠道/部署需求
// 原则：商机是业务事实源，报价只读快照；订单类型由 quote_kind 表达，商机阶段仅提示

export interface OpportunityContextInput {
  opportunity_name?: string | null
  owner_name?: string | null
  stage?: string | null
  source?: string | null
  tags?: unknown
  customer_industry?: string | null
  customer_tier?: string | null
}

export interface OpportunityContext {
  opportunity_name: string | null
  owner_name: string | null
  stage: string | null
  channel: string | null
  tags: string[]
  customer_industry: string | null
  customer_tier: string | null
  order_type_hint: string | null
}

/** 商机阶段 → 订单类型提示（仅参考；最终由销售选择 quote_kind） */
export function orderTypeHintFromStage(stage: string | null | undefined): string | null {
  const s = String(stage || '').toUpperCase()
  if (s.includes('RENEW') || s.includes('续费')) return 'RENEW'
  if (s.includes('EXPANSION') || s.includes('ADDON') || s.includes('增购')) return 'ADDON'
  if (s.includes('UPGRADE') || s.includes('升级')) return 'UPGRADE'
  return null
}

export function buildOpportunityContext(input: OpportunityContextInput): OpportunityContext {
  return {
    opportunity_name: input.opportunity_name ?? null,
    owner_name: input.owner_name ?? null,
    stage: input.stage ?? null,
    channel: input.source ?? null,
    tags: Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : [],
    customer_industry: input.customer_industry ?? null,
    customer_tier: input.customer_tier ?? null,
    order_type_hint: orderTypeHintFromStage(input.stage),
  }
}
