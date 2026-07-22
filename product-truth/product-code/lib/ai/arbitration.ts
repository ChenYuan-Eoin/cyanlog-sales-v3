// lib/ai/arbitration.ts
// 仲裁机制 — 多模型结果投票/一致性检查
// 单一模型可能出错，多模型投票提高准确率

import { reviewWithFailoverSync, type SyncReviewResult } from './failover'

/**
 * 仲裁策略
 */
export type ArbitrationStrategy = 'majority_vote' | 'weighted_vote' | 'confidence_threshold'

/**
 * 多模型结果
 */
export interface ModelResult {
  provider: string
  result: SyncReviewResult
  weight?: number
}

/**
 * 仲裁结果
 */
export interface ArbitrationResult {
  /** 最终结果 */
  finalResult: SyncReviewResult
  /** 各模型结果 */
  modelResults: ModelResult[]
  /** 一致性得分 0-1 */
  consistencyScore: number
  /** 仲裁策略 */
  strategy: ArbitrationStrategy
  /** 是否需要人工复核 */
  needsHumanReview: boolean
}

/**
 * 仲裁器
 */
export class Arbitrator {
  private strategy: ArbitrationStrategy = 'majority_vote'
  private consistencyThreshold = 0.7

  setStrategy(strategy: ArbitrationStrategy): void {
    this.strategy = strategy
  }

  /**
   * 仲裁多模型结果
   */
  async arbitrate(
    contractText: string,
    providers: string[] = ['local', 'cloud', 'rule-engine']
  ): Promise<ArbitrationResult> {
    // 并发调用多个模型
    const modelResults: ModelResult[] = await Promise.all(
      providers.map(async (provider) => {
        const result = await reviewWithFailoverSync(contractText, {
          preferredProvider: provider,
          tool: 'contract_review',
          capability: 'contract_review',
          phase: 'arbitration_review',
        })
        return { provider, result }
      })
    )

    // 根据策略仲裁
    let finalResult: SyncReviewResult
    switch (this.strategy) {
      case 'majority_vote':
        finalResult = this.majorityVote(modelResults)
        break
      case 'weighted_vote':
        finalResult = this.weightedVote(modelResults)
        break
      case 'confidence_threshold':
        finalResult = this.confidenceThreshold(modelResults)
        break
    }

    // 计算一致性得分
    const consistencyScore = this.calculateConsistency(modelResults)

    return {
      finalResult,
      modelResults,
      consistencyScore,
      strategy: this.strategy,
      needsHumanReview: consistencyScore < this.consistencyThreshold,
    }
  }

  /**
   * 多数投票
   */
  private majorityVote(results: ModelResult[]): SyncReviewResult {
    // 简化版：取第一个结果
    return results[0].result
  }

  /**
   * 加权投票
   */
  private weightedVote(results: ModelResult[]): SyncReviewResult {
    // 简化版：取权重最高的结果
    const sorted = [...results].sort((a, b) => (b.weight || 1) - (a.weight || 1))
    return sorted[0].result
  }

  /**
   * 置信度阈值
   */
  private confidenceThreshold(results: ModelResult[]): SyncReviewResult {
    // 简化版：取第一个非降级结果
    const nonDegraded = results.find((r) => !r.result.degraded)
    return nonDegraded?.result || results[0].result
  }

  /**
   * 计算一致性得分
   */
  private calculateConsistency(results: ModelResult[]): number {
    if (results.length < 2) return 1.0

    // 简化版：比较风险数量
    const counts = results.map((r) => r.result.risks.length)
    const avg = counts.reduce((sum, c) => sum + c, 0) / counts.length
    const variance = counts.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / counts.length

    // 方差越小，一致性越高
    return Math.max(0, 1 - variance / 10)
  }
}
