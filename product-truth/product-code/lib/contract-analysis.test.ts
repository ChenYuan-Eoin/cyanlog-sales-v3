import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getOrgIdForUser: vi.fn(),
  executeRules: vi.fn(),
  executeContractSemanticReview: vi.fn(),
  getSkillBundle: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/configs/runtime', () => ({ getOrgIdForUser: mocks.getOrgIdForUser }))
vi.mock('@/lib/rules/engine', () => ({ executeRules: mocks.executeRules }))
vi.mock('@/lib/ai/contract-semantic', () => ({
  executeContractSemanticReview: mocks.executeContractSemanticReview,
}))
vi.mock('@/lib/contracts/skill-bundle', () => ({
  getOrCompilePublishedContractSkillBundle: mocks.getSkillBundle,
}))
vi.mock('@/lib/error-log', () => ({ logError: vi.fn() }))

import { runStructuredAnalysis, saveStructuredReport } from './contract-analysis'

function query(result: unknown, capture?: (operation: string, payload: unknown) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    or: vi.fn(() => chain),
    is: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    delete: vi.fn(() => { capture?.('delete', null); return chain }),
    insert: vi.fn((payload: unknown) => { capture?.('insert', payload); return chain }),
    update: vi.fn((payload: unknown) => { capture?.('update', payload); return chain }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  return chain
}

function skillBundle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1', org_id: 'org-1', key: 'CONTRACT_REVIEW_DEFAULT', version: 1,
    status: 'published' as const, is_current: true,
    rule_snapshot_ids: ['snapshot-1', 'snapshot-2'],
    rule_set_snapshot_ids: ['ruleset-snapshot-1'], template_snapshot_ids: [],
    document_snapshot_ids: ['ruleset-document-1'], output_schema: {},
    model_policy_id: null,
    eval_case_ids: [], release_meta: {},
    compiled_from: {
      production_rule_source: { source_of_truth: 'config_center_published_rules' },
      rule_translation_gate: { status: 'ready', official_review_allowed: true },
      rule_set_document_gate: { status: 'ready' },
      eval_results: {
        rule_acceptance_status: 'passed',
        model_quality_eval_status: 'blocked_without_independent_gold',
      },
      rules: [
        {
          id: 'snapshot-1', rule_id: 'rule-1', code: 'R001', version: 2,
          clause_category: 'payment', target_field: 'first_payment_rate',
          field_hints: ['付款', '账期', '首付款'], execution_protocol: 'legacy_adapter',
        },
        {
          id: 'snapshot-2', rule_id: 'rule-2', code: 'R002', version: 1,
          clause_category: 'termination', target_field: 'termination_refund',
          field_hints: ['退款', '退还', '终止'], execution_protocol: 'legacy_adapter',
        },
      ],
    },
    compiled_hash: 'skill-hash', published_at: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

const contractText = [
  '第一条 付款条款：验收后付款。',
  '第二条 退款条款：客户可要求全额退款。',
  '第三条 验收条款：乙方提交成果后，如甲方3日内未提出异议，视为验收通过。',
].join('\n')

function semanticResult(overrides: Record<string, unknown> = {}) {
  return {
    risks: [{
      ruleCode: 'R002', ruleVersion: 1, level: 'red', title: '语义风险',
      description: '存在宽泛退款承诺', suggestion: '删除全额退款承诺',
      evidence: ['客户可要求全额退款'],
    }],
    summary: '语义审核完成', provider: 'provider-cloud', model: 'model-cloud',
    degraded: false, validationWarnings: [], droppedRiskCount: 0,
    inputStats: {
      original_text_length: contractText.length, submitted_text_length: contractText.length,
      estimated_page_count: 1, total_chunk_count: 1, selected_chunk_count: 1,
      character_coverage_ratio: 1, selection_strategy: 'full_text', coverage_limited: false,
    },
    invocationId: 'invocation-semantic', invocationIds: ['invocation-semantic'],
    planSnapshotId: 'plan-snapshot-1', planSnapshotHash: 'a'.repeat(64),
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, evidence: 'provider' },
    attempts: [],
    ...overrides,
  }
}

describe('runStructuredAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOrgIdForUser.mockResolvedValue('org-1')
    mocks.getSkillBundle.mockResolvedValue(skillBundle())
    mocks.executeRules.mockResolvedValue({
      risks: [{
        ruleCode: 'R001', level: 'yellow', title: '付款风险',
        description: '首付款比例偏低', suggestion: '提高首付款比例',
        evidence: ['第一条 付款条款：验收后付款。'],
      }],
      summary: '规则审核完成', appliedRules: 15, matchedRules: 1,
    })
    mocks.executeContractSemanticReview.mockResolvedValue(semanticResult())
    mocks.from.mockImplementation((table: string) => {
      if (table === 'contracts') {
        return query({ data: { parsed_text: contractText, filename: 'contract.docx', created_by: 'u-1' }, error: null })
      }
      if (table === 'clause_library') return query({ data: [], error: null })
      return query({ data: null, error: null })
    })
  })

  it('merges rules with a validated six-object semantic run and binds only real invocations', async () => {
    const report = await runStructuredAnalysis('contract-1', {
      reviewId: 'review-1', requestedBy: 'u-1', reviewTrigger: 'manual_rerun',
    })

    expect(mocks.executeContractSemanticReview).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1',
      skillBundleId: 'skill-1', contractText,
      skillContext: expect.objectContaining({
        rules: expect.arrayContaining([expect.objectContaining({ code: 'R001', version: 2 })]),
      }),
    }))
    expect(report.result.risks).toHaveLength(2)
    expect(report.result.provider).toBe('rule-engine+provider-cloud')
    expect(report.result.summary).toContain('语义审核（provider-cloud/model-cloud）')
    expect(report.runtime).toMatchObject({
      model_policy_id: null,
      plan_snapshot_id: 'plan-snapshot-1',
      model_invocation_ids: ['invocation-semantic'],
      model: 'model-cloud',
    })
  })

  it('pins only an exact ModelCatalogEntry asset for controlled comparison', async () => {
    await runStructuredAnalysis('contract-1', {
      reviewId: 'review-1', semanticModelAssetId: 'model-catalog-backup',
    })

    expect(mocks.executeContractSemanticReview).toHaveBeenCalledWith(expect.objectContaining({
      pinModelAssetId: 'model-catalog-backup',
    }))
  })

  it('runs the configured model independently while an unready rule bundle degrades official review', async () => {
    mocks.getSkillBundle.mockResolvedValueOnce(skillBundle({
      status: 'compiled', is_current: false,
      compiled_from: {
        rule_translation_gate: { status: 'needs_ai_translation', official_review_allowed: false },
        rule_set_document_gate: { status: 'ready' },
        eval_results: {
          rule_acceptance_status: 'failed',
          model_quality_eval_status: 'blocked_without_independent_gold',
        },
        rules: [],
      },
    }))

    const report = await runStructuredAnalysis('contract-1')

    expect(mocks.executeContractSemanticReview).toHaveBeenCalledOnce()
    expect(report.result.provider).toBe('rule-engine+provider-cloud')
    expect(report.result.degraded).toBe(true)
    expect(report.result.degradationReasons).toEqual(expect.arrayContaining([
      'skill_bundle_not_published',
      'skill_bundle_not_current',
      'rule_translation_not_ready',
      'skill_eval_not_passed',
    ]))
    expect(report.runtime?.model_invocation_ids).toEqual(['invocation-semantic'])
  })

  it('still runs the platform model when rule bundle compilation itself fails', async () => {
    mocks.getSkillBundle.mockRejectedValueOnce(new Error('RULESET_CURRENT_RULE_SNAPSHOT_INVALID'))
    mocks.executeRules.mockResolvedValueOnce({
      risks: [], summary: '规则审核不可用', appliedRules: 0, matchedRules: 0,
    })

    const report = await runStructuredAnalysis('contract-1', { reviewId: 'review-1' })

    expect(mocks.executeContractSemanticReview).toHaveBeenCalledWith(expect.objectContaining({
      skillBundleId: null,
      skillContext: expect.objectContaining({ rules: [] }),
    }))
    expect(report.result.provider).toBe('rule-engine+provider-cloud')
    expect(report.result.degradationReasons).toEqual(expect.arrayContaining([
      'skill_not_applied',
      'skill_bundle_load_failed',
      'rule_engine_no_rules_applied',
    ]))
    expect(report.runtime).toMatchObject({
      skill_bundle_id: null,
      plan_snapshot_id: 'plan-snapshot-1',
      model_invocation_ids: ['invocation-semantic'],
      rule_snapshot_ids: [],
    })
  })

  it('keeps model invocation truth even when a valid semantic run finds zero risks', async () => {
    mocks.executeContractSemanticReview.mockResolvedValueOnce(semanticResult({ risks: [] }))

    const report = await runStructuredAnalysis('contract-1', { reviewId: 'review-1' })

    expect(report.result.provider).toBe('rule-engine+provider-cloud')
    expect(report.runtime?.model).toBe('model-cloud')
    expect(report.runtime?.model_invocation_ids).toEqual(['invocation-semantic'])
  })

  it('keeps a validated fallback-model result but reports route degradation', async () => {
    mocks.executeContractSemanticReview.mockResolvedValueOnce(semanticResult({
      provider: 'provider-backup', model: 'model-backup', degraded: true,
      invocationIds: ['invocation-primary-failed', 'invocation-backup'],
    }))

    const report = await runStructuredAnalysis('contract-1', { reviewId: 'review-1' })

    expect(report.result.risks).toHaveLength(2)
    expect(report.result.degradationReasons).toContain('semantic_review_route_fallback')
    expect(report.runtime?.model_invocation_ids).toEqual([
      'invocation-primary-failed', 'invocation-backup',
    ])
  })

  it('degrades when a red or yellow finding cannot bind to source text', async () => {
    mocks.executeContractSemanticReview.mockResolvedValueOnce(semanticResult({
      risks: [{
        ruleCode: 'R002', level: 'red', title: '无法定位', description: '风险',
        suggestion: '处理', evidence: ['原文不存在的片段'],
      }],
    }))

    const report = await runStructuredAnalysis('contract-1', { reviewId: 'review-1' })

    expect(report.result.degraded).toBe(true)
    expect(report.result.degradationReasons).toContain('source_location_unbound')
  })

  it('has no old failover, ModelPolicy or fabricated structured model invocation path', () => {
    const source = readFileSync(join(process.cwd(), 'lib/contract-analysis.ts'), 'utf8')
    expect(source).not.toContain("@/lib/ai/failover")
    expect(source).not.toContain("@/lib/contracts/model-policy")
    expect(source).not.toContain('recordModelInvocation')
    expect(source).not.toContain("phase: 'structured_rules'")
  })
})

describe('saveStructuredReport', () => {
  it('persists rule evidence, the immutable plan pointer, and real invocation ids', async () => {
    let insertedRiskRows: unknown
    let reviewUpdate: unknown
    mocks.from.mockImplementation((table: string) => query({ data: [], error: null }, (operation, payload) => {
      if (table === 'contract_risk_cards' && operation === 'insert') insertedRiskRows = payload
      if (table === 'contract_reviews' && operation === 'update') reviewUpdate = payload
    }))

    await saveStructuredReport('review-1', 'contract-1', {
      result: {
        risks: [{
          ruleId: 'rule-1', ruleCode: 'PAYMENT_MINIMUM', ruleVersion: 4,
          decisionId: 'below_minimum',
          propertyReadings: [{
            propertyKey: 'contract_amount', status: 'read', value: 40_000,
            unit: 'CNY', evidence: '合同金额为4万元', confidence: 0.98,
          }],
          level: 'red', title: '合同金额低于最低标准',
          description: '合同金额为4万元，低于5万元。', suggestion: '转人工复核并调整金额。',
          evidence: ['合同金额为4万元'],
        }],
        summary: '命中1条规则', appliedRules: 1, matchedRules: 1,
        provider: 'rule-engine+provider-cloud', degraded: false,
      },
      risk_summary: {
        total_clauses: 1, critical_risks: 1, high_risks: 0,
        medium_risks: 0, low_risks: 0, compliance_score: 75,
      },
      compliance_check: {
        missing_required_clauses: [], dangerous_clauses: [], ambiguous_clauses: [],
        unbalanced_clauses: [], party_a_consistency: 'unknown', party_b_consistency: 'unknown', issues: [],
      },
      effectiveness_analysis: '需要复核', clauses: [], source_text: '第一条 合同金额为4万元。',
      runtime: {
        skill_bundle_id: 'skill-1', model_policy_id: null,
        plan_snapshot_id: 'plan-snapshot-1', plan_snapshot_hash: 'a'.repeat(64),
        rule_snapshot_ids: ['snapshot-1'], rule_set_snapshot_ids: ['ruleset-snapshot-1'],
        rule_set_document_ids: [],
        rule_snapshot_refs: [{ id: 'snapshot-1', rule_id: 'rule-1', code: 'PAYMENT_MINIMUM', version: 4 }],
        model_invocation_ids: ['invocation-1'], provider: 'rule-engine+provider-cloud', model: 'model-cloud',
      },
    })

    expect(insertedRiskRows).toEqual([
      expect.objectContaining({
        rule_id: 'rule-1',
        evidence: expect.objectContaining({
          rule_snapshot_id: 'snapshot-1', decision_id: 'below_minimum',
          property_readings: [expect.objectContaining({ propertyKey: 'contract_amount', value: 40_000 })],
        }),
      }),
    ])
    expect(reviewUpdate).toEqual(expect.objectContaining({
      model_policy_id: null,
      plan_snapshot_id: 'plan-snapshot-1',
      model_invocation_ids: ['invocation-1'],
    }))
  })
})
