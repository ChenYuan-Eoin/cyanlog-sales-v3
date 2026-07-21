import { describe, expect, it } from 'vitest'

import { executeAIUsePoint } from '@/lib/ai/runtime-executor'

const LIVE_ENABLED = process.env.WP02_LIVE_AI_ACCEPTANCE === '1'
const LIVE_FAILOVER_ENABLED = process.env.WP02_LIVE_AI_EXPECT_FAILOVER === '1'
const LIVE_CLOUD_PIN_ENABLED = process.env.WP02_LIVE_AI_CLOUD_PIN === '1'

function validateStatusOutput(text: string) {
  const normalized = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/\s/g, '')

  return normalized.includes('"status":"ok"')
    ? { ok: true as const, value: { status: 'ok' as const } }
    : { ok: false as const, error: '模型没有返回约定的 status=ok JSON' }
}

describe.skipIf(!LIVE_ENABLED)('WP02 六对象运行计划真实双模型验收', () => {
  it.skipIf(LIVE_FAILOVER_ENABLED)('同一冻结输入分别调用本地与云端模型，并持久化 provider token 证据', async () => {
    const commonInput = {
      orgId: 'a226ed0f-5e6f-445f-82c4-378362b45ab5',
      usePointId: 'generic.ai.analyze',
      executionEnvironment: 'local' as const,
      messages: [
        { role: 'system' as const, content: 'Directly answer without reasoning. Return only valid JSON.' },
        { role: 'user' as const, content: 'Return exactly this JSON object: {"status":"ok"}' },
      ],
      maxTokens: 128,
      validateOutput: validateStatusOutput,
      requestMeta: { acceptance: 'wp02-dual-model-minimal-generation' },
    }

    const local = await executeAIUsePoint({
      ...commonInput,
      pinModelAssetId: 'model.gemma-4-e4b.local',
    })
    const cloud = await executeAIUsePoint({
      ...commonInput,
      pinModelAssetId: 'model.gpt-5.5.cloud',
    })

    for (const result of [local, cloud]) {
      expect(result.usage.evidence).toBe('provider')
      expect(result.usage.inputTokens).toBeGreaterThan(0)
      expect(result.usage.outputTokens).toBeGreaterThan(0)
      expect(result.usage.totalTokens).toBe(
        (result.usage.inputTokens || 0) + (result.usage.outputTokens || 0),
      )
      expect(result.invocationId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.executionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.planSnapshotId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.degraded).toBe(false)
    }

    expect(local.model).toBe('google/gemma-4-e4b')
    expect(cloud.model).toBe('gpt-5.5')
    expect(local.planSnapshotId).toBe(cloud.planSnapshotId)
    expect(local.planSnapshotHash).toBe(cloud.planSnapshotHash)
    expect(local.executionId).not.toBe(cloud.executionId)
    expect(local).toMatchObject({
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model.gemma-4-e4b.local',
    })
    expect(cloud).toMatchObject({
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model.gpt-5.5.cloud',
    })

    console.info(JSON.stringify({
      plan_snapshot_id: local.planSnapshotId,
      plan_snapshot_hash: local.planSnapshotHash,
      invocations: [local, cloud].map((result) => ({
        invocation_id: result.invocationId,
        execution_id: result.executionId,
        execution_mode: result.executionMode,
        pinned_model_catalog_entry_id: result.pinnedModelCatalogEntryId,
        provider: result.provider,
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        total_tokens: result.usage.totalTokens,
        latency_ms: result.latencyMs,
      })),
    }))
  }, 180_000)

  it.skipIf(!LIVE_FAILOVER_ENABLED)('主模型真实失败后按发布顺序降级到云端，并保留两次 attempt', async () => {
    const result = await executeAIUsePoint({
      orgId: 'a226ed0f-5e6f-445f-82c4-378362b45ab5',
      usePointId: 'generic.ai.analyze',
      executionEnvironment: 'local',
      messages: [
        { role: 'system', content: 'Directly answer without reasoning. Return only valid JSON.' },
        { role: 'user', content: 'Return exactly this JSON object: {"status":"ok"}' },
      ],
      maxTokens: 128,
      validateOutput: validateStatusOutput,
      requestMeta: { acceptance: 'wp02-real-route-failover' },
    })

    expect(result.model).toBe('gpt-5.5')
    expect(result.provider).toBe('provider.cloud.gateway')
    expect(result.degraded).toBe(true)
    expect(result.executionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.executionMode).toBe('route')
    expect(result.pinnedModelCatalogEntryId).toBeNull()
    expect(result.attempts).toHaveLength(2)
    expect(new Set(result.attempts.map((attempt) => attempt.executionId))).toEqual(new Set([result.executionId]))
    expect(new Set(result.attempts.map((attempt) => attempt.requestMeta.input_sha256)).size).toBe(1)
    expect(result.attempts[0]).toMatchObject({
      attemptNo: 1,
      providerConnectionId: 'provider.lm-studio.local',
      status: 'failed',
      degraded: true,
    })
    expect(result.attempts[1]).toMatchObject({
      attemptNo: 2,
      providerConnectionId: 'provider.cloud.gateway',
      status: 'completed',
      degraded: true,
    })
    expect(result.usage.evidence).toBe('provider')
    expect(result.usage.totalTokens).toBeGreaterThan(0)

    console.info(JSON.stringify({
      plan_snapshot_id: result.planSnapshotId,
      plan_snapshot_hash: result.planSnapshotHash,
      degraded: result.degraded,
      execution_id: result.executionId,
      execution_mode: result.executionMode,
      pinned_model_catalog_entry_id: result.pinnedModelCatalogEntryId,
      attempts: result.attempts.map((attempt) => ({
        invocation_id: attempt.id,
        attempt_no: attempt.attemptNo,
        provider: attempt.providerConnectionId,
        model: attempt.model,
        status: attempt.status,
        fallback_reason: attempt.fallbackReason,
        total_tokens: attempt.totalTokens,
      })),
    }))
  }, 180_000)

  it.skipIf(!LIVE_CLOUD_PIN_ENABLED)('云端固定模型只形成 pinned 探测证据', async () => {
    const result = await executeAIUsePoint({
      orgId: 'a226ed0f-5e6f-445f-82c4-378362b45ab5',
      usePointId: 'generic.ai.analyze',
      executionEnvironment: 'local',
      pinModelAssetId: 'model.gpt-5.5.cloud',
      messages: [
        { role: 'system', content: 'Directly answer without reasoning. Return only valid JSON.' },
        { role: 'user', content: 'Return exactly this JSON object: {"status":"ok"}' },
      ],
      maxTokens: 128,
      validateOutput: validateStatusOutput,
      requestMeta: { acceptance: 'wp02-pinned-cloud-mode-truth' },
    })

    expect(result).toMatchObject({
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model.gpt-5.5.cloud',
      modelAssetId: 'model.gpt-5.5.cloud',
      providerAssetId: 'provider.cloud.gateway',
      degraded: false,
    })
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]).toMatchObject({
      executionMode: 'pinned',
      pinnedModelCatalogEntryId: 'model.gpt-5.5.cloud',
      attemptNo: 1,
      status: 'completed',
    })
    expect(result.usage.evidence).toBe('provider')
    expect(result.usage.totalTokens).toBeGreaterThan(0)

    console.info(JSON.stringify({
      plan_snapshot_id: result.planSnapshotId,
      plan_snapshot_hash: result.planSnapshotHash,
      execution_id: result.executionId,
      execution_mode: result.executionMode,
      pinned_model_catalog_entry_id: result.pinnedModelCatalogEntryId,
      invocation_id: result.invocationId,
      provider: result.provider,
      model: result.model,
      total_tokens: result.usage.totalTokens,
    }))
  }, 180_000)
})
