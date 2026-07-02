import { describe, expect, it } from 'vitest'
import {
  inferRuleLifecycleStatus,
  inferRuleTranslationStatus,
  missingRulePublicationFields,
} from './rule-publication'

const completeRule = {
  business_domain: 'contract_review',
  risk_level: 'yellow',
  applicable_scenarios: ['standard_contract_review'],
  scope: 'org',
  engine_type: 'hybrid',
  target_field: 'payment_schedule',
  clause_category: 'payment',
  field_hints: ['付款', '账期'],
  semantic_prompt: '检查付款节奏是否超出发布规则约束。',
  message_template: {
    title: '付款节奏风险',
    comment: '建议按已发布规则调整付款条款。',
    negotiation_action: '销售需与客户确认付款节点。',
  },
}

describe('contract rule publication gate', () => {
  it('allows publication only when source metadata and executable fields are complete', () => {
    expect(missingRulePublicationFields(completeRule)).toEqual([])
    expect(inferRuleTranslationStatus(completeRule)).toBe('ready')
    expect(inferRuleLifecycleStatus(completeRule)).toBe('ready_to_publish')
  })

  it('blocks rules without risk level, applicable scenarios, or scope', () => {
    const missing = missingRulePublicationFields({
      ...completeRule,
      risk_level: null,
      applicable_scenarios: [],
      scope: null,
    })

    expect(missing).toEqual(expect.arrayContaining([
      'risk_level',
      'applicable_scenarios',
      'scope',
    ]))
    expect(inferRuleTranslationStatus({
      ...completeRule,
      applicable_scenarios: [],
    })).toBe('needs_ai_translation')
  })
})
