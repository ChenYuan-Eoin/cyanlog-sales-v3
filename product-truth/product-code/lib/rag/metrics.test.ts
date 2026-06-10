import { describe, it, expect } from 'vitest'
import {
  calculateRecall,
  calculatePrecision,
  calculateF1,
  calculateFaithfulness,
  calculateRelevance,
  calculateTaskAccuracy,
} from './metrics'

describe('RAG metrics', () => {
  it('calculateRecall: 3/5 = 0.6', () => {
    expect(calculateRecall(3, 5)).toBe(0.6)
  })

  it('calculateRecall: no relevant returns 1.0', () => {
    expect(calculateRecall(0, 0)).toBe(1.0)
  })

  it('calculatePrecision: 3/10 = 0.3', () => {
    expect(calculatePrecision(3, 10)).toBe(0.3)
  })

  it('calculatePrecision: no retrieved returns 0', () => {
    expect(calculatePrecision(0, 0)).toBe(0)
  })

  it('calculateF1: P=0.5, R=0.5 → 0.5', () => {
    expect(calculateF1(0.5, 0.5)).toBe(0.5)
  })

  it('calculateF1: P=1.0, R=0.0 → 0', () => {
    expect(calculateF1(1.0, 0.0)).toBe(0)
  })

  it('calculateFaithfulness: matched phrases', () => {
    // 改用更明确的短语匹配
    const score = calculateFaithfulness('合同', ['合同'])
    expect(score).toBe(1.0)
  })

  it('calculateFaithfulness: unmatched returns low', () => {
    const score = calculateFaithfulness('完全不相关', ['合同'])
    expect(score).toBe(0)
  })

  it('calculateRelevance: matched keywords', () => {
    const score = calculateRelevance('账期', '账期是120天')
    expect(score).toBe(1.0)
  })

  it('calculateTaskAccuracy: 7/10 = 0.7', () => {
    expect(calculateTaskAccuracy(7, 10)).toBe(0.7)
  })

  it('calculateTaskAccuracy: 0/0 = 0', () => {
    expect(calculateTaskAccuracy(0, 0)).toBe(0)
  })
})
