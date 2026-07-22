import { describe, expect, it } from 'vitest'

import {
  getReviewExecutionPresentation,
  normalizeReviewCompliance,
} from './review-display'

describe('normalizeReviewCompliance', () => {
  it('fills fields omitted by historical review results', () => {
    expect(normalizeReviewCompliance({ party_a_consistency: 'consistent' })).toEqual({
      missing_required_clauses: [],
      dangerous_clauses: [],
      ambiguous_clauses: [],
      unbalanced_clauses: [],
      party_a_consistency: 'consistent',
      party_b_consistency: 'unknown',
      issues: [],
    })
  })

  it('drops malformed list entries instead of crashing the page', () => {
    expect(normalizeReviewCompliance({
      missing_required_clauses: ['付款条款', null, 42],
      issues: 'not-an-array',
    })).toMatchObject({
      missing_required_clauses: ['付款条款'],
      issues: [],
    })
  })
})

describe('getReviewExecutionPresentation', () => {
  it('never presents deterministic rule fallback as AI review', () => {
    expect(getReviewExecutionPresentation('rule_engine')).toMatchObject({
      isRuleEngine: true,
      resultTitle: '规则风险点',
      completionLabel: '规则复审完成（非 AI）',
    })
  })

  it('keeps local and cloud providers under AI semantics', () => {
    expect(getReviewExecutionPresentation('local_primary')).toMatchObject({
      isRuleEngine: false,
      resultTitle: 'AI 风险点',
      completionLabel: 'AI 审核完成',
    })
    expect(getReviewExecutionPresentation('sales_cloud_backup')).toMatchObject({
      isRuleEngine: false,
      resultTitle: 'AI 风险点',
    })
  })

  it('recognizes the historical level-three alias', () => {
    expect(getReviewExecutionPresentation('AI_LEVEL_3').isRuleEngine).toBe(true)
  })
})
