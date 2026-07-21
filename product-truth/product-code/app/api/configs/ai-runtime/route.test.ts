/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAIRuntimeOverview } from '@/app/configs/types'
import { compilePublishedAIExecutionPlan, type AIExecutionPlanConfigRow } from '@/lib/ai/runtime-plan'

const mocks = vi.hoisted(() => ({
  listPublishedConfigsByType: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)

vi.mock('@/lib/configs/runtime', () => ({
  listPublishedConfigsByType: mocks.listPublishedConfigsByType,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { GET } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'
const EXECUTION_ID = '11111111-1111-4111-8111-111111111111'
const OLD_EXECUTION_ID = '22222222-2222-4222-8222-222222222222'

function publishedRows(apiKey = CANARY_SECRET): AIExecutionPlanConfigRow[] {
  const common = {
    type: 'AI_CONFIG',
    status: 'PUBLISHED' as const,
    org_id: 'org-1',
    updated_at: '2026-07-21T00:00:00.000Z',
  }
  return [
    {
      ...common,
      id: 'provider-config',
      key: 'PROVIDER_CLOUD',
      name: '云端模型网关',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.cloud',
        enabled: true,
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        auth_mode: 'bearer',
        base_url: 'https://models.example/v1',
        api_key: apiKey,
        connection_timeout_ms: 5_000,
      },
    },
    {
      ...common,
      id: 'model-config',
      key: 'MODEL_REVIEW_PRIMARY',
      name: '审核主模型',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'model_catalog_entry',
        asset_id: 'model.review.primary',
        enabled: true,
        provider_connection_id: 'provider.cloud',
        model_id: 'review-model-v1',
        capabilities: ['text_generation', 'structured_output'],
      },
    },
    {
      ...common,
      id: 'model-fallback-config',
      key: 'MODEL_REVIEW_FALLBACK',
      name: '审核降级模型',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'model_catalog_entry',
        asset_id: 'model.review.fallback',
        enabled: true,
        provider_connection_id: 'provider.cloud',
        model_id: 'review-model-fallback-v1',
        capabilities: ['text_generation', 'structured_output'],
      },
    },
    {
      ...common,
      id: 'application-config',
      key: 'APP_CONTRACT_REVIEW',
      name: '合同风险识别应用',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'ai_application',
        asset_id: 'app.contract.review',
        enabled: true,
        capabilities: ['text_generation', 'structured_output'],
      },
    },
    {
      ...common,
      id: 'use-point-config',
      key: 'USE_POINT_CONTRACT_REVIEW',
      name: '合同语义审核',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'business_use_point',
        asset_id: 'contract.review.semantic',
        enabled: true,
        module_id: 'contract_review',
        required_capabilities: ['text_generation', 'structured_output'],
      },
    },
    {
      ...common,
      id: 'binding-config',
      key: 'BINDING_CONTRACT_REVIEW',
      name: '合同审核应用绑定',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'application_binding',
        asset_id: 'binding.contract.review',
        enabled: true,
        business_use_point_id: 'contract.review.semantic',
        ai_application_id: 'app.contract.review',
      },
    },
    {
      ...common,
      id: 'route-config',
      key: 'ROUTE_CONTRACT_REVIEW',
      name: '合同审核默认路由',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'route_policy',
        asset_id: 'route.contract.review',
        enabled: true,
        ai_application_id: 'app.contract.review',
        model_catalog_entry_ids: ['model.review.primary', 'model.review.fallback'],
        strategy: 'ordered_fallback',
        timeout_ms: 60_000,
        failure_action: 'manual_review',
      },
    },
  ]
}

function hostedMixedRows(): AIExecutionPlanConfigRow[] {
  const rows = publishedRows()
  const cloudProvider = rows.find((row) => row.value?.kind === 'provider_connection')!
  const cloudModel = rows.find((row) => row.value?.kind === 'model_catalog_entry')!
  const providerWithoutKey = { ...(cloudProvider.value || {}) }
  delete providerWithoutKey.api_key
  const localProvider: AIExecutionPlanConfigRow = {
    ...cloudProvider,
    id: 'provider-local-config',
    key: 'PROVIDER_LOCAL',
    name: 'LM Studio 本机服务',
    value: {
      ...providerWithoutKey,
      asset_id: 'provider.local',
      runtime_location: 'local',
      auth_mode: 'none',
      base_url: 'http://127.0.0.1:1234/v1',
    },
  }
  const localModel: AIExecutionPlanConfigRow = {
    ...cloudModel,
    id: 'model-local-config',
    key: 'MODEL_LOCAL',
    name: 'Gemma 本机模型',
    value: {
      ...cloudModel.value,
      asset_id: 'model.local',
      provider_connection_id: 'provider.local',
      model_id: 'google/gemma-4-e4b',
    },
  }
  return [
    localProvider,
    localModel,
    ...rows.map((row) => row.value?.kind === 'route_policy'
      ? { ...row, value: { ...row.value, model_catalog_entry_ids: ['model.local', 'model.review.primary'] } }
      : row),
  ]
}

function makeInvocationQueries(
  rowsByUsePoint: Record<string, unknown[]> = {},
  error: unknown = null,
) {
  const queries: Array<ReturnType<typeof makeQuery>> = []

  function makeQuery() {
    let usePointId = ''
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      not: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      insert: mocks.insert,
      update: mocks.update,
      delete: mocks.delete,
    }
    query.select.mockReturnValue(query)
    query.eq.mockImplementation((column: string, value: string) => {
      if (column === 'business_use_point_id') usePointId = value
      return query
    })
    query.not.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.limit.mockImplementation(async () => ({
      data: (rowsByUsePoint[usePointId] || []).map((row) => (
        row && typeof row === 'object' && !Array.isArray(row)
          ? {
              execution_mode: 'route',
              pinned_model_catalog_entry_id: null,
              ...row,
            }
          : row
      )),
      error,
    }))
    return query
  }

  mocks.from.mockImplementation(() => {
    const query = makeQuery()
    queries.push(query)
    return query
  })
  return queries
}

function semanticPlanHash(rows: AIExecutionPlanConfigRow[]) {
  return semanticPlan(rows).snapshotHash
}

function semanticPlan(rows: AIExecutionPlanConfigRow[]) {
  return compilePublishedAIExecutionPlan({
    orgId: 'org-1',
    usePointId: 'contract.review.semantic',
    executionEnvironment: 'local',
    rows,
  })
}

function snapshotEmbed(rows: AIExecutionPlanConfigRow[], id = 'snapshot-1') {
  const plan = semanticPlan(rows)
  return {
    id,
    business_use_point_id: plan.usePointId,
    application_id: plan.applicationId,
    route_policy_id: plan.routeId,
    snapshot_sha256: plan.snapshotHash,
    snapshot: plan.snapshot,
  }
}

function pinnedInvocation(rows: AIExecutionPlanConfigRow[], overrides: Record<string, unknown> = {}) {
  const completedAt = new Date(Date.now() - 1_000).toISOString()
  return {
    id: 'pinned-fallback-probe',
    execution_id: EXECUTION_ID,
    execution_mode: 'pinned',
    pinned_model_catalog_entry_id: 'model.review.fallback',
    plan_snapshot_id: 'snapshot-1',
    business_use_point_id: 'contract.review.semantic',
    application_id: 'app.contract.review',
    route_policy_id: 'route.contract.review',
    model_catalog_entry_id: 'model.review.fallback',
    provider_connection_id: 'provider.cloud',
    provider: 'provider.cloud',
    model: 'review-model-fallback-v1',
    attempt_no: 1,
    status: 'completed',
    degraded: false,
    fallback_reason: null,
    latency_ms: 500,
    input_tokens: 20,
    output_tokens: 10,
    total_tokens: 30,
    error_message: null,
    review_id: 'review-run-1',
    created_at: completedAt,
    completed_at: completedAt,
    plan_snapshot: snapshotEmbed(rows),
    ...overrides,
  }
}

describe('GET /api/configs/ai-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL', '')
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    mocks.listPublishedConfigsByType.mockResolvedValue(publishedRows())
    makeInvocationQueries()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns one six-object current plan with plan-linked attempt and token truth', async () => {
    const rows = publishedRows()
    const snapshotHash = semanticPlanHash(rows)
    const snapshot = snapshotEmbed(rows)
    const completedAt = new Date(Date.now() - 1_000).toISOString()
    mocks.listPublishedConfigsByType.mockResolvedValue(rows)
    const queries = makeInvocationQueries({
      'contract.review.semantic': [{
        id: 'invocation-fallback',
        execution_id: EXECUTION_ID,
        plan_snapshot_id: 'snapshot-1',
        business_use_point_id: 'contract.review.semantic',
        application_id: 'app.contract.review',
        route_policy_id: 'route.contract.review',
        model_catalog_entry_id: 'model.review.fallback',
        provider_connection_id: 'provider.cloud',
        provider: 'provider.cloud',
        model: 'review-model-fallback-v1-202607',
        attempt_no: 2,
        status: 'completed',
        degraded: true,
        fallback_reason: 'PROVIDER_UNAVAILABLE',
        latency_ms: 840,
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        error_message: null,
        review_id: 'review-run-1',
        created_at: completedAt,
        completed_at: completedAt,
        plan_snapshot: snapshot,
      },
      {
        id: 'invocation-primary-failed',
        execution_id: EXECUTION_ID,
        plan_snapshot_id: 'snapshot-1',
        business_use_point_id: 'contract.review.semantic',
        application_id: 'app.contract.review',
        route_policy_id: 'route.contract.review',
        model_catalog_entry_id: 'model.review.primary',
        provider_connection_id: 'provider.cloud',
        provider: 'provider.cloud',
        model: 'review-model-v1',
        attempt_no: 1,
        status: 'failed',
        degraded: true,
        fallback_reason: 'PROVIDER_UNAVAILABLE',
        latency_ms: 300,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        error_message: '模型连接或传输失败。',
        review_id: 'review-run-1',
        created_at: new Date(Date.now() - 2_000).toISOString(),
        completed_at: new Date(Date.now() - 1_700).toISOString(),
        plan_snapshot: snapshot,
      }],
    })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const responseText = await res.text()
    const body = JSON.parse(responseText)
    const semantic = body.data.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))

    expect(res.status).toBe(200)
    expect(isAIRuntimeOverview(body.data)).toBe(true)
    expect(responseText).not.toContain('[REDACTED:CIRCULAR]')
    expect(responseText).not.toContain(CANARY_SECRET)
    expect(body.data.source).toBe('published_ai_platform_assets')
    expect(body.data.truth_contract).toEqual({
      legacy_model_policy_consumed: false,
      environment_route_fallback_consumed: false,
      configured_or_published_is_not_verified: true,
    })
    expect(semantic.plan).toMatchObject({
      state: 'ready',
      snapshot_hash: snapshotHash,
      application: { name: '合同风险识别应用' },
      route: { name: '合同审核默认路由', failure_action: 'manual_review' },
      configured_candidates: [
        expect.objectContaining({ position: 1, execution_status: 'effective', effective_position: 1 }),
        expect.objectContaining({ position: 2, execution_status: 'effective', effective_position: 2 }),
      ],
      candidates: expect.arrayContaining([
        expect.objectContaining({
          position: 1,
          role: 'primary',
          model_name: '审核主模型',
          model_id: 'review-model-v1',
          provider_name: '云端模型网关',
        }),
        expect.objectContaining({
          position: 2,
          role: 'fallback',
          model_name: '审核降级模型',
          model_id: 'review-model-fallback-v1',
        }),
      ]),
    })
    expect(semantic.environment_projections.local).toMatchObject({
      state: 'ready',
      execution_environment: 'local',
    })
    expect(semantic.environment_projections.hosted).toMatchObject({
      state: 'ready',
      execution_environment: 'hosted',
    })
    expect(semantic.verification).toBe('fallback_passed')
    expect(semantic.latest_current_attempt).toMatchObject({
      id: 'invocation-fallback',
      execution_id: EXECUTION_ID,
      matches_current_plan: true,
      outcome: 'fallback_passed',
      model: 'review-model-fallback-v1-202607',
      snapshot_integrity: 'verified',
      freshness: 'fresh',
      review_run_id: 'review-run-1',
      tokens: { input: 120, output: 30, total: 150, evidence: 'provider' },
    })
    expect(semantic.latest_current_execution_attempts.map((attempt: any) => attempt.id)).toEqual([
      'invocation-primary-failed',
      'invocation-fallback',
    ])
    expect(semantic.latest_current_execution_complete).toBe(true)
    const routeAttemptWithPinnedIdentity = structuredClone(body.data)
    routeAttemptWithPinnedIdentity.use_points[0].latest_attempts[0].pinned_model_catalog_entry_id = 'model.review.fallback'
    expect(isAIRuntimeOverview(routeAttemptWithPinnedIdentity)).toBe(false)

    const routeAttemptInPinnedSlot = structuredClone(body.data)
    routeAttemptInPinnedSlot.use_points[0].latest_pinned_attempt = {
      ...routeAttemptInPinnedSlot.use_points[0].latest_current_attempt,
    }
    expect(isAIRuntimeOverview(routeAttemptInPinnedSlot)).toBe(false)

    const pinnedAttemptInRouteSlot = structuredClone(body.data)
    pinnedAttemptInRouteSlot.use_points[0].latest_current_attempt = {
      ...pinnedAttemptInRouteSlot.use_points[0].latest_current_attempt,
      execution_mode: 'pinned',
      pinned_model_catalog_entry_id: 'model.review.fallback',
    }
    expect(isAIRuntimeOverview(pinnedAttemptInRouteSlot)).toBe(false)

    const forgedPassedWithoutExecution = structuredClone(body.data)
    const forgedSemantic = forgedPassedWithoutExecution.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))
    forgedSemantic.verification = 'passed'
    forgedSemantic.latest_current_attempt = null
    forgedSemantic.latest_current_execution_attempts = []
    forgedSemantic.latest_current_execution_complete = false
    forgedPassedWithoutExecution.summary.verified_current_plans = forgedPassedWithoutExecution.use_points
      .filter((item: any) => item.verification === 'passed' || item.verification === 'fallback_passed').length
    expect(isAIRuntimeOverview(forgedPassedWithoutExecution)).toBe(false)

    const driftedSelectedProjection = structuredClone(body.data)
    const driftedSemantic = driftedSelectedProjection.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))
    driftedSemantic.environment_projections.local.application.name = '漂移的应用名称'
    expect(isAIRuntimeOverview(driftedSelectedProjection)).toBe(false)

    const forgedSummary = structuredClone(body.data)
    forgedSummary.summary.ready_plans += 1
    expect(isAIRuntimeOverview(forgedSummary)).toBe(false)
    expect(queries).toHaveLength(5)
    expect(queries[0].select).toHaveBeenCalledTimes(1)
    expect(queries[0].not).toHaveBeenCalledWith('plan_snapshot_id', 'is', null)
    expect(queries[0].eq).toHaveBeenCalledWith('business_use_point_id', 'contract.review.semantic')
    expect(mocks.listPublishedConfigsByType).toHaveBeenCalledWith('AI_CONFIG', 'org-1')
    expect(mocks.from).toHaveBeenCalledTimes(5)
    expect(mocks.from).toHaveBeenCalledWith('model_invocations')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('does not call an isolated second-candidate success a fallback without the same execution failure chain', async () => {
    const rows = publishedRows()
    const completedAt = new Date(Date.now() - 1_000).toISOString()
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'orphan-fallback-success',
      execution_id: EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.fallback',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-fallback-v1',
      attempt_no: 2,
      status: 'completed',
      degraded: true,
      fallback_reason: 'PROVIDER_UNAVAILABLE',
      latency_ms: 840,
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
      error_message: null,
      review_id: 'review-run-1',
      created_at: completedAt,
      completed_at: completedAt,
      plan_snapshot: snapshotEmbed(rows),
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(semantic.verification).toBe('incomplete_evidence')
    expect(semantic.latest_current_attempt).toMatchObject({
      id: 'orphan-fallback-success',
      matches_current_plan: true,
      outcome: 'incomplete_evidence',
    })
    expect(semantic.latest_current_execution_attempts).toHaveLength(1)
    expect(semantic.latest_current_execution_complete).toBe(false)
  })

  it('uses the same primary and fallback audit semantics as formal ReviewRun evidence', async () => {
    const rows = publishedRows()
    const snapshot = snapshotEmbed(rows)
    const completedAt = new Date(Date.now() - 1_000).toISOString()
    const primarySuccess = {
      id: 'primary-success-with-fallback-reason',
      execution_id: EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v1',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      fallback_reason: 'SHOULD_NOT_EXIST',
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      error_message: null,
      review_id: 'review-run-1',
      created_at: completedAt,
      completed_at: completedAt,
      plan_snapshot: snapshot,
    }
    makeInvocationQueries({ 'contract.review.semantic': [primarySuccess] })
    const primaryResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    const primaryBody = await primaryResponse.json()
    const primarySemantic = primaryBody.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    expect(primarySemantic.verification).toBe('incomplete_evidence')
    expect(primarySemantic.latest_current_attempt.outcome).toBe('incomplete_evidence')

    const failedPrimary = {
      ...primarySuccess,
      id: 'primary-failure-without-degraded-truth',
      status: 'failed',
      degraded: false,
      fallback_reason: 'TIMEOUT',
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      error_message: '模型请求超时。',
      created_at: new Date(Date.now() - 2_000).toISOString(),
    }
    const fallbackSuccess = {
      ...primarySuccess,
      id: 'fallback-success',
      model_catalog_entry_id: 'model.review.fallback',
      model: 'review-model-fallback-v1',
      attempt_no: 2,
      degraded: true,
      fallback_reason: 'TIMEOUT',
    }
    makeInvocationQueries({ 'contract.review.semantic': [fallbackSuccess, failedPrimary] })
    const degradedResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    const degradedBody = await degradedResponse.json()
    const degradedSemantic = degradedBody.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    expect(degradedSemantic.verification).toBe('incomplete_evidence')

    makeInvocationQueries({ 'contract.review.semantic': [
      { ...fallbackSuccess, fallback_reason: 'PROVIDER_UNAVAILABLE' },
      { ...failedPrimary, degraded: true },
    ] })
    const mismatchResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    const mismatchBody = await mismatchResponse.json()
    const mismatchSemantic = mismatchBody.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    expect(mismatchSemantic.verification).toBe('incomplete_evidence')
  })

  it('only calls a failed execution complete after the published route is exhausted', async () => {
    const rows = publishedRows()
    const snapshot = snapshotEmbed(rows)
    const primaryFailure = {
      id: 'primary-failed',
      execution_id: EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v1',
      attempt_no: 1,
      status: 'failed',
      degraded: true,
      fallback_reason: 'PROVIDER_UNAVAILABLE',
      latency_ms: 200,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      error_message: '主模型不可达',
      review_id: 'review-run-1',
      created_at: new Date(Date.now() - 2_000).toISOString(),
      completed_at: new Date(Date.now() - 1_800).toISOString(),
      plan_snapshot: snapshot,
    }
    makeInvocationQueries({ 'contract.review.semantic': [primaryFailure] })

    const inProgressResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    const inProgressBody = await inProgressResponse.json()
    const inProgress = inProgressBody.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    expect(inProgress.verification).toBe('incomplete_evidence')
    expect(inProgress.latest_current_execution_complete).toBe(false)

    makeInvocationQueries({ 'contract.review.semantic': [{
      ...primaryFailure,
      id: 'fallback-failed',
      model_catalog_entry_id: 'model.review.fallback',
      model: 'review-model-fallback-v1',
      attempt_no: 2,
      error_message: '降级模型也不可达',
      created_at: new Date(Date.now() - 1_000).toISOString(),
      completed_at: new Date(Date.now() - 800).toISOString(),
    }, primaryFailure] })

    const exhaustedResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    const exhaustedBody = await exhaustedResponse.json()
    const exhausted = exhaustedBody.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    expect(exhausted.verification).toBe('failed')
    expect(exhausted.latest_current_execution_complete).toBe(true)
    expect(exhausted.latest_current_execution_attempts.map((attempt: any) => attempt.attempt_no)).toEqual([1, 2])

    const failuresWithoutReviewRun = [{
      ...primaryFailure,
      id: 'fallback-failed-without-review',
      model_catalog_entry_id: 'model.review.fallback',
      model: 'review-model-fallback-v1',
      attempt_no: 2,
      review_id: null,
      created_at: new Date(Date.now() - 1_000).toISOString(),
      completed_at: new Date(Date.now() - 800).toISOString(),
    }, {
      ...primaryFailure,
      id: 'primary-failed-without-review',
      review_id: null,
    }]
    makeInvocationQueries({ 'contract.review.semantic': failuresWithoutReviewRun })

    const unauditedResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    const unauditedBody = await unauditedResponse.json()
    const unaudited = unauditedBody.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    expect(unaudited.verification).toBe('incomplete_evidence')
    expect(unaudited.latest_current_execution_complete).toBe(false)
    expect(unaudited.latest_current_execution_attempts.every((attempt: any) => (
      attempt.outcome === 'incomplete_evidence' && attempt.review_run_id === null
    ))).toBe(true)
  })

  it('keeps pre-migration rows without execution identity as history, not current availability proof', async () => {
    const rows = publishedRows()
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'legacy-un-grouped-success',
      execution_id: null,
      execution_mode: null,
      pinned_model_catalog_entry_id: null,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v1',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      fallback_reason: null,
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      review_id: 'review-run-old',
      created_at: new Date(Date.now() - 2_000).toISOString(),
      completed_at: new Date(Date.now() - 1_500).toISOString(),
      plan_snapshot: snapshotEmbed(rows),
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(semantic.verification).toBe('not_verified')
    expect(semantic.latest_current_attempt).toBeNull()
    expect(semantic.latest_attempts[0]).toMatchObject({
      id: 'legacy-un-grouped-success',
      matches_current_plan: false,
      outcome: 'incomplete_evidence',
    })
  })

  it('shows a successful pinned model probe without counting it as published-route verification', async () => {
    const rows = publishedRows()
    makeInvocationQueries({ 'contract.review.semantic': [pinnedInvocation(rows)] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(isAIRuntimeOverview(body.data)).toBe(true)
    expect(semantic.verification).toBe('not_verified')
    expect(semantic.latest_current_attempt).toBeNull()
    expect(semantic.latest_current_execution_attempts).toEqual([])
    expect(semantic.latest_pinned_attempt).toMatchObject({
      id: 'pinned-fallback-probe',
      execution_mode: 'pinned',
      outcome: 'passed',
      matches_current_plan: true,
    })
    expect(body.data.summary.verified_current_plans).toBe(0)

    const mismatchedPinnedIdentity = structuredClone(body.data)
    const pinned = mismatchedPinnedIdentity.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))
    pinned.latest_pinned_attempt.pinned_model_catalog_entry_id = 'model.review.primary'
    expect(isAIRuntimeOverview(mismatchedPinnedIdentity)).toBe(false)
  })

  it('shows a failed pinned probe as a complete single-model failure without failing the route', async () => {
    const rows = publishedRows()
    makeInvocationQueries({ 'contract.review.semantic': [pinnedInvocation(rows, {
      id: 'pinned-fallback-failed',
      status: 'failed',
      degraded: true,
      fallback_reason: 'PROVIDER_UNAVAILABLE',
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      error_message: '指定模型不可达',
    })] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(semantic.verification).toBe('not_verified')
    expect(semantic.latest_current_execution_complete).toBe(false)
    expect(semantic.latest_pinned_attempt).toMatchObject({
      id: 'pinned-fallback-failed',
      execution_mode: 'pinned',
      outcome: 'failed',
      failure_code: 'PROVIDER_UNAVAILABLE',
    })
  })

  it('does not let an older plan success verify the current published plan', async () => {
    const currentRows = publishedRows()
    const oldRows = currentRows.map((row) => row.id === 'model-config'
      ? { ...row, value: { ...row.value, model_id: 'review-model-v0' } }
      : row)
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'stale-success',
      execution_id: OLD_EXECUTION_ID,
      plan_snapshot_id: 'snapshot-old',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v0',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      review_id: 'review-run-old',
      created_at: new Date(Date.now() - 2_000).toISOString(),
      completed_at: new Date(Date.now() - 1_500).toISOString(),
      plan_snapshot: snapshotEmbed(oldRows, 'snapshot-old'),
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))

    expect(semantic.plan.state).toBe('ready')
    expect(semantic.verification).toBe('not_verified')
    expect(semantic.latest_current_attempt).toBeNull()
    expect(semantic.latest_attempts[0]).toMatchObject({
      id: 'stale-success',
      matches_current_plan: false,
      outcome: 'passed',
    })
  })

  it('rejects an attempt whose hash matches but whose model/provider are not candidates in the current plan', async () => {
    const rows = publishedRows()
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'unrelated-candidate',
      execution_id: EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.not-in-route',
      provider_connection_id: 'provider.not-in-route',
      provider: 'provider.not-in-route',
      model: 'unrelated-model',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      review_id: 'review-run-1',
      created_at: new Date(Date.now() - 2_000).toISOString(),
      completed_at: new Date(Date.now() - 1_500).toISOString(),
      plan_snapshot: snapshotEmbed(rows),
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))

    expect(semantic.verification).toBe('not_verified')
    expect(semantic.latest_current_attempt).toBeNull()
    expect(semantic.latest_attempts[0].matches_current_plan).toBe(false)
    expect(semantic.latest_attempts[0].snapshot_integrity).toBe('verified')
    expect(semantic.latest_attempts[0].outcome).toBe('incomplete_evidence')
  })

  it('rejects a tampered immutable snapshot even when its stored hash claims to be current', async () => {
    const rows = publishedRows()
    const snapshot = snapshotEmbed(rows)
    const tamperedSnapshot = {
      ...snapshot,
      snapshot: {
        ...snapshot.snapshot,
        application: {
          ...snapshot.snapshot.application,
          assetId: 'app.tampered',
        },
      },
    }
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'tampered-snapshot-attempt',
      execution_id: EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v1',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      review_id: 'review-run-1',
      created_at: new Date(Date.now() - 2_000).toISOString(),
      completed_at: new Date(Date.now() - 1_500).toISOString(),
      plan_snapshot: tamperedSnapshot,
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(semantic.verification).toBe('not_verified')
    expect(semantic.latest_current_attempt).toBeNull()
    expect(semantic.latest_attempts[0]).toMatchObject({
      id: 'tampered-snapshot-attempt',
      snapshot_integrity: 'invalid',
      matches_current_plan: false,
      outcome: 'incomplete_evidence',
    })
  })

  it('expires an old success instead of claiming the model is currently available', async () => {
    const rows = publishedRows()
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'old-current-success',
      execution_id: OLD_EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v1',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      review_id: 'review-run-old',
      created_at: new Date(Date.now() - 49 * 60 * 60 * 1_000).toISOString(),
      completed_at: new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString(),
      plan_snapshot: snapshotEmbed(rows),
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(semantic.verification).toBe('stale')
    expect(semantic.latest_current_attempt).toMatchObject({
      id: 'old-current-success',
      matches_current_plan: true,
      freshness: 'stale',
      outcome: 'passed',
    })
    expect(body.data.summary.verified_current_plans).toBe(0)
  })

  it('does not accept a contract semantic completion without ReviewRun linkage', async () => {
    const rows = publishedRows()
    makeInvocationQueries({ 'contract.review.semantic': [{
      id: 'missing-review-run',
      execution_id: EXECUTION_ID,
      plan_snapshot_id: 'snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      model_catalog_entry_id: 'model.review.primary',
      provider_connection_id: 'provider.cloud',
      provider: 'provider.cloud',
      model: 'review-model-v1',
      attempt_no: 1,
      status: 'completed',
      degraded: false,
      latency_ms: 500,
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      review_id: null,
      created_at: new Date(Date.now() - 2_000).toISOString(),
      completed_at: new Date(Date.now() - 1_500).toISOString(),
      plan_snapshot: snapshotEmbed(rows),
    }] })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(semantic.verification).toBe('incomplete_evidence')
    expect(semantic.latest_current_attempt).toMatchObject({
      outcome: 'incomplete_evidence',
      review_run_required: true,
      review_run_id: null,
    })
  })

  it('returns a human-actionable blocked use point without falling back to ModelPolicy', async () => {
    const rows = publishedRows().filter((row) => row.value?.kind !== 'application_binding')
    mocks.listPublishedConfigsByType.mockResolvedValue(rows)

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))

    expect(res.status).toBe(200)
    expect(semantic.verification).toBe('blocked')
    expect(semantic.plan).toMatchObject({
      state: 'blocked',
      execution_environment: 'local',
      code: 'BINDING_NOT_FOUND',
      reason: '这个产品功能还没有选择 AI 能力。',
      next_action: '为这个产品功能选择并发布一项 AI 能力。',
    })
    expect(semantic.plan.reason).not.toContain('business_use_point')
    expect(semantic.plan.reason).not.toContain('contract.review.semantic')
    expect(semantic.environment_projections.local).toEqual(semantic.plan)
    expect(semantic.environment_projections.hosted).toMatchObject({
      state: 'blocked',
      execution_environment: 'hosted',
      code: 'BINDING_NOT_FOUND',
    })
    expect(body.data.summary.blocked_plans).toBeGreaterThan(0)
  })

  it('keeps plans visible but refuses to claim availability when evidence storage is unavailable', async () => {
    makeInvocationQueries({}, { message: 'model_invocations evidence schema unavailable' })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()
    const semantic = body.data.use_points.find((item: any) => (
      item.use_point.asset_id === 'contract.review.semantic'
    ))

    expect(res.status).toBe(200)
    expect(body.data.evidence).toMatchObject({
      available: false,
      source: 'immutable_plan_snapshots_and_model_invocations',
      freshness_window_hours: 24,
      error: '部分业务用点的真实模型调用证据暂时无法读取；对应业务用点不能据此判断模型可用。',
    })
    expect(body.data.evidence.unavailable_use_points).toContain('contract.review.semantic')
    expect(semantic.plan.state).toBe('ready')
    expect(semantic.evidence_available).toBe(false)
    expect(semantic.verification).toBe('evidence_unavailable')
  })

  it('uses the same hosted environment predicate as the real business entrypoints', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('VERCEL_REGION', '')
    makeInvocationQueries()

    const localResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    expect((await localResponse.json()).data.execution_environment).toBe('local')

    vi.stubEnv('VERCEL_URL', 'candidate.vercel.app')
    makeInvocationQueries()
    const hostedResponse = await GET({ method: 'GET', headers: new Headers() } as any)
    expect((await hostedResponse.json()).data.execution_environment).toBe('hosted')
  })

  it('shows the administrator route and hosted projection without treating local exclusion as fallback', async () => {
    const rows = hostedMixedRows()
    mocks.listPublishedConfigsByType.mockResolvedValue(rows)
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_URL', 'candidate.vercel.app')
    makeInvocationQueries()

    const response = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await response.json()
    const semantic = body.data.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')

    expect(response.status).toBe(200)
    expect(isAIRuntimeOverview(body.data)).toBe(true)
    expect(semantic.verification).toBe('not_verified')
    expect(semantic.plan.configured_candidates).toEqual([
      expect.objectContaining({
        position: 1,
        model_catalog_entry_id: 'model.local',
        runtime_location: 'local',
        execution_status: 'excluded_from_hosted',
        effective_position: null,
      }),
      expect.objectContaining({
        position: 2,
        model_catalog_entry_id: 'model.review.primary',
        runtime_location: 'cloud',
        execution_status: 'effective',
        effective_position: 1,
      }),
    ])
    expect(semantic.plan.candidates).toEqual([
      expect.objectContaining({
        position: 1,
        role: 'primary',
        model_catalog_entry_id: 'model.review.primary',
      }),
    ])
    expect(semantic.environment_projections.local).toMatchObject({
      state: 'ready',
      execution_environment: 'local',
      configured_candidates: [
        expect.objectContaining({
          model_catalog_entry_id: 'model.local',
          execution_status: 'effective',
          effective_position: 1,
        }),
        expect.objectContaining({
          model_catalog_entry_id: 'model.review.primary',
          execution_status: 'effective',
          effective_position: 2,
        }),
      ],
      candidates: [
        expect.objectContaining({ model_catalog_entry_id: 'model.local', position: 1, role: 'primary' }),
        expect.objectContaining({ model_catalog_entry_id: 'model.review.primary', position: 2, role: 'fallback' }),
      ],
    })
    expect(semantic.environment_projections.hosted).toEqual(semantic.plan)
    expect(semantic.latest_current_execution_attempts).toEqual([])

    const invalidHostedExclusion = structuredClone(body.data)
    const invalidSemantic = invalidHostedExclusion.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    invalidSemantic.plan.configured_candidates[0].runtime_location = 'cloud'
    expect(isAIRuntimeOverview(invalidHostedExclusion)).toBe(false)

    const invalidLocalProjection = structuredClone(body.data)
    const invalidLocalSemantic = invalidLocalProjection.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    invalidLocalSemantic.environment_projections.local.candidates = []
    expect(isAIRuntimeOverview(invalidLocalProjection)).toBe(false)

    const mismatchedCurrentProjection = structuredClone(body.data)
    const mismatchedCurrentSemantic = mismatchedCurrentProjection.use_points.find((item: any) => item.use_point.asset_id === 'contract.review.semantic')
    mismatchedCurrentSemantic.environment_projections.hosted.snapshot_hash = 'f'.repeat(64)
    expect(isAIRuntimeOverview(mismatchedCurrentProjection)).toBe(false)
  })

  it('returns 403 before reading platform assets or invocation evidence', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await GET({ method: 'GET', headers: new Headers() } as any)

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'read')
    expect(mocks.listPublishedConfigsByType).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
