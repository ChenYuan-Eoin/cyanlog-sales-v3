import { describe, expect, it } from 'vitest'
import {
  selectReviewExecutionProvider,
  type ContractModelPolicy,
  type ModelPolicyProvider,
} from './model-policy'

const ruleProvider: ModelPolicyProvider = {
  profile: 'rule_engine',
  provider_kind: 'builtin',
  provider: 'rule-engine',
  model: 'rule-engine',
  level: 99,
  timeout_ms: 15000,
  stages: ['structured_rules', 'rule_fallback'],
  role: 'fallback',
  capabilities: ['deterministic_rule_scan'],
  data_boundary: 'rules_only',
  health_check_required: false,
  routing: {
    max_pages: 1,
    strategy: 'rule',
  },
  source_config_id: null,
}

const aiProvider: ModelPolicyProvider = {
  profile: 'sales_cloud',
  provider_kind: 'openai_compatible',
  provider: 'openai-compatible',
  model: 'qwen-plus',
  level: 1,
  timeout_ms: 45000,
  stages: ['semantic_review', 'comment_patch_draft', 'report_summary'],
  role: 'primary',
  capabilities: ['semantic_clause_review'],
  data_boundary: 'contract_text_allowed',
  health_check_required: true,
  routing: {
    max_pages: 15,
    strategy: 'chunked',
  },
  source_config_id: '11111111-1111-4111-8111-111111111111',
}

function policy(providerChain: ModelPolicyProvider[]): ContractModelPolicy {
  return {
    id: 'policy-1',
    org_id: 'org-1',
    key: 'CONTRACT_REVIEW_DEFAULT',
    name: '合同审核默认模型策略',
    version: 1,
    status: 'published',
    is_current: true,
    provider_chain: providerChain,
    routing_policy: {},
    timeout_ms: 45000,
    fallback_policy: {},
    audit_policy: {},
    source_config_ids: [],
    published_at: '2026-07-01T00:00:00.000Z',
  }
}

describe('selectReviewExecutionProvider', () => {
  it('uses rule engine for structured rule execution even when AI providers exist', () => {
    const selected = selectReviewExecutionProvider(policy([aiProvider, ruleProvider]), 'structured_rules')
    expect(selected.provider).toBe('rule-engine')
    expect(selected.model).toBe('rule-engine')
  })

  it('uses the configured AI provider for semantic review stages', () => {
    const selected = selectReviewExecutionProvider(policy([aiProvider, ruleProvider]), 'semantic_review')
    expect(selected.provider_kind).toBe('openai_compatible')
    expect(selected.profile).toBe('sales_cloud')
  })

  it('falls back to rule engine when no AI provider can run the requested stage', () => {
    const selected = selectReviewExecutionProvider(policy([ruleProvider]), 'semantic_review')
    expect(selected.provider).toBe('rule-engine')
  })
})
