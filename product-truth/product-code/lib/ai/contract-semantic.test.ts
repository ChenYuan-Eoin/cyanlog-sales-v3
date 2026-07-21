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
      skillBundleId: 'bundle-1', plan, validateOutput: expect.any(Function),
    }))
  })

  it('does not import legacy failover, ModelPolicy, environment routes or LM Studio CLI', () => {
    const source = readFileSync(join(process.cwd(), 'lib/ai/contract-semantic.ts'), 'utf8')
    expect(source).not.toContain("@/lib/ai/failover")
    expect(source).not.toContain('ModelPolicy')
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli/)
  })
})
