import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  extractReviewFactsWithFailoverSync,
  reviewWithFailoverSync,
  type SuccessfulFactExtractionEvidence,
} from '@/lib/ai/failover'
import { extractTokenUsage, type TokenUsage } from '@/lib/ai/model-invocations'
import {
  buildDecisionReviewModelInput,
  evaluateDecisionReviewOutcome,
  resolveFrozenChunkSourceQuote,
  resolveFrozenRuleBinding,
  resolveReviewSourceAnchor,
  reviewStyleToStrategyCode,
  shouldMaterializeReviewRiskCard,
  splitReviewTextIntoChunks,
  type DecisionDraftLike,
  type DecisionReviewOutcome,
  type FrozenReviewChunkProof,
  type ReviewTextPageRange,
} from '@/lib/contracts/review-workbench'
import { verifyContractReviewSource } from '@/lib/documents/source-render-server'
import {
  adjudicateParsedFactsOnlyExtractionChunk,
  buildFactsOnlyAdjudicationTraceInputs,
  buildFactsOnlyDocumentAdjudicationInputs,
  isRetryableFactsOnlyRunError,
  isUncertainDatabaseTransportError,
  mergeFactsOnlyAdjudicationBatches,
  normalizeFactsOnlyExtractionSourceAnchors,
  parseFactsOnlyExtraction,
  parseFactsCompletionReceipt,
  type FactsCompletionReceipt,
  type FactsOnlyStageIdentity,
} from '@/lib/contracts/deterministic-review-runtime'
import {
  loadReviewBundleSnapshot,
  type PublishedReviewBundle,
} from '@/lib/contracts/review-workbench-server'

export interface ContractAnalysisJobRecord {
  id: string
  contract_id: string
  review_id: string
  requested_by: string | null
  status: 'preparing' | 'queued' | 'running' | 'completed' | 'failed'
  attempts: number
  provider: string | null
  degraded: boolean
  last_error: string | null
  locked_at: string | null
  lock_token?: string | null
  locked_by?: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ContractAnalysisResult {
  risks: Array<{
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    source_quote?: string | null
    candidate_source_quote?: string | null
    source_quote_normalization?: 'exact' | 'whitespace_only' | null
    rule_code?: string | null
    rule_snapshot_id?: string | null
    source_start?: number | null
    source_end?: number | null
    source_chunk?: FrozenReviewChunkProof | null
  }>
  summary: string
  appliedRules: number
  matchedRules: number
  provider: string
  degraded: boolean
  usage?: TokenUsage
}

export interface FactsV2StageReceipt {
  run_id: string
  idempotent: boolean
  chunk_count: number
  coverage_count: number
  adjudication_count: number
  facts_idempotent: boolean
  document_run_id: string
  document_idempotent: boolean
  document_outcome_count: number
  risk_cards_materialized: false
  review_completed: false
}

type FactsOnlyResumeState =
  | { kind: 'none' }
  | { kind: 'staged'; stage: FactsOnlyStageIdentity }
  | { kind: 'partial'; reason: string }
  | { kind: 'orphan_invocations'; invocation_ids: string[] }
  | { kind: 'resumable_checkpoints'; checkpoint_count: number }

interface FactsOnlyChunkCheckpointRecord {
  id: string
  org_id: string
  contract_id: string
  review_id: string
  analysis_job_id: string
  skill_bundle_id: string
  skill_bundle_version: number
  model_policy_id: string
  model_policy_hash: string
  source_storage_path: string
  source_hash: string
  source_text_hash: string
  chunk_index: number
  chunk_total: number
  source_start: number
  source_end: number
  source_chunk_hash: string
  model_invocation_id: string
  provider: string
  model: string
  fallback_rank: number
  attempt: number
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number
  raw_output: string
  raw_output_hash: string
  provider_raw_output_hash: string
  checkpoint_hash: string
  source_anchor_validated: boolean
}

export interface ClauseMatch {
  clauseNumber: string | null
  clauseTitle: string | null
  clauseText: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  riskCategory: string | null
  riskDescription: string | null
  legalBasis: string | null
  suggestion: string | null
  suggestedText: string | null
  matchedLibraryClauseId: string | null
  position: number
  startOffset: number
  endOffset: number
}

export interface RiskSummary {
  total_clauses: number
  critical_risks: number
  high_risks: number
  medium_risks: number
  low_risks: number
  compliance_score: number
  strategy_code?: string
}

export interface ComplianceCheck {
  missing_required_clauses: string[]
  dangerous_clauses: string[]
  ambiguous_clauses: string[]
  unbalanced_clauses: string[]
  party_a_consistency: 'consistent' | 'inconsistent' | 'unknown'
  party_b_consistency: 'consistent' | 'inconsistent' | 'unknown'
  issues: string[]
}

export interface StructuredReport {
  result: ContractAnalysisResult
  risk_summary: RiskSummary
  compliance_check: ComplianceCheck
  effectiveness_analysis: string
  clauses: ClauseMatch[]
}

export interface ReviewOptions {
  strategyCode?: 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'
  preferredProvider?: string
  requestId?: string
  reviewId?: string
  jobId?: string
  decisionSnapshot?: DecisionDraftLike[]
  sourceText?: string
  sourceOrgId?: string
  sourcePages?: ReviewTextPageRange[]
  reviewBundle?: PublishedReviewBundle
}

type DecisionSnapshotRecord = DecisionDraftLike & {
  id?: string
  org_id?: string
  contract_id?: string
  review_id?: string
  created_by?: string
  optimistic_version?: number
  comment_preview?: string | null
  internal_note?: string | null
  translation_input_snapshot?: unknown
  evidence_anchors?: unknown
  rule_bundle_id?: string | null
  rule_bundle_version?: number | null
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
}

interface MaterializedDecisionOutcome {
  source_risk_id: string
  outcome: DecisionReviewOutcome
  workflow_state: 'REVIEW_PASSED' | 'NEEDS_REVISION'
  reason: string
}

interface DecisionBatchRecord {
  id: string
  contract_id: string
  source_review_id: string
  new_review_id: string
  analysis_job_id: string
  review_style: 'lenient' | 'balanced' | 'strict'
  decision_snapshot?: unknown
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
}

interface DirectReviewRecord {
  review_trigger?: string | null
  parent_review_id?: string | null
  strategy_id?: string | null
  preferred_provider?: string | null
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
  skill_bundle_id?: string | null
  rule_version?: number | null
  model_policy_id?: string | null
  rule_snapshot_ids?: string[] | null
  rule_set_snapshot_ids?: string[] | null
}

interface DirectRiskRow {
  id: string
  contract_id: string
  review_id: string
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
  auto_fixable: boolean
  fix_action: null
  clause_ref: null
  position_start: number | null
  position_end: number | null
  detected_by: 'ai' | 'rule' | 'manual'
  confidence: null
  status: 'open'
  fixed_by: null
  fixed_at: null
  created_at: string
  updated_at: string
  rule_id: string | null
  rule_code: string | null
  rule_version: number | null
  evidence: Record<string, unknown>
}

function locateDirectRisk(
  sourceText: string,
  risk: ContractAnalysisResult['risks'][number]
): ReturnType<typeof resolveReviewSourceAnchor> {
  const resolved = resolveReviewSourceAnchor({
    sourceText,
    sourceQuote: risk.source_quote,
    sourceStart: risk.source_start,
    sourceEnd: risk.source_end,
    chunk: risk.source_chunk,
  })
  if (!resolved || resolved.status !== 'exact_frozen_chunk' || !resolved.chunk) {
    return resolved
  }
  const actualChunkHash = createHash('sha256')
    .update(sourceText.slice(resolved.chunk.start, resolved.chunk.end))
    .digest('hex')
  return actualChunkHash === resolved.chunk.hash ? resolved : null
}

function materializeDirectRiskRows(
  job: ContractAnalysisJobRecord,
  result: ContractAnalysisResult,
  sourceText: string,
  bundle: PublishedReviewBundle
): DirectRiskRow[] {
  const now = new Date().toISOString()
  return result.risks.filter((risk) => shouldMaterializeReviewRiskCard(risk.level)).map((risk) => {
    const location = locateDirectRisk(sourceText, risk)
    const boundRule = resolveFrozenRuleBinding(risk, bundle.rules)
    const isLiveUnfrozenRuleResult = result.degraded && result.provider !== 'manual-fallback'
    return {
      id: randomUUID(),
      contract_id: job.contract_id,
      review_id: job.review_id,
      level: risk.level,
      title: risk.title,
      description: risk.description,
      suggestion: risk.suggestion,
      auto_fixable: false,
      fix_action: null,
      clause_ref: null,
      position_start: location?.start ?? null,
      position_end: location?.end ?? null,
      detected_by: result.provider === 'manual-fallback'
        ? 'manual'
        : isLiveUnfrozenRuleResult || boundRule
          ? 'rule'
          : 'ai',
      confidence: null,
      status: 'open',
      fixed_by: null,
      fixed_at: null,
      created_at: now,
      updated_at: now,
      rule_id: boundRule?.rule_id || null,
      rule_code: boundRule?.code || null,
      rule_version: boundRule?.rule_version || null,
      evidence: {
        analysis_job_id: job.id,
        provider: result.provider,
        degraded: result.degraded,
        execution_origin: isLiveUnfrozenRuleResult ? 'deterministic_rule_engine_live_unfrozen' : result.provider === 'manual-fallback' ? 'manual_fallback' : 'ai_provider',
        source_anchor_status: location?.status || 'unresolved',
        source_anchor_match_field: location?.matchField || null,
        source_exact_text: location?.exactText || null,
        candidate_source_quote: risk.candidate_source_quote || risk.source_quote || null,
        source_quote_normalization: risk.source_quote_normalization || null,
        ...(location?.chunk ? {
          source_chunk_index: location.chunk.index,
          source_chunk_total: location.chunk.total,
          source_chunk_start: location.chunk.start,
          source_chunk_end: location.chunk.end,
          source_chunk_hash: location.chunk.hash,
        } : {}),
        candidate_rule_code: risk.rule_code || null,
        candidate_rule_snapshot_id: risk.rule_snapshot_id || null,
        binding_status: boundRule ? 'frozen_rule_snapshot' : 'unbound',
        rule_snapshot_id: boundRule?.snapshot_id || null,
        skill_bundle_id: bundle.id,
        skill_bundle_version: bundle.version,
        customer_output_eligible: Boolean(location && boundRule),
      },
    }
  })
}

async function loadFrozenReviewBundle(
  orgId: string,
  review: DirectReviewRecord,
  label: string
) {
  if (
    !review.skill_bundle_id
    || !review.rule_version
    || !review.model_policy_id
    || !Array.isArray(review.rule_snapshot_ids)
    || !Array.isArray(review.rule_set_snapshot_ids)
  ) {
    throw new Error(`${label} ReviewRun 缺少冻结规则包或模型策略身份，已停止执行`)
  }
  const reviewBundle = await loadReviewBundleSnapshot(orgId, review.skill_bundle_id, review.rule_version)
  if (
    !reviewBundle
    || reviewBundle.model_policy_id !== review.model_policy_id
    || reviewBundle.model_policy?.id !== review.model_policy_id
    || JSON.stringify(reviewBundle.rule_snapshot_ids) !== JSON.stringify(review.rule_snapshot_ids)
    || JSON.stringify(reviewBundle.rule_set_snapshot_ids) !== JSON.stringify(review.rule_set_snapshot_ids)
  ) {
    throw new Error(`${label} ReviewRun 的冻结规则包、模型策略或快照身份已失效`)
  }
  return reviewBundle
}

async function verifyAndBindReviewModelEvidence(
  job: ContractAnalysisJobRecord,
  bundle: PublishedReviewBundle,
  result: ContractAnalysisResult
) {
  const { data, error } = await supabaseAdmin
    .from('model_invocations')
    .select('id,skill_bundle_id,model_policy_id,provider,model,status,degraded,request_meta,response_meta')
    .eq('contract_id', job.contract_id)
    .eq('review_id', job.review_id)
    .order('created_at', { ascending: true })
  if (error) throw error

  const invocations = (data || []).filter((invocation) => {
    const requestMeta = invocation.request_meta && typeof invocation.request_meta === 'object'
      ? invocation.request_meta as Record<string, unknown>
      : {}
    return requestMeta.job_id === job.id
  })
  if (invocations.length === 0) {
    throw new Error('ReviewRun 缺少可持久化的模型调用证据，已停止完成')
  }
  if (invocations.some((invocation) => (
    invocation.skill_bundle_id !== bundle.id
    || invocation.model_policy_id !== bundle.model_policy_id
  ))) {
    throw new Error('模型调用证据与 ReviewRun 冻结 bundle 或 policy 不一致，已停止完成')
  }

  const completed = invocations.filter((invocation) => (
    invocation.status === 'completed'
    && invocation.provider === result.provider
    && invocation.degraded === result.degraded
  ))
  if (completed.length === 0) {
    throw new Error('ReviewRun 缺少与最终结果一致的已完成模型调用，已停止完成')
  }
  if (!result.degraded && completed.some((invocation) => {
    const usage = extractTokenUsage(invocation.response_meta)
    return !usage || !(Number(usage.totalTokens) > 0)
  })) {
    throw new Error('非降级 ReviewRun 的模型调用缺少 token 证据，已停止完成')
  }

  const policyProviders = bundle.model_policy?.provider_chain || []
  for (const invocation of completed.filter((item) => !item.degraded)) {
    const requestMeta = invocation.request_meta && typeof invocation.request_meta === 'object'
      ? invocation.request_meta as Record<string, unknown>
      : {}
    const metadata = requestMeta.metadata && typeof requestMeta.metadata === 'object'
      ? requestMeta.metadata as Record<string, unknown>
      : {}
    const configId = typeof metadata.config_id === 'string' ? metadata.config_id : null
    const matchesFrozenPolicy = policyProviders.some((provider) => (
      provider.source_config_id === configId
      && provider.model === invocation.model
      && (!provider.profile || provider.profile === invocation.provider)
    ))
    if (!matchesFrozenPolicy) {
      throw new Error('实际模型 Provider、配置或模型不属于冻结 ModelPolicy，已停止完成')
    }
  }

  const invocationIds = invocations.map((invocation) => invocation.id)
  const { data: updatedReview, error: updateError } = await supabaseAdmin
    .from('contract_reviews')
    .update({ model_invocation_ids: invocationIds })
    .eq('id', job.review_id)
    .eq('contract_id', job.contract_id)
    .eq('status', 'ANALYZING')
    .select('id')
    .maybeSingle()
  if (updateError || !updatedReview) {
    throw updateError || new Error('ReviewRun 模型调用证据回填失败，已停止完成')
  }
  return invocationIds
}

async function verifyDirectReviewSource(
  contractId: string,
  review: DirectReviewRecord
) {
  if (review.review_trigger !== 'direct') {
    throw new Error('普通审核任务缺少 direct ReviewRun 身份，已停止执行')
  }
  if (!review.source_storage_path || !review.source_hash || !review.source_text_hash) {
    throw new Error('普通审核 ReviewRun 缺少完整源文件身份，已停止执行')
  }

  const { data: contract, error } = await supabaseAdmin
    .from('contracts')
    .select('id,org_id,filename,mime_type,storage_path,parsed_text')
    .eq('id', contractId)
    .maybeSingle()
  if (error || !contract?.filename || !contract.storage_path || !contract.parsed_text?.trim()) {
    throw new Error('普通审核源文件或可验证解析文本不存在')
  }
  if (contract.storage_path !== review.source_storage_path) {
    throw new Error('普通审核 ReviewRun 绑定的源文件路径已变化，已停止执行')
  }
  if (!contract.org_id) throw new Error('普通审核源组织身份不存在')
  const reviewBundle = await loadFrozenReviewBundle(contract.org_id, review, '普通审核')

  const pageMap = await verifyContractReviewSource({
    id: contract.id,
    filename: contract.filename,
    mime_type: contract.mime_type,
    storage_path: contract.storage_path,
    parsed_text: contract.parsed_text,
  })
  const sourceText = contract.parsed_text
  const sourceTextHash = createHash('sha256').update(sourceText).digest('hex')
  if (
    pageMap.source_hash !== review.source_hash
    || pageMap.source_text_hash !== review.source_text_hash
    || sourceTextHash !== review.source_text_hash
  ) {
    throw new Error('普通审核 ReviewRun 绑定的源文件字节或解析文本已变化，已停止执行')
  }

  let strategyCode: ReviewOptions['strategyCode']
  if (review.strategy_id) {
    const { data: strategy, error: strategyError } = await supabaseAdmin
      .from('review_strategies')
      .select('id,org_id,code')
      .eq('id', review.strategy_id)
      .maybeSingle()
    if (
      strategyError
      || !strategy
      || (strategy.org_id !== null && strategy.org_id !== contract.org_id)
      || !['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE'].includes(strategy.code)
    ) {
      throw new Error('普通审核 ReviewRun 绑定的策略已失效或不属于源组织')
    }
    strategyCode = strategy.code as ReviewOptions['strategyCode']
  }

  return {
    sourceText,
    sourceOrgId: contract.org_id || undefined,
    sourceStoragePath: review.source_storage_path,
    sourceHash: review.source_hash,
    sourceTextHash: review.source_text_hash,
    strategyId: review.strategy_id || undefined,
    strategyCode,
    preferredProvider: review.preferred_provider || undefined,
    reviewBundle,
    sourcePages: pageMap.pages,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseFactsV2StageReceipt(
  value: unknown,
  expected: {
    chunkCount: number
    coverageCount: number
    adjudicationCount: number
    documentOutcomeCount: number
  },
): FactsV2StageReceipt {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!isRecord(candidate)) throw new Error('facts_v2_stage_receipt_invalid')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const integer = (key: string) => {
    const item = candidate[key]
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) {
      throw new Error(`facts_v2_stage_receipt_${key}_invalid`)
    }
    return item
  }
  if (
    typeof candidate.run_id !== 'string'
    || !uuid.test(candidate.run_id)
    || typeof candidate.document_run_id !== 'string'
    || !uuid.test(candidate.document_run_id)
    || typeof candidate.idempotent !== 'boolean'
    || typeof candidate.facts_idempotent !== 'boolean'
    || candidate.idempotent !== candidate.facts_idempotent
    || typeof candidate.document_idempotent !== 'boolean'
    || candidate.risk_cards_materialized !== false
    || candidate.review_completed !== false
  ) {
    throw new Error('facts_v2_stage_receipt_contract_invalid')
  }
  const receipt: FactsV2StageReceipt = {
    run_id: candidate.run_id,
    idempotent: candidate.idempotent,
    chunk_count: integer('chunk_count'),
    coverage_count: integer('coverage_count'),
    adjudication_count: integer('adjudication_count'),
    facts_idempotent: candidate.facts_idempotent,
    document_run_id: candidate.document_run_id,
    document_idempotent: candidate.document_idempotent,
    document_outcome_count: integer('document_outcome_count'),
    risk_cards_materialized: false,
    review_completed: false,
  }
  if (
    receipt.chunk_count !== expected.chunkCount
    || receipt.coverage_count !== expected.coverageCount
    || receipt.adjudication_count !== expected.adjudicationCount
    || receipt.document_outcome_count !== expected.documentOutcomeCount
  ) {
    throw new Error('facts_v2_stage_receipt_counts_invalid')
  }
  return receipt
}

function parseFactChunkCheckpointReceipt(
  value: unknown,
  expected: { invocationId: string; chunkIndex: number },
) {
  const candidate = Array.isArray(value) ? value[0] : value
  if (
    !isRecord(candidate)
    || typeof candidate.checkpoint_id !== 'string'
    || typeof candidate.invocation_id !== 'string'
    || candidate.invocation_id !== expected.invocationId
    || candidate.chunk_index !== expected.chunkIndex
    || typeof candidate.idempotent !== 'boolean'
  ) {
    throw new Error('facts_chunk_checkpoint_receipt_invalid')
  }
  return {
    checkpointId: candidate.checkpoint_id,
    invocationId: candidate.invocation_id,
    chunkIndex: candidate.chunk_index,
    idempotent: candidate.idempotent,
  }
}

async function loadFactsOnlyCheckpointState(job: ContractAnalysisJobRecord) {
  const [checkpointResult, invocationResult] = await Promise.all([
    supabaseAdmin
      .from('contract_review_fact_chunk_checkpoints')
      .select([
        'id', 'org_id', 'contract_id', 'review_id', 'analysis_job_id',
        'skill_bundle_id', 'skill_bundle_version', 'model_policy_id', 'model_policy_hash',
        'source_storage_path', 'source_hash', 'source_text_hash',
        'chunk_index', 'chunk_total', 'source_start', 'source_end', 'source_chunk_hash',
        'model_invocation_id', 'provider', 'model', 'fallback_rank', 'attempt',
        'input_tokens', 'output_tokens', 'total_tokens', 'raw_output', 'raw_output_hash',
        'provider_raw_output_hash', 'checkpoint_hash',
        'source_anchor_validated',
      ].join(','))
      .eq('analysis_job_id', job.id)
      .eq('contract_id', job.contract_id)
      .eq('review_id', job.review_id)
      .order('chunk_index', { ascending: true }),
    supabaseAdmin
      .from('model_invocations')
      .select('id,status,request_meta')
      .eq('contract_id', job.contract_id)
      .eq('review_id', job.review_id)
      .eq('phase', 'fact_extraction')
      .order('created_at', { ascending: true }),
  ])
  if (checkpointResult.error) throw checkpointResult.error
  if (invocationResult.error) throw invocationResult.error

  const checkpoints = (checkpointResult.data || []) as unknown as FactsOnlyChunkCheckpointRecord[]
  const invocations = (invocationResult.data || []).filter((invocation) => {
    const requestMeta = isRecord(invocation.request_meta) ? invocation.request_meta : {}
    return requestMeta.job_id === job.id
  })
  const completedIds = new Set(
    invocations
      .filter((invocation) => invocation.status === 'completed')
      .map((invocation) => invocation.id),
  )
  const checkpointInvocationIds = new Set(checkpoints.map((checkpoint) => checkpoint.model_invocation_id))
  const completedWithoutCheckpoint = [...completedIds].filter((id) => !checkpointInvocationIds.has(id))
  const checkpointWithoutCompletedInvocation = checkpoints
    .filter((checkpoint) => !completedIds.has(checkpoint.model_invocation_id))
    .map((checkpoint) => checkpoint.model_invocation_id)

  return {
    checkpoints,
    completedWithoutCheckpoint,
    checkpointWithoutCompletedInvocation,
  }
}

async function checkpointSuccessfulFactExtraction(
  job: ContractAnalysisJobRecord,
  chunkIndex: number,
  evidence: SuccessfulFactExtractionEvidence,
) {
  if (!job.lock_token) throw new Error('facts_chunk_checkpoint_requires_active_lease')
  const invocationId = randomUUID()
  const invoke = () => supabaseAdmin.rpc('checkpoint_contract_review_fact_chunk_v1', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.lock_token,
    p_invocation_id: invocationId,
    p_provider: evidence.provider,
    p_provider_name: evidence.providerName,
    p_model: evidence.model,
    p_fallback_rank: evidence.fallbackRank,
    p_attempt: evidence.attempt,
    p_latency_ms: evidence.latencyMs,
    p_request_id: evidence.requestId || null,
    p_request_metadata: evidence.requestMetadata,
    p_usage: evidence.usage,
    p_response_metadata: evidence.responseMetadata,
    p_raw_output: evidence.rawOutput,
  })

  let response: Awaited<ReturnType<typeof invoke>>
  try {
    response = await invoke()
  } catch (error) {
    if (!isUncertainDatabaseTransportError(error)) throw error
    response = await invoke()
  }
  if (response.error && isUncertainDatabaseTransportError(response.error)) {
    response = await invoke()
  }
  if (response.error) throw response.error
  return parseFactChunkCheckpointReceipt(response.data, { invocationId, chunkIndex })
}


/**
 * Run the candidate-only fact extraction and persist its immutable source and
 * document evidence. This is intentionally not a terminal analysis result:
 * callers must continue to a separate risk-materialization/completion step in
 * the same lease before enabling the facts_v1 Worker branch.
 */
export async function stageFactsOnlyDirectReviewEvidence(
  job: ContractAnalysisJobRecord,
  verifiedSource: Awaited<ReturnType<typeof verifyDirectReviewSource>>,
  assertLease: () => Promise<void>,
): Promise<FactsV2StageReceipt> {
  if (!job.lock_token) throw new Error('facts_v2_stage_requires_active_lease')
  const { reviewBundle } = verifiedSource
  if (
    reviewBundle.execution_contract !== 'facts_v1'
    || !verifiedSource.sourceOrgId
    || !reviewBundle.model_policy_id
    || !reviewBundle.model_policy
    || reviewBundle.model_policy.id !== reviewBundle.model_policy_id
    || reviewBundle.rules.length === 0
  ) {
    throw new Error('facts_v2_stage_frozen_candidate_invalid')
  }
  const chunks = splitReviewTextIntoChunks(
    verifiedSource.sourceText,
    verifiedSource.sourcePages,
  )
  if (chunks.length === 0) throw new Error('facts_v2_stage_source_chunks_empty')
  if (chunks.some((chunk) => chunk.text.length > 4000)) {
    throw new Error('facts_v2_stage_chunk_exceeds_provider_safe_limit')
  }
  const publishedRules = reviewBundle.rules.map((rule) => ({
    rule_snapshot_id: rule.snapshot_id,
    rule_code: rule.code,
    name: rule.name,
    description: rule.description,
    clause_category: rule.clause_category,
    risk_level: rule.risk_level,
    review_criteria: rule.review_criteria,
  }))
  const checkpointState = await loadFactsOnlyCheckpointState(job)
  if (checkpointState.completedWithoutCheckpoint.length > 0) {
    throw new Error(
      `facts_v1_completed_invocation_without_checkpoint:${checkpointState.completedWithoutCheckpoint.join(',')}`,
    )
  }
  if (checkpointState.checkpointWithoutCompletedInvocation.length > 0) {
    throw new Error(
      `facts_v1_checkpoint_without_completed_invocation:${checkpointState.checkpointWithoutCompletedInvocation.join(',')}`,
    )
  }
  const checkpointByChunk = new Map(
    checkpointState.checkpoints.map((checkpoint) => [checkpoint.chunk_index, checkpoint]),
  )
  if (
    checkpointState.checkpoints.length > chunks.length
    || checkpointState.checkpoints.some((checkpoint) => !chunks.some((chunk) => chunk.index === checkpoint.chunk_index))
  ) {
    throw new Error('facts_v1_checkpoint_chunk_plan_mismatch')
  }
  const batches = [] as ReturnType<typeof adjudicateParsedFactsOnlyExtractionChunk>[]
  const invocationIdsByChunk = new Map<number, string>()
  const stagingChunks: Array<{ model_invocation_id: string; raw_output: string }> = []
  // Keep provider affinity after the first successful chunk. If the requested
  // provider truncates or fails and a frozen fallback succeeds, restarting the
  // original chain for every remaining chunk only repeats the same failure and
  // can force local models to unload/reload in a loop.
  let preferredProvider = verifiedSource.preferredProvider

  for (const chunk of chunks) {
    await assertLease()
    const chunkProof: FrozenReviewChunkProof = {
      index: chunk.index,
      total: chunks.length,
      start: chunk.start,
      end: chunk.end,
      hash: createHash('sha256').update(chunk.text).digest('hex'),
    }
    const checkpoint = checkpointByChunk.get(chunk.index)
    if (checkpoint) {
      const frozenProvider = reviewBundle.model_policy.provider_chain.some((provider) => (
        provider.profile === checkpoint.provider
        && provider.model === checkpoint.model
        && provider.stages.includes('fact_extraction')
      ))
      if (
        checkpoint.org_id !== verifiedSource.sourceOrgId
        || checkpoint.contract_id !== job.contract_id
        || checkpoint.review_id !== job.review_id
        || checkpoint.analysis_job_id !== job.id
        || checkpoint.skill_bundle_id !== reviewBundle.id
        || checkpoint.skill_bundle_version !== reviewBundle.version
        || checkpoint.model_policy_id !== reviewBundle.model_policy_id
        || !/^[0-9a-f]{64}$/.test(checkpoint.model_policy_hash)
        || checkpoint.source_storage_path !== verifiedSource.sourceStoragePath
        || checkpoint.source_hash !== verifiedSource.sourceHash
        || checkpoint.source_text_hash !== verifiedSource.sourceTextHash
        || checkpoint.chunk_total !== chunks.length
        || checkpoint.source_start !== chunk.start
        || checkpoint.source_end !== chunk.end
        || checkpoint.source_chunk_hash !== chunkProof.hash
        || createHash('sha256').update(checkpoint.raw_output).digest('hex') !== checkpoint.raw_output_hash
        || !/^[0-9a-f]{64}$/.test(checkpoint.checkpoint_hash)
        || checkpoint.source_anchor_validated !== true
        || checkpoint.total_tokens <= 0
        || !frozenProvider
      ) {
        throw new Error(`facts_v1_checkpoint_identity_mismatch:${chunk.index}`)
      }
      const extraction = parseFactsOnlyExtraction(checkpoint.raw_output, reviewBundle.rules)
      batches.push(adjudicateParsedFactsOnlyExtractionChunk({
        extraction,
        source_text: verifiedSource.sourceText,
        chunk: chunkProof,
        rules: reviewBundle.rules,
      }))
      invocationIdsByChunk.set(chunk.index, checkpoint.model_invocation_id)
      stagingChunks.push({
        model_invocation_id: checkpoint.model_invocation_id,
        raw_output: checkpoint.raw_output,
      })
      preferredProvider = checkpoint.provider
      continue
    }
    let preparedBatch: ReturnType<typeof adjudicateParsedFactsOnlyExtractionChunk> | null = null
    const extraction = await extractReviewFactsWithFailoverSync(chunk.text, {
      orgId: verifiedSource.sourceOrgId,
      contractId: job.contract_id,
      reviewId: job.review_id,
      jobId: job.id,
      requestId: `${job.id}:facts:${chunk.index}`,
      preferredProvider,
      tool: 'contract_review',
      capability: 'contract_review',
      phase: 'fact_extraction',
      skillBundleId: reviewBundle.id,
      modelPolicyId: reviewBundle.model_policy_id,
      frozenModelPolicy: reviewBundle.model_policy,
      publishedRules,
      deterministicRules: reviewBundle.rules,
      chunk: {
        ...chunkProof,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
      },
      prepareSuccessfulExtraction: (providerExtraction) => {
        const normalized = normalizeFactsOnlyExtractionSourceAnchors(
          providerExtraction,
          chunk.text,
          reviewBundle.rules,
        )
        preparedBatch = adjudicateParsedFactsOnlyExtractionChunk({
          extraction: normalized,
          source_text: verifiedSource.sourceText,
          chunk: chunkProof,
          rules: reviewBundle.rules,
        })
        return normalized
      },
      persistSuccessfulExtraction: (evidence) => checkpointSuccessfulFactExtraction(
        job,
        chunk.index,
        evidence,
      ),
    })
    await assertLease()
    if (!preparedBatch) throw new Error('facts_v1_source_validation_hook_missing_result')
    preferredProvider = extraction.provider
    batches.push(preparedBatch)
    invocationIdsByChunk.set(chunk.index, extraction.invocationId)
    stagingChunks.push({
      model_invocation_id: extraction.invocationId,
      raw_output: extraction.rawOutput,
    })
  }

  const merged = mergeFactsOnlyAdjudicationBatches(batches, verifiedSource.sourceText)
  const adjudications = buildFactsOnlyAdjudicationTraceInputs(merged, invocationIdsByChunk)
  const documentAdjudications = buildFactsOnlyDocumentAdjudicationInputs(
    merged,
    reviewBundle.rules,
  )
  await assertLease()
  const { data, error } = await supabaseAdmin.rpc('stage_contract_review_facts_v2', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.lock_token,
    p_chunks: stagingChunks,
    p_adjudications: adjudications,
  })
  if (error) throw error
  return parseFactsV2StageReceipt(data, {
    chunkCount: chunks.length,
    coverageCount: chunks.length * reviewBundle.rules.length,
    adjudicationCount: adjudications.length,
    documentOutcomeCount: documentAdjudications.length,
  })
}

async function loadFactsOnlyResumeState(
  job: ContractAnalysisJobRecord,
  reviewBundle: PublishedReviewBundle,
): Promise<FactsOnlyResumeState> {
  const { data: factRun, error: factRunError } = await supabaseAdmin
    .from('contract_review_fact_runs')
    .select('id,analysis_job_id,contract_id,review_id,skill_bundle_id,model_policy_id,output_contract')
    .eq('analysis_job_id', job.id)
    .eq('contract_id', job.contract_id)
    .eq('review_id', job.review_id)
    .maybeSingle()
  if (factRunError) throw factRunError

  if (factRun) {
    if (
      factRun.analysis_job_id !== job.id
      || factRun.contract_id !== job.contract_id
      || factRun.review_id !== job.review_id
      || factRun.skill_bundle_id !== reviewBundle.id
      || factRun.model_policy_id !== reviewBundle.model_policy_id
      || factRun.output_contract !== 'facts_v1'
    ) {
      return { kind: 'partial', reason: 'facts_run_identity_mismatch' }
    }
    const { data: documentRun, error: documentRunError } = await supabaseAdmin
      .from('contract_review_document_runs')
      .select('id,fact_run_id')
      .eq('fact_run_id', factRun.id)
      .maybeSingle()
    if (documentRunError) throw documentRunError
    if (!documentRun || documentRun.fact_run_id !== factRun.id) {
      return { kind: 'partial', reason: 'document_run_missing' }
    }
    return {
      kind: 'staged',
      stage: { run_id: factRun.id, document_run_id: documentRun.id },
    }
  }

  const checkpointState = await loadFactsOnlyCheckpointState(job)
  if (checkpointState.checkpointWithoutCompletedInvocation.length > 0) {
    return { kind: 'partial', reason: 'checkpoint_without_completed_invocation' }
  }
  if (checkpointState.completedWithoutCheckpoint.length > 0) {
    return {
      kind: 'orphan_invocations',
      invocation_ids: checkpointState.completedWithoutCheckpoint,
    }
  }
  if (checkpointState.checkpoints.length > 0) {
    return {
      kind: 'resumable_checkpoints',
      checkpoint_count: checkpointState.checkpoints.length,
    }
  }
  return { kind: 'none' }
}

async function resolveFactsOnlyStageIdentity(
  job: ContractAnalysisJobRecord,
  verifiedSource: Awaited<ReturnType<typeof verifyDirectReviewSource>>,
  assertLease: () => Promise<void>,
): Promise<FactsOnlyStageIdentity> {
  const initial = await loadFactsOnlyResumeState(job, verifiedSource.reviewBundle)
  if (initial.kind === 'staged') return initial.stage
  if (initial.kind === 'partial') {
    throw new Error(`facts_v1_staging_partial:${initial.reason}`)
  }
  if (initial.kind === 'orphan_invocations') {
    throw new Error(`facts_v1_orphan_invocations:${initial.invocation_ids.join(',')}`)
  }

  try {
    const staged = await stageFactsOnlyDirectReviewEvidence(job, verifiedSource, assertLease)
    return { run_id: staged.run_id, document_run_id: staged.document_run_id }
  } catch (error) {
    const recovered = await loadFactsOnlyResumeState(job, verifiedSource.reviewBundle)
    if (recovered.kind === 'staged') return recovered.stage
    if (recovered.kind === 'partial') {
      throw new Error(`facts_v1_staging_partial:${recovered.reason}`, { cause: error })
    }
    if (recovered.kind === 'orphan_invocations') {
      throw new Error(
        `facts_v1_orphan_invocations:${recovered.invocation_ids.join(',')}`,
        { cause: error },
      )
    }
    throw error
  }
}

async function completeFactsOnlyDirectReview(
  job: ContractAnalysisJobRecord,
  stage: FactsOnlyStageIdentity,
): Promise<FactsCompletionReceipt> {
  if (!job.lock_token) throw new Error('facts_completion_requires_active_lease')
  const invoke = () => supabaseAdmin.rpc('complete_contract_review_facts_v1', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.lock_token,
    p_fact_run_id: stage.run_id,
    p_document_run_id: stage.document_run_id,
  })

  let response: Awaited<ReturnType<typeof invoke>>
  try {
    response = await invoke()
  } catch (error) {
    if (!isUncertainDatabaseTransportError(error)) throw error
    response = await invoke()
  }
  if (response.error && isUncertainDatabaseTransportError(response.error)) {
    response = await invoke()
  }
  if (response.error) throw response.error
  return parseFactsCompletionReceipt(response.data, stage)
}

async function verifyDecisionBatchSource(
  contractId: string,
  batch: DecisionBatchRecord,
  snapshots: DecisionSnapshotRecord[],
  review: DirectReviewRecord
) {
  if (!batch.source_storage_path || !batch.source_hash || !batch.source_text_hash) {
    throw new Error('复审批次缺少完整源文件身份，已停止执行')
  }
  if (snapshots.some((snapshot) => (
    snapshot.source_storage_path !== batch.source_storage_path
    || snapshot.source_hash !== batch.source_hash
    || snapshot.source_text_hash !== batch.source_text_hash
  ))) {
    throw new Error('复审批次包含绑定旧源文件或旧解析文本的决策快照，已停止执行')
  }
  const { data: contract, error } = await supabaseAdmin
    .from('contracts')
    .select('id,org_id,filename,mime_type,storage_path,parsed_text')
    .eq('id', contractId)
    .maybeSingle()
  if (error || !contract?.filename || !contract.storage_path) {
    throw new Error('复审源文件不存在或无法读取')
  }
  if (contract.storage_path !== batch.source_storage_path) {
    throw new Error('复审批次绑定的源文件路径已变化，已停止执行')
  }

  const pageMap = await verifyContractReviewSource({
    id: contract.id,
    filename: contract.filename,
    mime_type: contract.mime_type,
    storage_path: contract.storage_path,
    parsed_text: contract.parsed_text,
  })
  if (pageMap.source_hash !== batch.source_hash) {
    throw new Error('复审批次绑定的源文件字节已变化，已停止执行')
  }
  if (pageMap.source_text_hash !== batch.source_text_hash) {
    throw new Error('复审批次绑定的页级文本身份已变化，已停止执行')
  }

  const sourceText = contract.parsed_text || ''
  const sourceTextHash = createHash('sha256').update(sourceText).digest('hex')
  if (sourceTextHash !== batch.source_text_hash) {
    throw new Error('复审批次绑定的解析文本已变化，已停止执行')
  }
  const sourceOrgId = contract.org_id || undefined
  if (!sourceOrgId) throw new Error('复审源组织身份不存在')
  const reviewBundle = await loadFrozenReviewBundle(sourceOrgId, review, '决策复审')
  return { sourceText, sourceOrgId, reviewBundle }
}

function mapDecisionReviewFindings(
  findings: ContractAnalysisResult['risks'],
  snapshots: DecisionSnapshotRecord[]
) {
  const byRiskId = new Map<string, ContractAnalysisResult['risks']>()
  let hasUnscopedConflict = false
  for (const finding of findings) {
    if (finding.level !== 'red' && finding.level !== 'yellow') continue
    const markers = [...`${finding.title}\n${finding.description}\n${finding.suggestion}`
      .matchAll(/\[DECISION_ITEM:(ALL|\d+)\]/gi)]
    if (markers.length !== 1 || markers[0][1].toUpperCase() === 'ALL') {
      hasUnscopedConflict = true
      continue
    }
    const index = Number(markers[0][1]) - 1
    const riskId = Number.isInteger(index) && index >= 0 ? snapshots[index]?.risk_id : null
    if (!riskId) {
      hasUnscopedConflict = true
      continue
    }
    byRiskId.set(riskId, [...(byRiskId.get(riskId) || []), finding])
  }
  return { byRiskId, hasUnscopedConflict }
}

export async function enqueueContractAnalysisJob(
  contractId: string,
  reviewId: string,
  requestedBy: string,
  initialStatus: 'preparing' | 'queued' = 'queued'
) {
  const { data, error } = await supabaseAdmin
    .from('contract_analysis_jobs')
    .insert({
      contract_id: contractId,
      review_id: reviewId,
      requested_by: requestedBy,
      status: initialStatus,
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as ContractAnalysisJobRecord
}

export async function claimNextContractAnalysisJob(workerId: string) {
  const { data, error } = await supabaseAdmin
    .rpc('claim_contract_analysis_job', {
      p_worker_id: workerId,
    })

  if (error) {
    throw error
  }

  const job = Array.isArray(data) ? data[0] : data
  return (job ?? null) as ContractAnalysisJobRecord | null
}

export async function fetchContractText(contractId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('contracts')
    .select('parsed_text, filename')
    .eq('id', contractId)
    .single()

  if (error) {
    throw error
  }

  if (data?.parsed_text) {
    return data.parsed_text
  }

  return `合同文件: ${data?.filename || 'unknown'}`
}

async function fetchContractContext(contractId: string): Promise<{ text: string; orgId?: string }> {
  const { data, error } = await supabaseAdmin
    .from('contracts')
    .select('parsed_text, filename, org_id')
    .eq('id', contractId)
    .single()

  if (error) {
    throw error
  }

  const text = data?.parsed_text || `合同文件: ${data?.filename || 'unknown'}`
  const orgId = data?.org_id || undefined

  return { text, orgId }
}

/**
 * 运行合同分析 — 统一走AI降级链路
 * 后台任务和前端请求共用同一套降级逻辑，只是消费方式不同
 * 前端用 reviewWithFailover（流式），后台用 reviewWithFailoverSync（非流式）
 */
export async function runContractAnalysis(
  contractId: string,
  options?: ReviewOptions
): Promise<ContractAnalysisResult> {
  const context = await fetchContractContext(contractId)

  // 统一走AI降级链路（本地→云端→规则引擎→人工标记）
  const aiResult = await reviewWithFailoverSync(context.text, {
    orgId: context.orgId,
    contractId,
    reviewId: options?.reviewId,
    jobId: options?.jobId,
    preferredProvider: options?.preferredProvider,
    requestId: options?.requestId,
    tool: 'contract_review',
    capability: 'contract_review',
    phase: 'semantic_review',
  })

  return {
    risks: aiResult.risks,
    summary: aiResult.summary,
    appliedRules: aiResult.risks.length,
    matchedRules: aiResult.risks.filter((r) => r.level === 'red' || r.level === 'yellow').length,
    provider: aiResult.provider,
    degraded: aiResult.degraded,
    usage: aiResult.usage,
  }
}

async function renewContractAnalysisLease(job: ContractAnalysisJobRecord) {
  if (!job.lock_token) throw new Error('分析任务缺少 Worker 租约令牌，拒绝继续写入')
  const { data, error } = await supabaseAdmin.rpc('heartbeat_contract_analysis_job', {
    p_job_id: job.id,
    p_lock_token: job.lock_token,
  })
  if (error || data !== true) {
    throw new Error(`分析任务租约已失效，拒绝继续写入${error?.message ? `：${error.message}` : ''}`)
  }
}

export async function withContractAnalysisLease<T>(
  job: ContractAnalysisJobRecord,
  operation: (assertLease: () => Promise<void>) => Promise<T>
): Promise<T> {
  let heartbeatError: Error | null = null
  let heartbeatRunning = false
  const assertLease = async () => {
    if (heartbeatError) throw heartbeatError
    await renewContractAnalysisLease(job)
  }
  const timer = setInterval(() => {
    if (heartbeatRunning || heartbeatError) return
    heartbeatRunning = true
    void renewContractAnalysisLease(job)
      .catch((error) => {
        heartbeatError = error instanceof Error ? error : new Error(describeContractAnalysisError(error))
      })
      .finally(() => {
        heartbeatRunning = false
      })
  }, 60_000)

  try {
    await assertLease()
    const result = await operation(assertLease)
    if (heartbeatError && job.status === 'running') throw heartbeatError
    return result
  } finally {
    clearInterval(timer)
  }
}

export async function markContractAnalysisRunning(job: ContractAnalysisJobRecord) {
  const lockToken = job.lock_token || randomUUID()
  const lockedBy = job.locked_by || 'inline-request'
  job.lock_token = lockToken
  job.locked_by = lockedBy
  const { data, error } = await supabaseAdmin.rpc('activate_contract_analysis_job', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: lockToken,
    p_locked_by: lockedBy,
  })
  const activated = (Array.isArray(data) ? data[0] : data) as ContractAnalysisJobRecord | null
  if (error || !activated) {
    const { data: recovered, error: recoveryError } = await supabaseAdmin
      .from('contract_analysis_jobs')
      .select('*')
      .eq('id', job.id)
      .eq('contract_id', job.contract_id)
      .eq('review_id', job.review_id)
      .eq('status', 'running')
      .eq('lock_token', lockToken)
      .maybeSingle()
    if (recoveryError || !recovered) {
      job.lock_token = null
      job.locked_by = null
      throw error || recoveryError || new Error('分析任务未能原子进入运行态')
    }
    Object.assign(job, recovered)
    return
  }
  Object.assign(job, activated)
}

export async function markContractAnalysisCompleted(job: ContractAnalysisJobRecord, result: ContractAnalysisResult) {
  if (!job.lock_token) throw new Error('分析任务缺少 Worker 租约令牌，拒绝完成')
  const { error } = await supabaseAdmin.rpc('complete_contract_analysis_job', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.lock_token,
    p_review_result: result,
    p_provider: result.provider,
    p_degraded: result.degraded,
  })
  if (error) throw error
  job.status = 'completed'
  job.lock_token = null
  job.locked_at = null
}

export async function markContractAnalysisFailed(job: ContractAnalysisJobRecord, error: unknown) {
  const message = describeContractAnalysisError(error)
  const { error: rpcError } = await supabaseAdmin.rpc('fail_contract_analysis_job', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.status === 'running' ? job.lock_token || null : null,
    p_error: message,
  })
  if (rpcError) throw rpcError
  job.status = 'failed'
  job.lock_token = null
  job.locked_at = null
}

function isRetryableFactsCheckpointError(error: unknown) {
  return isRetryableFactsOnlyRunError(describeContractAnalysisError(error))
}

async function requeueFactsOnlyJobOnce(
  job: ContractAnalysisJobRecord,
  error: unknown,
) {
  if (!job.lock_token) return false
  const invoke = () => supabaseAdmin.rpc('requeue_contract_review_facts_once_v1', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.lock_token,
    p_error: describeContractAnalysisError(error),
  })
  let response: Awaited<ReturnType<typeof invoke>>
  try {
    response = await invoke()
  } catch (rpcError) {
    if (!isUncertainDatabaseTransportError(rpcError)) throw rpcError
    response = await invoke()
  }
  if (response.error && isUncertainDatabaseTransportError(response.error)) {
    response = await invoke()
  }
  if (response.error) throw response.error
  if (response.data !== true) return false
  job.status = 'queued'
  job.attempts = 2
  job.last_error = describeContractAnalysisError(error)
  job.lock_token = null
  job.locked_at = null
  job.locked_by = null
  return true
}

function describeContractAnalysisError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const record = error as Record<string, unknown>
    const parts = ['code', 'message', 'details', 'hint'].flatMap((key) => {
      const value = record[key]
      return typeof value === 'string' && value.trim() ? [`${key}=${value.trim()}`] : []
    })
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(record)
    } catch {
      return 'unknown_structured_error'
    }
  }
  return String(error)
}

export async function processQueuedContractAnalysisJobs(workerId: string, limit: number = 1) {
  const processed: Array<{
    jobId: string
    contractId: string
    reviewId: string
    status: 'completed' | 'failed' | 'deferred' | 'inconsistent' | 'unknown'
    provider?: string
    degraded?: boolean
    error?: string
  }> = []

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextContractAnalysisJob(workerId)
    if (!job) {
      break
    }

    try {
      const outcome = await processContractAnalysisJob(job)

      processed.push({
        jobId: job.id,
        contractId: job.contract_id,
        reviewId: job.review_id,
        status: 'completed',
        provider: outcome.provider,
        degraded: outcome.degraded,
      })
    } catch (error) {
      const message = describeContractAnalysisError(error)
      let actualStatus: 'completed' | 'failed' | 'deferred' | 'inconsistent' | 'unknown' = 'unknown'
      let auditError = message
      try {
        const terminalState = await readContractAnalysisTerminalState(job)
        actualStatus = terminalState === 'active' ? 'deferred' : terminalState
      } catch (stateError) {
        const stateMessage = describeContractAnalysisError(stateError)
        auditError = `${message}; terminal state unavailable: ${stateMessage}`
      }

      processed.push({
        jobId: job.id,
        contractId: job.contract_id,
        reviewId: job.review_id,
        status: actualStatus,
        error: auditError,
      })
    }
  }

  return processed
}

async function readDecisionTerminalState(job: ContractAnalysisJobRecord, batchId: string) {
  const [batchResult, jobResult, reviewResult, contractResult] = await Promise.all([
    supabaseAdmin
      .from('contract_review_submission_batches')
      .select('status')
      .eq('id', batchId)
      .eq('contract_id', job.contract_id)
      .eq('new_review_id', job.review_id)
      .eq('analysis_job_id', job.id)
      .maybeSingle(),
    supabaseAdmin
      .from('contract_analysis_jobs')
      .select('status')
      .eq('id', job.id)
      .eq('contract_id', job.contract_id)
      .eq('review_id', job.review_id)
      .maybeSingle(),
    supabaseAdmin
      .from('contract_reviews')
      .select('status')
      .eq('id', job.review_id)
      .eq('contract_id', job.contract_id)
      .maybeSingle(),
    supabaseAdmin.from('contracts').select('status').eq('id', job.contract_id).maybeSingle(),
  ])
  const results = [batchResult, jobResult, reviewResult, contractResult]
  if (results.some((result) => result.error || !result.data)) {
    throw new Error('无法读取复审批次终态，拒绝执行可能覆盖已完成结果的失败补偿')
  }
  const statuses = results.map((result) => String(result.data?.status || ''))
  const allCompleted = statuses[0] === 'completed'
    && statuses[1] === 'completed'
    && statuses[2] === 'COMPLETED'
    && statuses[3] === 'COMPLETED'
  if (allCompleted) return 'completed' as const
  const allFailed = statuses[0] === 'failed'
    && statuses[1] === 'failed'
    && statuses[2] === 'FAILED'
    && statuses[3] === 'FAILED'
  if (allFailed) return 'failed' as const
  if (statuses.some((status) => ['completed', 'COMPLETED', 'failed', 'FAILED'].includes(status))) {
    return 'inconsistent' as const
  }
  return 'active' as const
}

export async function readContractAnalysisTerminalState(job: ContractAnalysisJobRecord) {
  const [jobResult, reviewResult, contractResult] = await Promise.all([
    supabaseAdmin
      .from('contract_analysis_jobs')
      .select('status')
      .eq('id', job.id)
      .eq('contract_id', job.contract_id)
      .eq('review_id', job.review_id)
      .maybeSingle(),
    supabaseAdmin
      .from('contract_reviews')
      .select('status')
      .eq('id', job.review_id)
      .eq('contract_id', job.contract_id)
      .maybeSingle(),
    supabaseAdmin.from('contracts').select('status').eq('id', job.contract_id).maybeSingle(),
  ])
  const results = [jobResult, reviewResult, contractResult]
  if (results.some((result) => result.error || !result.data)) {
    throw new Error('无法读取分析任务终态，拒绝执行可能覆盖已完成结果的失败补偿')
  }
  const statuses = results.map((result) => String(result.data?.status || ''))
  if (statuses[0] === 'completed' && statuses[1] === 'COMPLETED' && statuses[2] === 'COMPLETED') {
    return 'completed' as const
  }
  if (statuses[0] === 'failed' && statuses[1] === 'FAILED' && statuses[2] === 'FAILED') {
    return 'failed' as const
  }
  if (statuses.some((status) => ['completed', 'COMPLETED', 'failed', 'FAILED'].includes(status))) {
    return 'inconsistent' as const
  }
  return 'active' as const
}

export async function processContractAnalysisJob(job: ContractAnalysisJobRecord) {
  let decisionBatch: DecisionBatchRecord | null = null
  let decisionResult: ContractAnalysisResult | null = null
  let analysisResult: ContractAnalysisResult | null = null
  let factsStageIdentity: FactsOnlyStageIdentity | null = null
  let factsOnlyExecution = false
  try {
    const [batchResult, reviewKindResult] = await Promise.all([
      supabaseAdmin
        .from('contract_review_submission_batches')
        .select('id,contract_id,source_review_id,new_review_id,analysis_job_id,review_style,decision_snapshot,source_storage_path,source_hash,source_text_hash')
        .eq('new_review_id', job.review_id)
        .maybeSingle(),
      supabaseAdmin
        .from('contract_reviews')
        .select('review_trigger,parent_review_id,strategy_id,preferred_provider,source_storage_path,source_hash,source_text_hash,skill_bundle_id,rule_version,model_policy_id,rule_snapshot_ids,rule_set_snapshot_ids')
        .eq('id', job.review_id)
        .eq('contract_id', job.contract_id)
        .maybeSingle(),
    ])
    if (batchResult.error) throw batchResult.error
    if (reviewKindResult.error || !reviewKindResult.data) throw reviewKindResult.error || new Error('ReviewRun 不存在')
    const candidateBatch = batchResult.data as DecisionBatchRecord | null
    if (candidateBatch && (
      candidateBatch.contract_id !== job.contract_id
      || candidateBatch.new_review_id !== job.review_id
      || candidateBatch.analysis_job_id !== job.id
    )) {
      throw new Error('复审批次与合同、ReviewRun 或分析任务身份不一致，已停止执行')
    }
    if (!candidateBatch && reviewKindResult.data.review_trigger === 'decision_batch') {
      throw new Error('决策复审 ReviewRun 缺少提交批次，已停止普通审核降级')
    }
    if (candidateBatch && reviewKindResult.data.review_trigger !== 'decision_batch') {
      throw new Error('提交批次与 ReviewRun 类型不一致，已停止执行')
    }
    if (candidateBatch && (
      reviewKindResult.data.parent_review_id !== candidateBatch.source_review_id
      || reviewKindResult.data.source_storage_path !== candidateBatch.source_storage_path
      || reviewKindResult.data.source_hash !== candidateBatch.source_hash
      || reviewKindResult.data.source_text_hash !== candidateBatch.source_text_hash
    )) {
      throw new Error('提交批次与 ReviewRun 的父版本或源文件身份不一致，已停止执行')
    }
    decisionBatch = candidateBatch
    await markContractAnalysisRunning(job)
    return await withContractAnalysisLease(job, async (assertLease) => {
      if (!decisionBatch) {
        const directReview = reviewKindResult.data as DirectReviewRecord
        const verifiedSource = await verifyDirectReviewSource(job.contract_id, directReview)
        if (verifiedSource.reviewBundle.execution_contract === 'facts_v1') {
          factsOnlyExecution = true
          factsStageIdentity = await resolveFactsOnlyStageIdentity(
            job,
            verifiedSource,
            assertLease,
          )
          await assertLease()
          await verifyDirectReviewSource(job.contract_id, directReview)
          await assertLease()
          const completion = await completeFactsOnlyDirectReview(job, factsStageIdentity)
          analysisResult = completion.review_result
          job.status = 'completed'
          job.provider = completion.provider
          job.degraded = false
          job.lock_token = null
          job.locked_at = null
          job.locked_by = null
          return completion.review_result
        }
        if (verifiedSource.reviewBundle.execution_contract !== 'legacy_risk_v1') {
          throw new Error('unsupported_direct_review_execution_contract')
        }
        const report = await runStructuredAnalysis(job.contract_id, {
          reviewId: job.review_id,
          jobId: job.id,
          requestId: job.id,
          strategyCode: verifiedSource.strategyCode,
          preferredProvider: verifiedSource.preferredProvider,
          sourceText: verifiedSource.sourceText,
          sourceOrgId: verifiedSource.sourceOrgId,
          sourcePages: verifiedSource.sourcePages,
          reviewBundle: verifiedSource.reviewBundle,
        })
        analysisResult = report.result
        await assertLease()
        await verifyAndBindReviewModelEvidence(job, verifiedSource.reviewBundle, report.result)
        await assertLease()
        await verifyDirectReviewSource(job.contract_id, directReview)
        await assertLease()
        await saveStructuredReport(job, report, verifiedSource.strategyId, verifiedSource.sourceText, verifiedSource.reviewBundle)
        await assertLease()
        await verifyDirectReviewSource(job.contract_id, directReview)
        await assertLease()
        await markContractAnalysisCompleted(job, report.result)
        return report.result
      }

      const decisionSnapshot = Array.isArray(decisionBatch.decision_snapshot)
        ? decisionBatch.decision_snapshot as DecisionSnapshotRecord[]
        : []
      const decisionReview = reviewKindResult.data as DirectReviewRecord
      const verifiedSource = await verifyDecisionBatchSource(job.contract_id, decisionBatch, decisionSnapshot, decisionReview)
      if (verifiedSource.reviewBundle.execution_contract !== 'legacy_risk_v1') {
        throw new Error(
          '决策复审 Worker 仅允许 legacy_risk_v1；facts_v1 候选不得回落到模型 severity 链',
        )
      }
      const report = await runStructuredAnalysis(job.contract_id, {
        reviewId: job.review_id,
        jobId: job.id,
        requestId: job.id,
        strategyCode: reviewStyleToStrategyCode(decisionBatch.review_style),
        decisionSnapshot,
        sourceText: verifiedSource.sourceText,
        sourceOrgId: verifiedSource.sourceOrgId,
        reviewBundle: verifiedSource.reviewBundle,
      })
      decisionResult = report.result
      await assertLease()
      await verifyAndBindReviewModelEvidence(job, verifiedSource.reviewBundle, report.result)
      await assertLease()
      await saveStructuredReport(job, report)
      await assertLease()
      const outcomes = await materializeDecisionReviewRiskFacts({
        contractId: job.contract_id,
        sourceReviewId: decisionBatch.source_review_id,
        newReviewId: job.review_id,
        decisionBatchId: decisionBatch.id,
        decisionSnapshot,
        modelCompleted: true,
        modelProvider: report.result.provider,
        modelDegraded: report.result.degraded,
        modelFindings: report.result.risks,
        job,
      })
      await assertLease()
      await verifyDecisionBatchSource(job.contract_id, decisionBatch, decisionSnapshot, decisionReview)
      await assertLease()
      await completeDecisionBatch(decisionBatch, outcomes, job, report.result)
      return report.result
    })
  } catch (error) {
    if (decisionBatch) {
      let terminalState: Awaited<ReturnType<typeof readDecisionTerminalState>>
      try {
        terminalState = await readDecisionTerminalState(job, decisionBatch.id)
      } catch (stateError) {
        throw new Error(
          stateError instanceof Error ? stateError.message : '无法确认复审批次终态，已停止失败补偿',
          { cause: error }
        )
      }
      if (terminalState === 'completed' && decisionResult) return decisionResult
      if (terminalState === 'completed' || terminalState === 'inconsistent') {
        throw new Error('复审批次存在已完成写入，拒绝将其降级为失败态', { cause: error })
      }
      if (terminalState === 'failed') throw error
      await renewContractAnalysisLease(job)
      await failDecisionBatch(decisionBatch, job, error)
      throw error
    }
    if (
      factsOnlyExecution
      && !factsStageIdentity
      && isRetryableFactsCheckpointError(error)
      && await requeueFactsOnlyJobOnce(job, error)
    ) {
      throw error
    }
    const terminalState = await readContractAnalysisTerminalState(job)
    if (terminalState === 'completed' && analysisResult) return analysisResult
    if (terminalState === 'completed' && factsStageIdentity) {
      const completion = await completeFactsOnlyDirectReview(job, factsStageIdentity)
      analysisResult = completion.review_result
      job.status = 'completed'
      job.provider = completion.provider
      job.degraded = false
      job.lock_token = null
      job.locked_at = null
      job.locked_by = null
      return completion.review_result
    }
    if (terminalState === 'completed' || terminalState === 'inconsistent') {
      throw new Error('分析任务存在已完成或不一致写入，拒绝将其降级为失败态', { cause: error })
    }
    if (terminalState === 'failed') throw error
    await renewContractAnalysisLease(job)
    await markContractAnalysisFailed(job, error)
    throw error
  }
}

async function materializeDecisionReviewRiskFacts(input: {
  contractId: string
  sourceReviewId: string
  newReviewId: string
  decisionBatchId: string
  decisionSnapshot: DecisionSnapshotRecord[]
  modelCompleted: boolean
  modelProvider: string | null
  modelDegraded: boolean
  modelFindings?: ContractAnalysisResult['risks']
  job: ContractAnalysisJobRecord
}): Promise<MaterializedDecisionOutcome[]> {
  const { data: facts, error } = await supabaseAdmin
    .from('contract_risk_cards')
    .select('id,level,title,description,suggestion,auto_fixable,fix_action,clause_ref,position_start,position_end,detected_by,confidence,rule_id,rule_code,rule_version,status,fixed_by,fixed_at,evidence')
    .eq('contract_id', input.contractId)
    .eq('review_id', input.sourceReviewId)
  if (error) throw error

  if (!facts?.length) return []
  const now = new Date().toISOString()
  const draftByRiskId = new Map(input.decisionSnapshot.map((snapshot) => [snapshot.risk_id, snapshot]))
  const modelReview = mapDecisionReviewFindings(input.modelFindings || [], input.decisionSnapshot)
  const outcomes: MaterializedDecisionOutcome[] = []
  const rows = facts.map((fact) => {
    const { id: sourceRiskId, status: sourceStatus, evidence, ...immutableFact } = fact
    const draft = draftByRiskId.get(sourceRiskId)
    const evidenceRecord = evidence && typeof evidence === 'object'
      ? evidence as Record<string, unknown>
      : {}
    if (!draft) {
      if (sourceStatus === 'open') {
        throw new Error(`复审快照未覆盖待处理风险 ${sourceRiskId}，已停止写入`)
      }
      return {
        id: randomUUID(),
        ...immutableFact,
        contract_id: input.contractId,
        review_id: input.newReviewId,
        status: sourceStatus,
        detected_by: fact.detected_by || 'review_run',
        evidence: {
          ...evidenceRecord,
          source_risk_id: sourceRiskId,
          carried_forward_from_review_id: input.sourceReviewId,
        },
        created_at: now,
        updated_at: now,
      }
    }
    const priorReview = evidenceRecord.decision_review && typeof evidenceRecord.decision_review === 'object'
      ? evidenceRecord.decision_review as Record<string, unknown>
      : null
    const priorOutcome = sourceStatus === 'fixed' && priorReview?.outcome === 'resolved'
      ? 'resolved' as const
      : null
    const evaluation = evaluateDecisionReviewOutcome({
      draft,
      modelCompleted: input.modelCompleted,
      modelDegraded: input.modelDegraded,
      hasModelConflict: modelReview.hasUnscopedConflict || modelReview.byRiskId.has(sourceRiskId),
      priorOutcome,
    })
    outcomes.push({ source_risk_id: sourceRiskId, ...evaluation })
    return {
      id: randomUUID(),
      ...immutableFact,
      contract_id: input.contractId,
      review_id: input.newReviewId,
      status: evaluation.outcome === 'resolved' ? 'fixed' : 'open',
      detected_by: fact.detected_by || 'review_run',
      evidence: {
        ...evidenceRecord,
        source_risk_id: sourceRiskId,
        decision_batch_id: input.decisionBatchId,
        decision_review: {
          outcome: evaluation.outcome,
          reason: evaluation.reason,
          model_job_id: input.job.id,
          model_provider: input.modelProvider,
          model_degraded: input.modelDegraded,
          model_completed: input.modelCompleted,
          model_findings: modelReview.hasUnscopedConflict
            ? input.modelFindings || []
            : modelReview.byRiskId.get(sourceRiskId) || [],
        },
      },
      created_at: now,
      updated_at: now,
    }
  })
  const newRiskBySourceId = new Map(rows.flatMap((fact) => {
    const evidence = fact.evidence && typeof fact.evidence === 'object'
      ? fact.evidence as Record<string, unknown>
      : {}
    return typeof evidence.source_risk_id === 'string'
      ? [[evidence.source_risk_id, fact.id] as const]
      : []
  }))
  const retryDrafts = outcomes.flatMap((outcome) => {
    if (outcome.outcome === 'resolved') return []
    const snapshot = draftByRiskId.get(outcome.source_risk_id)
    const newRiskId = newRiskBySourceId.get(outcome.source_risk_id)
    if (!snapshot?.org_id || !snapshot.created_by || !newRiskId) return []
    return [{
      id: randomUUID(),
      org_id: snapshot.org_id,
      contract_id: input.contractId,
      review_id: input.newReviewId,
      risk_id: newRiskId,
      created_by: snapshot.created_by,
      status: 'draft_selected',
      decision_kind: snapshot.negotiation_result || snapshot.decision_kind || null,
      selected_option_id: snapshot.resolution_strategy_id || snapshot.selected_option_id || null,
      selected_option_snapshot: snapshot.resolution_strategy_snapshot || snapshot.selected_option_snapshot || null,
      resolution_strategy_id: snapshot.resolution_strategy_id || snapshot.selected_option_id || null,
      resolution_strategy_snapshot: snapshot.resolution_strategy_snapshot || snapshot.selected_option_snapshot || null,
      negotiation_result: snapshot.negotiation_result || snapshot.decision_kind || null,
      feedback: snapshot.feedback || null,
      comment_preview: snapshot.comment_preview || null,
      internal_note: snapshot.internal_note || null,
      customer_comment: snapshot.customer_comment || null,
      revision_text: snapshot.revision_text || null,
      translation_input_snapshot: snapshot.translation_input_snapshot || {},
      source_anchor: snapshot.source_anchor || {},
      source_storage_path: snapshot.source_storage_path || null,
      source_hash: snapshot.source_hash || null,
      source_text_hash: snapshot.source_text_hash || null,
      evidence_anchors: snapshot.evidence_anchors || (snapshot.source_anchor ? [snapshot.source_anchor] : []),
      rule_bundle_id: snapshot.rule_bundle_id || null,
      rule_bundle_version: snapshot.rule_bundle_version || null,
      workflow_state: 'NEEDS_REVISION',
      // This exact active batch authorizes worker staging before the new
      // ReviewRun becomes COMPLETED. User writes still require a completed run.
      submission_batch_id: input.decisionBatchId,
      optimistic_version: 1,
      submitted_at: null,
      created_at: now,
      updated_at: now,
    }]
  })
  if (!input.job.lock_token) throw new Error('复审批次缺少 Worker 租约令牌，拒绝写入风险事实')
  const { error: stageError } = await supabaseAdmin.rpc('stage_contract_review_decision_result', {
    p_batch_id: input.decisionBatchId,
    p_contract_id: input.contractId,
    p_review_id: input.newReviewId,
    p_job_id: input.job.id,
    p_lock_token: input.job.lock_token,
    p_risk_rows: rows,
    p_retry_drafts: retryDrafts,
  })
  if (stageError) throw stageError
  return outcomes
}

async function completeDecisionBatch(batch: {
  id: string
}, outcomes: MaterializedDecisionOutcome[], job: ContractAnalysisJobRecord, result: ContractAnalysisResult) {
  if (!job.lock_token) throw new Error('复审批次缺少 Worker 租约令牌，拒绝完成')
  const { error } = await supabaseAdmin.rpc('complete_contract_review_decision_batch', {
    p_batch_id: batch.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_job_id: job.id,
    p_lock_token: job.lock_token,
    p_outcomes: outcomes,
    p_review_result: result,
    p_provider: result.provider,
    p_degraded: result.degraded,
  })
  if (error) throw error
  job.status = 'completed'
  job.lock_token = null
  job.locked_at = null
}

async function failDecisionBatch(
  batch: { id: string },
  job: ContractAnalysisJobRecord,
  failure: unknown
) {
  if (!job.lock_token) throw new Error('复审批次缺少 Worker 租约令牌，拒绝写入失败态')
  const message = failure instanceof Error ? failure.message : String(failure)
  const { error } = await supabaseAdmin.rpc('fail_contract_review_decision_batch', {
    p_batch_id: batch.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_job_id: job.id,
    p_lock_token: job.lock_token,
    p_error: message,
  })
  if (error) throw error
  job.status = 'failed'
  job.lock_token = null
  job.locked_at = null
}

// ============ 结构化报告生成（iTerms 风格）============

export interface StructuredReport {
  result: ContractAnalysisResult
  risk_summary: RiskSummary
  compliance_check: ComplianceCheck
  effectiveness_analysis: string
  clauses: ClauseMatch[]
}

function extractClauses(text: string): ClauseMatch[] {
  const clauses: ClauseMatch[] = []
  if (!text) return clauses

  const patterns = [
    /(?:^|\n)\s*第\s*([一二三四五六七八九十百零0-9]+)\s*[条章节款项][\s、：:]*(.{0,80}?)(?=\n|$)/g,
    /(?:^|\n)\s*(\d+\.\d+(?:\.\d+)?)\s*[、.]?\s*(.{0,80}?)(?=\n|$)/g,
  ]

  let position = 0
  const seen = new Set<string>()

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const clauseNumber = match[1]?.trim() || null
      const clauseTitle = match[2]?.trim() || null
      const startOffset = match.index
      const endOffset = match.index + match[0].length
      const clauseText = match[0].trim()
      const key = `${clauseNumber}-${clauseText.slice(0, 30)}`
      if (seen.has(key) || clauseText.length < 5) continue
      seen.add(key)

      clauses.push({
        clauseNumber, clauseTitle, clauseText,
        riskLevel: 'low', riskCategory: null, riskDescription: null,
        legalBasis: null, suggestion: null, suggestedText: null,
        matchedLibraryClauseId: null, position: position++,
        startOffset, endOffset,
      })
      if (clauses.length >= 50) break
    }
    if (clauses.length >= 50) break
  }
  return clauses
}

async function matchClauseLibrary(clauses: ClauseMatch[], orgId?: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let query = supabaseAdmin.from('clause_library')
    .select('id, category, stance, template_text, org_id')
  query = orgId ? query.or(`org_id.is.null,org_id.eq.${orgId}`) : query.is('org_id', null)
  const { data: library, error } = await query
  if (error || !library) return map

  const keywordsMap: Record<string, string[]> = {
    payment: ['付款', '支付', '价款', '费用', '预付', '结算', '对价'],
    delivery: ['交付', '运送', '发货', '运输', '移交', '验收'],
    quality: ['质量', '保修', '质保', '售后', '维修', '缺陷'],
    breach: ['违约', '违约金', '赔偿', '罚则', '损失'],
    dispute: ['争议', '仲裁', '诉讼', '管辖', '法院', '争议解决'],
    liability: ['免责', '责任', '不可抗力', '赔偿'],
    ip: ['知识产权', '专利', '著作权', '技术成果'],
  }
  for (const clause of clauses) {
    const text = `${clause.clauseTitle || ''} ${clause.clauseText}`
    for (const [category, kws] of Object.entries(keywordsMap)) {
      if (kws.some(kw => text.includes(kw))) {
        const matched = library.find(lib =>
          lib.category === category && (lib.stance === 'required' || lib.stance === 'dangerous' || lib.stance === 'risky')
        )
        if (matched) map.set(clause.clauseText.slice(0, 50), matched.id)
        break
      }
    }
  }
  return map
}

function calculateRiskSummary(risks: ContractAnalysisResult['risks'], clauseCount: number, strategyCode?: string): RiskSummary {
  let critical = 0
  let high = 0
  const medium = 0
  let low = 0
  for (const risk of risks) {
    if (risk.level === 'red') critical++
    else if (risk.level === 'yellow') high++
    else low++
  }
  const score = Math.max(0, Math.min(100, 100 - critical * 25 - high * 10 - medium * 3))
  return {
    total_clauses: clauseCount,
    critical_risks: critical,
    high_risks: high,
    medium_risks: medium,
    low_risks: low,
    compliance_score: score,
    strategy_code: strategyCode,
  }
}
async function performComplianceCheck(
  clauses: ClauseMatch[],
  orgId: string | undefined
): Promise<ComplianceCheck> {
  const result: ComplianceCheck = {
    missing_required_clauses: [],
    dangerous_clauses: [],
    ambiguous_clauses: [],
    unbalanced_clauses: [],
    party_a_consistency: 'unknown',
    party_b_consistency: 'unknown',
    issues: [],
  }

  // 1. 必备条款检查
  let required: Array<{ category: string; name: string }> = []
  try {
    let q = supabaseAdmin.from('clause_library').select('name, category, stance').eq('stance', 'required')
    q = orgId ? q.or(`org_id.is.null,org_id.eq.${orgId}`) : q.is('org_id', null)
    const { data } = await q
    required = (data || []).map(d => ({ category: d.category, name: d.name }))
  } catch {
 /* ignore */ }

  const found = new Set<string>()
  const kwsMap: Record<string, string[]> = {
    payment: ['付款', '支付', '价款'],
    delivery: ['交付', '运送'],
    quality: ['质量', '保修'],
    breach: ['违约', '违约金'],
    dispute: ['争议', '仲裁'],
  }
  for (const clause of clauses) {
    const text = clause.clauseText
    for (const [cat, kws] of Object.entries(kwsMap)) {
      if (kws.some(kw => text.includes(kw))) {
        found.add(cat)
        break
      }
    }
  }
  for (const req of required) {
    if (!found.has(req.category)) {
      result.missing_required_clauses.push(req.name)
    }
  }

  // 2. 危险条款检查
  try {
    let q = supabaseAdmin.from('clause_library').select('id, name, template_text, stance')
      .in('stance', ['dangerous', 'risky'])
    q = orgId ? q.or(`org_id.is.null,org_id.eq.${orgId}`) : q.is('org_id', null)
    const { data: dangerous } = await q
    if (dangerous) {
      for (const dc of dangerous) {
        for (const clause of clauses) {
          if (dc.template_text && clause.clauseText.includes(dc.template_text.slice(0, 30))) {
            if (dc.stance === 'dangerous') result.dangerous_clauses.push(dc.name)
            break
          }
        }
      }
    }
  } catch {
 /* ignore */ }

  // 3. 模糊用语检查
  for (const clause of clauses) {
    if (/(?:等|之类|有关|相关|类似|适当|合理)/.test(clause.clauseText) && clause.clauseText.length < 100) {
      result.ambiguous_clauses.push(
        `${clause.clauseNumber || '?'}条：包含模糊用语`
      )
    }
  }

  return result
}

function generateEffectivenessAnalysis(c: ComplianceCheck, r: RiskSummary): string {
  const lines: string[] = []
  lines.push(`## 合同效力与风险分析报告`)
  lines.push(``)
  lines.push(`### 综合评分：${r.compliance_score}/100`)
  if (r.compliance_score >= 80) lines.push(`合同条款较为完整，风险整体可控。`)
  else if (r.compliance_score >= 60) lines.push(`合同存在部分风险条款，建议重点关注并修改。`)
  else lines.push(`合同存在重大风险，不建议直接签署。`)
  lines.push(``)

  if (c.missing_required_clauses.length > 0) {
    lines.push(`### 缺失必备条款（${c.missing_required_clauses.length}项）`)
    for (const x of c.missing_required_clauses) lines.push(`- ${x}`)
    lines.push(``)
  }
  if (c.dangerous_clauses.length > 0) {
    lines.push(`### 高风险条款（${c.dangerous_clauses.length}项）`)
    for (const x of c.dangerous_clauses) lines.push(`- ${x}`)
    lines.push(``)
  }
  if (c.ambiguous_clauses.length > 0) {
    lines.push(`### 模糊用语条款（${c.ambiguous_clauses.length}项）`)
    for (const x of c.ambiguous_clauses.slice(0, 5)) lines.push(`- ${x}`)
    lines.push(``)
  }
  if (c.issues.length > 0) {
    lines.push(`### 其他问题`)
    for (const x of c.issues) lines.push(`- ${x}`)
    lines.push(``)
  }
  return lines.join('\n')
}

export async function runStructuredAnalysis(
  contractId: string,
  options?: ReviewOptions
): Promise<StructuredReport> {
  const context = options?.sourceText !== undefined
    ? { text: options.sourceText, orgId: options.sourceOrgId }
    : await fetchContractContext(contractId)
  const reviewBundle = options?.reviewBundle
  const isDecisionReview = Boolean(options?.decisionSnapshot?.length)
  const isDirectFrozenReview = Boolean(reviewBundle && !isDecisionReview)
  const chunks = isDecisionReview
    ? [{
        index: 1,
        start: 0,
        end: context.text.length,
        text: buildDecisionReviewModelInput(context.text, options!.decisionSnapshot!),
        page_start: null,
        page_end: null,
      }]
    : reviewBundle
      ? splitReviewTextIntoChunks(context.text, options?.sourcePages)
      : [{
          index: 1,
          start: 0,
          end: context.text.length,
          text: context.text,
          page_start: null,
          page_end: null,
        }]
  const publishedRules = reviewBundle?.rules.map((rule) => ({
    rule_snapshot_id: rule.snapshot_id,
    rule_code: rule.code,
    name: rule.name,
    description: rule.description,
    clause_category: rule.clause_category,
    risk_level: rule.risk_level,
    review_criteria: rule.review_criteria,
  })) || []
  const chunkResults: Array<{
    chunk: (typeof chunks)[number]
    chunkHash: string
    result: Awaited<ReturnType<typeof reviewWithFailoverSync>>
  }> = []

  for (const chunk of chunks) {
    const chunkHash = createHash('sha256').update(chunk.text).digest('hex')
    const result = await reviewWithFailoverSync(chunk.text, {
      orgId: context.orgId,
      contractId,
      reviewId: options?.reviewId,
      jobId: options?.jobId,
      preferredProvider: options?.preferredProvider,
      requestId: options?.requestId,
      tool: 'contract_review',
      capability: 'contract_review',
      phase: 'semantic_review',
      skillBundleId: reviewBundle?.id,
      modelPolicyId: reviewBundle?.model_policy_id || undefined,
      frozenModelPolicy: reviewBundle?.model_policy || undefined,
      publishedRules,
      chunk: isDirectFrozenReview ? {
        index: chunk.index,
        total: chunks.length,
        start: chunk.start,
        end: chunk.end,
        hash: chunkHash,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
      } : undefined,
    }, 1)
    if (reviewBundle && result.degraded) {
      throw new Error(
        `冻结审核分块 ${chunk.index}/${chunks.length} 未获得非降级模型结果（provider=${result.provider}），已停止剩余分块`
      )
    }
    chunkResults.push({ chunk, chunkHash, result })
  }

  const risks = chunkResults.flatMap(({ chunk, chunkHash, result }) => result.risks.map((risk) => {
    const candidateQuote = risk.source_quote?.trim() || ''
    const resolvedQuote = isDirectFrozenReview
      ? resolveFrozenChunkSourceQuote(chunk.text, candidateQuote)
      : null
    return {
      ...risk,
      candidate_source_quote: candidateQuote || null,
      source_quote: resolvedQuote?.exactText || candidateQuote || null,
      source_quote_normalization: resolvedQuote?.normalization || null,
      source_start: resolvedQuote ? chunk.start + resolvedQuote.start : null,
      source_end: resolvedQuote ? chunk.start + resolvedQuote.end : null,
      source_chunk: resolvedQuote ? {
        index: chunk.index,
        total: chunks.length,
        start: chunk.start,
        end: chunk.end,
        hash: chunkHash,
      } : null,
    }
  }))
  const dedupedRisks = Array.from(new Map(risks.map((risk, index) => {
    const located = typeof risk.source_start === 'number' && typeof risk.source_end === 'number'
    const key = located
      ? `${risk.rule_code || ''}:${risk.source_start}:${risk.source_end}`
      : `unresolved:${index}:${risk.rule_snapshot_id || ''}:${risk.rule_code || ''}:${risk.source_quote || ''}`
    return [key, risk]
  })).values())
  const usageValues = chunkResults.map(({ result }) => result.usage).filter(Boolean) as TokenUsage[]
  const usage = usageValues.length > 0 ? {
    inputTokens: usageValues.reduce((sum, item) => sum + (item.inputTokens || 0), 0),
    outputTokens: usageValues.reduce((sum, item) => sum + (item.outputTokens || 0), 0),
    totalTokens: usageValues.reduce((sum, item) => sum + (item.totalTokens || 0), 0),
  } : undefined
  const providers = [...new Set(chunkResults.map(({ result }) => result.provider))]

  const result: ContractAnalysisResult = {
    risks: dedupedRisks,
    summary: chunkResults.length === 1
      ? chunkResults[0].result.summary
      : chunkResults.map(({ chunk, result: chunkResult }) => (
          `[分块 ${chunk.index}/${chunks.length}${chunk.page_start ? `，页 ${chunk.page_start}-${chunk.page_end}` : ''}] ${chunkResult.summary}`
        )).join('\n'),
    appliedRules: dedupedRisks.length,
    matchedRules: dedupedRisks.filter((risk) => risk.level === 'red' || risk.level === 'yellow').length,
    provider: providers.length === 1 ? providers[0] : `multi:${providers.join(',')}`,
    degraded: chunkResults.some(({ result: chunkResult }) => chunkResult.degraded),
    usage,
  }

  const clauses = extractClauses(context.text)
  const clauseMatches = await matchClauseLibrary(clauses, context.orgId)
  for (const clause of clauses) {
    const libId = clauseMatches.get(clause.clauseText.slice(0, 50))
    if (libId) clause.matchedLibraryClauseId = libId
  }

  const risk_summary = calculateRiskSummary(result.risks, clauses.length, options?.strategyCode)
  const compliance_check = await performComplianceCheck(clauses, context.orgId)
  const effectiveness_analysis = generateEffectivenessAnalysis(compliance_check, risk_summary)

  return { result, risk_summary, compliance_check, effectiveness_analysis, clauses }
}

export async function saveStructuredReport(
  job: ContractAnalysisJobRecord,
  report: StructuredReport,
  strategyId?: string,
  directSourceText?: string,
  directReviewBundle?: PublishedReviewBundle
): Promise<void> {
  if (!job.lock_token) throw new Error('分析任务缺少 Worker 租约令牌，拒绝写入结构化报告')
  if (directSourceText !== undefined && !directReviewBundle) {
    throw new Error('普通审核缺少冻结规则包，拒绝物化风险事实')
  }
  const clauseRows = report.clauses.map(c => ({
      review_id: job.review_id,
      contract_id: job.contract_id,
      clause_number: c.clauseNumber,
      clause_title: c.clauseTitle,
      clause_text: c.clauseText,
      risk_level: c.riskLevel,
      risk_category: c.riskCategory,
      risk_description: c.riskDescription,
      legal_basis: c.legalBasis,
      suggestion: c.suggestion,
      suggested_text: c.suggestedText,
      matched_library_clause_id: c.matchedLibraryClauseId,
      position: c.position,
      start_offset: c.startOffset,
      end_offset: c.endOffset,
    }))
  const directRiskRows = directSourceText === undefined
    ? []
    : materializeDirectRiskRows(job, report.result, directSourceText, directReviewBundle as PublishedReviewBundle)
  const { error } = await supabaseAdmin.rpc('stage_contract_analysis_report', {
    p_job_id: job.id,
    p_contract_id: job.contract_id,
    p_review_id: job.review_id,
    p_lock_token: job.lock_token,
    p_strategy_id: strategyId || null,
    p_risk_summary: report.risk_summary as unknown as Record<string, unknown>,
    p_compliance_check: report.compliance_check as unknown as Record<string, unknown>,
    p_effectiveness_analysis: report.effectiveness_analysis,
    p_clauses: clauseRows,
    p_risks: directRiskRows,
  })
  if (error) {
    const diagnostics = directRiskRows.reduce((summary, row) => {
      const anchor = String(row.evidence.source_anchor_status || 'unknown')
      const binding = String(row.evidence.binding_status || 'unknown')
      summary[`${anchor}:${binding}`] = (summary[`${anchor}:${binding}`] || 0) + 1
      return summary
    }, {} as Record<string, number>)
    throw new Error(
      `${describeContractAnalysisError(error)} | direct_risk_diagnostics=${JSON.stringify({ total: directRiskRows.length, groups: diagnostics })}`,
      { cause: error }
    )
  }
}
