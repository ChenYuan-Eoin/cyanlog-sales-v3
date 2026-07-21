import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/contract-analysis', () => ({
  enqueueContractAnalysisJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
  formatAnalysisError: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
  markContractAnalysisCompleted: vi.fn().mockResolvedValue(undefined),
  markContractAnalysisFailed: vi.fn().mockResolvedValue(undefined),
  markContractAnalysisRunning: vi.fn().mockResolvedValue(undefined),
  runStructuredAnalysis: vi.fn().mockResolvedValue({ result: { summary: 'rerun done' } }),
  saveStructuredReport: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/observability', () => ({
  getRequestId: vi.fn(() => 'req-1'),
  logRouteDone: vi.fn(),
  logRouteFailure: vi.fn(),
  logRouteStart: vi.fn(),
}))

vi.mock('@/lib/route-params', () => ({
  resolveIdParam: vi.fn(),
}))

vi.mock('@/lib/contracts/review-source-identity', () => ({
  loadCurrentReviewSourceIdentity: vi.fn().mockResolvedValue({
    source_storage_path: 'contracts/a.docx',
    source_hash: 'a'.repeat(64),
    source_text_hash: 'b'.repeat(64),
  }),
  ReviewSourceIdentityError: class ReviewSourceIdentityError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import { enqueueContractAnalysisJob, runStructuredAnalysis } from '@/lib/contract-analysis'
import { resolveIdParam } from '@/lib/route-params'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  loadCurrentReviewSourceIdentity,
  ReviewSourceIdentityError,
} from '@/lib/contracts/review-source-identity'

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost:3000/api/contracts/contract-1/review-runs', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeQuery(result: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeUpdate(result: unknown) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function makeInsert(result: unknown) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

describe('POST /api/contracts/[id]/review-runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(requireAuth as any).mockResolvedValue({ id: 'u-admin' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['u-admin', 'u-owner'] })
    ;(resolveIdParam as any).mockResolvedValue('contract-1')
    ;(enqueueContractAnalysisJob as any).mockResolvedValue({ id: 'job-1' })
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })

  it('允许已完成合同创建手动再审核运行', async () => {
    const contractQuery = makeQuery({
      data: { id: 'contract-1', status: 'COMPLETED', storage_path: 'contracts/a.docx', created_by: 'u-owner', org_id: 'org-1' },
      error: null,
    })
    const parentReviewQuery = makeQuery({
      data: { id: 'review-parent' },
      error: null,
    })
    const updateQuery = makeUpdate({
      data: { id: 'contract-1' },
      error: null,
    })
    const reviewInsertQuery = makeInsert({
      data: { id: 'review-rerun' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(parentReviewQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(reviewInsertQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest({
      trigger_event: 'manual_rerun',
      semantic_model_asset_id: 'model.gpt-5.5.cloud',
    }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      jobId: 'job-1',
      reviewId: 'review-rerun',
      parentReviewId: 'review-parent',
      triggerEvent: 'manual_rerun',
      semanticModelAssetId: 'model.gpt-5.5.cloud',
      status: 'COMPLETED',
    })
    expect(runStructuredAnalysis).toHaveBeenCalledWith('contract-1', expect.objectContaining({
      reviewId: 'review-rerun',
      requestedBy: 'u-admin',
      reviewTrigger: 'direct',
      reviewEvent: 'manual_rerun',
      semanticModelAssetId: 'model.gpt-5.5.cloud',
    }))
    expect(reviewInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      review_trigger: 'direct',
      source_storage_path: 'contracts/a.docx',
      source_hash: 'a'.repeat(64),
      source_text_hash: 'b'.repeat(64),
    }))
  })

  it('降级再审核必须在响应主状态中显式返回 DEGRADED', async () => {
    const contractQuery = makeQuery({
      data: { id: 'contract-1', status: 'COMPLETED', storage_path: 'contracts/a.docx', created_by: 'u-owner', org_id: 'org-1' },
      error: null,
    })
    const parentReviewQuery = makeQuery({
      data: { id: 'review-parent' },
      error: null,
    })
    const updateQuery = makeUpdate({
      data: { id: 'contract-1' },
      error: null,
    })
    const reviewInsertQuery = makeInsert({
      data: { id: 'review-rerun' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(runStructuredAnalysis as any).mockResolvedValueOnce({
      result: {
        summary: 'rule fallback only',
        degraded: true,
        degradationReasons: ['model_output_invalid_or_unavailable'],
      },
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(parentReviewQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(reviewInsertQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest({ trigger_event: 'manual_rerun' }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      status: 'DEGRADED',
      degraded: true,
      degradationReasons: ['model_output_invalid_or_unavailable'],
      message: '再审核已完成，但存在降级或未绑定项，需要人工复核',
    })
  })

  it('允许文档对比完成后以客户回传版本事件创建再审核', async () => {
    const contractQuery = makeQuery({
      data: { id: 'contract-1', status: 'COMPLETED', storage_path: 'contracts/a.docx', created_by: 'u-owner', org_id: 'org-1' },
      error: null,
    })
    const parentReviewQuery = makeQuery({
      data: { id: 'review-parent' },
      error: null,
    })
    const updateQuery = makeUpdate({
      data: { id: 'contract-1' },
      error: null,
    })
    const reviewInsertQuery = makeInsert({
      data: { id: 'review-from-compare' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(parentReviewQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(reviewInsertQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest({
      trigger_event: 'customer_version_received',
      comparison_id: '33333333-3333-4333-8333-333333333333',
    }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      reviewId: 'review-from-compare',
      parentReviewId: 'review-parent',
      triggerEvent: 'customer_version_received',
      comparisonId: '33333333-3333-4333-8333-333333333333',
      status: 'COMPLETED',
    })
    expect(runStructuredAnalysis).toHaveBeenCalledWith('contract-1', expect.objectContaining({
      reviewId: 'review-from-compare',
      reviewTrigger: 'direct',
      reviewEvent: 'customer_version_received',
    }))
  })

  it('规则发布或 SkillBundle 未过正式门时不得描述为正式审核完成', async () => {
    const contractQuery = makeQuery({
      data: { id: 'contract-1', status: 'COMPLETED', storage_path: 'contracts/a.docx', created_by: 'u-owner', org_id: 'org-1' },
      error: null,
    })
    const parentReviewQuery = makeQuery({
      data: { id: 'review-parent' },
      error: null,
    })
    const updateQuery = makeUpdate({
      data: { id: 'contract-1' },
      error: null,
    })
    const reviewInsertQuery = makeInsert({
      data: { id: 'review-rerun' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(runStructuredAnalysis as any).mockResolvedValueOnce({
      result: {
        summary: 'compiled bundle only',
        degraded: true,
        degradationReasons: ['skill_bundle_not_published', 'skill_eval_not_passed'],
      },
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(parentReviewQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(reviewInsertQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest({ trigger_event: 'manual_rerun' }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      status: 'DEGRADED',
      degraded: true,
      degradationReasons: ['skill_bundle_not_published', 'skill_eval_not_passed'],
      message: '再审核已降级：配置中心规则发布或 SkillBundle 未通过正式门，不能作为正式审核完成',
    })
  })

  it('当前源文件没有冻结身份时拒绝创建 ReviewRun', async () => {
    const contractQuery = makeQuery({
      data: { id: 'contract-1', status: 'COMPLETED', storage_path: 'contracts/a.docx', created_by: 'u-owner', org_id: 'org-1' },
      error: null,
    })
    ;(loadCurrentReviewSourceIdentity as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ReviewSourceIdentityError(
        'SOURCE_IDENTITY_MISSING',
        '合同当前源文件尚未完成可审计解析，不能创建 ReviewRun',
      ),
    )
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(contractQuery)

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: '合同当前源文件尚未完成可审计解析，不能创建 ReviewRun',
      code: 'SOURCE_IDENTITY_MISSING',
    })
    expect(enqueueContractAnalysisJob).not.toHaveBeenCalled()
  })

  it('拒绝正在审核中的合同重复创建再审核', async () => {
    const contractQuery = makeQuery({
      data: { id: 'contract-1', status: 'ANALYZING', storage_path: 'contracts/a.docx', created_by: 'u-owner', org_id: 'org-1' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any).mockReturnValueOnce(contractQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: '合同正在审核中，请勿重复提交',
      code: 'ALREADY_IN_PROGRESS',
    })
    expect(enqueueContractAnalysisJob).not.toHaveBeenCalled()
  })
})
