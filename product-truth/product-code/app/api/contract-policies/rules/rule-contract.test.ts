import { describe, expect, it } from 'vitest'
import {
  allowedConditionOperators,
  buildLegacyRuleAdapter,
  createRuleSchema,
  reconcileConditionForProperty,
  reconcileRuleContractForEditing,
  ruleContractSchema,
  updateRuleSchema,
} from './rule-contract'
import type {
  ContractRuleCondition,
  ContractRuleProperty,
} from '@/types/rules'

const problemCategoryId = '11111111-1111-4111-8111-111111111111'
const ruleSetId = '22222222-2222-4222-8222-222222222222'

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

function singlePropertyContract(
  property: ContractRuleProperty,
  condition: ContractRuleCondition
) {
  return {
    schema_version: '1.0' as const,
    properties: [property],
    decisions: [{
      id: 'decision_1',
      label: '判定',
      outcome: 'block' as const,
      priority: 100,
      match: 'all' as const,
      conditions: [condition],
      action: '进入复核',
      message: '条件不符合要求',
    }],
    missing_evidence_outcome: 'manual_review' as const,
  }
}

describe('rule_contract v1 API contract', () => {
  it('accepts multiple predefined properties and explicit all/any matching', () => {
    const parsed = ruleContractSchema.safeParse(multiPropertyContract())
    expect(parsed.success).toBe(true)
  })

  it.each([
    {
      type: 'money',
      property: { key: 'amount', label: '金额', type: 'money', required: true, currency: 'CNY' },
      condition: { property_key: 'amount', operator: '>=', value: 50_000, unit: 'CNY' },
    },
    {
      type: 'percentage',
      property: { key: 'ratio', label: '比例', type: 'percentage', required: true, unit: 'percent' },
      condition: { property_key: 'ratio', operator: '<', value: 15, unit: 'percent' },
    },
    {
      type: 'duration',
      property: { key: 'days', label: '期限', type: 'duration', required: true, unit: 'day' },
      condition: { property_key: 'days', operator: '<=', value: 30, unit: 'day' },
    },
    {
      type: 'number',
      property: { key: 'copies', label: '份数', type: 'number', required: true, unit: 'copy' },
      condition: { property_key: 'copies', operator: '>', value: 2, unit: 'copy' },
    },
    {
      type: 'date',
      property: { key: 'signed_on', label: '签署日', type: 'date', required: true },
      condition: { property_key: 'signed_on', operator: '>=', value: '2026-07-20' },
    },
    {
      type: 'enum',
      property: {
        key: 'payment_method', label: '付款方式', type: 'enum', required: true,
        options: [{ value: 'prepaid', label: '预付款' }, { value: 'installment', label: '分期' }],
      },
      condition: { property_key: 'payment_method', operator: 'in', value: ['prepaid', 'installment'] },
    },
    {
      type: 'boolean',
      property: { key: 'has_guarantee', label: '有担保', type: 'boolean', required: true },
      condition: { property_key: 'has_guarantee', operator: '=', value: true },
    },
    {
      type: 'text',
      property: { key: 'jurisdiction', label: '管辖约定', type: 'text', required: true },
      condition: { property_key: 'jurisdiction', operator: 'contains', value: '深圳' },
    },
  ] as const)('accepts the audited $type operator/value/unit combination', ({ property, condition }) => {
    expect(ruleContractSchema.safeParse(singlePropertyContract(
      property as ContractRuleProperty,
      condition as ContractRuleCondition
    )).success).toBe(true)
  })

  it.each([
    {
      name: 'money cannot use contains',
      property: { key: 'amount', label: '金额', type: 'money', required: true, currency: 'CNY' },
      condition: { property_key: 'amount', operator: 'contains', value: '50000', unit: 'CNY' },
      message: '不允许运算符',
    },
    {
      name: 'percentage requires numeric value',
      property: { key: 'ratio', label: '比例', type: 'percentage', required: true, unit: 'percent' },
      condition: { property_key: 'ratio', operator: '<', value: '15', unit: 'percent' },
      message: '有限数字',
    },
    {
      name: 'duration condition unit follows property',
      property: { key: 'days', label: '期限', type: 'duration', required: true, unit: 'day' },
      condition: { property_key: 'days', operator: '<=', value: 30, unit: 'month' },
      message: '属性单位一致',
    },
    {
      name: 'date is ISO calendar date',
      property: { key: 'signed_on', label: '签署日', type: 'date', required: true },
      condition: { property_key: 'signed_on', operator: '=', value: '2026-02-30' },
      message: 'YYYY-MM-DD',
    },
    {
      name: 'enum value belongs to configured options',
      property: {
        key: 'method', label: '方式', type: 'enum', required: true,
        options: [{ value: 'prepaid', label: '预付' }],
      },
      condition: { property_key: 'method', operator: '=', value: 'cash' },
      message: '现有选项',
    },
    {
      name: 'boolean requires boolean value',
      property: { key: 'flag', label: '是否', type: 'boolean', required: true },
      condition: { property_key: 'flag', operator: '=', value: 'true' },
      message: '布尔值',
    },
    {
      name: 'text requires text value',
      property: { key: 'place', label: '地点', type: 'text', required: true },
      condition: { property_key: 'place', operator: 'contains', value: 42 },
      message: '文本比较值',
    },
    {
      name: 'text equality would imply exact semantic identity',
      property: { key: 'place', label: '地点', type: 'text', required: true },
      condition: { property_key: 'place', operator: '=', value: '深圳' },
      message: '不允许运算符',
    },
    {
      name: 'text membership would imply exact semantic identity',
      property: { key: 'place', label: '地点', type: 'text', required: true },
      condition: { property_key: 'place', operator: 'in', value: ['深圳', '上海'] },
      message: '不允许运算符',
    },
    {
      name: 'existence checks cannot retain stale values',
      property: { key: 'amount', label: '金额', type: 'money', required: true, currency: 'CNY' },
      condition: { property_key: 'amount', operator: 'exists', value: 50_000, unit: 'CNY' },
      message: '不能携带比较值',
    },
  ] as const)('rejects $name', ({ property, condition, message }) => {
    const parsed = ruleContractSchema.safeParse(singlePropertyContract(
      property as ContractRuleProperty,
      condition as ContractRuleCondition
    ))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes(message))).toBe(true)
    }
  })

  it('publishes an explicit operator matrix for every property type', () => {
    expect(allowedConditionOperators('money')).toEqual(['>=', '<=', '=', '>', '<', 'exists', 'not_exists'])
    expect(allowedConditionOperators('enum')).toEqual(['=', 'in', 'exists', 'not_exists'])
    expect(allowedConditionOperators('boolean')).toEqual(['=', 'exists', 'not_exists'])
    expect(allowedConditionOperators('text')).toEqual(['contains', 'exists', 'not_exists'])
  })

  it('rejects an unreachable not-exists decision on a required property', () => {
    const parsed = ruleContractSchema.safeParse(singlePropertyContract({
      key: 'amount', label: '金额', type: 'money', required: true, currency: 'CNY',
    }, {
      property_key: 'amount', operator: 'not_exists',
    }))
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes('会先进入缺少证据处理'))).toBe(true)
    }
  })

  it('reconciles operator, value and unit when a property changes type', () => {
    const condition: ContractRuleCondition = {
      property_key: 'amount',
      operator: '>=',
      value: 50_000,
      unit: 'CNY',
    }
    const nextProperty: ContractRuleProperty = {
      key: 'amount',
      label: '付款方式',
      type: 'enum',
      required: true,
      options: [{ value: 'prepaid', label: '预付款' }],
    }

    expect(reconcileConditionForProperty(condition, nextProperty)).toEqual({
      property_key: 'amount',
      operator: '=',
      value: 'prepaid',
      unit: undefined,
    })
  })

  it('reconciles duration units and removed enum options without stale references', () => {
    expect(reconcileConditionForProperty({
      property_key: 'term', operator: '<=', value: 30, unit: 'day',
    }, {
      key: 'term', label: '期限', type: 'duration', required: true, unit: 'month',
    })).toMatchObject({ value: 30, unit: 'month' })

    expect(reconcileConditionForProperty({
      property_key: 'method', operator: 'in', value: ['removed'],
    }, {
      key: 'method', label: '方式', type: 'enum', required: true,
      options: [{ value: 'retained', label: '保留选项' }],
    })).toMatchObject({ value: ['retained'], unit: undefined })
  })

  it('clears value and unit when a condition becomes an existence check', () => {
    expect(reconcileConditionForProperty({
      property_key: 'amount', operator: 'exists', value: 50_000, unit: 'CNY',
    }, {
      key: 'amount', label: '金额', type: 'money', required: true, currency: 'CNY',
    })).toEqual({
      property_key: 'amount',
      operator: 'exists',
      value: undefined,
      unit: undefined,
    })
  })

  it('normalizes legacy money unit/currency duplication before editing', () => {
    const legacyContract = singlePropertyContract({
      key: 'amount',
      label: '合同金额',
      type: 'money',
      required: true,
      unit: 'CNY',
      currency: 'CNY',
    }, {
      property_key: 'amount',
      operator: '>=',
      value: 50_000,
      unit: 'CNY',
    })

    const reconciled = reconcileRuleContractForEditing(legacyContract)
    expect(reconciled.properties[0]).toMatchObject({
      type: 'money',
      currency: 'CNY',
      unit: undefined,
    })
    expect(reconciled.decisions[0].conditions[0]).toMatchObject({
      value: 50_000,
      unit: 'CNY',
    })
    expect(ruleContractSchema.safeParse(reconciled).success).toBe(true)
  })

  it('does not silently reinterpret an ambiguous legacy money unit', () => {
    const legacyContract = singlePropertyContract({
      key: 'amount',
      label: '合同金额',
      type: 'money',
      required: true,
      unit: '万元',
      currency: 'CNY',
    }, {
      property_key: 'amount',
      operator: '>=',
      value: 50,
      unit: '万元',
    })

    const reconciled = reconcileRuleContractForEditing(legacyContract)
    expect(reconciled.properties[0].unit).toBe('万元')
    const parsed = ruleContractSchema.safeParse(reconciled)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes('不能另设单位'))).toBe(true)
    }
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

  it('requires a rule set, business category and canonical contract on every user save', () => {
    expect(updateRuleSchema.safeParse({ name: '只改名称' }).success).toBe(false)
    expect(updateRuleSchema.safeParse({
      rule_set_id: ruleSetId,
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
