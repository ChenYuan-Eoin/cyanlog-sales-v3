// lib/tuning/lora.ts
// LoRA调优评估框架 — 模型微调效果对比
// LoRA（Low-Rank Adaptation）是一种参数高效微调方法
// 实际项目中如何评估微调效果？需要基线对比 + 量化指标

/**
 * LoRA配置参数
 */
export interface LoRAConfig {
  /** LoRA rank（8/16/32/64） */
  rank: number
  /** LoRA alpha（通常=2*rank） */
  alpha: number
  /** 学习率 */
  learningRate: number
  /** 训练轮数 */
  epochs: number
  /** 批大小 */
  batchSize: number
}

/**
 * 默认LoRA配置
 */
export const DEFAULT_LORA_CONFIG: LoRAConfig = {
  rank: 16,
  alpha: 32,
  learningRate: 1e-4,
  epochs: 3,
  batchSize: 4,
}

/**
 * 评估指标
 */
export interface EvalMetrics {
  /** 准确率 */
  accuracy: number
  /** 召回率 */
  recall: number
  /** F1分数 */
  f1: number
  /** 平均延迟（ms） */
  avgLatencyMs: number
  /** 成本（$/千次调用） */
  costPerKCalls: number
}

/**
 * 评估数据集样本
 */
export interface EvalSample {
  id: string
  input: string
  /** 期望输出 */
  expected: string
  /** 实际输出 */
  actual?: string
  /** 是否正确 */
  correct?: boolean
  /** 延迟ms */
  latencyMs?: number
}

/**
 * 评估结果
 */
export interface LoRAEvalResult {
  /** 配置ID */
  configId: string
  config: LoRAConfig
  metrics: EvalMetrics
  /** 样本数 */
  sampleCount: number
  /** 评估时间 */
  evaluatedAt: string
}

/**
 * LoRA评估器
 * 评估的核心是"基线对比"——对比微调前后的效果差异
 */
export class LoRAEvaluator {
  /**
   * 评估基线模型（未微调）
   */
  async evaluateBaseline(
    samples: EvalSample[],
    inferenceFn: (input: string) => Promise<{ output: string; latencyMs: number }>
  ): Promise<LoRAEvalResult> {
    return this.evaluate(samples, inferenceFn, {
      configId: 'baseline',
      config: { ...DEFAULT_LORA_CONFIG, rank: 0 }, // rank=0 表示无微调
    })
  }

  /**
   * 评估微调后模型
   */
  async evaluateTuned(
    samples: EvalSample[],
    inferenceFn: (input: string) => Promise<{ output: string; latencyMs: number }>,
    config: LoRAConfig,
    configId: string = 'tuned'
  ): Promise<LoRAEvalResult> {
    return this.evaluate(samples, inferenceFn, { configId, config })
  }

  /**
   * 评估模型
   */
  private async evaluate(
    samples: EvalSample[],
    inferenceFn: (input: string) => Promise<{ output: string; latencyMs: number }>,
    options: { configId: string; config: LoRAConfig }
  ): Promise<LoRAEvalResult> {
    const evaluated: EvalSample[] = []
    let totalLatency = 0

    for (const sample of samples) {
      try {
        const { output, latencyMs } = await inferenceFn(sample.input)
        const correct = this.isCorrect(output, sample.expected)
        totalLatency += latencyMs

        evaluated.push({
          ...sample,
          actual: output,
          correct,
          latencyMs,
        })
      } catch {
        evaluated.push({ ...sample, correct: false })
      }
    }

    // 计算指标
    const correct = evaluated.filter((s) => s.correct).length
    const accuracy = correct / evaluated.length
    const avgLatency = totalLatency / evaluated.length

    // 简化版：召回率 = 准确率（无FP/FN区分）
    const recall = accuracy
    const f1 = (2 * accuracy * recall) / (accuracy + recall + 1e-9)

    // 成本估算（基于延迟）
    const costPerKCalls = this.estimateCost(avgLatency, options.config)

    return {
      configId: options.configId,
      config: options.config,
      metrics: {
        accuracy,
        recall,
        f1,
        avgLatencyMs: avgLatency,
        costPerKCalls,
      },
      sampleCount: evaluated.length,
      evaluatedAt: new Date().toISOString(),
    }
  }

  /**
   * 判断输出是否正确（简化版：精确匹配）
   */
  private isCorrect(actual: string, expected: string): boolean {
    return actual.trim() === expected.trim()
  }

  /**
   * 估算成本
   * LoRA微调的成本主要由训练成本+推理成本组成
   * 推理成本和模型大小、batch size相关
   */
  private estimateCost(avgLatencyMs: number, config: LoRAConfig): number {
    // 简化估算：基础成本 + LoRA附加成本
    const baseCost = 0.01 // $/千次调用（基线）
    const loraCost = config.rank > 0 ? config.rank * 0.0001 : 0
    return baseCost + loraCost
  }

  /**
   * 对比基线和微调结果
   */
  compare(baseline: LoRAEvalResult, tuned: LoRAEvalResult): {
    accuracyDelta: number
    latencyDelta: number
    costDelta: number
    recommendation: 'adopt' | 'rejected' | 'manual_review'
    reasoning: string
  } {
    const accuracyDelta = tuned.metrics.accuracy - baseline.metrics.accuracy
    const latencyDelta = tuned.metrics.avgLatencyMs - baseline.metrics.avgLatencyMs
    const costDelta = tuned.metrics.costPerKCalls - baseline.metrics.costPerKCalls

    let recommendation: 'adopt' | 'rejected' | 'manual_review' = 'manual_review'
    let reasoning = ''

    if (accuracyDelta < 0.02 && costDelta > 0) {
      recommendation = 'rejected'
      reasoning = `准确率提升不足${(accuracyDelta * 100).toFixed(1)}%，但成本增加，不建议采用`
    } else if (accuracyDelta >= 0.05 && costDelta < 0.5) {
      recommendation = 'adopt'
      reasoning = `准确率提升${(accuracyDelta * 100).toFixed(1)}%，成本增加可接受，建议采用`
    } else {
      recommendation = 'manual_review'
      reasoning = `准确率提升${(accuracyDelta * 100).toFixed(1)}%，需要人工评估是否值得`
    }

    return {
      accuracyDelta,
      latencyDelta,
      costDelta,
      recommendation,
      reasoning,
    }
  }
}
