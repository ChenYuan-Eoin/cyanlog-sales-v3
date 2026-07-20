import { describe, expect, it } from 'vitest'
import {
  buildLegacyRuleAdapter,
  createRuleSchema,
  ruleContractSchema,
  updateRuleSchema,
} from './rule-contract'

const problemCategoryId = '11111111-1111-4111-8111-111111111111'

function multiPropertyContract() {
  return {
    schema_version: '1.0' as const,
    properties: [
      {
        key: 'contract_amount',
        label: '合同金额',
        type: 'money' as const,
        required: true,
        currency: 'CNY',
      },
      {
        key: 'payment_days',
        label: '付款期限',
        type: 'duration' as const,
        required: true,
        unit: 'day',
      },
    ],
    decisions: [
      {
        id: 'acceptable',
        label: '可接受',
        outcome: 'pass' as const,
        priority: 10,
        match: 'all' as const,
        conditions: [
          { property_key: 'contract_amount', operator: '>=' as const, value: 50_000, unit: 'CNY' },
          { property_key: 'payment_days', operator: '<=' as const, value: 30, unit: 'day' },
        ],
        action: '通过审核',
      },
      {
        id: 'red_line',
        label: '红线',
        outcome: 'block' as const,
        priority: 30,
        match: 'any' as const,
        conditions: [
          { property_key: 'contract_amount', operator: '<' as const, value: 50_000, unit: 'CNY' },
          { property_key: 'payment_days', operator: '>' as const, value: 90, unit: 'day' },
        ],
        message: '金额或账期触发红线',
      },
    ],
    missing_evidence_outcome: 'manual_review' as const,
  }
}

describe('rule_contract v1 API contract', () => {
  it('accepts multiple predefined properties and explicit all/any matching', () => {
    const parsed = ruleContractSchema.safeParse(multiPropertyContract())
    expect(parsed.success).toBe(true)
  })

  it('rejects dangling property references instead of inventing runtime properties', () => {
    const contract = multiPropertyContract()
    contract.decisions[0].conditions[0].property_key = 'runtime_extracted_amount'

    const parsed = ruleContractSchema.safeParse(contract)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes('不存在的属性'))).toBe(true)
    }
  })

  it('rejects prompts, model selection, target fields and engine controls from new writes', () => {
    const parsed = createRuleSchema.safeParse({
      code: 'R100',
      name: '金额下限',
      problem_category_id: problemCategoryId,
      rule_contract: multiPropertyContract(),
      prompt: '请识别金额',
      model_id: 'gpt-5.5',
      target_field: 'contract_amount',
      engine_type: 'hybrid',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
    }
  })

  it('rejects technical fields on PATCH too', () => {
    expect(updateRuleSchema.safeParse({ semantic_prompt: '机器指令' }).success).toBe(false)
    expect(updateRuleSchema.safeParse({ provider: 'openai' }).success).toBe(false)
  })

  it('requires a canonical contract and business category on every user save', () => {
    expect(updateRuleSchema.safeParse({ name: '只改名称' }).success).toBe(false)
    expect(updateRuleSchema.safeParse({
      problem_category_id: problemCategoryId,
      rule_contract: multiPropertyContract(),
    }).success).toBe(true)
  })

  it('adapts canonical details into legacy columns without storing prompt/model choices', () => {
    const adapter = buildLegacyRuleAdapter(multiPropertyContract(), 'payment')

    expect(adapter).toMatchObject({
      category: 'amount',
      engine_type: 'structured',
      target_field: 'contract_amount',
      clause_category: 'payment',
      semantic_prompt: null,
      level_a_operator: '>=',
      level_a_threshold: 50_000,
      level_c_operator: '<',
      level_c_threshold: 50_000,
    })
    expect(JSON.stringify(adapter)).not.toContain('model')
    expect(adapter.semantic_prompt).toBeNull()
  })
})
