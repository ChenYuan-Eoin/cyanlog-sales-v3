import { describe, it, expect } from 'vitest'
import { RAGEvaluator, type EvalSample } from './evaluator'

const sampleEval: EvalSample = {
  id: 'sample-1',
  question: '什么是账期',
  goldenAnswer: '120天',
  relevantDocIds: ['doc-1', 'doc-2'],
  modelAnswer: '账期是120天',
  retrievedContents: ['账期是120天', '付款方式为月结'],
  retrievedDocIds: ['doc-1', 'doc-3'],
}

describe('RAGEvaluator', () => {
  it('should evaluate single sample', () => {
    const evaluator = new RAGEvaluator()
    const result = evaluator.evaluateSample(sampleEval)

    expect(result.sampleId).toBe('sample-1')
    expect(result.recall).toBe(0.5) // 1/2
    expect(result.precision).toBe(0.5) // 1/2 (1个相关/2个检索)
    expect(result.f1).toBeCloseTo(0.5, 2)
    expect(result.faithfulness).toBeGreaterThan(0)
    expect(result.relevance).toBeGreaterThan(0)
  })

  it('should evaluate dataset', () => {
    const evaluator = new RAGEvaluator()
    const result = evaluator.evaluateDataset([sampleEval])

    expect(result.details).toHaveLength(1)
    expect(result.aggregate.avgRecall).toBe(0.5)
    expect(result.aggregate.avgPrecision).toBe(0.5)
  })

  it('should handle empty dataset', () => {
    const evaluator = new RAGEvaluator()
    const result = evaluator.evaluateDataset([])
    expect(result.aggregate.avgRecall).toBe(0)
    expect(result.details).toHaveLength(0)
  })
})
