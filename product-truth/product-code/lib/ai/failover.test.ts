import { describe, expect, it } from 'vitest'
import {
  buildFactsOnlySystemPromptForTest,
  buildReviewSystemPromptForTest,
  buildSyncResponseFormatForTest,
  describeProviderRuntimeReadiness,
  getProviderFinishReasonForTest,
  getProviderResponseTextForTest,
  providerModelListIncludesForTest,
  reviewWithFailover,
  reviewWithFailoverSync,
  resolveFrozenProviderChainForTest,
  resolveProviderChainForTest,
  resolveStructuredProviderChainForTest,
  type AIProvider,
} from './failover'
import type { PublishedAIToolPolicyConfig } from '@/lib/configs/runtime'
import type { PublishedReviewRule } from '@/lib/contracts/review-workbench'
import { getAIProviderRuntimeSignature } from './provider-probe'

function provider(
  id: string,
  level: number,
  options: {
    kind?: AIProvider['providerKind']
    baseUrl?: string
    strategy?: NonNullable<AIProvider['config']['routing']>['strategy']
    capabilities?: string[]
    boundApps?: string[]
    fallbackChain?: string[]
    apiKey?: string
    enabled?: boolean
  } = {}
): AIProvider {
  const kind = options.kind || 'openai_compatible'

  return {
    id,
    name: id,
    timeout: 1000,
    providerKind: kind,
    config: {
      config_id: `${id}-config`,
      key: id,
      instance_id: id,
      display_name: id,
      level,
      name: id,
      profile: id,
      provider_kind: kind === 'builtin' ? 'rule_engine' : 'openai_compatible',
      base_url: options.baseUrl || 'https://cloud.example/v1',
      api_key: options.apiKey,
      model: kind === 'builtin' ? 'rule-engine' : `${id}-model`,
      timeout_ms: 1000,
      enabled: options.enabled ?? true,
      capabilities: options.capabilities,
      bound_apps: options.boundApps,
      fallback_chain: options.fallbackChain,
      routing: {
        max_pages: 20,
        strategy: options.strategy || 'full',
      },
    },
  }
}

describe('resolveProviderChainForTest', () => {
  const local = provider('local_primary', 1, {
    baseUrl: 'http://127.0.0.1:1234/v1',
    capabilities: ['contract_review', 'rule_semantic_eval', 'comment_patch', 'report_summary'],
    boundApps: ['contract_review', 'comment_patch', 'report_summary'],
    fallbackChain: ['sales_cloud_backup', 'rule_engine'],
  })
  const cloud = provider('sales_cloud_backup', 2, {
    baseUrl: 'https://cloud.yiyongai.cn/v1',
    strategy: 'chunked',
    capabilities: ['contract_review', 'long_text', 'contract_draft', 'contract_compare', 'rule_translation'],
    boundApps: ['contract_review', 'contract_draft', 'contract_compare', 'tender_parse', 'rule_translation'],
    fallbackChain: ['rule_engine'],
  })
  const rule = provider('rule_engine', 3, {
    kind: 'builtin',
    strategy: 'rule',
    capabilities: ['deterministic_rule_scan'],
    boundApps: ['contract_compare', 'rule_translation'],
  })

  it('routes normal contract review to the local-capable provider first', () => {
    expect(resolveProviderChainForTest([local, cloud, rule], 'short contract', {
      tool: 'contract_review',
      capability: 'contract_review',
    })).toEqual(['local_primary', 'sales_cloud_backup', 'rule_engine'])
  })

  it('routes contract comparison to a provider that declares compare and long-text capability', () => {
    expect(resolveProviderChainForTest([local, cloud, rule], 'long compare text'.repeat(400), {
      tool: 'contract_compare',
      capability: 'long_text',
    })[0]).toBe('sales_cloud_backup')
  })

  it('honors a provider fallback chain before appending remaining providers', () => {
    const chain = resolveProviderChainForTest([cloud, rule, local], 'short contract', {
      tool: 'contract_review',
      capability: 'contract_review',
      preferredProvider: 'local_primary',
    })

    expect(chain).toEqual(['local_primary', 'sales_cloud_backup', 'rule_engine'])
  })

  it('does not pick the rule engine as AI review when an AI model matches the capability', () => {
    const eagerRule = provider('rule_engine', 1, {
      kind: 'builtin',
      strategy: 'rule',
      capabilities: ['deterministic_rule_scan'],
    })

    expect(resolveProviderChainForTest([eagerRule, local], 'short contract', {
      tool: 'contract_review',
      capability: 'contract_review',
    })[0]).toBe('local_primary')
  })

  it('can route deterministic checks to the rule engine when the task asks for it', () => {
    expect(resolveProviderChainForTest([local, cloud, rule], 'short text', {
      tool: 'rule_translation',
      capability: 'deterministic_rule_scan',
    })[0]).toBe('rule_engine')
  })

  it('routes each product tool to its configured first provider instead of a hard-coded tier', () => {
    const scenarios = [
      { tool: 'contract_review', capability: 'contract_review', first: 'local_primary' },
      { tool: 'contract_compare', capability: 'long_text', first: 'sales_cloud_backup' },
      { tool: 'contract_draft', capability: 'long_text', first: 'sales_cloud_backup' },
      { tool: 'tender_parse', capability: 'long_text', first: 'sales_cloud_backup' },
      { tool: 'rule_translation', capability: 'rule_translation', first: 'sales_cloud_backup' },
      { tool: 'comment_patch', capability: 'comment_patch', first: 'local_primary' },
      { tool: 'report_summary', capability: 'report_summary', first: 'local_primary' },
    ]

    for (const scenario of scenarios) {
      expect(resolveProviderChainForTest([local, cloud, rule], 'long product text'.repeat(300), {
        tool: scenario.tool,
        capability: scenario.capability,
      })[0]).toBe(scenario.first)
    }
  })
})

describe('resolveStructuredProviderChainForTest', () => {
  const local = provider('local_primary', 1, { baseUrl: 'http://127.0.0.1:1234/v1' })
  const cloud = provider('cloud_primary', 2, { baseUrl: 'https://cloud.example/v1' })
  const unrelated = provider('unrelated_provider', 3, { baseUrl: 'https://other.example/v1' })
  const rule = provider('rule_engine', 4, { kind: 'builtin', strategy: 'rule' })
  const policy: PublishedAIToolPolicyConfig = {
    kind: 'tool_policy',
    config_id: 'policy-id',
    key: 'contract_review_local_first',
    display_name: 'Contract review local first',
    name: 'Contract review local first',
    enabled: true,
    tool: 'contract_review',
    capability: 'contract_review',
    strategy: 'local_first',
    priority: 10,
    provider_chain: ['local_primary'],
    fallback_chain: ['cloud_primary', 'rule_engine'],
    timeout_ms: 30_000,
    conditions: {
      max_pages: 20,
      document_formats: ['docx'],
      sensitive_data: 'allow_cloud',
    },
  }

  it('uses only the explicit primary and fallback chain', () => {
    const result = resolveStructuredProviderChainForTest(
      [local, cloud, unrelated, rule],
      policy,
      'contract text',
      {
        tool: 'contract_review',
        capability: 'contract_review',
        documentFormat: 'docx',
        sensitiveData: 'allow_cloud',
      }
    )

    expect(result.matches).toBe(true)
    expect(result.chain).toEqual(['local_primary', 'cloud_primary', 'rule_engine'])
    expect(result.chain).not.toContain('unrelated_provider')
  })

  it('does not match a policy outside its document boundary', () => {
    const result = resolveStructuredProviderChainForTest(
      [local, cloud, rule],
      policy,
      'contract text',
      {
        tool: 'contract_review',
        capability: 'contract_review',
        documentFormat: 'pdf',
        sensitiveData: 'allow_cloud',
      }
    )

    expect(result.matches).toBe(false)
  })
})

describe('resolveFrozenProviderChainForTest', () => {
  const local = provider('local_primary', 1, { baseUrl: 'http://127.0.0.1:1234/v1' })
  const cloud = provider('cloud_primary', 2, { baseUrl: 'https://cloud.example/v1' })
  const rule = provider('rule_engine', 3, { kind: 'builtin', strategy: 'rule' })
  const frozenPolicy = {
    id: 'policy-id',
    version: 1,
    timeout_ms: 45_000,
    provider_chain: [
      {
        level: 1,
        profile: 'local_primary',
        model: 'local_primary-model',
        provider_kind: 'openai_compatible',
        source_config_id: 'local_primary-config',
        stages: ['semantic_review'],
      },
      {
        level: 2,
        profile: 'cloud_primary',
        model: 'cloud_primary-model',
        provider_kind: 'openai_compatible',
        source_config_id: 'cloud_primary-config',
        stages: ['semantic_review'],
      },
      {
        level: 3,
        profile: 'rule_engine',
        model: 'rule-engine',
        provider_kind: 'builtin',
        source_config_id: null,
        stages: ['semantic_review'],
      },
    ],
  }

  it('uses the exact frozen config and model order', () => {
    expect(resolveFrozenProviderChainForTest([cloud, rule, local], frozenPolicy, {
      phase: 'semantic_review',
      modelPolicyId: 'policy-id',
    })).toEqual(['local_primary', 'cloud_primary', 'rule_engine'])
  })

  it('rejects a live provider whose model drifted from the frozen policy', () => {
    const drifted = provider('local_primary', 1, { baseUrl: 'http://127.0.0.1:1234/v1' })
    drifted.config.model = 'different-model'

    expect(() => resolveFrozenProviderChainForTest([drifted, cloud, rule], frozenPolicy, {
      phase: 'semantic_review',
      modelPolicyId: 'policy-id',
    })).toThrow(/配置或模型已漂移/)
  })

  it('rejects a ReviewRun bound to a different model policy', () => {
    expect(() => resolveFrozenProviderChainForTest([local, cloud, rule], frozenPolicy, {
      phase: 'semantic_review',
      modelPolicyId: 'other-policy',
    })).toThrow(/模型策略 ID 与冻结策略不一致/)
  })
})

describe('describeProviderRuntimeReadiness', () => {
  it('marks local providers without a key as probe-required instead of verified ready', () => {
    const status = describeProviderRuntimeReadiness(provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    }))

    expect(status.status).toBe('needs_probe')
    expect(status.warnings).toContain('missing_api_key_probe_required')
    expect(status.hasApiKey).toBe(false)
  })

  it('marks cloud providers without a key as misconfigured', () => {
    const status = describeProviderRuntimeReadiness(provider('sales_cloud_backup', 2, {
      baseUrl: 'https://cloud.yiyongai.cn/v1',
    }))

    expect(status.status).toBe('misconfigured')
    expect(status.blockingReasons).toContain('missing_api_key')
  })

  it('does not present the rule engine as an AI model provider', () => {
    const status = describeProviderRuntimeReadiness(provider('rule_engine', 3, {
      kind: 'builtin',
      strategy: 'rule',
    }))

    expect(status.status).toBe('rule_engine')
    expect(status.warnings).toContain('rule_engine_is_deterministic_fallback_not_ai_model')
  })

  it('marks a provider ready only after a matching successful inference probe', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    const status = describeProviderRuntimeReadiness(configured, {
      providerKey: configured.id,
      model: configured.config.model,
      status: 'completed',
      runtimeSignature: getAIProviderRuntimeSignature(configured.config),
      latencyMs: 1200,
      usage: { totalTokens: 12 },
      checkedAt: '2026-07-13T08:00:00.000Z',
    }, Date.parse('2026-07-13T09:00:00.000Z'))

    expect(status.status).toBe('ready')
    expect(status.lastProbe?.usage?.totalTokens).toBe(12)
  })

  it('marks a matching failed inference probe unavailable', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    const status = describeProviderRuntimeReadiness(configured, {
      providerKey: configured.id,
      model: configured.config.model,
      status: 'failed',
      runtimeSignature: getAIProviderRuntimeSignature(configured.config),
      error: 'model_load_failed',
      checkedAt: '2026-07-13T08:00:00.000Z',
    }, Date.parse('2026-07-13T09:00:00.000Z'))

    expect(status.status).toBe('unavailable')
    expect(status.warnings).toContain('inference_probe_failed')
  })

  it('requires another probe when the evidence belongs to another runtime config', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    const status = describeProviderRuntimeReadiness(configured, {
      providerKey: configured.id,
      model: configured.config.model,
      status: 'completed',
      runtimeSignature: 'stale-signature',
      checkedAt: '2026-07-13T08:00:00.000Z',
    }, Date.parse('2026-07-13T09:00:00.000Z'))

    expect(status.status).toBe('needs_probe')
    expect(status.warnings).toContain('inference_probe_config_mismatch')
  })
})

describe('review output contract', () => {
  it('blocks facts_v1 from both legacy model-severity entry points', async () => {
    await expect(reviewWithFailover('合同原文', {
      outputContract: 'facts_v1',
      deterministicRules: [],
    })).rejects.toThrow('facts_v1_requires_extractReviewFactsWithFailoverSync')
    await expect(reviewWithFailoverSync('合同原文', {
      outputContract: 'facts_v1',
      deterministicRules: [],
    })).rejects.toThrow('facts_v1_requires_extractReviewFactsWithFailoverSync')
  })

  it('uses an isolated facts-only prompt and strict schema with no model severity fields', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    configured.application = {
      kind: 'application',
      config_id: 'legacy-risk-prompt',
      key: 'contract_review',
      display_name: '合同审核',
      name: '合同审核',
      enabled: true,
      system_prompt: '请直接判断红黄绿等级。',
    }
    const deterministicRule: PublishedReviewRule = {
      snapshot_id: 'snapshot-r004-v22',
      code: 'R004',
      name: '默示验收期',
      review_criteria: {
        schema_version: 1,
        absence_decision: 'ignore',
        fact_schema: {
          silent_acceptance: { type: 'boolean', required: true },
          review_workdays: { type: 'number', nullable: true },
        },
        level_a: { all: [
          { eq: { fact: 'silent_acceptance', value: true } },
          { lte: { fact: 'review_workdays', value: 10 } },
        ] },
        level_b: { eq: { fact: 'review_workdays', value: 15 } },
        level_c: { gt: { fact: 'review_workdays', value: 30 } },
      },
      default_unknown: 'yellow_review',
      conflict_group: null,
      mutually_exclusive_with: [],
      specificity: 100,
      criteria_schema_version: 1,
      message_template: {},
    }

    const prompt = buildFactsOnlySystemPromptForTest(configured, [deterministicRule])
    expect(prompt).toContain('没有风险定级权限')
    expect(prompt).toContain('不得输出 level、severity')
    expect(prompt).not.toContain('请直接判断红黄绿等级')

    const format = buildSyncResponseFormatForTest(configured, {
      outputContract: 'facts_v1',
      deterministicRules: [deterministicRule],
    })
    expect(format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'contract_review_facts_v1', strict: true },
    })
    const serialized = JSON.stringify(format)
    expect(serialized).toContain('"facts"')
    expect(serialized).not.toContain('"level"')
    expect(serialized).not.toContain('"severity"')
    expect(serialized).not.toContain('"suggestion"')
  })

  it('preserves the configured application prompt and appends the machine contract', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    configured.application = {
      kind: 'application',
      config_id: 'contract-review-app',
      key: 'contract_review',
      display_name: '合同审核',
      name: '合同审核',
      enabled: true,
      system_prompt: '只依据配置中心发布规则判断风险。',
    }

    const prompt = buildReviewSystemPromptForTest(configured)

    expect(prompt).toContain('只依据配置中心发布规则判断风险。')
    expect(prompt).toContain('只输出一个 JSON 对象')
    expect(prompt).toContain('"risks"')
    expect(prompt).toContain('"summary"')
  })

  it('adds an explicit repair instruction after an invalid response', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })

    expect(buildReviewSystemPromptForTest(configured, 1)).toContain('上一次响应没有通过结构校验')
  })

  it('injects frozen rule semantics while keeping snapshot binding on the server', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    const prompt = buildReviewSystemPromptForTest(configured, 0, [{
      rule_snapshot_id: '3d7895c4-a118-4c4f-b4c6-325b28f332aa',
      rule_code: 'R013',
      name: 'SLA 服务承诺',
      description: '7x24 承诺必须有可验证口径和责任边界',
      risk_level: 'red',
      review_criteria: {
        engine_type: 'hybrid',
        field_hints: ['7x24', 'SLA'],
        semantic_prompt: '这段旧提示与规则摘要重复，不应再次注入模型上下文',
      },
    }])

    expect(prompt).toContain('冻结规则目录')
    expect(prompt).not.toContain('3d7895c4-a118-4c4f-b4c6-325b28f332aa')
    expect(prompt).toContain('R013')
    expect(prompt).toContain('7x24 承诺必须有可验证口径和责任边界')
    expect(prompt).toContain('field_hints')
    expect(prompt).not.toContain('这段旧提示与规则摘要重复')
    expect(prompt).not.toContain('engine_type')
    expect(prompt).toContain('rule_snapshot_id')
    expect(prompt).toContain('始终返回 null')
    expect(prompt).toContain('A/Level A/可接受表示不生成风险')
    expect(prompt).toContain('B/Level B/可让步输出 yellow')
    expect(prompt).toContain('C/Level C/红线输出 red')
    expect(prompt).toContain('无法逐字引用时不要输出该风险')
    expect(prompt).toContain('不得自行升级 red')
  })

  it('uses the semantic prompt only as a fallback for snapshots without a description', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    const prompt = buildReviewSystemPromptForTest(configured, 0, [{
      rule_snapshot_id: 'f940f246-cad5-401d-9faf-4ab374f34e11',
      rule_code: 'LEGACY-001',
      name: '旧规则',
      review_criteria: { semantic_prompt: '只有旧语义提示可用时仍需保留' },
    }])

    expect(prompt).toContain('只有旧语义提示可用时仍需保留')
  })

  it('keeps a 15-rule frozen catalogue compact while the server owns snapshot identities', () => {
    const configured = provider('local_primary', 1, {
      baseUrl: 'http://127.0.0.1:1234/v1',
    })
    const rules = Array.from({ length: 15 }, (_, index) => {
      const number = String(index + 1).padStart(3, '0')
      return {
        rule_snapshot_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        rule_code: `R${number}`,
        name: `规则 ${number}`,
        description: `规则 ${number} 的完整 A/B/红线判断摘要`,
        review_criteria: {
          field_hints: [`字段 ${number}`],
          semantic_prompt: `重复语义提示 ${number}：${'不得重复发送。'.repeat(40)}`,
        },
      }
    })
    const prompt = buildReviewSystemPromptForTest(configured, 0, rules)

    for (const rule of rules) {
      expect(prompt).not.toContain(rule.rule_snapshot_id)
      expect(prompt.match(new RegExp(`"rule_code":"${rule.rule_code}"`, 'g'))).toHaveLength(1)
    }
    expect(prompt).not.toContain('重复语义提示')
    expect(prompt.length).toBeLessThan(10_000)
  })

  it('reads chat-completions and responses-style output payloads', () => {
    expect(getProviderResponseTextForTest({
      choices: [{ message: { content: '{"risks":[],"summary":"ok"}' } }],
    })).toContain('"summary":"ok"')

    expect(getProviderResponseTextForTest({
      output: [{ content: [{ type: 'output_text', text: '{"risks":[],"summary":"done"}' }] }],
    })).toContain('"summary":"done"')

    expect(getProviderResponseTextForTest({ output_text: '{"risks":[],"summary":"ready"}' }))
      .toContain('"summary":"ready"')
  })

  it('recognizes output truncation and the exact model exposed by a local runtime', () => {
    expect(getProviderFinishReasonForTest({
      choices: [{ finish_reason: 'length', message: { content: '{"risks":[' } }],
    })).toBe('length')

    const localModels = {
      models: [{ name: 'qwen3.5-9b-local', aliases: ['qwen-local'] }],
      data: [{ id: 'qwen3.5-9b-local' }],
    }
    expect(providerModelListIncludesForTest(localModels, 'qwen3.5-9b-local')).toBe(true)
    expect(providerModelListIncludesForTest(localModels, 'gemma-4-e4b-local')).toBe(false)
  })
})
