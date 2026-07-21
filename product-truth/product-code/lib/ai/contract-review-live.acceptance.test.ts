import { describe, expect, it } from 'vitest'

import { runStructuredAnalysis, saveStructuredReport } from '@/lib/contract-analysis'
import { supabaseAdmin } from '@/lib/supabase'

const LIVE_PINNED_ENABLED = process.env.WP02_LIVE_CONTRACT_REVIEW === '1'
const LIVE_ROUTE_ENABLED = process.env.WP02_LIVE_CONTRACT_ROUTE === '1'
const CONTRACT_ID = '5cdabf0a-0d5a-4435-bca5-062ffad52c53'
const REQUESTED_BY = '43e5a06c-a4c1-4f53-9980-1b1c7a9c08bb'

type LiveReviewResult = {
  reviewId: string
  planSnapshotId: string
  planSnapshotHash: string
  executionId: string
  executionMode: 'route' | 'pinned'
  pinnedModelCatalogEntryId: string | null
  inputSha256: string
  model: string
  invocationIds: string[]
  totalTokens: number
  riskCount: number
  degraded: boolean
  degradationReasons: string[]
}

async function runReview(modelAssetId?: string): Promise<LiveReviewResult> {
  const { data: parent } = await supabaseAdmin
    .from('contract_reviews')
    .select('id, source_storage_path, source_hash, source_text_hash')
    .eq('contract_id', CONTRACT_ID)
    .not('source_storage_path', 'is', null)
    .not('source_hash', 'is', null)
    .not('source_text_hash', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!parent?.source_storage_path || !parent.source_hash || !parent.source_text_hash) {
    throw new Error('真实合同缺少可冻结的源文件身份，拒绝创建 ReviewRun')
  }

  const { data: review, error: reviewError } = await supabaseAdmin
    .from('contract_reviews')
    .insert({
      contract_id: CONTRACT_ID,
      status: 'PARSING',
      started_at: new Date().toISOString(),
      review_trigger: 'direct',
      parent_review_id: parent?.id || null,
      source_storage_path: parent.source_storage_path,
      source_hash: parent.source_hash,
      source_text_hash: parent.source_text_hash,
    })
    .select('id')
    .single()
  if (reviewError || !review?.id) throw reviewError || new Error('ReviewRun 创建失败')

  try {
    const report = await runStructuredAnalysis(CONTRACT_ID, {
      reviewId: review.id,
      requestedBy: REQUESTED_BY,
      reviewTrigger: 'direct',
      ...(modelAssetId ? { semanticModelAssetId: modelAssetId } : {}),
    })
    await saveStructuredReport(review.id, CONTRACT_ID, report)

    const finalStatus = report.result.degraded ? 'DEGRADED' : 'COMPLETED'
    const { error: finalError } = await supabaseAdmin
      .from('contract_reviews')
      .update({ status: finalStatus, completed_at: new Date().toISOString() })
      .eq('id', review.id)
    if (finalError) throw finalError

    const invocationIds = report.runtime?.model_invocation_ids || []
    const { data: invocations, error: invocationError } = await supabaseAdmin
      .from('model_invocations')
      .select('id, execution_id, execution_mode, pinned_model_catalog_entry_id, attempt_no, model, status, total_tokens, request_meta')
      .in('id', invocationIds)
      .order('attempt_no', { ascending: true })
    if (invocationError) throw invocationError

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

    expect(planSnapshotId).toMatch(/^[0-9a-f-]{36}$/)
    expect(planSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(executionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(executionMode).toBe(modelAssetId ? 'pinned' : 'route')
    expect(pinnedModelCatalogEntryId).toBe(modelAssetId || null)
    expect(inputSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(completed?.total_tokens).toBeGreaterThan(0)
    expect(completed?.model).toBeTruthy()

    return {
      reviewId: review.id,
      planSnapshotId: planSnapshotId || '',
      planSnapshotHash: planSnapshotHash || '',
      executionId,
      executionMode,
      pinnedModelCatalogEntryId,
      inputSha256,
      model: completed?.model || '',
      invocationIds,
      totalTokens: completed?.total_tokens || 0,
      riskCount: report.result.risks.length,
      degraded: report.result.degraded,
      degradationReasons: report.result.degradationReasons || [],
    }
  } catch (error) {
    await supabaseAdmin
      .from('contract_reviews')
      .update({ status: 'FAILED', completed_at: new Date().toISOString() })
      .eq('id', review.id)
    throw error
  }
}

describe.skipIf(!LIVE_PINNED_ENABLED && !LIVE_ROUTE_ENABLED)('WP02 真实合同 ReviewRun 验收', () => {
  it.skipIf(!LIVE_PINNED_ENABLED)('双模型绑定同一不可变计划与同一输入，并各自产生真实 token/invocation', async () => {
    const local = await runReview('model.gemma-4-e4b.local')
    const cloud = await runReview('model.gpt-5.5.cloud')

    expect(local.planSnapshotId).toBe(cloud.planSnapshotId)
    expect(local.planSnapshotHash).toBe(cloud.planSnapshotHash)
    expect(local.inputSha256).toBe(cloud.inputSha256)
    expect(local.model).toContain('gemma')
    expect(cloud.model).toContain('gpt-5.5')

    console.info(JSON.stringify({
      contract_id: CONTRACT_ID,
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
      accuracy_claim: 'blocked_without_independent_gold',
      route_review: review,
      attempts,
    }))
  }, 600_000)
})
