import type { ContractPolicyRule, ContractRuleSet } from '@/types/rules'

export type JsonRecord = Record<string, unknown>

export type RuleSetView = {
  key: string
  label: string
  code: string
  order: number
  rules: ContractPolicyRule[]
  total: number
  active: number
  published: number
  ready: number
  blocked: number
  source: 'all' | 'ruleset' | 'clause_category'
  asset?: ContractRuleSet
}

export type RuleSetSection = {
  key: string
  label: string
  description: string
  sets: RuleSetView[]
}

export const ruleSetSectionMeta: Record<string, { label: string; description: string; categories: string[] }> = {
  overview: {
    label: '总览',
    description: '全部规则资产与未归类入口',
    categories: ['all', 'uncategorized'],
  },
  review_logic: {
    label: '审查逻辑',
    description: '上下文、主体、验收、SLA 和争议路径',
    categories: ['business_integrity', 'acceptance', 'sla', 'renewal', 'dispute'],
  },
  breach_liability: {
    label: '违约与责任',
    description: '付款、税务、违约、责任上限和终止退款',
    categories: ['payment', 'tax', 'breach', 'liability', 'termination'],
  },
  ip_security: {
    label: '知识产权与数据',
    description: 'IP 归属、保密、数据安全和客户资料处理',
    categories: ['ip', 'data_security', 'confidentiality'],
  },
}

export const clauseCategoryMap: Record<string, { label: string; order: number }> = {
  payment: { label: '付款与结算', order: 10 },
  termination: { label: '终止与退款', order: 20 },
  tax: { label: '税务与发票', order: 30 },
  acceptance: { label: '验收与交付', order: 40 },
  breach: { label: '违约责任', order: 50 },
  liability: { label: '责任边界', order: 60 },
  confidentiality: { label: '保密义务', order: 70 },
  business_integrity: { label: '主体与金额一致性', order: 80 },
  ip: { label: '知识产权', order: 90 },
  data_security: { label: '数据安全', order: 100 },
  sla: { label: 'SLA 与服务承诺', order: 110 },
  renewal: { label: '续约与退出', order: 120 },
  dispute: { label: '争议解决', order: 130 },
}

export function clauseCategoryLabel(value?: string | null) {
  if (!value) return '未分类'
  return clauseCategoryMap[value]?.label || value
}

export function ruleSetCode(value: string) {
  if (value === 'uncategorized') return 'UNCATEGORIZED'
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

export function ruleSetKeyForAsset(ruleSetId: string) {
  return `ruleset:${ruleSetId}`
}

export function fallbackRuleSetKey(clauseCategory?: string | null) {
  return clauseCategory || 'uncategorized'
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function formatRuleValue(value: unknown, fallback = '未配置'): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const text: string = value
      .map((item) => formatRuleValue(item, ''))
      .filter(Boolean)
      .join(' / ')
    return text || fallback
  }
  if (value && typeof value === 'object') {
    const entries: string[] = Object.entries(value as JsonRecord)
      .map(([key, item]) => `${key}: ${formatRuleValue(item, '')}`)
      .filter((item) => !item.endsWith(': '))
    return entries.join('；') || fallback
  }
  return fallback
}

export function isRuleReady(rule: ContractPolicyRule) {
  return rule.translation_status === 'ready'
}

export function ruleExecutionFieldBlockingReasons(rule: ContractPolicyRule) {
  const reasons: string[] = []
  if (!rule.is_active) reasons.push('已停用')
  if (!rule.business_domain) reasons.push('缺业务域')
  if (!rule.clause_category) reasons.push('缺规则集')
  if (!rule.field_hints?.length) reasons.push('缺命中提示')
  if ((rule.engine_type === 'structured' || rule.engine_type === 'hybrid') && !rule.target_field) {
    reasons.push('缺目标字段')
  }
  if ((rule.engine_type === 'semantic' || rule.engine_type === 'hybrid') && !rule.semantic_prompt) {
    reasons.push('缺语义规则')
  }
  if (!hasRuleTemplateGuidance(rule)) {
    reasons.push('缺批注/谈判模板')
  }
  return reasons
}

function hasMeaningfulTemplateValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasMeaningfulTemplateValue)
  if (value && typeof value === 'object') {
    return Object.values(value as JsonRecord).some(hasMeaningfulTemplateValue)
  }
  return false
}

function hasRuleTemplateGuidance(rule: ContractPolicyRule): boolean {
  if (hasMeaningfulTemplateValue(rule.message_template)) return true
  return typeof rule.semantic_prompt === 'string'
    && /批注|谈判|建议|输出/.test(rule.semantic_prompt)
}

export function isFormallyPublishedRule(rule: ContractPolicyRule) {
  return Boolean(
    rule.is_active &&
    rule.lifecycle_status === 'published' &&
    rule.translation_status === 'ready' &&
    rule.published_at &&
    ruleExecutionFieldBlockingReasons(rule).length === 0
  )
}

export function ruleBlockingReasons(rule: ContractPolicyRule) {
  const reasons = ruleExecutionFieldBlockingReasons(rule)
  if (!isRuleReady(rule)) reasons.push('未完成转译')
  if (rule.lifecycle_status !== 'published') reasons.push('未正式发布')
  if (rule.lifecycle_status === 'published' && !rule.published_at) reasons.push('缺发布时间')
  return reasons
}

export function countBlockedRules(rules: ContractPolicyRule[]) {
  return rules.filter((rule) => ruleBlockingReasons(rule).length > 0).length
}

function formatThresholdUnit(unit?: string | null) {
  if (!unit) return ''
  const normalized = unit.toLowerCase()
  const unitMap: Record<string, string> = {
    percent: '%',
    percentage: '%',
    day: '天',
    days: '天',
    workday: '工作日',
    workdays: '工作日',
    month: '个月',
    months: '个月',
    year: '年',
    years: '年',
    yuan: '元',
    rmb: '元',
  }
  return unitMap[normalized] || unit
}

function formatOperator(operator: string) {
  const operatorMap: Record<string, string> = {
    '<=': '不超过',
    '>=': '不少于',
    '>': '超过',
    '<': '低于',
    '=': '等于',
  }
  return operatorMap[operator] || operator
}

export function formatThreshold(rule: ContractPolicyRule) {
  const unit = formatThresholdUnit(rule.level_a_unit || rule.level_b_unit || rule.level_c_unit || '')
  const formatLevel = (label: string, operator: string, threshold: number) => {
    if (operator === 'contains') return `${label} 包含命中词`
    if (operator === 'in') return `${label} 命中枚举值`
    return `${label} ${formatOperator(operator)} ${threshold}${unit}`
  }
  return [
    formatLevel('A', rule.level_a_operator, rule.level_a_threshold),
    formatLevel('B', rule.level_b_operator, rule.level_b_threshold),
    formatLevel('C', rule.level_c_operator, rule.level_c_threshold),
  ].join(' / ')
}

export function ruleExecutionSummary(rule: ContractPolicyRule) {
  const template = asRecord(rule.message_template)
  const levels = asRecord(template.levels)
  const outputs = asRecord(template.outputs)
  const trigger = rule.field_hints?.length
    ? rule.field_hints.join(' / ')
    : rule.target_field || '未配置'
  const risk = rule.semantic_prompt || formatThreshold(rule)
  const exceptions = formatRuleValue(
    levels.exception,
    rule.level_a_action ? `A档处理：${rule.level_a_action}` : '未配置'
  )
  const evidence = [
    'evidence_text exact match',
    'source range required',
    ...(rule.field_hints || []).slice(0, 4),
  ].join(' / ')
  const negotiation = formatRuleValue(
    template.negotiation_action || template.owner_role || rule.level_b_counterparty,
    rule.level_b_action === 'negotiate_with_counterparty'
      ? '销售需围绕风险项取得对价或客户确认，并记录谈判结果。'
      : '未配置'
  )
  const commentTemplate = formatRuleValue(
    template.comment || template.suggestion || template.description || template.title || outputs || levels,
    '未配置'
  )

  return [
    { label: '触发条件', value: trigger },
    { label: '风险条件', value: risk },
    { label: '例外条件', value: exceptions },
    { label: '证据要求', value: evidence },
    { label: '谈判动作', value: negotiation },
    { label: '批注模板', value: commentTemplate },
  ]
}

export function ruleSetPrimaryCategory(ruleSet: RuleSetView) {
  if (ruleSet.key === 'all') return 'all'
  const fromRules = ruleSet.rules.find((rule) => rule.clause_category)?.clause_category
  if (fromRules) return fromRules
  return ruleSet.code.toLowerCase()
}

export function ruleSetSectionKey(ruleSet: RuleSetView) {
  const category = ruleSetPrimaryCategory(ruleSet)
  for (const [sectionKey, meta] of Object.entries(ruleSetSectionMeta)) {
    if (meta.categories.includes(category)) return sectionKey
  }
  return 'overview'
}

export function buildRuleSetViews(
  sortedRules: ContractPolicyRule[],
  ruleSetAssets: ContractRuleSet[]
): RuleSetView[] {
  const groups = new Map<string, ContractPolicyRule[]>()
  for (const rule of sortedRules) {
    const key = fallbackRuleSetKey(rule.clause_category)
    groups.set(key, [...(groups.get(key) || []), rule])
  }

  const assetSets = ruleSetAssets.map((asset) => {
    const items = sortedRules.filter((rule) => (
      rule.rule_set_id === asset.id
      || (!rule.rule_set_id && ruleSetCode(rule.clause_category || 'uncategorized') === asset.code)
    ))
    const total = asset.rule_count ?? items.length
    const ready = items.filter(isRuleReady).length
    const formal = items.filter(isFormallyPublishedRule).length
    const blocked = countBlockedRules(items)
    return {
      key: ruleSetKeyForAsset(asset.id),
      label: asset.name,
      code: asset.code,
      order: asset.priority ?? 999,
      rules: items,
      total,
      active: items.filter((rule) => rule.is_active).length,
      published: formal,
      ready,
      blocked: Math.max(blocked, total - items.length),
      source: 'ruleset' as const,
      asset,
    }
  })

  const representedFallbackKeys = new Set(
    ruleSetAssets.map((asset) => asset.code.toLowerCase())
  )
  const fallbackSets = Array.from(groups.entries())
    .filter(([key]) => !representedFallbackKeys.has(ruleSetCode(key).toLowerCase()))
    .map(([key, items]) => {
      const ready = items.filter(isRuleReady).length
      const blocked = countBlockedRules(items)
      return {
        key,
        label: clauseCategoryLabel(key),
        code: ruleSetCode(key),
        order: clauseCategoryMap[key]?.order ?? 999,
        rules: items,
        total: items.length,
        active: items.filter((rule) => rule.is_active).length,
        published: items.filter(isFormallyPublishedRule).length,
        ready,
        blocked,
        source: 'clause_category' as const,
      }
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'zh-CN'))

  const allReady = sortedRules.filter(isRuleReady).length
  const allBlocked = countBlockedRules(sortedRules)

  return [{
    key: 'all',
    label: '全部规则集',
    code: 'ALL',
    order: 0,
    rules: sortedRules,
    total: sortedRules.length,
    active: sortedRules.filter((rule) => rule.is_active).length,
    published: sortedRules.filter(isFormallyPublishedRule).length,
    ready: allReady,
    blocked: allBlocked,
    source: 'all' as const,
  }, ...assetSets, ...fallbackSets].sort((left, right) => (
    left.key === 'all' ? -1 : right.key === 'all' ? 1 : left.order - right.order || left.label.localeCompare(right.label, 'zh-CN')
  ))
}

export function buildRuleSetSections(ruleSets: RuleSetView[]): RuleSetSection[] {
  return Object.entries(ruleSetSectionMeta)
    .map(([key, meta]) => ({
      key,
      label: meta.label,
      description: meta.description,
      sets: ruleSets.filter((ruleSet) => ruleSetSectionKey(ruleSet) === key),
    }))
    .filter((section) => section.sets.length > 0)
}
