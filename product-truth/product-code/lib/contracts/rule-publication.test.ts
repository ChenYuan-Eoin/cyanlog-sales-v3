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

const canonicalRule = {
  code: 'PAYMENT_MINIMUM',
  name: '合同金额不得低于五万元',
  rule_set_id: '11111111-1111-4111-8111-111111111111',
  problem_category_id: '22222222-2222-4222-8222-222222222222',
  business_domain: 'contract_review',
  risk_level: 'red',
  applicable_scenarios: ['standard_contract_review'],
  scope: 'org',
  is_active: true,
  rule_contract: {
    schema_version: '1.0' as const,
    properties: [{
      key: 'contract_amount',
      label: '合同金额',
      type: 'money' as const,
      required: true,
      currency: 'CNY',
    }],
    decisions: [
      {
        id: 'amount_block',
        label: '低于金额底线',
        outcome: 'block' as const,
        priority: 100,
        match: 'all' as const,
        conditions: [{ property_key: 'contract_amount', operator: '<' as const, value: 50000 }],
        action: '提交例外审批',
        message: '合同金额低于五万元。',
      },
      {
        id: 'amount_pass',
        label: '达到金额底线',
        outcome: 'pass' as const,
        priority: 10,
        match: 'all' as const,
        conditions: [{ property_key: 'contract_amount', operator: '>=' as const, value: 50000 }],
      },
    ],
    missing_evidence_outcome: 'manual_review' as const,
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

  it('publishes a complete canonical business contract without legacy technical fields', () => {
    expect(missingRulePublicationFields(canonicalRule)).toEqual([])
    expect(inferRuleTranslationStatus(canonicalRule)).toBe('ready')
    expect(inferRuleLifecycleStatus(canonicalRule)).toBe('ready_to_publish')
  })

  it('blocks a canonical contract without a ruleset, category, or actionable risk handling', () => {
    const invalid = {
      ...canonicalRule,
      rule_set_id: null,
      problem_category_id: null,
      rule_contract: {
        ...canonicalRule.rule_contract,
        decisions: [{
          ...canonicalRule.rule_contract.decisions[0],
          action: '',
          message: '',
        }],
      },
    }

    expect(missingRulePublicationFields(invalid)).toEqual(expect.arrayContaining([
      'rule_set_id',
      'problem_category_id',
      'rule_contract.risk_handling',
    ]))
  })
})
