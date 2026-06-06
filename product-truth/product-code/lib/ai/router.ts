// lib/ai/router.ts
// 智能路由 — 根据策略选择Provider
// 路由不是简单降级，而是综合考虑任务类型、用户、负载、成本

import { reviewWithFailover } from './failover'
import type { TaskType, RoutingStrategy, RoutingContext } from './strategy'
import { compositeStrategy } from './strategy'

/**
 * 路由请求
 */
export interface RouteRequest {
  /** 任务类型 */
  taskType: TaskType
  /** 文档文本 */
  text: string
  /** 路由上下文 */
  context: RoutingContext
  /** 路由策略（可选，默认composite） */
  strategy?: RoutingStrategy
}

/**
 * 智能路由器
 */
export class SmartRouter {
  private strategy: RoutingStrategy

  constructor(strategy: RoutingStrategy = compositeStrategy) {
    this.strategy = strategy
  }

  /**
   * 路由并执行
   */
  async route(request: RouteRequest): Promise<{
    stream: ReadableStream
    provider: string
    degraded: boolean
    routeDecision: string
  }> {
    const provider = await this.strategy.select(request.taskType, request.context)

    // 调整PreferredProvider走降级链
    const result = await reviewWithFailover(request.text, provider)

    return {
      ...result,
      routeDecision: `strategy=${this.strategy.name}, selected=${provider}`,
    }
  }

  /**
   * 设置策略
   */
  setStrategy(strategy: RoutingStrategy): void {
    this.strategy = strategy
  }
}

/**
 * 默认路由器实例
 */
export const defaultRouter = new SmartRouter()
