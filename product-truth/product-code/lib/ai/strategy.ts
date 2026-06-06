// lib/ai/strategy.ts
// 路由策略 — 多种策略实现

/**
 * 任务类型
 */
export type TaskType = 'semantic' | 'extract' | 'classify' | 'generate'

/**
 * 路由策略接口
 */
export interface RoutingStrategy {
  /** 策略名称 */
  name: string
  /**
   * 选择Provider
   * @returns Provider名称: 'local' | 'cloud' | 'rule-engine'
   */
  select(taskType: TaskType, context: RoutingContext): Promise<'local' | 'cloud' | 'rule-engine'>
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
    local: boolean
    cloud: boolean
  }
  /** 当前负载（请求数） */
  currentLoad: {
    local: number
    cloud: number
  }
  /** 成本预算（0-1，1=不限） */
  costBudget: number
}

// ─── 策略1: 任务类型路由 ─────────────────────────────────
export const taskTypeStrategy: RoutingStrategy = {
  name: 'task-type',
  async select(taskType, _context) {
    if (taskType === 'classify') return 'rule-engine'
    if (taskType === 'extract') return 'local'
    return 'cloud'
  },
}

// ─── 策略2: 用户画像路由 ─────────────────────────────────
export const userProfileStrategy: RoutingStrategy = {
  name: 'user-profile',
  async select(_taskType, context) {
    // 高敏感度用户走更严格的审核（云端模型）
    if (context.userRiskSensitivity > 0.7) return 'cloud'
    return 'local'
  },
}

// ─── 策略3: 负载均衡路由 ─────────────────────────────────
export const loadBalanceStrategy: RoutingStrategy = {
  name: 'load-balance',
  async select(_taskType, context) {
    if (!context.providerHealth.local) return 'cloud'
    if (!context.providerHealth.cloud) return 'local'
    if (context.currentLoad.local < context.currentLoad.cloud) return 'local'
    return 'cloud'
  },
}

// ─── 策略4: 成本路由 ─────────────────────────────────
export const costStrategy: RoutingStrategy = {
  name: 'cost',
  async select(_taskType, context) {
    // 预算充足用云端，预算紧张用本地
    if (context.costBudget > 0.8) return 'cloud'
    if (context.costBudget > 0.3) return 'local'
    return 'rule-engine'
  },
}

// ─── 策略5: 综合路由（默认） ─────────────────────────────
export const compositeStrategy: RoutingStrategy = {
  name: 'composite',
  async select(taskType, context) {
    // 先按任务类型
    const taskTypeChoice = await taskTypeStrategy.select(taskType, context)

    // 再按负载均衡
    if (taskTypeChoice !== 'rule-engine') {
      return loadBalanceStrategy.select(taskType, context)
    }

    return taskTypeChoice
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
