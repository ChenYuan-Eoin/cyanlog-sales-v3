// lib/ai/strategy.ts
// 路由策略 — 多种策略实现

/**
 * 任务类型。业务层只声明要完成的工作，具体模型实例由路由策略决定。
 */
export type TaskType =
  | 'semantic'
  | 'extract'
  | 'classify'
  | 'generate'
  | 'contract_review'
  | 'document_compare'
  | 'contract_draft'
  | 'tender_long_document_parse'

/**
 * 策略命中的目标可以是模型实例 profile、能力池别名或内置执行器。
 * 这里刻意不用固定的 L1/L2/L3 槽位，避免把平台级模型网关写死成三层模型。
 */
export type RouteTarget = string

export type RouteTargetAlias =
  | `stage:${AIModelCapability}`
  | `pool:${'local' | 'cloud'}`
  | `executor:${'rule-engine'}`
  | string

export type AIModelCapability =
  | 'structured_rules'
  | 'template_compare'
  | 'semantic_review'
  | 'tender_long_document_parse'
  | 'comment_patch_draft'
  | 'report_summary'
  | 'rule_fallback'

export interface RoutingRule {
  id: string
  taskTypes: TaskType[]
  target: RouteTargetAlias
  minPages?: number
  maxPages?: number
  minRiskSensitivity?: number
  maxCostBudget?: number
}

/**
 * 路由策略接口
 */
export interface RoutingStrategy {
  /** 策略名称 */
  name: string
  /**
   * 选择模型实例或能力池目标。
   */
  select(taskType: TaskType, context: RoutingContext): Promise<RouteTarget>
}

/**
 * 路由上下文
 */
export interface RoutingContext {
  /** 文档页数 */
  pageCount: number
  /** 用户风险敏感度 0-1 */
  userRiskSensitivity: number
  /** 当前Provider健康状态 */
  providerHealth: {
    [providerProfile: string]: boolean
    local: boolean
    cloud: boolean
  }
  /** 当前负载（请求数） */
  currentLoad: {
    [providerProfile: string]: number
    local: number
    cloud: number
  }
  /** 成本预算（0-1，1=不限） */
  costBudget: number
  /**
   * 可选的发布策略规则。业务配置可以覆盖默认策略，不需要改代码。
   */
  strategyRules?: RoutingRule[]
}

export const defaultRoutingRules: RoutingRule[] = [
  {
    id: 'contract-review-semantic-local-first',
    taskTypes: ['contract_review', 'semantic'],
    target: 'stage:semantic_review',
    maxPages: 30,
  },
  {
    id: 'long-document-cloud-capability',
    taskTypes: ['tender_long_document_parse'],
    target: 'stage:tender_long_document_parse',
    minPages: 1,
  },
  {
    id: 'contract-draft-generation',
    taskTypes: ['contract_draft', 'generate'],
    target: 'stage:comment_patch_draft',
  },
  {
    id: 'document-compare-deterministic-first',
    taskTypes: ['document_compare', 'classify'],
    target: 'stage:template_compare',
  },
]

function matchesRoutingRule(rule: RoutingRule, taskType: TaskType, context: RoutingContext) {
  if (!rule.taskTypes.includes(taskType)) return false
  if (typeof rule.minPages === 'number' && context.pageCount < rule.minPages) return false
  if (typeof rule.maxPages === 'number' && context.pageCount > rule.maxPages) return false
  if (typeof rule.minRiskSensitivity === 'number' && context.userRiskSensitivity < rule.minRiskSensitivity) return false
  if (typeof rule.maxCostBudget === 'number' && context.costBudget > rule.maxCostBudget) return false
  return true
}

export function selectByRoutingRules(taskType: TaskType, context: RoutingContext): RouteTarget | null {
  const rules = context.strategyRules?.length ? context.strategyRules : defaultRoutingRules
  const matched = rules.find((rule) => matchesRoutingRule(rule, taskType, context))
  return matched?.target || null
}

// ─── 策略1: 任务类型路由 ─────────────────────────────────
export const taskTypeStrategy: RoutingStrategy = {
  name: 'task-type',
  async select(taskType, context) {
    const configuredTarget = selectByRoutingRules(taskType, context)
    if (configuredTarget) return configuredTarget
    if (taskType === 'extract') return 'stage:semantic_review'
    return 'stage:semantic_review'
  },
}

// ─── 策略2: 用户画像路由 ─────────────────────────────────
export const userProfileStrategy: RoutingStrategy = {
  name: 'user-profile',
  async select(_taskType, context) {
    // 高敏感度用户走更严格的审核（云端模型）
    if (context.userRiskSensitivity > 0.7) return 'pool:cloud'
    return 'stage:semantic_review'
  },
}

// ─── 策略3: 负载均衡路由 ─────────────────────────────────
export const loadBalanceStrategy: RoutingStrategy = {
  name: 'load-balance',
  async select(_taskType, context) {
    if (!context.providerHealth.local) return 'pool:cloud'
    if (!context.providerHealth.cloud) return 'pool:local'
    if (context.currentLoad.local < context.currentLoad.cloud) return 'pool:local'
    return 'pool:cloud'
  },
}

// ─── 策略4: 成本路由 ─────────────────────────────────
export const costStrategy: RoutingStrategy = {
  name: 'cost',
  async select(_taskType, context) {
    // 预算充足用云端，预算紧张用本地
    if (context.costBudget > 0.8) return 'pool:cloud'
    if (context.costBudget > 0.3) return 'pool:local'
    return 'executor:rule-engine'
  },
}

// ─── 策略5: 综合路由（默认） ─────────────────────────────
export const compositeStrategy: RoutingStrategy = {
  name: 'composite',
  async select(taskType, context) {
    return taskTypeStrategy.select(taskType, context)
  },
}

/**
 * 所有内置策略
 */
export const builtinStrategies: RoutingStrategy[] = [
  taskTypeStrategy,
  userProfileStrategy,
  loadBalanceStrategy,
  costStrategy,
  compositeStrategy,
]
