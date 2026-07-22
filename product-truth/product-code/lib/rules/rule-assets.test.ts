import { describe, expect, it } from 'vitest'

import { evaluateRuleSample, getRuleAssetHealth } from './rule-assets'
import type { ContractRuleAsset } from '@/types/contract-rule-assets'

const baseRule: ContractRuleAsset = {
  id: '00000000-0000-4000-8000-000000000001',
  org_id: '00000000-0000-4000-8000-000000000002',
  rule_set_id: '00000000-0000-4000-8000-000000000003',
  code: 'R001',
  name: '付款节奏',
  description: '检查首付款比例',
  category: 'ratio',
  applicable_scenarios: ['customer_contract'],
  scope: 'org',
  level_a_operator: '>=',
  level_a_threshold: 30,
  level_a_unit: 'percent',
  level_a_action: 'auto_accept',
  level_b_operator: '>=',
  level_b_threshold: 15,
  level_b_unit: 'percent',
  level_b_action: 'negotiate',
  level_b_counterparty: null,
  level_c_operator: '<',
  level_c_threshold: 15,
  level_c_unit: 'percent',
  level_c_action: 'block',
  level_c_message: null,
  approval_roles: [],
  version: 1,
  priority: 100,
  is_active: true,
  engine_type: 'structured',
  target_field: 'advance_ratio',
  clause_category: 'payment',
  field_hints: ['首付'],
  semantic_prompt: null,
  message_template: {
    comment_template: '建议调整首付款比例。',
    evidence_requirement: '定位付款条款',
    negotiation_guidance: '说明回款风险',
    bottom_line: '首付款不得低于 15%',
  },
  business_domain: 'payment',
  risk_level: 'yellow',
  lifecycle_status: 'ready_to_publish',
  translation_status: 'ready',
  translation_notes: [],
  translation_diff: [],
  translated_at: null,
  published_at: null,
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-13T00:00:00Z',
}

describe('rule assets', () => {
  it('evaluates deterministic numeric rules without a model', () => {
    expect(evaluateRuleSample(baseRule, { fields: { advance_ratio: 20 } })).toMatchObject({
      status: 'matched',
      level: 'B',
      mode: 'deterministic',
    })
  })

  it('does not pretend semantic rules matched', () => {
    const semantic = { ...baseRule, category: 'text' as const, engine_type: 'semantic' as const, semantic_prompt: '判断知识产权归属' }
    expect(evaluateRuleSample(semantic, { text: '知识产权归乙方' })).toMatchObject({
      status: 'needs_model',
      mode: 'model_required',
    })
  })

  it('blocks publishing when translation or actions are incomplete', () => {
    const incomplete = { ...baseRule, translation_status: 'needs_ai_translation' as const, level_b_action: null }
    const health = getRuleAssetHealth(incomplete)
    expect(health.publishable).toBe(false)
    expect(health.blockers).toContain('规则转译尚未确认')
    expect(health.blockers).toContain('A/B/C 处理动作不完整')
  })

  it('blocks publishing when legal execution materials are incomplete', () => {
    const incomplete = {
      ...baseRule,
      message_template: {
        comment_template: '',
        evidence_requirement: '',
        negotiation_guidance: '',
        bottom_line: '',
      },
    }
    const health = getRuleAssetHealth(incomplete)
    expect(health.publishable).toBe(false)
    expect(health.blockers).toEqual(expect.arrayContaining([
      '未配置客户侧批注模板',
      '未配置销售谈判口径',
      '未配置销售退让底线',
      '未配置证据要求',
    ]))
  })
})
