import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  ContractAnalysisLeaseError,
  enqueueContractAnalysisJob,
  markContractAnalysisFailed,
  markContractAnalysisRunning,
  runStructuredAnalysis,
  saveStructuredReport,
  type ContractAnalysisJobRecord,
  type StructuredReport,
} from '@/lib/contract-analysis'
import { resolveCurrentReviewArtifactBinding } from '@/lib/contracts/current-review-binding'
import { supabaseAdmin } from '@/lib/supabase'

const LIVE_PINNED_ENABLED = process.env.WP02_LIVE_CONTRACT_REVIEW === '1'
const LIVE_ROUTE_ENABLED = process.env.WP02_LIVE_CONTRACT_ROUTE === '1'
const CONTRACT_ID = process.env.WP02_LIVE_CONTRACT_ID || ''
const REQUESTED_BY = process.env.WP02_LIVE_REQUESTED_BY || ''
const LOCAL_MODEL_ASSET_ID = process.env.WP02_LIVE_LOCAL_MODEL_ASSET_ID || ''
const CLOUD_MODEL_ASSET_ID = process.env.WP02_LIVE_CLOUD_MODEL_ASSET_ID || ''
const EVIDENCE_TAG = process.env.WP02_LIVE_EVIDENCE_TAG || 'manual-live-acceptance'
const RELEASE_COMMIT = process.env.WP02_LIVE_RELEASE_COMMIT || ''
const PREVIEW_DEPLOYMENT = process.env.WP02_LIVE_PREVIEW_DEPLOYMENT || ''
const PREVIEW_WRITE_FUSE = process.env.WP02_PREVIEW_WRITE_FUSE || ''
const PREVIEW_SUPABASE_URL = process.env.WP02_PREVIEW_SUPABASE_URL || ''
const PREVIEW_SUPABASE_PROJECT_REF = process.env.WP02_PREVIEW_SUPABASE_PROJECT_REF || ''
const ACTIVE_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ACTIVE_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const PREVIEW_WRITE_FUSE_VALUE = 'ALLOW_PREVIEW_WRITES'
// These identities are deliberately versioned instead of supplied by the same
// command that enables the write test. A caller therefore cannot redefine a
// Production project as Preview and have the guard accept its own assertion.
const TRUSTED_PREVIEW_SUPABASE_PROJECT_REFS = new Set(['vsfropnfsmnonkotywsx'])
const TRUSTED_PRODUCTION_SUPABASE_PROJECT_REFS = new Set(['wfawwhphfqqwfwrrkogy'])

function parseSupabaseProjectUrl(value: string, label: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} 不是有效 URL`)
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(`${label} 必须是无凭据、无路径参数的 HTTPS Supabase 项目根地址`)
  }

  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname)
  if (!match) throw new Error(`${label} 必须使用 <project-ref>.supabase.co`)
  return { origin: url.origin.toLowerCase(), projectRef: match[1].toLowerCase() }
}

function parseSupabaseProjectRef(value: string, label: string) {
  const normalized = value.toLowerCase()
  if (!/^[a-z0-9]{20}$/.test(normalized)) {
    throw new Error(`${label} 必须是 20 位 Supabase project ref`)
  }
  return normalized
}

function parseServiceRoleIdentity(value: string):
  | { kind: 'legacy_jwt'; projectRef: string }
  | { kind: 'opaque_secret' } {
  if (/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(value)) {
    return { kind: 'opaque_secret' }
  }
  const parts = value.split('.')
  if (parts.length !== 3) {
    throw new Error('Preview 诊断只接受 Supabase legacy JWT service-role key 或 sb_secret_ key')
  }

  let payload: { ref?: unknown; role?: unknown }
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 不是可解析的 Supabase JWT')
  }
  if (payload.role !== 'service_role') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 的 role 不是 service_role')
  }
  return {
    kind: 'legacy_jwt',
    projectRef: parseSupabaseProjectRef(String(payload.ref || ''), 'SUPABASE_SERVICE_ROLE_KEY.ref'),
  }
}

function validatePreviewWriteBoundary(input: {
  writeFuse: string
  previewSupabaseUrl: string
  previewSupabaseProjectRef: string
  activeSupabaseUrl: string
  serviceRoleKey: string
  vercelEnvironment?: string
}) {
  // This helper uses the service-role client and therefore validates every
  // Preview identity before the first Supabase query or mutation is built.
  if (input.writeFuse !== PREVIEW_WRITE_FUSE_VALUE) {
    throw new Error(`Preview 写入熔断未开启：WP02_PREVIEW_WRITE_FUSE 必须显式设为 ${PREVIEW_WRITE_FUSE_VALUE}`)
  }
  if (!input.previewSupabaseUrl || !input.previewSupabaseProjectRef || !input.serviceRoleKey) {
    throw new Error(
      'Preview 诊断必须设置 WP02_PREVIEW_SUPABASE_URL、WP02_PREVIEW_SUPABASE_PROJECT_REF 和 SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  if (!input.activeSupabaseUrl) {
    throw new Error('Preview 诊断必须显式设置 NEXT_PUBLIC_SUPABASE_URL')
  }
  if (input.vercelEnvironment === 'production') {
    throw new Error('Preview-only 数据库诊断拒绝在 Vercel Production 环境运行')
  }

  const expectedPreview = parseSupabaseProjectUrl(input.previewSupabaseUrl, 'WP02_PREVIEW_SUPABASE_URL')
  const activeProject = parseSupabaseProjectUrl(input.activeSupabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL')
  const expectedPreviewRef = parseSupabaseProjectRef(
    input.previewSupabaseProjectRef,
    'WP02_PREVIEW_SUPABASE_PROJECT_REF',
  )
  const serviceRoleIdentity = parseServiceRoleIdentity(input.serviceRoleKey)

  if (expectedPreview.projectRef !== expectedPreviewRef) {
    throw new Error('WP02_PREVIEW_SUPABASE_URL 与 WP02_PREVIEW_SUPABASE_PROJECT_REF 不匹配')
  }
  if (activeProject.origin !== expectedPreview.origin || activeProject.projectRef !== expectedPreviewRef) {
    throw new Error('当前 Supabase URL 未命中明确声明的 Preview 项目，拒绝任何数据库访问')
  }
  if (TRUSTED_PRODUCTION_SUPABASE_PROJECT_REFS.has(expectedPreviewRef)) {
    throw new Error('目标项目命中版本化 Production 拒绝名单，拒绝任何数据库访问')
  }
  if (!TRUSTED_PREVIEW_SUPABASE_PROJECT_REFS.has(expectedPreviewRef)) {
    throw new Error('目标项目不在版本化 Preview 写入允许名单，拒绝任何数据库访问')
  }
  if (serviceRoleIdentity.kind === 'legacy_jwt' && serviceRoleIdentity.projectRef !== expectedPreviewRef) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 所属项目与允许的 Preview 项目不一致')
  }

  return { expectedPreview, expectedPreviewRef, serviceRoleIdentity }
}

let opaqueServiceRoleProbe: Promise<void> | null = null

async function verifyOpaqueServiceRoleProjectBinding(input: {
  previewOrigin: string
  serviceRoleKey: string
}) {
  if (!opaqueServiceRoleProbe) {
    opaqueServiceRoleProbe = (async () => {
      const response = await fetch(`${input.previewOrigin}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          apikey: input.serviceRoleKey,
          Authorization: `Bearer ${input.serviceRoleKey}`,
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error(`sb_secret_ key 未被允许的 Preview 项目接受（HTTP ${response.status}）`)
      }
    })()
  }
  await opaqueServiceRoleProbe
}

function validatePinnedModelAssets(localModelAssetId: string, cloudModelAssetId: string) {
  if (!localModelAssetId || !cloudModelAssetId) {
    throw new Error('双模型验收必须设置 WP02_LIVE_LOCAL_MODEL_ASSET_ID 和 WP02_LIVE_CLOUD_MODEL_ASSET_ID')
  }
  if (localModelAssetId === cloudModelAssetId) {
    throw new Error('本地与云端模型资产 ID 必须不同，不能用同一模型冒充双模型验收')
  }
}

async function requireLiveConfiguration() {
  const boundary = validatePreviewWriteBoundary({
    writeFuse: PREVIEW_WRITE_FUSE,
    previewSupabaseUrl: PREVIEW_SUPABASE_URL,
    previewSupabaseProjectRef: PREVIEW_SUPABASE_PROJECT_REF,
    activeSupabaseUrl: ACTIVE_SUPABASE_URL,
    serviceRoleKey: ACTIVE_SUPABASE_SERVICE_ROLE_KEY,
    vercelEnvironment: process.env.VERCEL_ENV,
  })
  if (boundary.serviceRoleIdentity.kind === 'opaque_secret') {
    // Opaque keys do not encode a project ref. Prove the binding with a
    // read-only request to the hard-coded Preview endpoint before any table
    // query or mutation is allowed to run.
    await verifyOpaqueServiceRoleProjectBinding({
      previewOrigin: boundary.expectedPreview.origin,
      serviceRoleKey: ACTIVE_SUPABASE_SERVICE_ROLE_KEY,
    })
  }
  if (!CONTRACT_ID || !REQUESTED_BY) {
    throw new Error('启用真实验收时必须设置 WP02_LIVE_CONTRACT_ID 和 WP02_LIVE_REQUESTED_BY')
  }
  if (!RELEASE_COMMIT.trim() || !PREVIEW_DEPLOYMENT.trim()) {
    throw new Error(
      '启用诊断时必须填写 WP02_LIVE_RELEASE_COMMIT 和 WP02_LIVE_PREVIEW_DEPLOYMENT；它们仅用于关联发布上下文，不构成 Hosted Preview 同 SHA 证据',
    )
  }
  if (LIVE_PINNED_ENABLED) validatePinnedModelAssets(LOCAL_MODEL_ASSET_ID, CLOUD_MODEL_ASSET_ID)
}

type LiveReviewResult = {
  reviewId: string
  jobId: string
  planSnapshotId: string
  planSnapshotHash: string
  executionId: string
  executionMode: 'route' | 'pinned'
  pinnedModelCatalogEntryId: string | null
  inputSha256: string
  model: string
  invocationIds: string[]
  applicationId: string
  routePolicyId: string
  totalTokens: number
  riskCount: number
  degraded: boolean
  degradationReasons: string[]
}

async function settlePreLeaseFailure(input: {
  reviewId: string
  contractVersionId: string
  originalContractStatus: string
  cause: unknown
}) {
  // enqueueContractAnalysisJob can fail either before inserting a job or after
  // an ambiguous insert/claim. Preserve a real queued/running job for normal
  // recovery; only close the orphan ReviewRun when no job exists.
  const { data: existingJob, error: lookupError } = await supabaseAdmin
    .from('contract_analysis_jobs')
    .select('id, status')
    .eq('contract_id', CONTRACT_ID)
    .eq('review_id', input.reviewId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupError) {
    throw new AggregateError(
      [input.cause, lookupError],
      '审核任务创建失败，且无法判定是否存在可恢复任务；保留现场，拒绝盲目回滚',
    )
  }
  if (existingJob?.id) {
    throw new AggregateError(
      [input.cause],
      `审核任务租约未返回，但已存在可恢复任务 ${existingJob.id}（${existingJob.status}）；保留现场，禁止重复创建`,
    )
  }

  const completedAt = new Date().toISOString()
  const { data: cleanedReview, error: reviewCleanupError } = await supabaseAdmin
    .from('contract_reviews')
    .update({
      status: 'FAILED',
      completed_at: completedAt,
      results: { error: 'analysis_job_setup_failed_before_lease' },
    })
    .eq('id', input.reviewId)
    .eq('contract_id', CONTRACT_ID)
    .eq('contract_version_id', input.contractVersionId)
    .eq('status', 'PARSING')
    .select('id')
    .maybeSingle()
  if (reviewCleanupError || cleanedReview?.id !== input.reviewId) {
    throw new AggregateError(
      [
        input.cause,
        reviewCleanupError || new Error('孤立 ReviewRun 清理未精确命中预期 ID'),
      ],
      '审核任务创建失败，且 ReviewRun 清理结果不确定；保留现场',
    )
  }

  const { data: restoredContract, error: contractCleanupError } = await supabaseAdmin
    .from('contracts')
    .update({ status: input.originalContractStatus, updated_at: completedAt })
    .eq('id', CONTRACT_ID)
    .eq('current_version_id', input.contractVersionId)
    .eq('status', 'PARSING')
    .select('id')
    .maybeSingle()
  if (contractCleanupError || restoredContract?.id !== CONTRACT_ID) {
    throw new AggregateError(
      [
        input.cause,
        contractCleanupError || new Error('合同状态回滚未精确命中预期 ID'),
      ],
      '审核任务创建失败，且合同状态回滚结果不确定；保留现场',
    )
  }
}

async function runReview(modelAssetId?: string): Promise<LiveReviewResult> {
  await requireLiveConfiguration()
  const binding = await resolveCurrentReviewArtifactBinding({
    contractId: CONTRACT_ID,
    mode: 'read',
  })
  if (!binding) {
    throw new Error('真实合同当前版本尚未达到 SOURCE_READY 且页映射身份一致，拒绝创建 ReviewRun')
  }

  const [{ data: parent, error: parentError }, { data: contract, error: contractError }] = await Promise.all([
    supabaseAdmin
      .from('contract_reviews')
      .select('id, contract_version_id, source_storage_path, source_hash, source_text_hash')
      .eq('id', binding.reviewId)
      .eq('contract_id', CONTRACT_ID)
      .eq('contract_version_id', binding.contractVersionId)
      .not('source_storage_path', 'is', null)
      .not('source_hash', 'is', null)
      .not('source_text_hash', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('contracts')
      .select('id, current_version_id, status')
      .eq('id', CONTRACT_ID)
      .maybeSingle(),
  ])

  if (parentError || contractError) throw parentError || contractError

  if (
    !parent?.contract_version_id
    || !parent.source_storage_path
    || !parent.source_hash
    || !parent.source_text_hash
  ) {
    throw new Error('真实合同缺少可冻结的源文件身份，拒绝创建 ReviewRun')
  }
  if (
    contract?.id !== CONTRACT_ID
    || contract.current_version_id !== parent.contract_version_id
    || !['PENDING', 'FAILED', 'COMPLETED'].includes(String(contract.status))
  ) {
    throw new Error('真实合同版本或状态不允许创建 Preview 诊断 ReviewRun')
  }
  const originalContractStatus = String(contract.status)

  const { data: updatedContract, error: contractStateError } = await supabaseAdmin
    .from('contracts')
    .update({ status: 'PARSING', updated_at: new Date().toISOString() })
    .eq('id', CONTRACT_ID)
    .eq('current_version_id', parent.contract_version_id)
    .eq('status', originalContractStatus)
    .select('id, current_version_id')
    .maybeSingle()
  if (
    contractStateError
    || updatedContract?.id !== CONTRACT_ID
    || updatedContract.current_version_id !== parent.contract_version_id
  ) {
    throw contractStateError || new Error('合同当前版本已变化，拒绝启动真实验收')
  }

  const reviewId = randomUUID()
  const reviewIdentity = {
    id: reviewId,
    contract_id: CONTRACT_ID,
    contract_version_id: parent.contract_version_id,
    status: 'PARSING',
    review_trigger: 'direct',
    parent_review_id: parent.id,
    source_storage_path: parent.source_storage_path,
    source_hash: parent.source_hash,
    source_text_hash: parent.source_text_hash,
  }
  const { data: insertedReview, error: reviewError } = await supabaseAdmin
    .from('contract_reviews')
    .insert({
      ...reviewIdentity,
      started_at: new Date().toISOString(),
    })
    .select('id, contract_id, contract_version_id, status, review_trigger, parent_review_id, source_storage_path, source_hash, source_text_hash')
    .maybeSingle()

  let persistedSetupReview = insertedReview
  const reviewInsertFailure = reviewError || insertedReview?.id !== reviewId
    ? reviewError || new Error('ReviewRun 写入未返回预生成 ID')
    : null
  if (reviewInsertFailure) {
    const { data: existingReview, error: reviewLookupError } = await supabaseAdmin
      .from('contract_reviews')
      .select('id, contract_id, contract_version_id, status, review_trigger, parent_review_id, source_storage_path, source_hash, source_text_hash')
      .eq('id', reviewId)
      .maybeSingle()
    if (reviewLookupError) {
      throw new AggregateError(
        [reviewInsertFailure, reviewLookupError],
        'ReviewRun 写入响应不确定，且无法按预生成 ID 复核；保留现场，拒绝回滚',
      )
    }
    if (existingReview) {
      persistedSetupReview = existingReview
    } else {
      const { data: rolledBackContract, error: rollbackError } = await supabaseAdmin
        .from('contracts')
        .update({ status: originalContractStatus, updated_at: new Date().toISOString() })
        .eq('id', CONTRACT_ID)
        .eq('current_version_id', parent.contract_version_id)
        .eq('status', 'PARSING')
        .select('id')
        .maybeSingle()
      if (rollbackError || rolledBackContract?.id !== CONTRACT_ID) {
        throw new AggregateError(
          [
            reviewInsertFailure,
            rollbackError || new Error('合同状态回滚未精确命中预期 ID'),
          ],
          '确认 ReviewRun 不存在，但合同状态回滚结果不确定；保留现场',
        )
      }
      throw reviewInsertFailure
    }
  }

  if (
    !persistedSetupReview
    || persistedSetupReview.id !== reviewIdentity.id
    || persistedSetupReview.contract_id !== reviewIdentity.contract_id
    || persistedSetupReview.contract_version_id !== reviewIdentity.contract_version_id
    || persistedSetupReview.status !== reviewIdentity.status
    || persistedSetupReview.review_trigger !== reviewIdentity.review_trigger
    || persistedSetupReview.parent_review_id !== reviewIdentity.parent_review_id
    || persistedSetupReview.source_storage_path !== reviewIdentity.source_storage_path
    || persistedSetupReview.source_hash !== reviewIdentity.source_hash
    || persistedSetupReview.source_text_hash !== reviewIdentity.source_text_hash
  ) {
    throw new AggregateError(
      [reviewInsertFailure || new Error('ReviewRun 持久化身份与预生成身份不一致')],
      'ReviewRun 持久化身份冲突；保留现场，拒绝继续或回滚',
    )
  }
  const review = { id: reviewId }

  let job: ContractAnalysisJobRecord | null = null
  let report: StructuredReport | null = null
  try {
    job = await enqueueContractAnalysisJob(CONTRACT_ID, review.id, REQUESTED_BY)
    job = await markContractAnalysisRunning(job)
    report = await runStructuredAnalysis(CONTRACT_ID, {
      reviewId: review.id,
      requestedBy: REQUESTED_BY,
      reviewTrigger: 'direct',
      reviewEvent: EVIDENCE_TAG,
      ...(modelAssetId ? { semanticModelAssetId: modelAssetId } : {}),
    })
    job = await markContractAnalysisRunning(job)
    await saveStructuredReport(job, report)
  } catch (error) {
    if (!job) {
      await settlePreLeaseFailure({
        reviewId: review.id,
        contractVersionId: parent.contract_version_id,
        originalContractStatus,
        cause: error,
      })
    } else if (!(error instanceof ContractAnalysisLeaseError)) {
      try {
        await markContractAnalysisFailed(job, error)
      } catch (transitionError) {
        throw new AggregateError(
          [error, transitionError],
          '真实审核失败，且租约保护的失败状态发布也失败',
        )
      }
    }
    throw error
  }
  if (!job || !report) throw new Error('审核状态机未返回可验收的任务和报告')

  const invocationIds = report.runtime?.model_invocation_ids || []
  if (invocationIds.length === 0) throw new Error('真实审核完成但没有绑定 model_invocations')
  const { data: invocations, error: invocationError } = await supabaseAdmin
    .from('model_invocations')
    .select('id, contract_id, review_id, plan_snapshot_id, execution_id, execution_mode, pinned_model_catalog_entry_id, business_use_point_id, application_id, route_policy_id, model_catalog_entry_id, provider_connection_id, attempt_no, model, status, total_tokens, request_meta')
    .in('id', invocationIds)
    .order('attempt_no', { ascending: true })
  if (invocationError) throw invocationError

  const [{ data: persistedReview, error: persistedReviewError }, { data: persistedJob, error: persistedJobError }, { data: persistedContract, error: persistedContractError }] = await Promise.all([
    supabaseAdmin
      .from('contract_reviews')
      .select('id, contract_id, contract_version_id, status, source_storage_path, source_hash, source_text_hash')
      .eq('id', review.id)
      .maybeSingle(),
    supabaseAdmin
      .from('contract_analysis_jobs')
      .select('id, contract_id, review_id, status, degraded')
      .eq('id', job.id)
      .maybeSingle(),
    supabaseAdmin
      .from('contracts')
      .select('id, current_version_id, status')
      .eq('id', CONTRACT_ID)
      .maybeSingle(),
  ])
  if (persistedReviewError || persistedJobError || persistedContractError) {
    throw persistedReviewError || persistedJobError || persistedContractError
  }

  expect(persistedReview).toMatchObject({
    id: review.id,
    contract_id: CONTRACT_ID,
    contract_version_id: parent.contract_version_id,
    source_storage_path: parent.source_storage_path,
    source_hash: parent.source_hash,
    source_text_hash: parent.source_text_hash,
  })
  expect(['COMPLETED', 'DEGRADED']).toContain(persistedReview?.status)
  expect(persistedJob).toMatchObject({
    id: job.id,
    contract_id: CONTRACT_ID,
    review_id: review.id,
    status: 'completed',
    degraded: report.result.degraded,
  })
  expect(persistedContract).toMatchObject({
    id: CONTRACT_ID,
    current_version_id: parent.contract_version_id,
    status: 'COMPLETED',
  })

  const completed = (invocations || []).find((item) => item.status === 'completed')
  const requestMeta = completed?.request_meta && typeof completed.request_meta === 'object'
    ? completed.request_meta as Record<string, unknown>
    : {}
  const planSnapshotId = report.runtime?.plan_snapshot_id
  const planSnapshotHash = report.runtime?.plan_snapshot_hash
  const executionId = completed?.execution_id || ''
  const executionMode = completed?.execution_mode
  const pinnedModelCatalogEntryId = completed?.pinned_model_catalog_entry_id || null
  const inputSha256 = typeof requestMeta.input_sha256 === 'string' ? requestMeta.input_sha256 : ''
  const applicationId = completed?.application_id || ''
  const routePolicyId = completed?.route_policy_id || ''

  expect(invocationIds).toHaveLength(new Set(invocationIds).size)
  expect(invocations).toHaveLength(invocationIds.length)
  expect(new Set((invocations || []).map((item) => item.id))).toEqual(new Set(invocationIds))
  expect(planSnapshotId).toMatch(/^[0-9a-f-]{36}$/)
  expect(planSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
  expect(executionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(executionMode).toBe(modelAssetId ? 'pinned' : 'route')
  expect(pinnedModelCatalogEntryId).toBe(modelAssetId || null)
  expect(inputSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(completed?.total_tokens).toBeGreaterThan(0)
  expect(completed?.model).toBeTruthy()
  expect(applicationId).toBeTruthy()
  expect(routePolicyId).toBeTruthy()
  expect(new Set((invocations || []).map((item) => item.contract_id))).toEqual(new Set([CONTRACT_ID]))
  expect(new Set((invocations || []).map((item) => item.review_id))).toEqual(new Set([review.id]))
  expect(new Set((invocations || []).map((item) => item.plan_snapshot_id))).toEqual(new Set([planSnapshotId]))
  expect(new Set((invocations || []).map((item) => item.execution_id))).toEqual(new Set([executionId]))
  expect(new Set((invocations || []).map((item) => item.execution_mode))).toEqual(new Set([executionMode]))
  expect(new Set((invocations || []).map((item) => item.pinned_model_catalog_entry_id))).toEqual(
    new Set([pinnedModelCatalogEntryId]),
  )
  expect(new Set((invocations || []).map((item) => item.business_use_point_id))).toEqual(
    new Set(['contract.review.semantic']),
  )
  expect(new Set((invocations || []).map((item) => item.application_id))).toEqual(new Set([applicationId]))
  expect(new Set((invocations || []).map((item) => item.route_policy_id))).toEqual(new Set([routePolicyId]))
  if (modelAssetId) {
    expect(new Set((invocations || []).map((item) => item.model_catalog_entry_id))).toEqual(
      new Set([modelAssetId]),
    )
  }
  expect((invocations || []).map((item) => item.attempt_no)).toEqual(
    Array.from({ length: invocations?.length || 0 }, (_, index) => index + 1),
  )
  for (const invocation of invocations || []) {
    const meta = invocation.request_meta && typeof invocation.request_meta === 'object'
      ? invocation.request_meta as Record<string, unknown>
      : {}
    expect(meta).toMatchObject({
      input_sha256: inputSha256,
      plan_snapshot_sha256: planSnapshotHash,
      review_trigger: 'direct',
      review_event: EVIDENCE_TAG,
      pinned_model: modelAssetId || null,
    })
    expect(invocation.model_catalog_entry_id).toBeTruthy()
    expect(invocation.provider_connection_id).toBeTruthy()
  }

  return {
    reviewId: review.id,
    jobId: job.id,
    planSnapshotId: planSnapshotId || '',
    planSnapshotHash: planSnapshotHash || '',
    executionId,
    executionMode,
    pinnedModelCatalogEntryId,
    inputSha256,
    model: completed?.model || '',
    invocationIds,
    applicationId,
    routePolicyId,
    totalTokens: completed?.total_tokens || 0,
    riskCount: report.result.risks.length,
    degraded: report.result.degraded,
    degradationReasons: report.result.degradationReasons || [],
  }
}

describe('WP02 Preview 写入安全熔断', () => {
  const previewRef = 'vsfropnfsmnonkotywsx'
  const productionRef = 'wfawwhphfqqwfwrrkogy'
  const previewUrl = `https://${previewRef}.supabase.co`
  const serviceRoleKey = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ ref: previewRef, role: 'service_role' })).toString('base64url'),
    'test-signature',
  ].join('.')

  it('未显式开启写入熔断时在任何数据库访问前拒绝', () => {
    expect(() => validatePreviewWriteBoundary({
      writeFuse: '',
      previewSupabaseUrl: previewUrl,
      previewSupabaseProjectRef: previewRef,
      activeSupabaseUrl: previewUrl,
      serviceRoleKey,
    })).toThrow('Preview 写入熔断未开启')
  })

  it('当前 URL 未命中声明的 Preview project ref 时拒绝', () => {
    expect(() => validatePreviewWriteBoundary({
      writeFuse: PREVIEW_WRITE_FUSE_VALUE,
      previewSupabaseUrl: previewUrl,
      previewSupabaseProjectRef: previewRef,
      activeSupabaseUrl: `https://${productionRef}.supabase.co`,
      serviceRoleKey,
    })).toThrow('当前 Supabase URL 未命中明确声明的 Preview 项目')
  })

  it('版本化 Production project ref 即使被调用者声明成 Preview 也拒绝', () => {
    expect(() => validatePreviewWriteBoundary({
      writeFuse: PREVIEW_WRITE_FUSE_VALUE,
      previewSupabaseUrl: `https://${productionRef}.supabase.co`,
      previewSupabaseProjectRef: productionRef,
      activeSupabaseUrl: `https://${productionRef}.supabase.co`,
      serviceRoleKey: [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ ref: productionRef, role: 'service_role' })).toString('base64url'),
        'test-signature',
      ].join('.'),
    })).toThrow('版本化 Production 拒绝名单')
  })

  it('service-role key 不属于允许的 Preview project 时拒绝', () => {
    const mismatchedKey = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ ref: productionRef, role: 'service_role' })).toString('base64url'),
      'test-signature',
    ].join('.')
    expect(() => validatePreviewWriteBoundary({
      writeFuse: PREVIEW_WRITE_FUSE_VALUE,
      previewSupabaseUrl: previewUrl,
      previewSupabaseProjectRef: previewRef,
      activeSupabaseUrl: previewUrl,
      serviceRoleKey: mismatchedKey,
    })).toThrow('SUPABASE_SERVICE_ROLE_KEY 所属项目与允许的 Preview 项目不一致')
  })

  it('只允许 URL、版本化 allowlist 与 service-role 身份共同指向隔离 Preview', () => {
    expect(() => validatePreviewWriteBoundary({
      writeFuse: PREVIEW_WRITE_FUSE_VALUE,
      previewSupabaseUrl: previewUrl,
      previewSupabaseProjectRef: previewRef,
      activeSupabaseUrl: previewUrl,
      serviceRoleKey,
      vercelEnvironment: 'preview',
    })).not.toThrow()
  })

  it('双模型资产 ID 相同时拒绝冒充双模型验收', () => {
    expect(() => validatePinnedModelAssets('model.same', 'model.same')).toThrow(
      '本地与云端模型资产 ID 必须不同',
    )
  })
})

describe.skipIf(!LIVE_PINNED_ENABLED && !LIVE_ROUTE_ENABLED)('WP02 Preview 数据库本地诊断（非 Hosted 发布门）', () => {
  // This suite is intentionally a local helper bound to a Preview database.
  // Release evidence must instead exercise the authenticated HTTPS business
  // route on the deployed Preview and bind that response to its deployment SHA.
  it.skipIf(!LIVE_PINNED_ENABLED)('双模型绑定同一不可变计划与同一输入，并各自产生真实 token/invocation', async () => {
    const local = await runReview(LOCAL_MODEL_ASSET_ID)
    const cloud = await runReview(CLOUD_MODEL_ASSET_ID)

    expect(local.planSnapshotId).toBe(cloud.planSnapshotId)
    expect(local.planSnapshotHash).toBe(cloud.planSnapshotHash)
    expect(local.inputSha256).toBe(cloud.inputSha256)
    expect(local.pinnedModelCatalogEntryId).toBe(LOCAL_MODEL_ASSET_ID)
    expect(cloud.pinnedModelCatalogEntryId).toBe(CLOUD_MODEL_ASSET_ID)

    console.info(JSON.stringify({
      contract_id: CONTRACT_ID,
      evidence_tag: EVIDENCE_TAG,
      release_commit: RELEASE_COMMIT,
      preview_deployment: PREVIEW_DEPLOYMENT,
      evidence_scope: 'preview_db_local_diagnostic',
      release_context_only: true,
      hosted_preview_http_evidence: false,
      hosted_preview_http_route_required: '/api/contracts/:id/review-runs',
      accuracy_claim: 'blocked_without_independent_gold',
      reviews: [local, cloud],
    }))
  }, 600_000)

  it.skipIf(!LIVE_ROUTE_ENABLED)('真实合同沿当前发布路由执行并绑定同一次 ReviewRun', async () => {
    const review = await runReview()

    expect(review.executionMode).toBe('route')
    expect(review.pinnedModelCatalogEntryId).toBeNull()
    expect(review.invocationIds.length).toBeGreaterThan(0)

    const { data: attempts, error } = await supabaseAdmin
      .from('model_invocations')
      .select('execution_id, execution_mode, pinned_model_catalog_entry_id, attempt_no, status, review_id, total_tokens')
      .eq('execution_id', review.executionId)
      .order('attempt_no', { ascending: true })
    if (error) throw error

    expect(attempts?.length).toBeGreaterThan(0)
    expect(new Set((attempts || []).map((attempt) => attempt.execution_mode))).toEqual(new Set(['route']))
    expect(new Set((attempts || []).map((attempt) => attempt.pinned_model_catalog_entry_id))).toEqual(new Set([null]))
    expect(new Set((attempts || []).map((attempt) => attempt.review_id))).toEqual(new Set([review.reviewId]))
    expect((attempts || []).map((attempt) => attempt.attempt_no)).toEqual(
      Array.from({ length: attempts?.length || 0 }, (_, index) => index + 1),
    )
    expect((attempts || []).some((attempt) => attempt.status === 'completed' && (attempt.total_tokens || 0) > 0)).toBe(true)

    console.info(JSON.stringify({
      contract_id: CONTRACT_ID,
      evidence_tag: EVIDENCE_TAG,
      release_commit: RELEASE_COMMIT,
      preview_deployment: PREVIEW_DEPLOYMENT,
      evidence_scope: 'preview_db_local_diagnostic',
      release_context_only: true,
      hosted_preview_http_evidence: false,
      hosted_preview_http_route_required: '/api/contracts/:id/review-runs',
      accuracy_claim: 'blocked_without_independent_gold',
      route_review: review,
      attempts,
    }))
  }, 600_000)
})
