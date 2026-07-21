import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeAIUsePoint: vi.fn(),
  resolvePlan: vi.fn(),
}))

vi.mock('@/lib/ai/runtime-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime-executor')>()
  return { ...actual, executeAIUsePoint: mocks.executeAIUsePoint }
})
vi.mock('@/lib/ai/runtime-plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime-plan')>()
  return { ...actual, resolvePublishedAIExecutionPlan: mocks.resolvePlan }
})

import {
  executeContractSemanticReview,
  prepareContractSemanticInput,
  type ContractSemanticSkillContext,
} from './contract-semantic'
import type { AIExecutionCandidate, AIExecutionPlan } from './runtime-plan'

function planWithContextWindows(...windows: number[]): AIExecutionPlan {
  const candidates = windows.map((contextWindow, position): AIExecutionCandidate => ({
    position,
    modelConfigId: `model-config-${position}`,
    modelConfigKey: `MODEL_${position}`,
    modelAssetId: `model-${position}`,
    modelId: `model-api-${position}`,
    capabilities: ['text_generation', 'structured_output'],
    contextWindow,
    providerConfigId: `provider-config-${position}`,
    providerConfigKey: `PROVIDER_${position}`,
    providerAssetId: `provider-${position}`,
    providerType: 'openai_compatible',
    endpoint: `https://provider-${position}.example/v1`,
    runtimeLocation: 'cloud',
    authMode: 'bearer',
    connectionTimeoutMs: 1_000,
    credential: `secret-${position}`,
  }))
  return {
    orgId: 'org-1', executionEnvironment: 'hosted',
    usePointId: 'contract.review.semantic', usePointConfigId: 'use-point-config',
    applicationId: 'review-app', applicationConfigId: 'app-config',
    routeId: 'review-route', routeConfigId: 'route-config',
    failureAction: 'manual_review', timeoutMs: 60_000, candidates,
    snapshot: {
      schemaVersion: 'ai-runtime-plan.v1', orgId: 'org-1', executionEnvironment: 'hosted',
      usePoint: {
        configId: 'use-point-config', configKey: 'USE_POINT', assetId: 'contract.review.semantic',
        moduleId: 'contract_review', requiredCapabilities: ['text_generation', 'structured_output'],
      },
      binding: {
        configId: 'binding-config', configKey: 'BINDING', assetId: 'binding-1',
        usePointId: 'contract.review.semantic', applicationId: 'review-app',
      },
      application: {
        configId: 'app-config', configKey: 'APP', assetId: 'review-app',
        capabilities: ['text_generation', 'structured_output'],
      },
      route: {
        configId: 'route-config', configKey: 'ROUTE', assetId: 'review-route',
        strategy: 'ordered_fallback', timeoutMs: 60_000, failureAction: 'manual_review',
        orderedModelAssetIds: candidates.map((candidate) => candidate.modelAssetId),
      },
      candidates: candidates.map((candidate) => ({
        position: candidate.position,
        model: {
          configId: candidate.modelConfigId, configKey: candidate.modelConfigKey,
          assetId: candidate.modelAssetId, modelId: candidate.modelId,
          capabilities: candidate.capabilities, contextWindow: candidate.contextWindow,
        },
        provider: {
          configId: candidate.providerConfigId, configKey: candidate.providerConfigKey,
          assetId: candidate.providerAssetId, providerType: 'openai_compatible',
          endpoint: candidate.endpoint, runtimeLocation: 'cloud', authMode: 'bearer',
          credentialState: 'stored', connectionTimeoutMs: 1_000,
        },
      })),
    },
    snapshotHash: 'a'.repeat(64),
  }
}

const skillContext: ContractSemanticSkillContext = {
  rules: [{
    code: 'R001', version: 1, execution_protocol: 'legacy_adapter',
    field_hints: ['付款周期'], clause_category: '付款', target_field: 'payment_term',
  }],
}

const canonicalSkillContext: ContractSemanticSkillContext = {
  rules: [{
    code: 'MIN_PAYMENT',
    version: 2,
    execution_protocol: 'rule_contract_v1',
    rule_contract: {
      schema_version: '1.0',
      properties: [
        { key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' },
        { key: 'first_payment_rate', label: '首付款比例', type: 'percentage', required: true, unit: 'percent' },
      ],
      decisions: [{
        id: 'pass',
        label: '满足付款底线',
        outcome: 'pass',
        priority: 10,
        match: 'all',
        conditions: [
          { property_key: 'contract_amount', operator: '>=', value: 50_000, unit: 'CNY' },
          { property_key: 'first_payment_rate', operator: '>=', value: 30, unit: 'percent' },
        ],
      }],
      missing_evidence_outcome: 'manual_review',
    },
  }],
}

describe('contract semantic runtime', () => {
  it('keeps full text when the frozen fallback plan can fit it', () => {
    const prepared = prepareContractSemanticInput('付款周期为 120 天。', planWithContextWindows(64_000, 32_000), skillContext)

    expect(prepared.text).toBe('付款周期为 120 天。')
    expect(prepared.stats).toMatchObject({
      selection_strategy: 'full_text', character_coverage_ratio: 1, coverage_limited: false,
    })
  })

  it('uses one frozen balanced input that fits the smallest fallback context', () => {
    const source = [
      '首页。'.repeat(2_000),
      '付款周期为 120 天。'.repeat(500),
      '普通条款。'.repeat(2_000),
      '责任上限为合同金额十倍。'.repeat(500),
      '末页。'.repeat(2_000),
    ].join('\n')
    const prepared = prepareContractSemanticInput(source, planWithContextWindows(128_000, 8_192), skillContext)

    expect(prepared.stats.selection_strategy).toBe('balanced_chunked')
    expect(prepared.stats.submitted_text_length).toBeLessThan(source.length)
    expect(prepared.stats.submitted_text_length).toBeLessThan(3_000)
    expect(prepared.text).toContain('合同片段')
    expect(prepared.text).toContain('付款周期')
  })

  it('executes the registered semantic use point and applies source-grounded validation before acceptance', async () => {
    const plan = planWithContextWindows(32_000)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementation(async (input) => {
      const raw = JSON.stringify({
        risks: [{
          ruleCode: 'R001', ruleVersion: 1, level: 'red', title: '付款周期过长',
          description: '付款周期超过常规范围', suggestion: '改为 30 天',
          evidence: ['付款周期为 120 天'],
        }],
        summary: '存在付款风险',
      })
      const validation = await input.validateOutput(raw)
      if (!validation.ok) throw new Error(validation.error)
      expect(validation.evidence).toEqual({
        itemKind: 'risk',
        validationWarnings: [],
        droppedItemCount: 0,
        usableItemCount: 1,
      })
      return {
        value: validation.value, provider: 'provider-0', model: 'model-api-0', degraded: false,
        invocationId: 'invocation-1', invocationIds: ['invocation-1'],
        planSnapshotId: 'snapshot-1', planSnapshotHash: plan.snapshotHash,
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75, evidence: 'provider' },
        attempts: [], latencyMs: 25, text: raw, modelAssetId: 'model-0', providerAssetId: 'provider-0',
      }
    })

    const result = await executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: '第十条：付款周期为 120 天。', skillContext, executionEnvironment: 'hosted',
    })

    expect(result).toMatchObject({
      provider: 'provider-0', model: 'model-api-0', planSnapshotId: 'snapshot-1',
      invocationIds: ['invocation-1'], usage: { totalTokens: 75 },
      risks: [expect.objectContaining({ ruleCode: 'R001', evidence: ['付款周期为 120 天'] })],
    })
    expect(mocks.executeAIUsePoint).toHaveBeenCalledWith(expect.objectContaining({
      usePointId: 'contract.review.semantic', contractId: 'contract-1', reviewId: 'review-1',
      skillBundleId: 'bundle-1', plan, temperature: 0,
      validateOutput: expect.any(Function),
    }))
  })

  it('fails closed when a full-text semantic response omits every canonical rule', async () => {
    const plan = planWithContextWindows(32_000)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementationOnce(async (input) => {
      const validation = await input.validateOutput(JSON.stringify({ risks: [], summary: '审核完成' }))
      expect(validation.ok).toBe(false)
      if (validation.ok) throw new Error('expected canonical coverage rejection')
      expect(validation.error).toContain('missing rule output MIN_PAYMENT')
      throw new Error(validation.error)
    })

    await expect(executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: '合同金额为60000元，首付款比例为30%。',
      skillContext: canonicalSkillContext,
      executionEnvironment: 'hosted',
    })).rejects.toThrow('missing rule output MIN_PAYMENT')
  })

  it('fails closed when a canonical rule omits one of its configured properties', async () => {
    const plan = planWithContextWindows(32_000)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementationOnce(async (input) => {
      const raw = JSON.stringify({
        risks: [{
          ruleCode: 'MIN_PAYMENT',
          propertyReadings: [{
            propertyKey: 'contract_amount', status: 'read', value: 60_000, unit: 'CNY',
            evidence: '合同金额为60000元', confidence: 0.98,
          }],
        }],
        summary: '审核完成',
      })
      const validation = await input.validateOutput(raw)
      expect(validation.ok).toBe(false)
      if (validation.ok) throw new Error('expected canonical property coverage rejection')
      expect(validation.error).toContain('missing defined property first_payment_rate')
      throw new Error(validation.error)
    })

    await expect(executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: '合同金额为60000元，首付款比例为30%。',
      skillContext: canonicalSkillContext,
      executionEnvironment: 'hosted',
    })).rejects.toThrow('missing defined property first_payment_rate')
  })

  it('accepts one complete typed reading set per canonical rule and records the expected coverage audit', async () => {
    const plan = planWithContextWindows(32_000)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementationOnce(async (input) => {
      expect(input.messages[0]?.content).toContain('当前 canonical ruleCode 允许值：MIN_PAYMENT')
      expect(input.messages[0]?.content).toContain('"ruleCode":"MIN_PAYMENT"')
      expect(input.messages[0]?.content).toContain('"propertyKey":"contract_amount"')
      expect(input.messages[0]?.content).not.toContain('"ruleCode":"R001"')
      expect(input.requestMeta).toMatchObject({
        semantic_validation_revision: 'canonical-rule-property-coverage-v1',
        expected_canonical_rule_count: 1,
        expected_canonical_property_count: 2,
      })
      const raw = JSON.stringify({
        risks: [{
          ruleCode: 'MIN_PAYMENT',
          ruleVersion: 2,
          propertyReadings: [{
            propertyKey: 'contract_amount', status: 'read', value: 60_000, unit: 'CNY',
            evidence: '合同金额为60000元', confidence: 0.98,
          }, {
            propertyKey: 'first_payment_rate', status: 'read', value: 30, unit: 'percent',
            evidence: '首付款比例为30%', confidence: 0.96,
          }],
        }],
        summary: '付款条件满足底线',
      })
      const validation = await input.validateOutput(raw)
      if (!validation.ok) throw new Error(validation.error)
      expect(validation.evidence).toEqual({
        itemKind: 'risk', validationWarnings: [], droppedItemCount: 0, usableItemCount: 1,
      })
      return {
        value: validation.value, provider: 'provider-0', model: 'model-api-0', degraded: false,
        invocationId: 'invocation-canonical', invocationIds: ['invocation-canonical'],
        planSnapshotId: 'snapshot-1', planSnapshotHash: plan.snapshotHash,
        usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110, evidence: 'provider' },
        attempts: [], latencyMs: 25, text: raw, modelAssetId: 'model-0', providerAssetId: 'provider-0',
      }
    })

    const result = await executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: '合同金额为60000元，首付款比例为30%。',
      skillContext: canonicalSkillContext,
      executionEnvironment: 'hosted',
    })

    expect(result.risks).toEqual([expect.objectContaining({
      ruleCode: 'MIN_PAYMENT', decisionId: 'pass', level: 'green',
      propertyReadings: expect.arrayContaining([
        expect.objectContaining({ propertyKey: 'contract_amount', value: 60_000 }),
        expect.objectContaining({ propertyKey: 'first_payment_rate', value: 30 }),
      ]),
    })])
  })

  it('treats model nulls as omitted only for unknown optional reading fields', async () => {
    const plan = planWithContextWindows(32_000)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementationOnce(async (input) => {
      const raw = JSON.stringify({
        risks: [{
          ruleCode: 'MIN_PAYMENT',
          ruleVersion: 2,
          propertyReadings: [{
            propertyKey: 'contract_amount', status: 'read', value: 60_000, unit: 'CNY',
            evidence: '合同金额为60000元', confidence: 0.98,
          }, {
            propertyKey: 'first_payment_rate', status: 'missing', value: null, unit: null,
            evidence: null, confidence: 0.9,
          }],
        }],
        summary: '未找到首付款比例，需人工复核',
      })
      const validation = await input.validateOutput(raw)
      if (!validation.ok) throw new Error(validation.error)
      const missingReading = validation.value.data.risks[0]?.propertyReadings?.find(
        (reading: { propertyKey: string }) => reading.propertyKey === 'first_payment_rate',
      )
      expect(missingReading).toEqual({
        propertyKey: 'first_payment_rate', status: 'missing', confidence: 0.9,
      })
      return {
        value: validation.value, provider: 'provider-0', model: 'model-api-0', degraded: false,
        invocationId: 'invocation-null-adapter', invocationIds: ['invocation-null-adapter'],
        planSnapshotId: 'snapshot-1', planSnapshotHash: plan.snapshotHash,
        usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110, evidence: 'provider' },
        attempts: [], latencyMs: 25, text: raw, modelAssetId: 'model-0', providerAssetId: 'provider-0',
      }
    })

    const result = await executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: '合同金额为60000元，双方应按本合同约定付款。',
      skillContext: canonicalSkillContext,
      executionEnvironment: 'hosted',
    })

    expect(result.risks[0]).toMatchObject({
      ruleCode: 'MIN_PAYMENT', level: 'yellow',
      propertyReadings: expect.arrayContaining([
        { propertyKey: 'first_payment_rate', status: 'missing', confidence: 0.9 },
      ]),
    })
  })

  it('still rejects a read status whose model value is null', async () => {
    const plan = planWithContextWindows(32_000)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementationOnce(async (input) => {
      const raw = JSON.stringify({
        risks: [{
          ruleCode: 'MIN_PAYMENT',
          propertyReadings: [{
            propertyKey: 'contract_amount', status: 'read', value: null, unit: 'CNY',
            evidence: '合同金额为60000元', confidence: 0.98,
          }, {
            propertyKey: 'first_payment_rate', status: 'missing', confidence: 0.9,
          }],
        }],
        summary: '审核完成',
      })
      const validation = await input.validateOutput(raw)
      expect(validation.ok).toBe(false)
      if (validation.ok) throw new Error('expected null read value rejection')
      expect(validation.error).toContain('read status requires a typed value')
      throw new Error(validation.error)
    })

    await expect(executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: '合同金额为60000元。',
      skillContext: canonicalSkillContext,
      executionEnvironment: 'hosted',
    })).rejects.toThrow('read status requires a typed value')
  })

  it('marks a chunk-limited canonical response partial instead of presenting zero output as clean', async () => {
    const plan = planWithContextWindows(8_192)
    mocks.resolvePlan.mockResolvedValue(plan)
    mocks.executeAIUsePoint.mockImplementationOnce(async (input) => {
      const raw = JSON.stringify({ risks: [], summary: '仅完成片段检查' })
      const validation = await input.validateOutput(raw)
      if (!validation.ok) throw new Error(validation.error)
      expect(validation.evidence).toEqual({
        itemKind: 'risk',
        validationWarnings: ['semantic_input_coverage_limited:canonical_rule_property_completeness_not_proven'],
        droppedItemCount: 0,
        usableItemCount: 0,
      })
      return {
        value: validation.value, provider: 'provider-0', model: 'model-api-0', degraded: false,
        invocationId: 'invocation-partial', invocationIds: ['invocation-partial'],
        planSnapshotId: 'snapshot-1', planSnapshotHash: plan.snapshotHash,
        usage: { inputTokens: 80, outputTokens: 10, totalTokens: 90, evidence: 'provider' },
        attempts: [], latencyMs: 25, text: raw, modelAssetId: 'model-0', providerAssetId: 'provider-0',
      }
    })

    const result = await executeContractSemanticReview({
      orgId: 'org-1', contractId: 'contract-1', reviewId: 'review-1', skillBundleId: 'bundle-1',
      contractText: `${'普通合同条款。'.repeat(4_000)}合同金额为60000元，首付款比例为30%。`,
      skillContext: canonicalSkillContext,
      executionEnvironment: 'hosted',
    })

    expect(result.risks).toEqual([])
    expect(result.inputStats.coverage_limited).toBe(true)
    expect(result.validationWarnings).toContain(
      'semantic_input_coverage_limited:canonical_rule_property_completeness_not_proven'
    )
  })

  it('does not import legacy failover, ModelPolicy, environment routes or LM Studio CLI', () => {
    const source = readFileSync(join(process.cwd(), 'lib/ai/contract-semantic.ts'), 'utf8')
    expect(source).not.toContain("@/lib/ai/failover")
    expect(source).not.toContain('ModelPolicy')
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli/)
  })
})
