import { createHash, randomUUID } from 'node:crypto'

import { openAICompatibleChatCompletionsUrl } from '@/lib/ai/openai-compatible'
import {
  hashAIExecutionPlanSnapshot,
  resolvePublishedAIExecutionPlan,
  type AIExecutionCandidate,
  type AIExecutionEnvironment,
  type AIExecutionPlan,
} from '@/lib/ai/runtime-plan'
import {
  createSafeProviderProbeTransport,
  type SafeProviderProbeTransport,
} from '@/lib/configs/provider-endpoint.server'
import { supabaseAdmin } from '@/lib/supabase'

type JsonRecord = Record<string, unknown>

export type AIExecutionMessage = Readonly<{
  role: 'system' | 'user' | 'assistant'
  content: string
}>

export type AIExecutionUsage = Readonly<{
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  evidence: 'provider' | 'missing'
}>

export type AIOutputValidation<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>

export interface AIExecutionAttemptRecord {
  orgId: string
  contractId?: string | null
  reviewId?: string | null
  skillBundleId?: string | null
  planSnapshotId: string
  executionId: string
  executionMode: AIExecutionMode
  pinnedModelCatalogEntryId: string | null
  usePointId: string
  applicationId: string
  routePolicyId: string
  modelCatalogEntryId: string
  providerConnectionId: string
  provider: string
  model: string
  attemptNo: number
  status: 'completed' | 'failed'
  degraded: boolean
  fallbackReason: string | null
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  requestMeta: JsonRecord
  responseMeta: JsonRecord
  errorMessage: string | null
  startedAt: string
  completedAt: string
}

export interface AIExecutionAttemptEvidence extends AIExecutionAttemptRecord {
  id: string
}

export interface AIExecutionResult<T = string> {
  text: string
  value: T
  provider: string
  model: string
  modelAssetId: string
  providerAssetId: string
  planSnapshotId: string
  executionId: string
  executionMode: AIExecutionMode
  pinnedModelCatalogEntryId: string | null
  planSnapshotHash: string
  usage: AIExecutionUsage
  latencyMs: number
  degraded: boolean
  invocationId: string
  invocationIds: string[]
  attempts: AIExecutionAttemptEvidence[]
}

export type AIExecutionFailureAction = 'manual_review' | 'stop'
export type AIExecutionMode = 'route' | 'pinned'

export class AIExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly failureAction: AIExecutionFailureAction,
    public readonly attempts: readonly AIExecutionAttemptEvidence[],
    public readonly planSnapshotId: string | null,
    public readonly executionId: string | null = null,
    public readonly executionMode: AIExecutionMode | null = null,
    public readonly pinnedModelCatalogEntryId: string | null = null,
  ) {
    super(message)
    this.name = 'AIExecutionError'
  }
}

export interface ExecuteAIUsePointInput<T = string> {
  orgId: string
  usePointId: string
  executionEnvironment: AIExecutionEnvironment
  messages: readonly AIExecutionMessage[]
  contractId?: string | null
  reviewId?: string | null
  skillBundleId?: string | null
  plan?: AIExecutionPlan
  pinModelAssetId?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: JsonRecord
  validateOutput?: (text: string) => AIOutputValidation<T> | Promise<AIOutputValidation<T>>
  requestMeta?: JsonRecord
}

export interface RuntimeExecutorDependencies {
  resolvePlan?: typeof resolvePublishedAIExecutionPlan
  createTransport?: (candidate: AIExecutionCandidate) => Promise<SafeProviderProbeTransport>
  persistPlanSnapshot?: (plan: AIExecutionPlan) => Promise<{ id: string }>
  bindReviewPlan?: (input: {
    orgId: string
    reviewId: string
    contractId?: string | null
    planSnapshotId: string
  }) => Promise<void>
  recordAttempt?: (input: AIExecutionAttemptRecord) => Promise<{ id: string }>
  now?: () => number
}

type OpenAICompatiblePayload = {
  text: string
  finishReason: string | null
  usage: AIExecutionUsage
}

class CandidateAttemptError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly responseMeta: JsonRecord = {},
  ) {
    super(message)
    this.name = 'CandidateAttemptError'
  }
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function readUsage(payload: unknown): AIExecutionUsage {
  if (!payload || typeof payload !== 'object') {
    return { inputTokens: null, outputTokens: null, totalTokens: null, evidence: 'missing' }
  }
  const usage = (payload as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, totalTokens: null, evidence: 'missing' }
  }

  const record = usage as Record<string, unknown>
  const inputTokens = safePositiveInteger(record.prompt_tokens ?? record.input_tokens)
  const outputTokens = safePositiveInteger(record.completion_tokens ?? record.output_tokens)
  const reportedTotal = safePositiveInteger(record.total_tokens)
  if (inputTokens === null || outputTokens === null) {
    return { inputTokens: null, outputTokens: null, totalTokens: null, evidence: 'missing' }
  }
  const computedTotal = inputTokens + outputTokens
  if (reportedTotal !== null && reportedTotal !== computedTotal) {
    return { inputTokens: null, outputTokens: null, totalTokens: null, evidence: 'missing' }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: computedTotal,
    evidence: 'provider',
  }
}

function readTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const text = (part as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }).join('')
}

function readProviderReportedModel(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as { model?: unknown }).model
  if (typeof value !== 'string') return null
  const model = value.trim()
  return model.length > 0 && model.length <= 200 ? model : null
}

function modelIdentityResponseMeta(
  configuredModel: string,
  reportedModel: string | null,
): JsonRecord {
  return {
    reported_model: reportedModel,
    model_identity_source: reportedModel ? 'provider_reported' : 'configured_fallback',
    model_mismatch: reportedModel ? reportedModel !== configuredModel : null,
  }
}

function parseCompletionPayload(payload: unknown): OpenAICompatiblePayload {
  if (!payload || typeof payload !== 'object') {
    throw new CandidateAttemptError('INVALID_RESPONSE_JSON', 'Provider 没有返回有效 JSON。')
  }
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new CandidateAttemptError('INVALID_RESPONSE_SHAPE', 'Provider 响应缺少 choices。')
  }
  const first = choices[0]
  if (!first || typeof first !== 'object') {
    throw new CandidateAttemptError('INVALID_RESPONSE_SHAPE', 'Provider 响应 choices 结构无效。')
  }
  const message = (first as { message?: unknown }).message
  const text = message && typeof message === 'object'
    ? readTextContent((message as { content?: unknown }).content).trim()
    : ''
  if (!text) {
    throw new CandidateAttemptError('EMPTY_MODEL_OUTPUT', 'Provider 没有返回可用正文。')
  }
  const finishReason = typeof (first as { finish_reason?: unknown }).finish_reason === 'string'
    ? (first as { finish_reason: string }).finish_reason
    : null
  if (finishReason === 'length') {
    throw new CandidateAttemptError('TRUNCATED_MODEL_OUTPUT', 'Provider 输出因长度限制被截断。')
  }
  return { text, finishReason, usage: readUsage(payload) }
}

function outputHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function inputMessagesHash(messages: readonly AIExecutionMessage[]): string {
  const canonicalInput = JSON.stringify({
    schema: 'ai-input-messages.v1',
    messages: messages.map((message) => [message.role, message.content]),
  })
  return createHash('sha256').update(canonicalInput).digest('hex')
}

function boundedTimeout(value: number): number {
  if (!Number.isFinite(value)) return 60_000
  return Math.min(300_000, Math.max(100, Math.trunc(value)))
}

function validateMessages(messages: readonly AIExecutionMessage[]): void {
  if (messages.length === 0) {
    throw new Error('messages 不能为空')
  }
  for (const message of messages) {
    if (!['system', 'user', 'assistant'].includes(message.role) || !message.content.trim()) {
      throw new Error('messages 包含无效角色或空正文')
    }
  }
}

function safeError(error: unknown): { code: string; message: string; responseMeta: JsonRecord } {
  if (error instanceof CandidateAttemptError) {
    return { code: error.code, message: error.message, responseMeta: error.responseMeta }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'TIMEOUT', message: '模型请求超时。', responseMeta: {} }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'TIMEOUT', message: '模型请求超时。', responseMeta: {} }
  }
  // Do not persist raw provider bodies, URLs, request content or credentials.
  return { code: 'TRANSPORT_FAILED', message: '模型连接或传输失败。', responseMeta: {} }
}

async function defaultCreateTransport(candidate: AIExecutionCandidate) {
  return createSafeProviderProbeTransport(candidate.endpoint, candidate.runtimeLocation)
}

async function defaultPersistPlanSnapshot(plan: AIExecutionPlan): Promise<{ id: string }> {
  const row = {
    org_id: plan.orgId,
    business_use_point_id: plan.usePointId,
    application_id: plan.applicationId,
    route_policy_id: plan.routeId,
    snapshot: plan.snapshot,
    snapshot_sha256: plan.snapshotHash,
  }
  const { data, error } = await supabaseAdmin
    .from('ai_runtime_plan_snapshots')
    .insert(row)
    .select('id')
    .single()

  if (!error && data?.id) return { id: data.id as string }
  if (error?.code !== '23505') throw error || new Error('AI 运行计划快照写入失败')

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('ai_runtime_plan_snapshots')
    .select('id, snapshot')
    .eq('org_id', plan.orgId)
    .eq('snapshot_sha256', plan.snapshotHash)
    .maybeSingle()
  if (lookupError || !existing?.id) throw lookupError || new Error('AI 运行计划快照冲突后无法读回')
  if (hashAIExecutionPlanSnapshot(existing.snapshot as typeof plan.snapshot) !== plan.snapshotHash) {
    throw new Error('AI 运行计划快照哈希冲突')
  }
  return { id: existing.id as string }
}

async function defaultBindReviewPlan(input: {
  orgId: string
  reviewId: string
  contractId?: string | null
  planSnapshotId: string
}): Promise<void> {
  if (!input.contractId) {
    throw new Error('ReviewRun 绑定 AI 计划必须提供 contractId')
  }
  const { data, error } = await supabaseAdmin
    .from('contract_reviews')
    .update({ plan_snapshot_id: input.planSnapshotId })
    .eq('id', input.reviewId)
    .eq('contract_id', input.contractId)
    .select('id')
    .maybeSingle()
  if (error || !data?.id) throw error || new Error('ReviewRun 不存在或不属于指定合同')
}

async function defaultRecordAttempt(input: AIExecutionAttemptRecord): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from('model_invocations')
    .insert({
      org_id: input.orgId,
      contract_id: input.contractId || null,
      review_id: input.reviewId || null,
      skill_bundle_id: input.skillBundleId || null,
      model_policy_id: null,
      plan_snapshot_id: input.planSnapshotId,
      execution_id: input.executionId,
      execution_mode: input.executionMode,
      pinned_model_catalog_entry_id: input.pinnedModelCatalogEntryId,
      business_use_point_id: input.usePointId,
      application_id: input.applicationId,
      route_policy_id: input.routePolicyId,
      model_catalog_entry_id: input.modelCatalogEntryId,
      provider_connection_id: input.providerConnectionId,
      attempt_no: input.attemptNo,
      provider: input.provider,
      model: input.model,
      phase: input.usePointId,
      status: input.status,
      degraded: input.degraded,
      fallback_reason: input.fallbackReason,
      latency_ms: input.latencyMs,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      total_tokens: input.totalTokens,
      request_meta: input.requestMeta,
      response_meta: input.responseMeta,
      error_message: input.errorMessage,
      started_at: input.startedAt,
      completed_at: input.completedAt,
    })
    .select('id')
    .single()
  if (error || !data?.id) throw error || new Error('模型调用证据写入失败')
  return { id: data.id as string }
}

function selectCandidates(plan: AIExecutionPlan, pinModelAssetId?: string): readonly AIExecutionCandidate[] {
  if (!pinModelAssetId) return plan.candidates
  const pinned = plan.candidates.find((candidate) => candidate.modelAssetId === pinModelAssetId)
  if (!pinned) {
    throw new AIExecutionError(
      'PINNED_MODEL_NOT_IN_ROUTE',
      `指定模型不在已发布路由中：${pinModelAssetId}`,
      plan.failureAction,
      [],
      null,
    )
  }
  return [pinned]
}

export async function executeAIUsePoint<T = string>(
  input: ExecuteAIUsePointInput<T>,
  dependencies: RuntimeExecutorDependencies = {},
): Promise<AIExecutionResult<T>> {
  validateMessages(input.messages)
  const inputSha256 = inputMessagesHash(input.messages)
  const resolvePlan = dependencies.resolvePlan ?? resolvePublishedAIExecutionPlan
  const plan = input.plan ?? await resolvePlan({
    orgId: input.orgId,
    usePointId: input.usePointId,
    executionEnvironment: input.executionEnvironment,
  })
  if (plan.orgId !== input.orgId || plan.usePointId !== input.usePointId) {
    throw new Error('提供的 AI 运行计划与组织或业务用点不一致')
  }

  const persistPlanSnapshot = dependencies.persistPlanSnapshot ?? defaultPersistPlanSnapshot
  const bindReviewPlan = dependencies.bindReviewPlan ?? defaultBindReviewPlan
  const recordAttempt = dependencies.recordAttempt ?? defaultRecordAttempt
  const createTransport = dependencies.createTransport ?? defaultCreateTransport
  const now = dependencies.now ?? Date.now
  const snapshotRow = await persistPlanSnapshot(plan)
  if (input.reviewId) {
    await bindReviewPlan({
      orgId: input.orgId,
      reviewId: input.reviewId,
      contractId: input.contractId,
      planSnapshotId: snapshotRow.id,
    })
  }

  const candidates = selectCandidates(plan, input.pinModelAssetId)
  const executionId = randomUUID()
  const executionMode: AIExecutionMode = input.pinModelAssetId ? 'pinned' : 'route'
  const pinnedModelCatalogEntryId = executionMode === 'pinned' ? input.pinModelAssetId! : null
  const attempts: AIExecutionAttemptEvidence[] = []
  const previousFailureCodes: string[] = []

  for (const [index, candidate] of candidates.entries()) {
    const attemptNo = index + 1
    const startedMs = now()
    const startedAt = new Date(startedMs).toISOString()
    let transport: SafeProviderProbeTransport | null = null
    let reportedModel: string | null = null
    try {
      if (candidate.authMode === 'bearer' && !candidate.credential) {
        throw new CandidateAttemptError('CREDENTIAL_MISSING', 'Bearer Provider 缺少已发布凭据。')
      }
      transport = await createTransport(candidate)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), boundedTimeout(plan.timeoutMs))
      let response: Response
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (candidate.authMode === 'bearer') {
          headers.Authorization = `Bearer ${candidate.credential}`
        }
        response = await transport.fetch(openAICompatibleChatCompletionsUrl(transport.baseUrl), {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers,
          body: JSON.stringify({
            model: candidate.modelId,
            messages: input.messages,
            max_tokens: input.maxTokens ?? 4096,
            stream: false,
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
            ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
          }),
        })
      } finally {
        clearTimeout(timeout)
      }
      if (!response.ok) {
        throw new CandidateAttemptError(
          response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
          `Provider 请求失败，HTTP ${response.status}。`,
          { http_status: response.status },
        )
      }
      const payload = await response.json().catch(() => null)
      reportedModel = readProviderReportedModel(payload)
      const parsed = parseCompletionPayload(payload)
      if (parsed.usage.evidence !== 'provider' || !parsed.usage.totalTokens) {
        throw new CandidateAttemptError(
          'TOKEN_USAGE_MISSING',
          'Provider 未返回完整且非零的 token 使用量，不能形成可审计完成证据。',
        )
      }
      const validation = input.validateOutput
        ? await input.validateOutput(parsed.text)
        : ({ ok: true, value: parsed.text as T } as const)
      if (!validation.ok) {
        throw new CandidateAttemptError('OUTPUT_VALIDATION_FAILED', '模型输出未通过业务结构校验。', {
          validation_error: validation.error.slice(0, 500),
        })
      }

      const completedMs = now()
      const evidenceInput: AIExecutionAttemptRecord = {
        orgId: input.orgId,
        contractId: input.contractId,
        reviewId: input.reviewId,
        skillBundleId: input.skillBundleId,
        planSnapshotId: snapshotRow.id,
        executionId,
        executionMode,
        pinnedModelCatalogEntryId,
        usePointId: plan.usePointId,
        applicationId: plan.applicationId,
        routePolicyId: plan.routeId,
        modelCatalogEntryId: candidate.modelAssetId,
        providerConnectionId: candidate.providerAssetId,
        provider: candidate.providerAssetId,
        model: reportedModel ?? candidate.modelId,
        attemptNo,
        status: 'completed',
        degraded: attempts.length > 0,
        fallbackReason: previousFailureCodes.length > 0 ? previousFailureCodes.join(',') : null,
        latencyMs: Math.max(0, completedMs - startedMs),
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        totalTokens: parsed.usage.totalTokens,
        requestMeta: {
          ...(input.requestMeta || {}),
          plan_snapshot_sha256: plan.snapshotHash,
          message_count: input.messages.length,
          input_character_count: input.messages.reduce((sum, message) => sum + message.content.length, 0),
          input_sha256: inputSha256,
          pinned_model: input.pinModelAssetId || null,
          configured_model: candidate.modelId,
        },
        responseMeta: {
          ...modelIdentityResponseMeta(candidate.modelId, reportedModel),
          finish_reason: parsed.finishReason,
          output_sha256: outputHash(parsed.text),
          output_character_count: parsed.text.length,
          output_validation: 'passed',
          token_evidence: parsed.usage.evidence,
        },
        errorMessage: null,
        startedAt,
        completedAt: new Date(completedMs).toISOString(),
      }
      const recorded = await recordAttempt(evidenceInput)
      const evidence = { ...evidenceInput, id: recorded.id }
      attempts.push(evidence)
      return {
        text: parsed.text,
        value: validation.value,
        provider: candidate.providerAssetId,
        model: reportedModel ?? candidate.modelId,
        modelAssetId: candidate.modelAssetId,
        providerAssetId: candidate.providerAssetId,
        planSnapshotId: snapshotRow.id,
        executionId,
        executionMode,
        pinnedModelCatalogEntryId,
        planSnapshotHash: plan.snapshotHash,
        usage: parsed.usage,
        latencyMs: evidence.latencyMs,
        degraded: attempts.length > 1,
        invocationId: evidence.id,
        invocationIds: attempts.map((attempt) => attempt.id),
        attempts,
      }
    } catch (error) {
      const completedMs = now()
      const failure = safeError(error)
      previousFailureCodes.push(failure.code)
      const evidenceInput: AIExecutionAttemptRecord = {
        orgId: input.orgId,
        contractId: input.contractId,
        reviewId: input.reviewId,
        skillBundleId: input.skillBundleId,
        planSnapshotId: snapshotRow.id,
        executionId,
        executionMode,
        pinnedModelCatalogEntryId,
        usePointId: plan.usePointId,
        applicationId: plan.applicationId,
        routePolicyId: plan.routeId,
        modelCatalogEntryId: candidate.modelAssetId,
        providerConnectionId: candidate.providerAssetId,
        provider: candidate.providerAssetId,
        model: reportedModel ?? candidate.modelId,
        attemptNo,
        status: 'failed',
        degraded: true,
        fallbackReason: failure.code,
        latencyMs: Math.max(0, completedMs - startedMs),
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestMeta: {
          ...(input.requestMeta || {}),
          plan_snapshot_sha256: plan.snapshotHash,
          message_count: input.messages.length,
          input_character_count: input.messages.reduce((sum, message) => sum + message.content.length, 0),
          input_sha256: inputSha256,
          pinned_model: input.pinModelAssetId || null,
          configured_model: candidate.modelId,
        },
        responseMeta: {
          ...failure.responseMeta,
          ...modelIdentityResponseMeta(candidate.modelId, reportedModel),
          output_validation: 'failed',
        },
        errorMessage: failure.message,
        startedAt,
        completedAt: new Date(completedMs).toISOString(),
      }
      const recorded = await recordAttempt(evidenceInput)
      attempts.push({ ...evidenceInput, id: recorded.id })
    } finally {
      if (transport) await transport.close()
    }
  }

  throw new AIExecutionError(
    'ALL_CANDIDATES_FAILED',
    plan.failureAction === 'manual_review'
      ? '所有已发布模型候选均失败，必须进入人工复核。'
      : '所有已发布模型候选均失败，运行已停止。',
    plan.failureAction,
    attempts,
    snapshotRow.id,
    executionId,
    executionMode,
    pinnedModelCatalogEntryId,
  )
}
