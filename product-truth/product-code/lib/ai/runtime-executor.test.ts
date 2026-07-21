import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { AIExecutionCandidate, AIExecutionPlan } from './runtime-plan'
import {
  executeAIUsePoint,
  type AIExecutionAttemptRecord,
} from './runtime-executor'

function candidate(
  position: number,
  modelAssetId: string,
  providerAssetId: string,
  overrides: Partial<AIExecutionCandidate> = {},
): AIExecutionCandidate {
  return {
    position,
    modelConfigId: `model-config-${position}`,
    modelConfigKey: `MODEL_${position}`,
    modelAssetId,
    modelId: `model-api-${position}`,
    capabilities: ['text_generation'],
    providerConfigId: `provider-config-${position}`,
    providerConfigKey: `PROVIDER_${position}`,
    providerAssetId,
    providerType: 'openai_compatible',
    endpoint: `https://provider-${position}.example/v1`,
    runtimeLocation: 'cloud',
    authMode: 'bearer',
    connectionTimeoutMs: 1_000,
    credential: `secret-${position}`,
    ...overrides,
  }
}

function plan(overrides: Partial<AIExecutionPlan> = {}): AIExecutionPlan {
  const candidates = overrides.candidates || [
    candidate(0, 'model-primary', 'provider-primary'),
    candidate(1, 'model-backup', 'provider-backup'),
  ]
  return {
    orgId: 'org-1',
    executionEnvironment: 'hosted',
    usePointId: 'generic.ai.analyze',
    usePointConfigId: 'use-point-config',
    applicationId: 'application-1',
    applicationConfigId: 'application-config',
    routeId: 'route-1',
    routeConfigId: 'route-config',
    failureAction: 'manual_review',
    timeoutMs: 200,
    candidates,
    snapshot: {
      schemaVersion: 'ai-runtime-plan.v1',
      orgId: 'org-1',
      executionEnvironment: 'hosted',
      usePoint: {
        configId: 'use-point-config', configKey: 'USE_POINT', assetId: 'generic.ai.analyze',
        moduleId: 'shared_ai', requiredCapabilities: ['text_generation'],
      },
      binding: {
        configId: 'binding-config', configKey: 'BINDING', assetId: 'binding-1',
        usePointId: 'generic.ai.analyze', applicationId: 'application-1',
      },
      application: {
        configId: 'application-config', configKey: 'APP', assetId: 'application-1',
        capabilities: ['text_generation'],
      },
      route: {
        configId: 'route-config', configKey: 'ROUTE', assetId: 'route-1',
        strategy: 'ordered_fallback', timeoutMs: 200, failureAction: 'manual_review',
        orderedModelAssetIds: candidates.map((item) => item.modelAssetId),
      },
      candidates: candidates.map((item) => ({
        position: item.position,
        model: {
          configId: item.modelConfigId, configKey: item.modelConfigKey, assetId: item.modelAssetId,
          modelId: item.modelId, capabilities: item.capabilities,
        },
        provider: {
          configId: item.providerConfigId, configKey: item.providerConfigKey, assetId: item.providerAssetId,
          providerType: 'openai_compatible', endpoint: item.endpoint,
          runtimeLocation: item.runtimeLocation, authMode: item.authMode,
          credentialState: item.authMode === 'bearer' ? 'stored' : 'not_required',
          connectionTimeoutMs: item.connectionTimeoutMs,
        },
      })),
    },
    snapshotHash: 'a'.repeat(64),
    ...overrides,
  }
}

function completion(text = '{"ok":true}', status = 200, usage: {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} | null = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
}, reportedModel?: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage,
    ...(reportedModel !== undefined ? { model: reportedModel } : {}),
  }), { status, headers: { 'Content-Type': 'application/json' } })
}

function dependencies(fetches: Array<typeof fetch>) {
  let fetchIndex = 0
  let clock = Date.parse('2026-07-21T00:00:00.000Z')
  const close = vi.fn(async () => {})
  const createTransport = vi.fn(async (item: AIExecutionCandidate) => ({
    baseUrl: item.endpoint,
    fetch: fetches[Math.min(fetchIndex++, fetches.length - 1)],
    close,
    pinnedAddresses: [],
  }))
  const persistPlanSnapshot = vi.fn(async () => ({ id: 'plan-snapshot-1' }))
  const bindReviewPlan = vi.fn(async () => {})
  const recordAttempt = vi.fn(async (_input: AIExecutionAttemptRecord) => ({
    id: `invocation-${recordAttempt.mock.calls.length}`,
  }))
  return {
    close,
    createTransport,
    persistPlanSnapshot,
    bindReviewPlan,
    recordAttempt,
    now: () => {
      clock += 10
      return clock
    },
  }
}

const baseInput = {
  orgId: 'org-1',
  usePointId: 'generic.ai.analyze',
  executionEnvironment: 'hosted' as const,
  messages: [{ role: 'user' as const, content: '分析这份合同' }],
  contractId: 'contract-1',
  reviewId: 'review-1',
}

describe('executeAIUsePoint', () => {
  it('persists and binds the plan before a real primary call and records provider token usage', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-0',
      })
      return completion()
    })
    const deps = dependencies([request as typeof fetch])

    const result = await executeAIUsePoint({ ...baseInput, plan: plan() }, deps)

    expect(result).toMatchObject({
      model: 'model-api-0',
      provider: 'provider-primary',
      degraded: false,
      invocationId: 'invocation-1',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, evidence: 'provider' },
    })
    expect(deps.bindReviewPlan).toHaveBeenCalledWith({
      orgId: 'org-1', reviewId: 'review-1', contractId: 'contract-1', planSnapshotId: 'plan-snapshot-1',
    })
    expect(deps.persistPlanSnapshot.mock.invocationCallOrder[0])
      .toBeLessThan(deps.bindReviewPlan.mock.invocationCallOrder[0])
    expect(deps.bindReviewPlan.mock.invocationCallOrder[0])
      .toBeLessThan(request.mock.invocationCallOrder[0])
    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', attemptNo: 1, inputTokens: 11, outputTokens: 7, totalTokens: 18,
      planSnapshotId: 'plan-snapshot-1', modelCatalogEntryId: 'model-primary',
      providerConnectionId: 'provider-primary',
    }))
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('persists transport and explicit output-quality evidence from the business validator', async () => {
    const request = vi.fn(async () => completion('{"risks":[{"id":"risk-1"}]}')) as typeof fetch
    const deps = dependencies([request])

    await executeAIUsePoint({
      ...baseInput,
      plan: plan(),
      validateOutput: () => ({
        ok: true,
        value: { risks: [{ id: 'risk-1' }] },
        evidence: {
          itemKind: 'risk',
          validationWarnings: [],
          droppedItemCount: 0,
          usableItemCount: 1,
        },
      }),
    }, deps)

    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      responseMeta: expect.objectContaining({
        provider_kind: 'openai_compatible',
        transport: 'openai_compatible_http',
        output_validation: 'passed',
        token_evidence: 'provider',
        validation_audit_version: '1',
        validation_item_kind: 'risk',
        validation_warnings: [],
        dropped_item_count: 0,
        usable_item_count: 1,
        dropped_risk_count: 0,
        usable_risk_count: 1,
      }),
    }))
  })

  it('attributes execution to the provider-reported model when it differs from configuration', async () => {
    const request = vi.fn(async () => completion(
      '{"ok":true}',
      200,
      { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      'provider-actual-model',
    )) as typeof fetch
    const deps = dependencies([request])

    const result = await executeAIUsePoint({ ...baseInput, plan: plan() }, deps)

    expect(result.model).toBe('provider-actual-model')
    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      model: 'provider-actual-model',
      requestMeta: expect.objectContaining({ configured_model: 'model-api-0' }),
      responseMeta: expect.objectContaining({
        reported_model: 'provider-actual-model',
        model_identity_source: 'provider_reported',
        model_mismatch: true,
      }),
    }))
  })

  it('marks missing provider model identity and falls back explicitly to the configured model', async () => {
    const request = vi.fn(async () => completion()) as typeof fetch
    const deps = dependencies([request])

    const result = await executeAIUsePoint({ ...baseInput, plan: plan() }, deps)

    expect(result.model).toBe('model-api-0')
    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-api-0',
      requestMeta: expect.objectContaining({ configured_model: 'model-api-0' }),
      responseMeta: expect.objectContaining({
        reported_model: null,
        model_identity_source: 'configured_fallback',
        model_mismatch: null,
      }),
    }))
  })

  it('supports auth_mode none without sending Authorization and ignores poisoned env credentials', async () => {
    const previous = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'poison-must-not-be-used'
    try {
      const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
        return completion('ok')
      }) as typeof fetch
      const noAuth = candidate(0, 'model-none', 'provider-none', {
        authMode: 'none', credential: undefined,
      })
      const deps = dependencies([request])

      await expect(executeAIUsePoint({
        ...baseInput,
        plan: plan({ candidates: [noAuth] }),
      }, deps)).resolves.toMatchObject({ model: 'model-api-0' })
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previous
    }
  })

  it('records a failed 5xx attempt before ordered fallback succeeds', async () => {
    const first = vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch
    const second = vi.fn(async () => completion('backup')) as typeof fetch
    const deps = dependencies([first, second])

    const result = await executeAIUsePoint({ ...baseInput, plan: plan() }, deps)

    expect(result.degraded).toBe(true)
    expect(result.model).toBe('model-api-1')
    expect(result.invocationIds).toEqual(['invocation-1', 'invocation-2'])
    expect(result.executionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(deps.recordAttempt.mock.calls.map(([attempt]) => attempt.attemptNo)).toEqual([1, 2])
    expect(deps.recordAttempt.mock.calls.map(([attempt]) => attempt.executionId)).toEqual([
      result.executionId,
      result.executionId,
    ])
    expect(deps.recordAttempt.mock.calls.map(([attempt]) => attempt.executionMode)).toEqual([
      'route',
      'route',
    ])
    expect(deps.recordAttempt.mock.calls.map(([attempt]) => attempt.pinnedModelCatalogEntryId)).toEqual([
      null,
      null,
    ])
    expect(result).toMatchObject({
      executionMode: 'route',
      pinnedModelCatalogEntryId: null,
    })
    expect(deps.recordAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: 'failed', attemptNo: 1, fallbackReason: 'PROVIDER_UNAVAILABLE',
    }))
    expect(deps.recordAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      status: 'completed', attemptNo: 2, fallbackReason: 'PROVIDER_UNAVAILABLE',
    }))
    expect(deps.close).toHaveBeenCalledTimes(2)
  })

  it('generates a different execution identity for separate execute calls', async () => {
    const firstDeps = dependencies([vi.fn(async () => completion('first')) as typeof fetch])
    const secondDeps = dependencies([vi.fn(async () => completion('second')) as typeof fetch])

    const firstResult = await executeAIUsePoint({ ...baseInput, plan: plan() }, firstDeps)
    const secondResult = await executeAIUsePoint({ ...baseInput, plan: plan() }, secondDeps)

    expect(firstResult.executionId).not.toBe(secondResult.executionId)
    expect(firstDeps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      executionId: firstResult.executionId,
      attemptNo: 1,
    }))
    expect(secondDeps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      executionId: secondResult.executionId,
      attemptNo: 1,
    }))
  })

  it('records one stable body-free hash for the ordered role and content input across attempts', async () => {
    const messages = [
      { role: 'system' as const, content: '内部审核口径：不得写入审计元数据' },
      { role: 'user' as const, content: '真实合同正文：同一输入双模型比较' },
    ]
    const expectedHash = createHash('sha256').update(JSON.stringify({
      schema: 'ai-input-messages.v1',
      messages: messages.map((message) => [message.role, message.content]),
    })).digest('hex')
    const first = vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch
    const second = vi.fn(async () => completion('backup')) as typeof fetch
    const deps = dependencies([first, second])

    await executeAIUsePoint({ ...baseInput, messages, plan: plan() }, deps)

    const attempts = deps.recordAttempt.mock.calls.map(([attempt]) => attempt)
    expect(attempts.map((attempt) => attempt.requestMeta.input_sha256)).toEqual([
      expectedHash,
      expectedHash,
    ])
    expect(expectedHash).toMatch(/^[a-f0-9]{64}$/)
    const persistedMetadata = JSON.stringify(attempts.map((attempt) => attempt.requestMeta))
    expect(persistedMetadata).not.toContain(messages[0].content)
    expect(persistedMetadata).not.toContain(messages[1].content)
  })

  it('falls back after timeout and closes the aborted transport', async () => {
    const timeout = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch
    const second = vi.fn(async () => completion('backup')) as typeof fetch
    const deps = dependencies([timeout, second])

    const result = await executeAIUsePoint({
      ...baseInput,
      plan: plan({ timeoutMs: 100 }),
    }, deps)

    expect(result.model).toBe('model-api-1')
    expect(deps.recordAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      fallbackReason: 'TIMEOUT', status: 'failed',
    }))
    expect(deps.close).toHaveBeenCalledTimes(2)
  })

  it('falls back when JSON is invalid or the business output validator rejects it', async () => {
    const invalidJson = vi.fn(async () => new Response('not-json', { status: 200 })) as typeof fetch
    const invalidBusinessOutput = vi.fn(async () => completion('{"risk":null}')) as typeof fetch
    const success = vi.fn(async () => completion('{"risk":"R001"}')) as typeof fetch
    const threeCandidates = [
      candidate(0, 'model-a', 'provider-a'),
      candidate(1, 'model-b', 'provider-b'),
      candidate(2, 'model-c', 'provider-c'),
    ]
    const deps = dependencies([invalidJson, invalidBusinessOutput, success])

    const result = await executeAIUsePoint<{ risk: string }>({
      ...baseInput,
      plan: plan({ candidates: threeCandidates }),
      validateOutput: (text) => {
        const parsed = JSON.parse(text) as { risk?: unknown }
        return typeof parsed.risk === 'string'
          ? { ok: true, value: { risk: parsed.risk } }
          : { ok: false, error: 'risk must be a string' }
      },
    }, deps)

    expect(result.value).toEqual({ risk: 'R001' })
    expect(deps.recordAttempt.mock.calls.map(([attempt]) => attempt.fallbackReason)).toEqual([
      'INVALID_RESPONSE_JSON',
      'OUTPUT_VALIDATION_FAILED',
      'INVALID_RESPONSE_JSON,OUTPUT_VALIDATION_FAILED',
    ])
  })

  it('rejects content without provider token usage instead of fabricating completion evidence', async () => {
    const missingUsage = vi.fn(async () => completion('primary', 200, null, 'provider-primary-real')) as typeof fetch
    const backup = vi.fn(async () => completion('backup')) as typeof fetch
    const deps = dependencies([missingUsage, backup])

    const result = await executeAIUsePoint({ ...baseInput, plan: plan() }, deps)

    expect(result.model).toBe('model-api-1')
    expect(deps.recordAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: 'failed', fallbackReason: 'TOKEN_USAGE_MISSING',
      model: 'provider-primary-real',
      inputTokens: null, outputTokens: null, totalTokens: null,
      requestMeta: expect.objectContaining({ configured_model: 'model-api-0' }),
      responseMeta: expect.objectContaining({
        reported_model: 'provider-primary-real',
        model_identity_source: 'provider_reported',
        model_mismatch: true,
      }),
    }))
  })

  it.each(['manual_review', 'stop'] as const)(
    'fails closed with the published %s action after all candidates fail',
    async (failureAction) => {
      const deps = dependencies([
        vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch,
        vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch,
      ])
      const execution = executeAIUsePoint({
        ...baseInput,
        plan: plan({ failureAction }),
      }, deps)

      await expect(execution).rejects.toMatchObject({
        code: 'ALL_CANDIDATES_FAILED', failureAction, planSnapshotId: 'plan-snapshot-1',
        attempts: [expect.objectContaining({ attemptNo: 1 }), expect.objectContaining({ attemptNo: 2 })],
      })
      expect(deps.recordAttempt).toHaveBeenCalledTimes(2)
    },
  )

  it('pin mode executes only the selected model and never crosses to another candidate', async () => {
    const onlyRequest = vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch
    const deps = dependencies([onlyRequest])

    const execution = executeAIUsePoint({
      ...baseInput,
      plan: plan(),
      pinModelAssetId: 'model-backup',
    }, deps)

    await expect(execution).rejects.toMatchObject({
      code: 'ALL_CANDIDATES_FAILED',
      attempts: [expect.objectContaining({ modelCatalogEntryId: 'model-backup', attemptNo: 1 })],
    })
    expect(deps.createTransport).toHaveBeenCalledTimes(1)
    expect(deps.recordAttempt).toHaveBeenCalledTimes(1)
    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model-backup',
      modelCatalogEntryId: 'model-backup',
      attemptNo: 1,
      status: 'failed',
    }))
  })

  it('labels a successful pinned probe without claiming a full route execution', async () => {
    const request = vi.fn(async () => completion('pinned backup')) as typeof fetch
    const deps = dependencies([request])

    const result = await executeAIUsePoint({
      ...baseInput,
      plan: plan(),
      pinModelAssetId: 'model-backup',
    }, deps)

    expect(result).toMatchObject({
      modelAssetId: 'model-backup',
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model-backup',
      degraded: false,
    })
    expect(deps.recordAttempt).toHaveBeenCalledTimes(1)
    expect(deps.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model-backup',
      modelCatalogEntryId: 'model-backup',
      attemptNo: 1,
      status: 'completed',
    }))
  })
})
