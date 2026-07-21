// REQ: WP02
// PURPOSE: Present the six-object AI runtime plan and immutable plan-linked invocation truth.

import { NextRequest } from 'next/server'
import {
  AIExecutionPlanError,
  compilePublishedAIExecutionPlan,
  hashAIExecutionPlanSnapshot,
  type AIExecutionEnvironment,
  type AIExecutionPlan,
  type AIExecutionPlanConfigRow,
  type AIExecutionPlanSnapshot,
} from '@/lib/ai/runtime-plan'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { successResponse, errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { userHasOrgConfigAccess } from '@/lib/configs/access'
import { BUSINESS_USE_POINT_REGISTRY } from '@/lib/configs/ai-platform-registry'
import { listPublishedConfigsByType } from '@/lib/configs/runtime'
import { redactSecretsDeep } from '@/lib/configs/secret-redaction'
import { supabaseAdmin } from '@/lib/supabase'
import type { AuthUser } from '@/lib/auth'

type JsonRecord = Record<string, unknown>

interface RuntimePlanSnapshotEmbed {
  id: string
  business_use_point_id: string
  application_id: string
  route_policy_id: string
  snapshot_sha256: string
  snapshot: unknown
}

interface RuntimeAttemptRow {
  id: string
  execution_id: string | null
  execution_mode: 'route' | 'pinned' | null
  pinned_model_catalog_entry_id: string | null
  plan_snapshot_id: string | null
  business_use_point_id: string | null
  application_id: string | null
  route_policy_id: string | null
  model_catalog_entry_id: string | null
  provider_connection_id: string | null
  provider: string | null
  model: string | null
  attempt_no: number | null
  status: string | null
  degraded: boolean | null
  fallback_reason: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  error_message: string | null
  review_id: string | null
  created_at: string | null
  completed_at: string | null
  plan_snapshot: RuntimePlanSnapshotEmbed | RuntimePlanSnapshotEmbed[] | null
}

interface VerifiedSnapshotEvidence {
  embed: RuntimePlanSnapshotEmbed
  snapshot: JsonRecord
  candidates: Array<{
    position: number
    modelAssetId: string
    providerAssetId: string
  }>
}

const MAX_EVIDENCE_ROWS_PER_USE_POINT = 100
const MAX_PRESENTED_ATTEMPTS_PER_USE_POINT = 10
const RUNTIME_EVIDENCE_FRESHNESS_MS = 24 * 60 * 60 * 1000
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000

function currentExecutionEnvironment(): AIExecutionEnvironment {
  return process.env.VERCEL === '1' && Boolean(process.env.VERCEL_URL || process.env.VERCEL_REGION)
    ? 'hosted'
    : 'local'
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function truncate(value: string | null | undefined, limit = 240): string | null {
  if (!value) return null
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function hasCompleteTokenEvidence(row: RuntimeAttemptRow): boolean {
  return Number.isSafeInteger(row.input_tokens)
    && Number.isSafeInteger(row.output_tokens)
    && Number.isSafeInteger(row.total_tokens)
    && (row.input_tokens as number) >= 0
    && (row.output_tokens as number) >= 0
    && (row.total_tokens as number) > 0
    && (row.input_tokens as number) + (row.output_tokens as number) === row.total_tokens
}

function normalizeSnapshotEmbed(row: RuntimeAttemptRow): RuntimePlanSnapshotEmbed | null {
  if (Array.isArray(row.plan_snapshot)) return row.plan_snapshot[0] || null
  return row.plan_snapshot
}

function verifySnapshotEvidence(row: RuntimeAttemptRow): VerifiedSnapshotEvidence | null {
  const embed = normalizeSnapshotEmbed(row)
  if (!embed || !row.plan_snapshot_id || embed.id !== row.plan_snapshot_id) return null
  if (!/^[0-9a-f]{64}$/.test(embed.snapshot_sha256)) return null

  const snapshot = recordValue(embed.snapshot)
  if (snapshot.schemaVersion !== 'ai-runtime-plan.v1') return null
  try {
    if (hashAIExecutionPlanSnapshot(snapshot as unknown as AIExecutionPlanSnapshot) !== embed.snapshot_sha256) {
      return null
    }
  } catch {
    return null
  }

  const usePoint = recordValue(snapshot.usePoint)
  const application = recordValue(snapshot.application)
  const route = recordValue(snapshot.route)
  if (
    embed.business_use_point_id !== row.business_use_point_id
    || embed.application_id !== row.application_id
    || embed.route_policy_id !== row.route_policy_id
    || usePoint.assetId !== embed.business_use_point_id
    || application.assetId !== embed.application_id
    || route.assetId !== embed.route_policy_id
  ) {
    return null
  }

  if (!Array.isArray(snapshot.candidates)) return null
  const candidates = snapshot.candidates.flatMap((candidateValue) => {
    const candidate = recordValue(candidateValue)
    const model = recordValue(candidate.model)
    const provider = recordValue(candidate.provider)
    const position = numberValue(candidate.position)
    const modelAssetId = stringValue(model.assetId)
    const providerAssetId = stringValue(provider.assetId)
    return position !== null && position >= 0 && modelAssetId && providerAssetId
      ? [{ position, modelAssetId, providerAssetId }]
      : []
  })

  return candidates.length === snapshot.candidates.length
    ? { embed, snapshot, candidates }
    : null
}

function snapshotCandidatePosition(
  row: RuntimeAttemptRow,
  snapshotEvidence: VerifiedSnapshotEvidence | null,
): number | null {
  if (!snapshotEvidence) return null
  return snapshotEvidence.candidates.find((candidate) => (
    candidate.modelAssetId === row.model_catalog_entry_id
    && candidate.providerAssetId === row.provider_connection_id
  ))?.position ?? null
}

function attemptOutcome(
  row: RuntimeAttemptRow,
  candidatePosition: number | null,
  reviewRunRequired: boolean,
  executionRows: RuntimeAttemptRow[],
) {
  const executionId = stringValue(row.execution_id)
  const executionMode = row.execution_mode
  if (
    candidatePosition === null
    || !executionId
    || !row.attempt_no
    || row.attempt_no < 1
    || (executionMode !== 'route' && executionMode !== 'pinned')
  ) {
    return 'incomplete_evidence' as const
  }
  const candidateMatchesAttempt = executionMode === 'pinned'
    ? row.attempt_no === 1 && row.pinned_model_catalog_entry_id === row.model_catalog_entry_id
    : candidatePosition === row.attempt_no - 1
  if (!candidateMatchesAttempt) return 'incomplete_evidence' as const
  if (reviewRunRequired && !row.review_id) return 'incomplete_evidence' as const
  if (row.status === 'failed') {
    return stringValue(row.fallback_reason) ? 'failed' as const : 'incomplete_evidence' as const
  }
  if (row.status !== 'completed' || !hasCompleteTokenEvidence(row)) {
    return 'incomplete_evidence' as const
  }
  if (executionMode === 'pinned') {
    return row.degraded ? 'incomplete_evidence' as const : 'passed' as const
  }

  if (row.degraded) {
    const predecessorByAttempt = new Map(executionRows
      .filter((candidate) => (
        candidate.execution_id === executionId
        && candidate.execution_mode === 'route'
        && candidate.id !== row.id
      ))
      .map((candidate) => [candidate.attempt_no, candidate]))
    const auditedFallback = row.attempt_no >= 2
      && candidatePosition === row.attempt_no - 1
      && Boolean(stringValue(row.fallback_reason))
      && Array.from({ length: row.attempt_no - 1 }, (_, index) => index + 1).every((attemptNo) => {
        const predecessor = predecessorByAttempt.get(attemptNo)
        if (!predecessor || predecessor.status !== 'failed' || !stringValue(predecessor.fallback_reason)) {
          return false
        }
        const predecessorSnapshot = verifySnapshotEvidence(predecessor)
        return predecessor.plan_snapshot_id === row.plan_snapshot_id
          && predecessor.review_id === row.review_id
          && predecessorSnapshot?.embed.snapshot_sha256 === verifySnapshotEvidence(row)?.embed.snapshot_sha256
          && snapshotCandidatePosition(predecessor, predecessorSnapshot) === attemptNo - 1
      })
    return auditedFallback ? 'fallback_passed' as const : 'incomplete_evidence' as const
  }

  // A non-degraded route success must be the first (primary) candidate.
  return row.attempt_no === 1 ? 'passed' as const : 'incomplete_evidence' as const
}

function attemptFreshness(row: RuntimeAttemptRow, nowMs: number) {
  const occurredAt = row.completed_at || row.created_at
  if (!occurredAt) return { freshness: 'unknown' as const, age_ms: null }
  const occurredMs = new Date(occurredAt).getTime()
  if (!Number.isFinite(occurredMs)) return { freshness: 'unknown' as const, age_ms: null }
  const ageMs = nowMs - occurredMs
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) return { freshness: 'unknown' as const, age_ms: null }
  return {
    freshness: ageMs <= RUNTIME_EVIDENCE_FRESHNESS_MS ? 'fresh' as const : 'stale' as const,
    age_ms: Math.max(0, ageMs),
  }
}

function sanitizeAttempt(
  row: RuntimeAttemptRow,
  currentPlan: ReturnType<typeof presentPlan> | null,
  usePointId: string,
  nowMs: number,
  executionRows: RuntimeAttemptRow[],
) {
  const snapshotEvidence = verifySnapshotEvidence(row)
  const candidatePosition = snapshotCandidatePosition(row, snapshotEvidence)
  const reviewRunRequired = usePointId === 'contract.review.semantic'
  const outcome = attemptOutcome(row, candidatePosition, reviewRunRequired, executionRows)
  const freshness = attemptFreshness(row, nowMs)
  const currentCandidate = currentPlan?.candidates.find((candidate) => (
    candidate.model_catalog_entry_id === row.model_catalog_entry_id
    && candidate.provider_connection_id === row.provider_connection_id
  ))
  const matchesCurrentPlan = Boolean(
    currentPlan
    && stringValue(row.execution_id)
    && (row.execution_mode === 'route' || row.execution_mode === 'pinned')
    && (row.execution_mode === 'route'
      ? row.pinned_model_catalog_entry_id === null
      : row.pinned_model_catalog_entry_id === row.model_catalog_entry_id)
    && snapshotEvidence
    && snapshotEvidence.embed.snapshot_sha256 === currentPlan.snapshot_hash
    && row.business_use_point_id === usePointId
    && row.application_id === currentPlan.application.asset_id
    && row.route_policy_id === currentPlan.route.asset_id
    && currentCandidate
    && currentCandidate.position === (candidatePosition as number) + 1
    // Providers may report a canonical/versioned model name that differs from
    // the requested alias. The immutable model asset + plan candidate proves
    // what was selected; `row.model` remains the actual provider-reported ID.
    && row.provider === currentCandidate.provider_connection_id,
  )

  return {
    id: row.id,
    execution_id: row.execution_id,
    execution_mode: row.execution_mode,
    pinned_model_catalog_entry_id: row.pinned_model_catalog_entry_id,
    plan_snapshot_id: row.plan_snapshot_id,
    plan_snapshot_hash: snapshotEvidence?.embed.snapshot_sha256 || null,
    snapshot_integrity: snapshotEvidence ? 'verified' as const : 'invalid' as const,
    matches_current_plan: matchesCurrentPlan,
    business_use_point_id: row.business_use_point_id,
    application_id: row.application_id,
    route_policy_id: row.route_policy_id,
    model_catalog_entry_id: row.model_catalog_entry_id,
    provider_connection_id: row.provider_connection_id,
    provider: row.provider,
    model: row.model,
    attempt_no: row.attempt_no,
    outcome,
    status: row.status,
    degraded: Boolean(row.degraded),
    failure_code: truncate(row.fallback_reason, 100),
    error_message: truncate(row.error_message),
    latency_ms: row.latency_ms,
    tokens: hasCompleteTokenEvidence(row)
      ? {
          input: row.input_tokens as number,
          output: row.output_tokens as number,
          total: row.total_tokens as number,
          evidence: 'provider' as const,
        }
      : {
          input: null,
          output: null,
          total: null,
          evidence: 'missing' as const,
        },
    review_run_required: reviewRunRequired,
    review_run_id: row.review_id,
    occurred_at: row.completed_at || row.created_at,
    ...freshness,
  }
}

function clonePresentedAttempt(attempt: ReturnType<typeof sanitizeAttempt>) {
  return {
    ...attempt,
    tokens: { ...attempt.tokens },
  }
}

function planErrorAction(code: string): string {
  switch (code) {
    case 'USE_POINT_NOT_FOUND': return '登记并发布这个业务用点。'
    case 'USE_POINT_DISABLED': return '启用并发布这个业务用点的新版本。'
    case 'USE_POINT_REGISTRY_MISMATCH': return '让业务用点的模块与能力要求和产品注册事实保持一致。'
    case 'BINDING_NOT_FOUND': return '为这个业务用点发布一条应用绑定。'
    case 'BINDING_DISABLED': return '启用并发布这个业务用点的应用绑定。'
    case 'BINDING_AMBIGUOUS': return '只保留一条已发布且启用的应用绑定。'
    case 'APPLICATION_NOT_FOUND': return '发布绑定所指向的 AI 应用。'
    case 'APPLICATION_DISABLED': return '启用并发布绑定所指向的 AI 应用。'
    case 'APPLICATION_CAPABILITY_MISMATCH': return '补齐 AI 应用所需能力，或改绑到能力匹配的应用。'
    case 'ROUTE_NOT_FOUND': return '为 AI 应用发布一条路由策略。'
    case 'ROUTE_DISABLED': return '启用并发布 AI 应用的路由策略。'
    case 'ROUTE_AMBIGUOUS': return '只保留一条已发布且启用的路由策略。'
    case 'EMPTY_ROUTE': return '按主模型到降级模型的顺序添加至少一个候选。'
    case 'MODEL_NOT_FOUND': return '发布路由引用的模型目录条目。'
    case 'MODEL_DISABLED': return '启用并发布路由引用的模型。'
    case 'MODEL_CAPABILITY_MISMATCH': return '选择覆盖应用能力要求的模型。'
    case 'PROVIDER_NOT_FOUND': return '发布模型所引用的 Provider 连接。'
    case 'PROVIDER_DISABLED': return '启用并发布模型所引用的 Provider 连接。'
    case 'PROVIDER_CREDENTIAL_MISSING': return '为 Bearer Provider 保存真实凭据并发布新版本。'
    case 'RUNTIME_LOCATION_INCOMPATIBLE': return '托管环境改用公网可达 Provider；本地模型只在本机运行环境验收。'
    default: return '修正已发布六对象依赖后重新检查。'
  }
}

function rowName(rowsById: Map<string, AIExecutionPlanConfigRow>, id: string): string {
  return rowsById.get(id)?.name || rowsById.get(id)?.key || id
}

function presentPlan(plan: AIExecutionPlan, rowsById: Map<string, AIExecutionPlanConfigRow>) {
  return {
    state: 'ready' as const,
    snapshot_hash: plan.snapshotHash,
    execution_environment: plan.executionEnvironment,
    application: {
      asset_id: plan.applicationId,
      name: rowName(rowsById, plan.applicationConfigId),
    },
    route: {
      asset_id: plan.routeId,
      name: rowName(rowsById, plan.routeConfigId),
      strategy: 'ordered_fallback' as const,
      timeout_ms: plan.timeoutMs,
      failure_action: plan.failureAction,
    },
    candidates: plan.candidates.map((candidate) => ({
      position: candidate.position + 1,
      role: candidate.position === 0 ? 'primary' as const : 'fallback' as const,
      model_catalog_entry_id: candidate.modelAssetId,
      model_name: rowName(rowsById, candidate.modelConfigId),
      model_id: candidate.modelId,
      provider_connection_id: candidate.providerAssetId,
      provider_name: rowName(rowsById, candidate.providerConfigId),
      runtime_location: candidate.runtimeLocation,
      auth_mode: candidate.authMode,
      credential_state: candidate.authMode === 'none' ? 'not_required' as const : 'stored' as const,
    })),
  }
}

function blockedPlan(error: AIExecutionPlanError) {
  return {
    state: 'blocked' as const,
    code: error.code,
    reason: error.message,
    next_action: planErrorAction(error.code),
  }
}

function verificationState(
  plan: ReturnType<typeof presentPlan> | ReturnType<typeof blockedPlan>,
  evidenceAvailable: boolean,
  latestAttempt: ReturnType<typeof sanitizeAttempt> | null,
  executionComplete: boolean,
) {
  if (plan.state === 'blocked') return 'blocked' as const
  if (!evidenceAvailable) return 'evidence_unavailable' as const
  if (!latestAttempt) return 'not_verified' as const
  if (latestAttempt.freshness === 'stale') return 'stale' as const
  if (latestAttempt.freshness === 'unknown' || !executionComplete) return 'incomplete_evidence' as const
  if (latestAttempt.outcome === 'passed') return 'passed' as const
  if (latestAttempt.outcome === 'fallback_passed') return 'fallback_passed' as const
  if (latestAttempt.outcome === 'failed') return 'failed' as const
  return 'incomplete_evidence' as const
}

function latestCurrentExecution(
  attempts: ReturnType<typeof sanitizeAttempt>[],
  plan: ReturnType<typeof presentPlan> | null,
) {
  if (!plan) return { attempts: [] as ReturnType<typeof sanitizeAttempt>[], complete: false }
  const latestExecutionId = attempts.find((attempt) => (
    attempt.matches_current_plan && attempt.execution_mode === 'route'
  ))?.execution_id
  if (!latestExecutionId) return { attempts: [] as ReturnType<typeof sanitizeAttempt>[], complete: false }

  const executionAttempts = attempts
    .filter((attempt) => (
      attempt.matches_current_plan
      && attempt.execution_mode === 'route'
      && attempt.execution_id === latestExecutionId
    ))
    .sort((left, right) => (left.attempt_no || 0) - (right.attempt_no || 0))
  const hasContinuousAttemptNumbers = executionAttempts.length > 0
    && executionAttempts.every((attempt, index) => attempt.attempt_no === index + 1)
  const finalAttempt = executionAttempts.at(-1) || null
  const completedBySuccess = finalAttempt?.outcome === 'passed' || finalAttempt?.outcome === 'fallback_passed'
  const completedByExhaustion = executionAttempts.length === plan.candidates.length
    && executionAttempts.every((attempt) => attempt.outcome === 'failed')

  return {
    attempts: executionAttempts,
    complete: hasContinuousAttemptNumbers && (completedBySuccess || completedByExhaustion),
  }
}

async function loadLatestRuntimeAttempts(orgId: string, usePointId: string): Promise<RuntimeAttemptRow[]> {
  const { data, error } = await supabaseAdmin
    .from('model_invocations')
    .select(`
      id,
      execution_id,
      execution_mode,
      pinned_model_catalog_entry_id,
      plan_snapshot_id,
      business_use_point_id,
      application_id,
      route_policy_id,
      model_catalog_entry_id,
      provider_connection_id,
      provider,
      model,
      attempt_no,
      status,
      degraded,
      fallback_reason,
      latency_ms,
      input_tokens,
      output_tokens,
      total_tokens,
      error_message,
      review_id,
      created_at,
      completed_at,
      plan_snapshot:ai_runtime_plan_snapshots!model_invocations_runtime_plan_identity_fkey(
        id,
        business_use_point_id,
        application_id,
        route_policy_id,
        snapshot_sha256,
        snapshot
      )
    `)
    .eq('org_id', orgId)
    .eq('business_use_point_id', usePointId)
    .not('plan_snapshot_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_EVIDENCE_ROWS_PER_USE_POINT)

  if (error) throw error
  // Generated database types lag the WP02 migration until the Preview schema
  // is regenerated; the selected runtime evidence contract is asserted here.
  return (data || []) as unknown as RuntimeAttemptRow[]
}

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    try {
      if (!await userHasOrgConfigAccess(user.id, orgId, 'read')) {
        return errorResponse(createApiError('FORBIDDEN'))
      }

      const publishedRows = await listPublishedConfigsByType('AI_CONFIG', orgId) as AIExecutionPlanConfigRow[]
      const rowsById = new Map(publishedRows.map((row) => [row.id, row]))
      const executionEnvironment = currentExecutionEnvironment()
      const now = new Date()
      const evidenceResults = await Promise.all(BUSINESS_USE_POINT_REGISTRY.map(async (definition) => {
        try {
          return {
            usePointId: definition.asset_id,
            available: true as const,
            rows: await loadLatestRuntimeAttempts(orgId, definition.asset_id),
          }
        } catch (error) {
          console.error(`[AI runtime truth] evidence unavailable for ${definition.asset_id}:`, error)
          return {
            usePointId: definition.asset_id,
            available: false as const,
            rows: [] as RuntimeAttemptRow[],
          }
        }
      }))
      const evidenceByUsePoint = new Map(evidenceResults.map((result) => [result.usePointId, result]))

      const usePoints = BUSINESS_USE_POINT_REGISTRY.map((definition) => {
        let plan: ReturnType<typeof presentPlan> | ReturnType<typeof blockedPlan>
        try {
          plan = presentPlan(compilePublishedAIExecutionPlan({
            orgId,
            usePointId: definition.asset_id,
            executionEnvironment,
            rows: publishedRows,
          }), rowsById)
        } catch (error) {
          if (!(error instanceof AIExecutionPlanError)) throw error
          plan = blockedPlan(error)
        }

        const evidence = evidenceByUsePoint.get(definition.asset_id)
        const currentPlan = plan.state === 'ready' ? plan : null
        const evidenceRows = evidence?.rows || []
        const sanitizedEvidence = evidenceRows.map((row) => sanitizeAttempt(
          row,
          currentPlan,
          definition.asset_id,
          now.getTime(),
          evidenceRows,
        ))
        const latestAttempts = sanitizedEvidence
          .slice(0, MAX_PRESENTED_ATTEMPTS_PER_USE_POINT)
          .map(clonePresentedAttempt)
        const evidenceAvailable = evidence?.available === true
        const currentExecution = latestCurrentExecution(sanitizedEvidence, currentPlan)
        const latestCurrentAttempt = currentExecution.attempts.at(-1) || null
        const latestPinnedAttempt = sanitizedEvidence.find((attempt) => (
          attempt.matches_current_plan && attempt.execution_mode === 'pinned'
        )) || null
        const verification = verificationState(
          plan,
          evidenceAvailable,
          latestCurrentAttempt,
          currentExecution.complete,
        )
        const latestCurrentExecutionAttempts = currentExecution.attempts.map(clonePresentedAttempt)

        return {
          use_point: {
            asset_id: definition.asset_id,
            name: definition.display_name,
            module_id: definition.module_id,
            description: definition.description,
          },
          evidence_available: evidenceAvailable,
          plan,
          verification,
          latest_current_attempt: latestCurrentAttempt ? clonePresentedAttempt(latestCurrentAttempt) : null,
          latest_current_execution_complete: currentExecution.complete,
          latest_current_execution_attempts: latestCurrentExecutionAttempts,
          latest_pinned_attempt: latestPinnedAttempt ? clonePresentedAttempt(latestPinnedAttempt) : null,
          latest_attempts: latestAttempts,
        }
      })

      const unavailableUsePoints = evidenceResults
        .filter((result) => !result.available)
        .map((result) => result.usePointId)
      const response = {
        schema_version: 'ai-runtime-overview.v1' as const,
        source: 'published_ai_platform_assets' as const,
        generated_at: now.toISOString(),
        execution_environment: executionEnvironment,
        evidence: {
          available: unavailableUsePoints.length === 0,
          source: 'immutable_plan_snapshots_and_model_invocations' as const,
          freshness_window_hours: RUNTIME_EVIDENCE_FRESHNESS_MS / 3_600_000,
          unavailable_use_points: unavailableUsePoints,
          error: unavailableUsePoints.length > 0
            ? '部分业务用点的真实模型调用证据暂时无法读取；对应业务用点不能据此判断模型可用。'
            : null,
        },
        summary: {
          registered_use_points: usePoints.length,
          ready_plans: usePoints.filter((item) => item.plan.state === 'ready').length,
          blocked_plans: usePoints.filter((item) => item.plan.state === 'blocked').length,
          verified_current_plans: usePoints.filter((item) => (
            item.verification === 'passed' || item.verification === 'fallback_passed'
          )).length,
        },
        use_points: usePoints,
        truth_contract: {
          legacy_model_policy_consumed: false,
          environment_route_fallback_consumed: false,
          configured_or_published_is_not_verified: true,
        },
      }

      const storedSecrets = publishedRows
        .map((row) => stringValue(row.value?.api_key))
        .filter((value): value is string => Boolean(value))
      return successResponse(redactSecretsDeep(response, storedSecrets))
    } catch (error) {
      console.error('[AI runtime truth] failed:', error)
      return errorResponse(createApiError('DB_ERROR', '读取 AI 运行计划与真实调用证据失败'))
    }
  })
}
