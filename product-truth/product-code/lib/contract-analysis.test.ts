import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/configs/runtime', () => ({
  getOrgIdForUser: vi.fn(),
}))

vi.mock('@/lib/rules/engine', () => ({
  executeRules: vi.fn(),
}))

vi.mock('@/lib/ai/failover', () => ({
  reviewWithFailoverSync: vi.fn(),
}))

vi.mock('@/lib/contracts/skill-bundle', () => ({
  getOrCompilePublishedContractSkillBundle: vi.fn(),
}))

vi.mock('@/lib/contracts/model-policy', () => ({
  recordModelInvocation: vi.fn(),
  selectReviewExecutionProvider: vi.fn(),
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

import { runStructuredAnalysis } from './contract-analysis'
import { getOrgIdForUser } from '@/lib/configs/runtime'
import { executeRules } from '@/lib/rules/engine'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import { getOrCompilePublishedContractSkillBundle } from '@/lib/contracts/skill-bundle'
import { recordModelInvocation, selectReviewExecutionProvider } from '@/lib/contracts/model-policy'
import type { ModelPolicyProvider } from '@/lib/contracts/model-policy'
import { supabaseAdmin } from '@/lib/supabase'

const ruleProvider: ModelPolicyProvider = {
  profile: 'rule_engine',
  provider_kind: 'builtin' as const,
  provider: 'rule-engine',
  model: 'rule-engine',
  level: 99,
  timeout_ms: 15000,
  stages: ['structured_rules', 'rule_fallback'],
  role: 'fallback' as const,
  capabilities: ['deterministic_rule_scan'],
  data_boundary: 'rules_only' as const,
  health_check_required: false,
  routing: {
    max_pages: 1,
    strategy: 'rule' as const,
  },
  source_config_id: null,
}

const semanticProvider: ModelPolicyProvider = {
  profile: 'sales_cloud',
  provider_kind: 'openai_compatible' as const,
  provider: 'openai-compatible',
  model: 'gpt-review',
  level: 1,
  timeout_ms: 45000,
  stages: ['semantic_review', 'comment_patch_draft', 'report_summary'],
  role: 'primary' as const,
  capabilities: ['semantic_clause_review'],
  data_boundary: 'contract_text_allowed' as const,
  health_check_required: true,
  routing: {
    max_pages: 15,
    strategy: 'chunked' as const,
  },
  source_config_id: 'config-ai-1',
}

function makeThenableQuery(result: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    or: vi.fn(() => query),
    is: vi.fn(() => query),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  return query
}

describe('runStructuredAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(getOrgIdForUser).mockResolvedValue('org-1')
    vi.mocked(getOrCompilePublishedContractSkillBundle).mockResolvedValue({
      id: 'skill-1',
      org_id: 'org-1',
      key: 'CONTRACT_REVIEW_DEFAULT',
      version: 1,
      status: 'published',
      is_current: true,
      rule_snapshot_ids: ['snapshot-1'],
      template_snapshot_ids: [],
      output_schema: {},
      model_policy_id: 'policy-1',
      model_policy: {
        id: 'policy-1',
        org_id: 'org-1',
        key: 'CONTRACT_REVIEW_DEFAULT',
        name: '合同审核默认模型策略',
        version: 1,
        status: 'published',
        is_current: true,
        provider_chain: [],
        routing_policy: {},
        timeout_ms: 45000,
        fallback_policy: {},
        audit_policy: {},
        source_config_ids: [],
        published_at: null,
      },
      eval_case_ids: [],
      release_meta: {},
      compiled_from: {
        external_skill_source: {
          repo: 'suoyidev/ones-internal-skills',
          commit: 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
        },
        rules: [
          {
            id: 'snapshot-1',
            rule_id: 'rule-1',
            code: 'R001',
            version: 2,
            clause_category: 'payment',
            target_field: 'first_payment_rate',
            field_hints: ['付款', '账期', '首付款'],
          },
          {
            id: 'snapshot-2',
            rule_id: 'rule-2',
            code: 'R002',
            version: 1,
            clause_category: 'termination',
            target_field: 'termination_refund',
            field_hints: ['退款', '退还', '终止'],
          },
          {
            id: 'snapshot-4',
            rule_id: 'rule-4',
            code: 'R004',
            version: 2,
            clause_category: 'acceptance',
            target_field: 'acceptance_silent_days',
            field_hints: ['验收', '默示验收', '视为验收'],
          },
          {
            id: 'snapshot-11',
            rule_id: 'rule-11',
            code: 'R011',
            version: 2,
            clause_category: 'ip',
            target_field: 'ip_ownership_clause',
            field_hints: ['知识产权', '源代码', '二次开发'],
          },
        ],
      },
      compiled_hash: 'hash-1',
      published_at: null,
    })
    vi.mocked(selectReviewExecutionProvider).mockImplementation((_, stage) => (
      stage === 'semantic_review' ? semanticProvider : ruleProvider
    ))
    vi.mocked(executeRules).mockResolvedValue({
      risks: [{
        ruleCode: 'R001',
        level: 'yellow',
        title: '付款风险',
        description: '首付款比例偏低',
        suggestion: '提高首付款比例',
        evidence: ['第一条 付款条款：验收后付款。'],
      }],
      summary: '规则审核完成',
      appliedRules: 15,
      matchedRules: 1,
    })
    vi.mocked(reviewWithFailoverSync).mockResolvedValue({
      risks: [{
        ruleCode: 'R002',
        ruleVersion: 1,
        level: 'red',
        title: '语义风险',
        description: '存在宽泛退款承诺',
        suggestion: '删除全额退款承诺',
        evidence: ['客户可要求全额退款'],
      }],
      summary: '语义审核完成',
      provider: 'AI_LEVEL_2',
      model: 'gpt-review',
      providerKind: 'openai_compatible',
      degraded: false,
    })
    vi.mocked(recordModelInvocation)
      .mockResolvedValueOnce({ id: 'invocation-semantic' })
      .mockResolvedValueOnce({ id: 'invocation-structured' })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'contracts') {
        return makeThenableQuery({
          data: {
            parsed_text: '第一条 付款条款：验收后付款。\n第二条 退款条款：客户可要求全额退款。\n第三条 验收条款：乙方提交成果后，如甲方3日内未提出异议，视为验收通过。',
            filename: 'contract.docx',
            created_by: 'u-1',
          },
          error: null,
        })
      }
      if (table === 'clause_library') {
        return makeThenableQuery({ data: [], error: null })
      }
      return makeThenableQuery({ data: null, error: null })
    })
  })

  it('runs semantic review through the model policy and merges successful AI risks', async () => {
    const report = await runStructuredAnalysis('contract-1', {
      reviewId: 'review-1',
      requestedBy: 'u-1',
      reviewTrigger: 'manual_rerun',
    })

    expect(reviewWithFailoverSync).toHaveBeenCalledWith(expect.any(String), {
      orgId: 'org-1',
      preferredProvider: 'sales_cloud',
      skillContext: expect.objectContaining({
        source: expect.objectContaining({
          repo: 'suoyidev/ones-internal-skills',
          commit: 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
        }),
        rules: expect.arrayContaining([
          expect.objectContaining({
            code: 'R001',
            version: 2,
            clause_category: 'payment',
            target_field: 'first_payment_rate',
            field_hints: ['付款', '账期', '首付款'],
          }),
          expect.objectContaining({
            code: 'R002',
            version: 1,
            clause_category: 'termination',
            target_field: 'termination_refund',
            field_hints: ['退款', '退还', '终止'],
          }),
        ]),
      }),
    }, 1)
    expect(report.result.risks).toHaveLength(2)
    expect(report.result.provider).toBe('rule-engine+AI_LEVEL_2')
    expect(report.result.degraded).toBe(false)
    expect(report.result.summary).toContain('语义审核（AI_LEVEL_2/gpt-review）')
    expect(report.runtime?.model_invocation_ids).toEqual([
      'invocation-structured',
      'invocation-semantic',
    ])
  })

  it('degrades the review when a red or yellow risk cannot bind to source text', async () => {
    vi.mocked(executeRules).mockResolvedValueOnce({
      risks: [{
        ruleCode: 'R011',
        level: 'red',
        title: 'IP 归属',
        description: 'IP 归属缺失或未明确',
        suggestion: '必须修改合同条款',
      }],
      summary: '发现未定位风险',
      appliedRules: 15,
      matchedRules: 1,
    })
    vi.mocked(reviewWithFailoverSync).mockResolvedValueOnce({
      risks: [],
      summary: '无额外语义风险',
      provider: 'AI_LEVEL_2',
      model: 'gpt-review',
      providerKind: 'openai_compatible',
      degraded: false,
    })

    const report = await runStructuredAnalysis('contract-1', {
      reviewId: 'review-1',
      requestedBy: 'u-1',
      reviewTrigger: 'manual_rerun',
    })

    expect(report.result.degraded).toBe(true)
    expect(report.result.degradationReasons).toContain('source_location_unbound')
    expect(recordModelInvocation).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'structured_rules',
      status: 'degraded',
      degraded: true,
      fallbackReason: 'source_location_unbound',
      responseMeta: expect.objectContaining({
        unlocated_commentable_risk_count: 1,
      }),
    }))
  })

  it('deduplicates rule and semantic findings by business rule code and keeps the stronger sourced finding', async () => {
    vi.mocked(executeRules).mockResolvedValueOnce({
      risks: [{
        ruleCode: 'R004',
        level: 'yellow',
        title: '默示验收期',
        description: '默示验收期偏离建议区间',
        suggestion: '建议协商调整',
      }],
      summary: '发现旧规则命中',
      appliedRules: 15,
      matchedRules: 1,
    })
    vi.mocked(reviewWithFailoverSync).mockResolvedValueOnce({
      risks: [{
        ruleCode: 'R004@v2',
        ruleVersion: 2,
        level: 'red',
        title: '验收周期过短',
        description: '验收周期过短，可能导致甲方无法充分评估成果质量。',
        suggestion: '建议将验收周期延长至 15 个工作日。',
        evidence: ['第三条 验收条款：乙方提交成果后，如甲方3日内未提出异议，视为验收通过。'],
      }],
      summary: '语义审核完成',
      provider: 'AI_LEVEL_2',
      model: 'gpt-review',
      providerKind: 'openai_compatible',
      degraded: false,
    })

    const report = await runStructuredAnalysis('contract-1', {
      reviewId: 'review-1',
      requestedBy: 'u-1',
      reviewTrigger: 'manual_rerun',
    })

    expect(report.result.risks).toHaveLength(1)
    expect(report.result.risks[0]).toMatchObject({
      ruleCode: 'R004@v2',
      level: 'red',
      title: '验收周期过短',
    })
    expect(report.result.degraded).toBe(false)
  })
})
