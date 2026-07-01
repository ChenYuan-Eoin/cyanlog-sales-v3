import { describe, expect, it } from 'vitest'
import {
  isModelPolicyCurrentForPublishedProviders,
  selectReviewExecutionProvider,
  type ContractModelPolicy,
  type ModelPolicyProvider,
} from './model-policy'
import type { PublishedAIProviderConfig } from '@/lib/configs/runtime'

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

function publishedProvider(overrides: Partial<PublishedAIProviderConfig> = {}): PublishedAIProviderConfig {
  return {
    config_id: '11111111-1111-4111-8111-111111111111',
    key: 'AI_LEVEL_2',
    display_name: '云端模型',
    level: 2,
    name: '云端模型',
    profile: 'sales_cloud_backup',
    provider_kind: 'openai_compatible',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    api_key: 'test-key',
    model: 'gemini-3.5-flash',
    timeout_ms: 20000,
    enabled: true,
    routing: {
      max_pages: 80,
      strategy: 'chunked',
    },
    ...overrides,
  }
}

function publishedRuleProvider(): PublishedAIProviderConfig {
  return {
    config_id: '22222222-2222-4222-8222-222222222222',
    key: 'AI_LEVEL_3',
    display_name: '规则引擎',
    level: 3,
    name: '规则引擎',
    profile: 'rule_engine',
    provider_kind: 'builtin',
    base_url: '',
    api_key: undefined,
    model: 'rule-engine',
    timeout_ms: 15000,
    enabled: true,
    routing: {
      max_pages: 999,
      strategy: 'rule',
    },
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

describe('isModelPolicyCurrentForPublishedProviders', () => {
  it('accepts a policy generated from the current published providers', () => {
    const currentProvider: ModelPolicyProvider = {
      ...aiProvider,
      profile: 'sales_cloud_backup',
      model: 'gemini-3.5-flash',
      level: 2,
      timeout_ms: 20000,
      capabilities: ['semantic_clause_review', 'comment_patch_draft', 'report_summary'],
      routing: {
        max_pages: 80,
        strategy: 'chunked',
      },
    }
    const currentRuleProvider: ModelPolicyProvider = {
      ...ruleProvider,
      level: 3,
      source_config_id: '22222222-2222-4222-8222-222222222222',
      capabilities: ['deterministic_rule_scan', 'fallback_without_external_model'],
      routing: {
        max_pages: 999,
        strategy: 'rule',
      },
    }
    const currentPolicy = {
      ...policy([currentProvider, currentRuleProvider]),
      source_config_ids: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    }

    expect(
      isModelPolicyCurrentForPublishedProviders(currentPolicy, [
        publishedProvider(),
        publishedRuleProvider(),
      ])
    ).toBe(true)
  })

  it('rejects a stale policy when the published provider model changed', () => {
    const stalePolicy = {
      ...policy([aiProvider, { ...ruleProvider, level: 3 }]),
      source_config_ids: ['11111111-1111-4111-8111-111111111111'],
    }

    expect(isModelPolicyCurrentForPublishedProviders(stalePolicy, [publishedProvider()])).toBe(false)
  })
})
