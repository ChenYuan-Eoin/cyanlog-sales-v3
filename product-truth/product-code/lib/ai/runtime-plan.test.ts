import { describe, expect, it, vi } from 'vitest'

import {
  AIExecutionPlanError,
  compilePublishedAIExecutionPlan,
  resolvePublishedAIExecutionPlan,
  stableAIExecutionPlanSnapshotJson,
  type AIExecutionPlanConfigRow,
} from './runtime-plan'

const ORG_ID = 'org-runtime-plan'
const SECRET = 'lm-studio-secret-token-do-not-leak'

function row(
  id: string,
  kind: string,
  assetId: string,
  fields: Record<string, unknown>,
  options: Partial<Pick<AIExecutionPlanConfigRow, 'type' | 'status' | 'org_id'>> = {},
): AIExecutionPlanConfigRow {
  return {
    id,
    key: id.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
    name: id,
    type: options.type ?? 'AI_CONFIG',
    status: options.status ?? 'PUBLISHED',
    org_id: options.org_id ?? ORG_ID,
    updated_at: '2026-07-21T00:00:00.000Z',
    value: {
      schema_version: 'ai-platform.v1',
      kind,
      asset_id: assetId,
      enabled: true,
      ...fields,
    },
  }
}

function fixtures(): AIExecutionPlanConfigRow[] {
  return [
    row('provider-primary-config', 'provider_connection', 'provider.primary', {
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://primary.example/v1/',
      api_key: SECRET,
      connection_timeout_ms: 45_000,
    }),
    row('provider-backup-config', 'provider_connection', 'provider.backup', {
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://backup.example/v1',
      connection_timeout_ms: 60_000,
    }),
    row('model-primary-config', 'model_catalog_entry', 'model.primary', {
      provider_connection_id: 'provider.primary',
      model_id: 'vendor/primary',
      capabilities: ['structured_output', 'text_generation'],
      context_window: 131_072,
    }),
    row('model-backup-config', 'model_catalog_entry', 'model.backup', {
      provider_connection_id: 'provider.backup',
      model_id: 'vendor/backup',
      capabilities: ['text_generation', 'structured_output', 'long_context'],
      context_window: 262_144,
    }),
    row('application-config', 'ai_application', 'review.assistant', {
      capabilities: ['structured_output', 'text_generation'],
    }),
    row('use-point-config', 'business_use_point', 'contract.review.semantic', {
      module_id: 'contract_review',
      required_capabilities: ['text_generation', 'structured_output'],
    }),
    row('binding-config', 'application_binding', 'contract.review.semantic.binding', {
      business_use_point_id: 'contract.review.semantic',
      ai_application_id: 'review.assistant',
    }),
    row('route-config', 'route_policy', 'review.assistant.default', {
      ai_application_id: 'review.assistant',
      model_catalog_entry_ids: ['model.primary', 'model.backup'],
      strategy: 'ordered_fallback',
      timeout_ms: 120_000,
      failure_action: 'manual_review',
    }),
  ]
}

function compile(
  rows = fixtures(),
  executionEnvironment: 'local' | 'hosted' = 'hosted',
) {
  return compilePublishedAIExecutionPlan({
    orgId: ORG_ID,
    usePointId: 'contract.review.semantic',
    executionEnvironment,
    rows,
  })
}

function replaceAsset(
  rows: AIExecutionPlanConfigRow[],
  assetId: string,
  patch: Record<string, unknown>,
  rowPatch: Partial<AIExecutionPlanConfigRow> = {},
): AIExecutionPlanConfigRow[] {
  return rows.map((item) => item.value?.asset_id === assetId
    ? {
        ...item,
        ...rowPatch,
        value: { ...item.value, ...patch },
      }
    : item)
}

function expectPlanError(
  action: () => unknown,
  code: AIExecutionPlanError['code'],
) {
  try {
    action()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(AIExecutionPlanError)
    expect((error as AIExecutionPlanError).code).toBe(code)
  }
}

describe('six-object AI runtime plan compiler', () => {
  it('compiles the unique published graph and preserves RoutePolicy candidate order', () => {
    const plan = compile()

    expect(plan).toMatchObject({
      orgId: ORG_ID,
      executionEnvironment: 'hosted',
      usePointId: 'contract.review.semantic',
      applicationId: 'review.assistant',
      routeId: 'review.assistant.default',
      failureAction: 'manual_review',
      timeoutMs: 120_000,
    })
    expect(plan.candidates.map((candidate) => ({
      position: candidate.position,
      model: candidate.modelAssetId,
      provider: candidate.providerAssetId,
    }))).toEqual([
      { position: 0, model: 'model.primary', provider: 'provider.primary' },
      { position: 1, model: 'model.backup', provider: 'provider.backup' },
    ])
    expect(plan.candidates[0].endpoint).toBe('https://primary.example/v1')
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.snapshot.candidates)).toBe(true)
  })

  it('fails closed when any referenced object is missing', () => {
    const withoutProvider = fixtures().filter((item) => item.value?.asset_id !== 'provider.primary')
    expectPlanError(() => compile(withoutProvider), 'PROVIDER_NOT_FOUND')

    const withoutBinding = fixtures().filter((item) => item.value?.kind !== 'application_binding')
    expectPlanError(() => compile(withoutBinding), 'BINDING_NOT_FOUND')
  })

  it('fails closed on duplicate logical assets and duplicate enabled bindings', () => {
    const rows = fixtures()
    rows.push({
      ...rows.find((item) => item.value?.asset_id === 'model.primary')!,
      id: 'duplicate-model-config',
      key: 'DUPLICATE_MODEL_CONFIG',
    })
    expectPlanError(() => compile(rows), 'DUPLICATE_LOGICAL_ASSET')

    const duplicateBindingRows = fixtures()
    duplicateBindingRows.push(row(
      'binding-config-2',
      'application_binding',
      'contract.review.semantic.second-binding',
      {
        business_use_point_id: 'contract.review.semantic',
        ai_application_id: 'review.assistant',
      },
    ))
    expectPlanError(() => compile(duplicateBindingRows), 'BINDING_AMBIGUOUS')
  })

  it('rejects disabled and unpublished nodes instead of silently skipping them', () => {
    expectPlanError(
      () => compile(replaceAsset(fixtures(), 'review.assistant', { enabled: false })),
      'APPLICATION_DISABLED',
    )
    expectPlanError(
      () => compile(replaceAsset(
        fixtures(),
        'contract.review.semantic',
        {},
        { status: 'DRAFT' },
      )),
      'UNPUBLISHED_PLATFORM_ASSET',
    )
  })

  it('rejects application and model capability mismatches', () => {
    expectPlanError(
      () => compile(replaceAsset(
        fixtures(),
        'review.assistant',
        { capabilities: ['text_generation'] },
      )),
      'APPLICATION_CAPABILITY_MISMATCH',
    )
    expectPlanError(
      () => compile(replaceAsset(
        fixtures(),
        'model.primary',
        { capabilities: ['text_generation'] },
      )),
      'MODEL_CAPABILITY_MISMATCH',
    )
  })

  it('rejects an empty route at the strict schema boundary', () => {
    expectPlanError(
      () => compile(replaceAsset(
        fixtures(),
        'review.assistant.default',
        { model_catalog_entry_ids: [] },
      )),
      'MALFORMED_PLATFORM_ASSET',
    )
  })

  it('rejects a local Provider when compiling for a hosted runtime', () => {
    const localRows = replaceAsset(fixtures(), 'provider.primary', {
      runtime_location: 'local',
      base_url: 'http://127.0.0.1:1234/v1',
    })
    expectPlanError(() => compile(localRows, 'hosted'), 'RUNTIME_LOCATION_INCOMPATIBLE')

    expect(compile(localRows, 'local').candidates[0]).toMatchObject({
      runtimeLocation: 'local',
      endpoint: 'http://127.0.0.1:1234/v1',
    })
  })

  it('produces the same hash for equivalent rows regardless of fetch and set ordering', () => {
    const original = compile(fixtures())
    let reordered = fixtures().reverse()
    reordered = replaceAsset(reordered, 'contract.review.semantic', {
      required_capabilities: ['structured_output', 'text_generation'],
    })
    reordered = replaceAsset(reordered, 'review.assistant', {
      capabilities: ['text_generation', 'structured_output'],
    })
    reordered = replaceAsset(reordered, 'model.primary', {
      capabilities: ['text_generation', 'structured_output'],
    })

    const equivalent = compile(reordered)
    expect(equivalent.snapshotHash).toBe(original.snapshotHash)
    expect(stableAIExecutionPlanSnapshotJson(equivalent.snapshot))
      .toBe(stableAIExecutionPlanSnapshotJson(original.snapshot))
  })

  it('keeps credentials in memory but out of every enumerable plan and snapshot field', () => {
    const plan = compile()
    const primary = plan.candidates[0]

    expect(primary.credential).toBe(SECRET)
    expect(Object.keys(primary)).not.toContain('credential')
    expect(plan.snapshot.candidates[0].provider.credentialState).toBe('stored')

    const serializedPlan = JSON.stringify(plan)
    const serializedSnapshot = stableAIExecutionPlanSnapshotJson(plan.snapshot)
    for (const serialized of [serializedPlan, serializedSnapshot]) {
      expect(serialized).not.toContain(SECRET)
      expect(serialized).not.toContain('api_key')
      expect(serialized).not.toContain('credential\"')
    }
    expect(plan.snapshotHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses the injected published-config loader and ignores legacy ModelPolicy-shaped rows', async () => {
    const legacyRow: AIExecutionPlanConfigRow = {
      id: 'legacy-model-policy',
      key: 'AI_LEVEL_1',
      name: 'legacy provider',
      type: 'AI_CONFIG',
      status: 'PUBLISHED',
      org_id: ORG_ID,
      value: {
        kind: 'provider',
        model: 'legacy-model-must-not-run',
        base_url: 'https://legacy.example/v1',
        api_key: 'legacy-secret',
        enabled: true,
      },
    }
    const loader = vi.fn(async () => [...fixtures(), legacyRow])

    const plan = await resolvePublishedAIExecutionPlan({
      orgId: ORG_ID,
      usePointId: 'contract.review.semantic',
      executionEnvironment: 'hosted',
      loadPublishedConfigs: loader,
    })

    expect(loader).toHaveBeenCalledOnce()
    expect(loader).toHaveBeenCalledWith(ORG_ID)
    expect(plan.candidates.map((candidate) => candidate.modelId))
      .toEqual(['vendor/primary', 'vendor/backup'])
    expect(JSON.stringify(plan)).not.toContain('legacy-model-must-not-run')
    expect(JSON.stringify(plan)).not.toContain('legacy-secret')
  })
})
