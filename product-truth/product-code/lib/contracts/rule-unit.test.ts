import { describe, expect, it } from 'vitest'
import { buildRuleUnits, summarizeRuleTranslationGate } from './rule-unit'

describe('contract rule units', () => {
  it('marks complete config-center rules as ready executable units', () => {
    const units = buildRuleUnits([{
      id: 'rule-1',
      code: 'R001',
      name: '付款节奏',
      business_domain: 'contract_review',
      risk_level: 'red',
      applicable_scenarios: ['standard_contract_review'],
      scope: 'org',
      version: 2,
      engine_type: 'hybrid',
      target_field: 'first_payment_rate',
      clause_category: 'payment',
      field_hints: ['付款', '首付款'],
      semantic_prompt: '检查付款比例、付款触发条件和账期是否符合配置标准。',
      message_template: {
        title: '付款节奏风险',
        comment: '必须修改付款条款。',
      },
    }], new Map([['rule-1', {
      id: 'snapshot-1',
      rule_id: 'rule-1',
      version: 2,
      status: 'published',
    }]]))

    expect(units[0]).toMatchObject({
      id: 'snapshot-1',
      code: 'R001',
      source_trace: {
        source_of_truth: 'config_center_published_rule',
        rules_table: 'contract_rules_v2',
        snapshot_table: 'contract_rule_snapshots',
      },
      translation: {
        status: 'ready',
        method: 'configured_fields',
        missing_fields: [],
      },
    })
    expect(summarizeRuleTranslationGate(units)).toMatchObject({
      status: 'ready',
      official_review_allowed: true,
      total: 1,
      ready: 1,
    })
  })

  it('treats structured rule-set wording and output contract as an executable template', () => {
    const units = buildRuleUnits([{
      id: 'rule-structured-template',
      code: 'R001',
      name: '付款节奏',
      business_domain: 'contract_review',
      risk_level: 'yellow',
      applicable_scenarios: ['standard_contract_review'],
      scope: 'org',
      version: 2,
      engine_type: 'hybrid',
      target_field: 'payment_schedule',
      clause_category: 'payment',
      field_hints: ['付款', '首付款'],
      semantic_prompt: '检查付款比例、付款触发条件和账期是否符合配置标准。',
      message_template: {
        levels: {
          level_a: '首期>=30%，三段式 30/60/10，尾款账期<=30工作日',
          level_b: '首期 15-29%',
          level_c: '首期<15% / 100%验收后付首款 / 账期>30工作日',
        },
        source: {
          repo: 'suoyidev/ones-internal-skills',
        },
        outputs: {
          primary: 'word_native_comment',
          secondary: 'review_report',
          comment_author: 'ONES 业务运营',
        },
      },
    }], new Map([['rule-structured-template', {
      id: 'snapshot-structured-template',
      rule_id: 'rule-structured-template',
      version: 2,
      status: 'published',
    }]]))

    expect(units[0].translation).toMatchObject({
      status: 'ready',
      method: 'configured_fields',
      missing_fields: [],
    })
  })

  it('blocks formal review when a rule still needs AI translation confirmation', () => {
    const units = buildRuleUnits([{
      id: 'rule-1',
      code: 'R002',
      name: '终止退款',
      business_domain: 'contract_review',
      risk_level: 'yellow',
      applicable_scenarios: ['standard_contract_review'],
      scope: 'org',
      version: 1,
      engine_type: 'semantic',
      target_field: null,
      clause_category: 'termination',
      field_hints: ['退款'],
      semantic_prompt: null,
      message_template: {},
    }], new Map([['rule-1', {
      id: 'snapshot-1',
      rule_id: 'rule-1',
      version: 1,
      status: 'published',
    }]]))

    expect(units[0].translation).toMatchObject({
      status: 'needs_ai_translation',
      method: 'ai_required',
      missing_fields: ['semantic_prompt', 'message_template'],
    })
    expect(summarizeRuleTranslationGate(units)).toMatchObject({
      status: 'needs_ai_translation',
      official_review_allowed: false,
      needs_ai_translation: 1,
      blocking_reasons: ['rule_translation_needs_confirmation'],
    })
  })

  it('fails the gate when a config-center rule has no published snapshot', () => {
    const units = buildRuleUnits([{
      id: 'rule-1',
      code: 'R003',
      name: '税率',
      business_domain: 'contract_review',
      risk_level: 'yellow',
      applicable_scenarios: ['standard_contract_review'],
      scope: 'org',
      version: 1,
      engine_type: 'structured',
      target_field: 'tax_rate',
      clause_category: 'tax',
      field_hints: ['税率'],
      semantic_prompt: null,
      message_template: { title: '税率风险' },
    }], new Map())

    expect(units[0].translation.status).toBe('incomplete_source')
    expect(summarizeRuleTranslationGate(units)).toMatchObject({
      status: 'failed',
      official_review_allowed: false,
      incomplete_source: 1,
      blocking_reasons: ['rule_source_incomplete'],
    })
  })

  it('fails the gate when only a compiled draft snapshot is available', () => {
    const units = buildRuleUnits([{
      id: 'rule-1',
      code: 'R003',
      name: '税率',
      business_domain: 'contract_review',
      risk_level: 'yellow',
      applicable_scenarios: ['standard_contract_review'],
      scope: 'org',
      version: 2,
      engine_type: 'structured',
      target_field: 'tax_rate',
      clause_category: 'tax',
      field_hints: ['税率'],
      semantic_prompt: null,
      message_template: { title: '税率风险' },
    }], new Map([['rule-1', {
      id: 'snapshot-draft',
      rule_id: 'rule-1',
      version: 2,
      status: 'compiled',
    }]]))

    expect(units[0].translation).toMatchObject({
      status: 'incomplete_source',
      missing_fields: expect.arrayContaining(['published_rule_snapshot']),
    })
    expect(summarizeRuleTranslationGate(units)).toMatchObject({
      status: 'failed',
      official_review_allowed: false,
      blocking_reasons: ['rule_source_incomplete'],
    })
  })

  it('fails the gate when rule source metadata is missing', () => {
    const units = buildRuleUnits([{
      id: 'rule-1',
      code: 'R004',
      name: '适用范围缺失',
      business_domain: 'contract_review',
      risk_level: null,
      applicable_scenarios: [],
      scope: null,
      version: 1,
      engine_type: 'structured',
      target_field: 'contract_scope',
      clause_category: 'scope',
      field_hints: ['适用范围'],
      semantic_prompt: null,
      message_template: { title: '适用范围风险' },
    }], new Map([['rule-1', {
      id: 'snapshot-1',
      rule_id: 'rule-1',
      version: 1,
      status: 'published',
    }]]))

    expect(units[0].translation).toMatchObject({
      status: 'incomplete_source',
      missing_fields: expect.arrayContaining(['risk_level', 'applicable_scenarios', 'scope']),
    })
    expect(summarizeRuleTranslationGate(units)).toMatchObject({
      status: 'failed',
      official_review_allowed: false,
      blocking_reasons: ['rule_source_incomplete'],
    })
  })
})
