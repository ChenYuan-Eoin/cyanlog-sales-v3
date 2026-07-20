import { describe, expect, it } from 'vitest'
import type { ContractRuleContract } from '@/types/rules'
import {
  adaptLegacyRuleAsset,
  createDefaultRuleContract,
  evaluateRuleContract,
  isResolvedRuleContractComplete,
  ruleContractConfigurationStatus,
  normalizeRuleContract,
  parseChineseNumericText,
  resolveRuleContract,
  type RuleContractAsset,
} from './rule-contract'

function asset(ruleContract: ContractRuleContract, overrides: Partial<RuleContractAsset> = {}): RuleContractAsset {
  return {
    id: 'rule-1',
    org_id: 'org-1',
    code: 'PAYMENT-001',
    name: '合同金额底线',
    description: '判断合同总金额是否达到业务底线',
    problem_category_id: 'category-payment',
    problem_category: {
      id: 'category-payment',
      org_id: 'org-1',
      code: 'payment',
      name: '付款与结算',
    },
    rule_contract: ruleContract,
    ...overrides,
  }
}

function amountContract(): ContractRuleContract {
  return {
    schema_version: '1.0',
    properties: [{
      key: 'contract_amount',
      label: '合同金额',
      description: '合同含税总价',
      type: 'money',
      required: true,
      unit: 'CNY',
      currency: 'CNY',
    }],
    decisions: [
      {
        id: 'amount-pass',
        label: '达到金额底线',
        outcome: 'pass',
        priority: 9999,
        match: 'all',
        conditions: [{ property_key: 'contract_amount', operator: '>=', value: 50000, unit: 'CNY' }],
      },
      {
        id: 'amount-block',
        label: '低于金额底线',
        outcome: 'block',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000, unit: 'CNY' }],
      },
    ],
    missing_evidence_outcome: 'manual_review',
  }
}

describe('canonical rule contract', () => {
  it('provides one safe empty draft for UI creation', () => {
    expect(createDefaultRuleContract()).toEqual({
      schema_version: '1.0',
      properties: [],
      decisions: [],
      missing_evidence_outcome: 'manual_review',
    })
  })

  it('normalizes canonical JSON and rejects conditions that reference undefined properties', () => {
    expect(normalizeRuleContract(amountContract())).not.toBeNull()
    expect(normalizeRuleContract({
      ...amountContract(),
      decisions: [{
        id: 'bad',
        label: '错误引用',
        outcome: 'block',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'runtime_extracted_field', operator: 'exists' }],
      }],
    })).toBeNull()
  })

  it('limits missing evidence to manual review or block', () => {
    expect(normalizeRuleContract({
      ...amountContract(),
      missing_evidence_outcome: 'pass',
    })).toBeNull()
  })

  it('resolves a canonical contract before any legacy columns', () => {
    const canonical = amountContract()
    expect(resolveRuleContract({
      rule_contract: canonical,
      category: 'ratio',
      target_field: 'wrong_legacy_field',
    })).toEqual(canonical)
  })

  it('treats the database empty-draft sentinel as non-executable and adapts the old asset', () => {
    const resolved = resolveRuleContract({
      rule_contract: createDefaultRuleContract(),
      code: 'RULE-01-01',
      name: '合同金额',
      category: 'amount',
      target_field: 'contract_amount',
      level_a: { operator: '>=', threshold: 50000, unit: 'CNY', action: 'auto_approve' },
      level_b: { operator: '<', threshold: 50000, unit: 'CNY', action: 'manual_review' },
      level_c: { operator: '<', threshold: 30000, unit: 'CNY', action: 'block' },
    })

    expect(resolved.properties[0]).toMatchObject({ key: 'contract_amount', type: 'money' })
    expect(resolved.decisions.map((decision) => decision.id)).toEqual([
      'legacy_level_c',
      'legacy_level_b',
      'legacy_level_a',
    ])
  })

  it('separates runtime legacy compatibility from user-confirmed canonical completeness', () => {
    expect(isResolvedRuleContractComplete({
      rule_contract: null,
      code: 'R003',
      name: '账期',
      category: 'duration',
      target_field: 'payment_term_days',
      level_a: { operator: '<=', threshold: 30, unit: 'day', action: 'auto_approve' },
      level_b: { operator: '>', threshold: 30, unit: 'day', action: 'manual_review' },
      level_c: { operator: '>', threshold: 90, unit: 'day', action: 'block' },
    })).toBe(false)
    expect(ruleContractConfigurationStatus({ rule_contract: null })).toBe('legacy_compatible')
    expect(ruleContractConfigurationStatus({ rule_contract: createDefaultRuleContract() })).toBe('incomplete')
    expect(ruleContractConfigurationStatus({ rule_contract: amountContract() })).toBe('canonical_complete')
  })
})

describe('legacy asset adapter', () => {
  it('turns legacy A/B/C into canonical all-match decisions once', () => {
    const contract = adaptLegacyRuleAsset({
      code: 'R003',
      name: '账期',
      category: 'duration',
      target_field: 'payment_term_days',
      level_a: { operator: '<=', threshold: 30, unit: 'day', action: 'auto_approve' },
      level_b: { operator: '>', threshold: 30, unit: 'day', action: 'suggest_counterparty' },
      level_c: { operator: '>', threshold: 90, unit: 'day', action: 'block' },
    })

    expect(contract.schema_version).toBe('1.0')
    expect(contract.properties).toEqual([
      expect.objectContaining({ key: 'payment_term_days', type: 'duration' }),
    ])
    expect(contract.decisions).toHaveLength(3)
    expect(contract.decisions.every((decision) => decision.match === 'all')).toBe(true)
  })

  it('represents the old payment schedule as a real multi-property rule', () => {
    const contract = adaptLegacyRuleAsset({
      code: 'R001',
      name: '付款节奏',
      category: 'ratio',
      target_field: 'payment_schedule',
      level_a: { operator: '>=', threshold: 30, unit: 'percent', action: 'auto_approve' },
      level_b: { operator: '>=', threshold: 15, unit: 'percent', action: 'suggest_counterparty' },
      level_c: { operator: '<', threshold: 15, unit: 'percent', action: 'block' },
    })

    expect(contract.properties.map((property) => property.key)).toEqual([
      'first_payment_rate',
      'payment_term_days',
    ])
    expect(contract.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy_payment_term_redline', outcome: 'block' }),
    ]))
  })
})

describe('clause-first property reading', () => {
  it('reads uppercase Chinese money from the matched contract-amount clause, not the first amount in the document', () => {
    const result = evaluateRuleContract(
      asset(amountContract()),
      '履约保证金为壹万元。合同含税总价肆万捌仟元。服务费另行约定。'
    )

    expect(result.status).toBe('decided')
    expect(result.outcome).toBe('block')
    expect(result.readings.contract_amount.value).toBe(48000)
    expect(result.readings.contract_amount.evidence).toBe('合同含税总价肆万捌仟元。')
  })

  it('uses the amount nearest the defined property when one clause contains several amounts', () => {
    const result = evaluateRuleContract(
      asset(amountContract()),
      '付款与结算：合同总价100000元，履约保证金50000元。'
    )

    expect(result.outcome).toBe('pass')
    expect(result.readings.contract_amount.value).toBe(100000)
  })

  it('does not guess when equally relevant clauses contain conflicting values', () => {
    const result = evaluateRuleContract(
      asset(amountContract()),
      '补充协议记载合同总价48000元。主合同记载合同总价68000元。'
    )

    expect(result.status).toBe('missing_evidence')
    expect(result.outcome).toBe('manual_review')
    expect(result.ambiguous_property_keys).toEqual(['contract_amount'])
  })

  it('sends missing required evidence to manual review instead of inventing a value', () => {
    const result = evaluateRuleContract(asset(amountContract()), '双方同意友好履约。')

    expect(result.status).toBe('missing_evidence')
    expect(result.outcome).toBe('manual_review')
    expect(result.missing_property_keys).toEqual(['contract_amount'])
  })

  it('sends a currency conflict to manual review instead of comparing unlike units', () => {
    const result = evaluateRuleContract(asset(amountContract()), '合同金额USD 60000。')

    expect(result.status).toBe('missing_evidence')
    expect(result.outcome).toBe('manual_review')
    expect(result.unit_conflict_property_keys).toEqual(['contract_amount'])
    expect(result.readings.contract_amount).toMatchObject({
      status: 'unit_conflict',
      unit: 'USD',
    })
  })

  it('uses configured priority before risk severity when multiple decisions match', () => {
    const contract = amountContract()
    contract.decisions[0].conditions = [{ property_key: 'contract_amount', operator: '>', value: 0 }]
    contract.decisions[1].conditions = [{ property_key: 'contract_amount', operator: '<', value: 50000 }]
    const result = evaluateRuleContract(asset(contract), '合同总价48000元。')

    expect(result.decision?.id).toBe('amount-pass')
    expect(result.risk_level).toBe('green')
  })

  it('rejects text equality because runtime reads a clause and only contains is executable', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [{ key: 'invoice_note', label: '发票备注', type: 'text', required: true }],
      decisions: [{
        id: 'invalid-text-equality',
        label: '错误文本配置',
        outcome: 'block',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'invoice_note', operator: '=', value: '专票' }],
      }],
      missing_evidence_outcome: 'manual_review',
    }

    expect(normalizeRuleContract(contract)).toBeNull()
  })
})

describe('multi-property and common property types', () => {
  it('supports multi-property rules and explicit any-match semantics', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [
        { key: 'first_payment_rate', label: '首付款比例', type: 'percentage', required: true, unit: 'percent' },
        { key: 'final_payment_days', label: '尾款支付期限', type: 'duration', required: true, unit: 'day' },
      ],
      decisions: [
        {
          id: 'payment-redline',
          label: '付款条件触碰红线',
          outcome: 'block',
          priority: 10,
          match: 'any',
          conditions: [
            { property_key: 'first_payment_rate', operator: '<', value: 15, unit: 'percent' },
            { property_key: 'final_payment_days', operator: '>', value: 30, unit: 'day' },
          ],
        },
        {
          id: 'payment-negotiate',
          label: '付款条件需谈判',
          outcome: 'negotiate',
          priority: 10,
          match: 'all',
          conditions: [
            { property_key: 'first_payment_rate', operator: '<', value: 30, unit: 'percent' },
            { property_key: 'final_payment_days', operator: '<=', value: 30, unit: 'day' },
          ],
        },
      ],
      missing_evidence_outcome: 'manual_review',
    }
    const result = evaluateRuleContract(
      asset(contract, { name: '付款节奏', description: '首付款与尾款账期必须同时受控' }),
      '付款安排：首付款20%，尾款应在验收后45天内支付。'
    )

    expect(result.outcome).toBe('block')
    expect(result.readings.first_payment_rate.value).toBe(20)
    expect(result.readings.final_payment_days.value).toBe(45)
  })

  it('allows an explicit not_exists decision for an optional business property', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [{ key: 'renewal_exit', label: '续约退出机制', type: 'text', required: false }],
      decisions: [{
        id: 'missing_exit_block',
        label: '缺少退出机制',
        outcome: 'block',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'renewal_exit', operator: 'not_exists' }],
      }],
      missing_evidence_outcome: 'manual_review',
    }
    const result = evaluateRuleContract(asset(contract, { name: '续约与退出' }), '双方友好合作。')

    expect(result.status).toBe('decided')
    expect(result.outcome).toBe('block')
  })

  it('reads enum, boolean, text, number, and date only from their matched clauses', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [
        {
          key: 'payment_method',
          label: '付款方式',
          type: 'enum',
          required: true,
          options: [
            { value: 'bank', label: '银行转账' },
            { value: 'cash', label: '现金' },
          ],
        },
        {
          key: 'subcontract_allowed',
          label: '允许转包',
          type: 'boolean',
          required: true,
          options: [
            { value: 'true', label: '允许转包' },
            { value: 'false', label: '禁止转包' },
          ],
        },
        { key: 'invoice_note', label: '发票备注', type: 'text', required: true },
        { key: 'copy_count', label: '合同份数', type: 'number', required: true, unit: '份' },
        { key: 'effective_date', label: '生效日期', type: 'date', required: true },
      ],
      decisions: [{
        id: 'all-facts-present',
        label: '事实完整',
        outcome: 'pass',
        priority: 1,
        match: 'all',
        conditions: [
          { property_key: 'payment_method', operator: '=', value: 'bank' },
          { property_key: 'subcontract_allowed', operator: '=', value: true },
          { property_key: 'invoice_note', operator: 'contains', value: '专票' },
          { property_key: 'copy_count', operator: '=', value: 2 },
          { property_key: 'effective_date', operator: '=', value: '2026-08-01' },
        ],
      }],
      missing_evidence_outcome: 'manual_review',
    }
    const result = evaluateRuleContract(
      asset(contract, { name: '合同基础事实' }),
      [
        '付款方式：银行转账。',
        '允许转包：允许转包。',
        '发票备注：开具增值税专票。',
        '合同份数：2份。',
        '生效日期：2026年8月1日。',
      ].join('')
    )

    expect(result.outcome).toBe('pass')
    expect(result.readings).toMatchObject({
      payment_method: { value: 'bank' },
      subcontract_allowed: { value: true },
      copy_count: { value: 2 },
      effective_date: { value: '2026-08-01' },
    })
  })

  it('matches an enum decision by stable option value and remains compatible with an older label value', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [{
        key: 'payment_method',
        label: '付款方式',
        type: 'enum',
        required: true,
        options: [
          { value: 'option_1', label: '预付款' },
          { value: 'option_2', label: '验收后付款' },
        ],
      }],
      decisions: [{
        id: 'prepay-pass',
        label: '采用预付款',
        outcome: 'pass',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'payment_method', operator: '=', value: '预付款' }],
      }],
      missing_evidence_outcome: 'manual_review',
    }

    const result = evaluateRuleContract(asset(contract), '付款方式为预付款。')

    expect(result.readings.payment_method.value).toBe('option_1')
    expect(result.outcome).toBe('pass')
  })

  it('does not misread a negative boolean phrase through its positive substring', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [{
        key: 'subcontract_allowed',
        label: '允许转包',
        type: 'boolean',
        required: true,
        options: [
          { value: 'true', label: '允许转包' },
          { value: 'false', label: '不允许转包' },
        ],
      }],
      decisions: [{
        id: 'forbid-subcontract',
        label: '禁止转包',
        outcome: 'pass',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'subcontract_allowed', operator: '=', value: false }],
      }],
      missing_evidence_outcome: 'manual_review',
    }

    const result = evaluateRuleContract(asset(contract), '未经甲方书面同意，乙方不允许转包。')

    expect(result.readings.subcontract_allowed).toMatchObject({ status: 'read', value: false })
    expect(result.outcome).toBe('pass')
  })

  it('reads a question-answer boolean as false and reports contradictory assertions as ambiguous', () => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [{
        key: 'subcontract_allowed',
        label: '是否允许转包',
        type: 'boolean',
        required: true,
        options: [
          { value: 'true', label: '允许转包' },
          { value: 'false', label: '不允许转包' },
        ],
      }],
      decisions: [{
        id: 'forbid-subcontract',
        label: '禁止转包',
        outcome: 'pass',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'subcontract_allowed', operator: '=', value: false }],
      }],
      missing_evidence_outcome: 'manual_review',
    }

    const negative = evaluateRuleContract(asset(contract), '是否允许转包：否。')
    expect(negative.readings.subcontract_allowed).toMatchObject({ status: 'read', value: false })
    expect(negative.decision?.id).toBe('forbid-subcontract')

    const conflicting = evaluateRuleContract(
      asset(contract),
      '是否允许转包：否，但补充条款约定允许转包。'
    )
    expect(conflicting.readings.subcontract_allowed.status).toBe('ambiguous')
    expect(conflicting.status).toBe('missing_evidence')
  })

  it.each([
    ['合同金额为5万。', 50_000],
    ['合同金额为5亿。', 500_000_000],
  ])('reads explicit Chinese money unit in %s', (sourceText, expected) => {
    const result = evaluateRuleContract(asset(amountContract()), sourceText)
    expect(result.readings.contract_amount).toMatchObject({ status: 'read', value: expected, unit: 'CNY' })
  })

  it.each(['合同金额为5w。', '合同金额为5W。'])('does not invent a money unit for ambiguous shorthand %s', (sourceText) => {
    const result = evaluateRuleContract(asset(amountContract()), sourceText)
    expect(result.readings.contract_amount.status).toBe('missing')
    expect(result.status).toBe('missing_evidence')
  })

  it.each([
    ['付款期限为90天。', 'month', 3],
    ['付款期限为1年。', 'day', 365],
  ])('converts duration units before comparing %s', (sourceText, propertyUnit, expected) => {
    const contract: ContractRuleContract = {
      schema_version: '1.0',
      properties: [{
        key: 'payment_days',
        label: '付款期限',
        type: 'duration',
        required: true,
        unit: propertyUnit,
      }],
      decisions: [{
        id: 'duration-equal',
        label: '期限一致',
        outcome: 'pass',
        priority: 1,
        match: 'all',
        conditions: [{ property_key: 'payment_days', operator: '=', value: expected }],
      }],
      missing_evidence_outcome: 'manual_review',
    }

    expect(evaluateRuleContract(asset(contract), sourceText).outcome).toBe('pass')
  })
})

describe('Chinese numeric reader', () => {
  it.each([
    ['肆万捌仟', 48000],
    ['壹佰零伍万', 1050000],
    ['十二', 12],
    ['2,500', 2500],
  ])('parses %s as %s', (source, expected) => {
    expect(parseChineseNumericText(source)).toBe(expected)
  })
})
