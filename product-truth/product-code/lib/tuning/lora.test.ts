import { describe, it, expect } from 'vitest'
import { LoRAEvaluator, DEFAULT_LORA_CONFIG, type EvalSample } from './lora'

describe('LoRAEvaluator', () => {
  it('should evaluate baseline', async () => {
    const samples: EvalSample[] = [
      { id: '1', input: '什么是账期', expected: '120天' },
      { id: '2', input: '付款方式', expected: '月结' },
    ]

    const evaluator = new LoRAEvaluator()
    const result = await evaluator.evaluateBaseline(
      samples,
      async (input) => {
        // 简单mock：第二个样本"出错"
        const output = input === '什么是账期' ? '120天' : 'wrong'
        return { output, latencyMs: 100 }
      }
    )

    expect(result.configId).toBe('baseline')
    expect(result.metrics.accuracy).toBe(0.5)
    expect(result.metrics.avgLatencyMs).toBe(100)
  })

  it('should compare baseline and tuned', async () => {
    const samples: EvalSample[] = [
      { id: '1', input: 'test', expected: 'ok' },
    ]

    const evaluator = new LoRAEvaluator()

    const baseline = await evaluator.evaluateBaseline(
      samples,
      async () => ({ output: 'wrong', latencyMs: 100 })
    )

    const tuned = await evaluator.evaluateTuned(
      samples,
      async () => ({ output: 'ok', latencyMs: 120 }),
      { ...DEFAULT_LORA_CONFIG, rank: 16 }
    )

    const comparison = evaluator.compare(baseline, tuned)
    expect(comparison.accuracyDelta).toBe(1.0)
    expect(comparison.recommendation).toBe('adopt')
  })

  it('should reject when accuracy gain is small but cost increases', async () => {
    const samples: EvalSample[] = [
      { id: '1', input: 'test', expected: 'ok' },
      { id: '2', input: 'test2', expected: 'ok' },
    ]

    const evaluator = new LoRAEvaluator()

    const baseline = await evaluator.evaluateBaseline(
      samples,
      async () => ({ output: 'ok', latencyMs: 100 })
    )

    // 微调后只多了rank=1的LoRA，但成本增加
    const tuned = await evaluator.evaluateTuned(
      samples,
      async () => ({ output: 'ok', latencyMs: 100 }),
      { ...DEFAULT_LORA_CONFIG, rank: 1 }
    )

    const comparison = evaluator.compare(baseline, tuned)
    expect(comparison.accuracyDelta).toBe(0)
    expect(comparison.costDelta).toBeGreaterThan(0)
    expect(comparison.recommendation).toBe('rejected')
  })
})
