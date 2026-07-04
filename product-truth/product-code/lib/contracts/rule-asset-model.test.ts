import { describe, expect, it } from 'vitest'
import type { ContractPolicyRule, ContractRuleSet } from '@/types/rules'
import {
  buildRuleSetSections,
  buildRuleSetViews,
  isFormallyPublishedRule,
  ruleBlockingReasons,
  ruleExecutionSummary,
  ruleSetKeyForAsset,
} from './rule-asset-model'

function rule(overrides: Partial<ContractPolicyRule> = {}): ContractPolicyRule {
  return {
    id: overrides.id || 'rule-1',
    org_id: 'org-1',
    rule_set_id: null,
    rule_set_document_id: null,
    code: 'R001',
    name: '付款节奏',
    description: '首期款、验收款和尾款比例检查',
    business_domain: 'contract_review',
    risk_level: 'red',
    lifecycle_status: 'published',
    translation_status: 'ready',
    category: 'ratio',
    engine_type: 'hybrid',
    target_field: 'payment_schedule',
    clause_category: 'payment',
    field_hints: ['首付款', '验收款', '付款节奏'],
    semantic_prompt: '识别首付款比例、验收后付款比例和账期。',
    message_template: {
      comment: '付款节奏不符合红线，需要修改条款。',
      negotiation_action: '销售需取得客户确认并保留对价。',
    },
    applicable_scenarios: ['standard_contract'],
    scope: 'org',
    level_a_operator: '>=',
    level_a_threshold: 30,
    level_a_unit: 'percent',
    level_a_action: 'approve',
    level_b_operator: '>=',
    level_b_threshold: 15,
    level_b_unit: 'percent',
    level_b_action: 'negotiate_with_counterparty',
    level_b_counterparty: 'customer',
    level_c_operator: '<',
    level_c_threshold: 15,
    level_c_unit: 'percent',
    level_c_action: 'block',
    level_c_message: '首付款低于红线',
    approval_roles: ['LEGAL'],
    priority: 100,
    version: 2,
    is_active: true,
    published_at: '2026-07-03T00:00:00.000Z',
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
    ...overrides,
  }
}

function ruleSet(overrides: Partial<ContractRuleSet> = {}): ContractRuleSet {
  return {
    id: overrides.id || 'ruleset-payment',
    org_id: 'org-1',
    code: 'PAYMENT',
    name: '付款与结算',
    description: '付款、结算和账期规则集',
    applicable_scenario: 'standard_contract',
    priority: 10,
    is_default: true,
    is_active: true,
    version: 1,
    lifecycle_status: 'published',
    translation_status: 'ready',
    published_at: '2026-07-03T00:00:00.000Z',
    published_by: 'system',
    release_note: null,
    metadata: null,
    created_by: null,
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
    latest_document: null,
    rule_count: undefined,
    published_rule_count: undefined,
    ready_rule_count: undefined,
    blocked_rule_count: undefined,
    ...overrides,
  }
}

describe('rule asset model', () => {
  it('groups rule assets into product-facing sections instead of a flat machine list', () => {
    const paymentRuleSet = ruleSet()
    const ipRuleSet = ruleSet({
      id: 'ruleset-ip',
      code: 'IP',
      name: '知识产权',
      priority: 90,
    })
    const views = buildRuleSetViews([
      rule({ id: 'rule-payment', rule_set_id: paymentRuleSet.id, clause_category: 'payment' }),
      rule({
        id: 'rule-ip',
        code: 'R011',
        name: 'IP 归属',
        rule_set_id: ipRuleSet.id,
        clause_category: 'ip',
        target_field: 'ip_ownership',
        field_hints: ['知识产权', '归属'],
      }),
    ], [paymentRuleSet, ipRuleSet])
    const sections = buildRuleSetSections(views)

    expect(sections.find((section) => section.key === 'breach_liability')?.sets.map((set) => set.label))
      .toContain('付款与结算')
    expect(sections.find((section) => section.key === 'ip_security')?.sets.map((set) => set.label))
      .toContain('知识产权')
    expect(views[0].key).toBe('all')
  })

  it('does not let markdown or imported reference assets bypass rule-level publication gates', () => {
    const asset = ruleSet({
      id: 'ruleset-liability',
      code: 'LIABILITY',
      name: '责任边界',
      latest_document: {
        id: 'doc-1',
        org_id: 'org-1',
        rule_set_id: 'ruleset-liability',
        title: '责任边界声明',
        source_type: 'github_reference',
        source_uri: 'https://github.com/suoyidev/ones-internal-skills',
        content_markdown: '# 责任边界',
        content_hash: 'hash',
        version: 1,
        status: 'translated',
        translation_status: 'ready',
        translation_diff: null,
        translation_summary: null,
        created_by: null,
        updated_by: null,
        created_at: '2026-07-03T00:00:00.000Z',
        updated_at: '2026-07-03T00:00:00.000Z',
      },
    })
    const incompleteRule = rule({
      id: 'rule-liability',
      rule_set_id: asset.id,
      clause_category: 'liability',
      lifecycle_status: 'draft',
      translation_status: 'needs_ai_translation',
      target_field: null,
      semantic_prompt: null,
      message_template: null,
      published_at: null,
    })
    const liabilityView = buildRuleSetViews([incompleteRule], [asset])
      .find((view) => view.key === ruleSetKeyForAsset(asset.id))

    expect(liabilityView?.blocked).toBe(1)
    expect(ruleBlockingReasons(incompleteRule)).toEqual(expect.arrayContaining([
      '缺目标字段',
      '缺语义规则',
      '缺批注/谈判模板',
      '未完成转译',
      '未正式发布',
    ]))
    expect(isFormallyPublishedRule(incompleteRule)).toBe(false)
  })

  it('requires active published ready rules before formal review can use them', () => {
    const published = rule()
    const missingPublishedAt = rule({ id: 'rule-2', published_at: null })

    expect(isFormallyPublishedRule(published)).toBe(true)
    expect(isFormallyPublishedRule(missingPublishedAt)).toBe(false)
    expect(ruleBlockingReasons(missingPublishedAt)).toContain('缺发布时间')
  })

  it('accepts nested rule templates produced from rule-set assets', () => {
    const imported = rule({
      message_template: {
        levels: {
          level_a: '首期>=30%',
          level_b: '首期15-29%',
          level_c: '首期<15%',
        },
        outputs: {
          primary: 'word_native_comment',
          secondary: 'review_report',
          comment_author: 'ONES 业务运营',
        },
      },
      level_b_counterparty: '销售需围绕风险项取得对价或客户确认。',
    })

    expect(ruleBlockingReasons(imported)).not.toContain('缺批注/谈判模板')
    expect(isFormallyPublishedRule(imported)).toBe(true)
  })

  it('exposes a non-black-box RuleUnit execution summary', () => {
    const summary = ruleExecutionSummary(rule())

    expect(summary.map((item) => item.label)).toEqual([
      '触发条件',
      '风险条件',
      '例外条件',
      '证据要求',
      '谈判动作',
      '批注模板',
    ])
    expect(summary.find((item) => item.label === '证据要求')?.value).toContain('evidence_text exact match')
    expect(summary.find((item) => item.label === '谈判动作')?.value).toContain('客户确认')
  })
})
