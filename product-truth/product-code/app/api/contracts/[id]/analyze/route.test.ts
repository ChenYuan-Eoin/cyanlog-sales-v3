import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

vi.mock('@/lib/contract-analysis', () => ({
  claimContractAnalysisJobById: vi.fn(),
  ContractAnalysisLeaseError: class ContractAnalysisLeaseError extends Error {
    readonly name = 'ContractAnalysisLeaseError'

    constructor(
      readonly code: 'ANALYSIS_LEASE_LOST' | 'ANALYSIS_STATE_WRITE_FAILED',
      readonly jobId: string,
      message: string,
      readonly detail?: unknown,
    ) {
      super(message)
    }
  },
  formatAnalysisError: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
  markContractAnalysisCompleted: vi.fn().mockResolvedValue(undefined),
  markContractAnalysisFailed: vi.fn().mockResolvedValue(undefined),
  markContractAnalysisRunning: vi.fn().mockResolvedValue(undefined),
  runStructuredAnalysis: vi.fn(),
  saveStructuredReport: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/observability', () => ({
  getRequestId: vi.fn(() => 'req-1'),
  logRouteDone: vi.fn(),
  logRouteFailure: vi.fn(),
  logRouteStart: vi.fn(),
}))

vi.mock('@/lib/route-params', () => ({ resolveIdParam: vi.fn() }))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(),
  listFreshAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import {
  claimContractAnalysisJobById,
  ContractAnalysisLeaseError,
  markContractAnalysisFailed,
  markContractAnalysisRunning,
  runStructuredAnalysis,
} from '@/lib/contract-analysis'
import { resolveIdParam } from '@/lib/route-params'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

const sourceVersionId = '11111111-1111-4111-8111-111111111111'
const sourceUploadId = '22222222-2222-4222-8222-222222222222'
const sourceFileHash = 'A'.repeat(64)

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost:3000/api/contracts/contract-1/analyze', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function contractQuery(contract: Record<string, unknown> | null = {
  id: 'contract-1',
  status: 'PENDING',
  current_version_id: sourceVersionId,
  created_by: 'u-owner',
  org_id: 'org-1',
}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: contract, error: null }),
  }
}

const claimedJob = {
  id: 'job-1',
  contract_id: 'contract-1',
  review_id: 'review-1',
  requested_by: 'u-admin',
  status: 'running',
  attempts: 1,
  provider: null,
  degraded: false,
  last_error: null,
  locked_at: '2026-07-21T12:00:00.000Z',
  lock_token: '33333333-3333-4333-8333-333333333333',
  locked_by: 'initial-review:req-1',
  started_at: '2026-07-21T12:00:00.000Z',
  completed_at: null,
  created_at: '2026-07-21T12:00:00.000Z',
  updated_at: '2026-07-21T12:00:00.000Z',
}

describe('POST /api/contracts/[id]/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'u-admin' } as never)
    vi.mocked(listFreshAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['u-admin', 'u-owner'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(true)
    vi.mocked(resolveIdParam).mockResolvedValue('contract-1')
    vi.mocked(claimContractAnalysisJobById).mockResolvedValue(claimedJob as never)
    vi.mocked(runStructuredAnalysis).mockResolvedValue({
      result: {
        risks: [],
        summary: '完成',
        appliedRules: 1,
        matchedRules: 1,
        provider: 'rule-engine+provider',
        degraded: false,
      },
      risk_summary: {},
      compliance_check: {},
      effectiveness_analysis: '',
      clauses: [],
    } as never)
  })

  it('uses the version-bound atomic start and executes exactly the leased initial review', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'PARSING',
        job_status: 'queued',
        should_process: true,
        recovered: false,
      }],
      error: null,
    } as never)

    const response = await POST(makeRequest({
      expected_upload_id: sourceUploadId,
      expected_file_sha256: sourceFileHash,
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      reviewId: 'review-1',
      jobId: 'job-1',
      status: 'COMPLETED',
      recovered: false,
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('start_initial_contract_review_fenced', expect.objectContaining({
      p_contract_id: 'contract-1',
      p_contract_version_id: sourceVersionId,
      p_expected_contract_status: 'PENDING',
      p_expected_upload_id: sourceUploadId,
      p_expected_file_sha256: sourceFileHash.toLowerCase(),
    }))
    expect(claimContractAnalysisJobById).toHaveBeenCalledWith(
      'job-1',
      'initial-review:req-1',
      expect.any(String),
    )
    expect(runStructuredAnalysis).toHaveBeenCalledTimes(1)
    expect(runStructuredAnalysis).toHaveBeenCalledWith('contract-1', expect.objectContaining({
      reviewId: 'review-1',
      reviewTrigger: 'initial_upload',
      reviewEvent: 'initial_generate',
    }))
  })

  it('没有审核能力时使用 fresh assignments 拒绝且不创建 ReviewRun 或任务', async () => {
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const response = await POST(makeRequest({
      expected_upload_id: sourceUploadId,
      expected_file_sha256: sourceFileHash,
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('FORBIDDEN')
    expect(listFreshAccessibleUserIds).toHaveBeenCalledWith('u-admin')
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'review')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(runStructuredAnalysis).not.toHaveBeenCalled()
  })

  it('returns the existing running identity without creating or executing another review', async () => {
    vi.mocked(claimContractAnalysisJobById).mockResolvedValueOnce(null)
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery({
      id: 'contract-1',
      status: 'ANALYZING',
      current_version_id: sourceVersionId,
      created_by: 'u-owner',
      org_id: 'org-1',
    }) as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'ANALYZING',
        job_status: 'running',
        should_process: false,
        recovered: true,
      }],
      error: null,
    } as never)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toMatchObject({ reviewId: 'review-1', jobId: 'job-1', status: 'PARSING', recovered: true })
    expect(claimContractAnalysisJobById).toHaveBeenCalledTimes(1)
    expect(runStructuredAnalysis).not.toHaveBeenCalled()
  })

  it('reclaims a stale running lease and resumes the same review identity', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery({
      id: 'contract-1',
      status: 'ANALYZING',
      current_version_id: sourceVersionId,
      created_by: 'u-owner',
      org_id: 'org-1',
    }) as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'ANALYZING',
        job_status: 'running',
        should_process: false,
        recovered: true,
      }],
      error: null,
    } as never)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ reviewId: 'review-1', jobId: 'job-1', status: 'COMPLETED', recovered: true })
    expect(claimContractAnalysisJobById).toHaveBeenCalledTimes(1)
    expect(runStructuredAnalysis).toHaveBeenCalledTimes(1)
  })

  it('recovers a queued response-loss path by competing for the same job lease', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'PARSING',
        job_status: 'queued',
        should_process: false,
        recovered: true,
      }],
      error: null,
    } as never)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ reviewId: 'review-1', jobId: 'job-1', status: 'COMPLETED', recovered: true })
    expect(claimContractAnalysisJobById).toHaveBeenCalledTimes(1)
    expect(runStructuredAnalysis).toHaveBeenCalledTimes(1)
  })

  it('keeps the source and review identity when processing fails', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'PARSING',
        job_status: 'queued',
        should_process: true,
        recovered: false,
      }],
      error: null,
    } as never)
    vi.mocked(runStructuredAnalysis).mockRejectedValueOnce(new Error('provider unavailable'))

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      reviewId: 'review-1',
      jobId: 'job-1',
      status: 'FAILED',
      processingError: 'provider unavailable',
    })
    expect(markContractAnalysisFailed).toHaveBeenCalledWith(claimedJob, expect.any(Error))
  })

  it('returns an explicit preparation error when the contract has no current source version', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery({
      id: 'contract-1',
      status: 'DRAFT',
      current_version_id: null,
      created_by: 'u-owner',
      org_id: 'org-1',
    }) as never)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({
      error: '合同还没有完成源文件版本登记，请从文件准备步骤继续',
      code: 'SOURCE_VERSION_MISSING',
    })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('rejects invalid review options before reading or mutating contract state', async () => {
    const response = await POST(makeRequest({ strategy: 'FAST' }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when a caller tries to override platform model or strategy routing', async () => {
    for (const body of [
      { strategy: 'BALANCED' },
      { strategy_id: '44444444-4444-4444-8444-444444444444' },
      { provider: 'openai' },
      { model: 'gpt-user-selected' },
    ]) {
      const response = await POST(makeRequest(body), {
        params: Promise.resolve({ id: 'contract-1' }),
      })
      expect(response.status).toBe(400)
    }

    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('rejects an invalid expected source hash before reading contract state', async () => {
    const response = await POST(makeRequest({ expected_file_sha256: 'not-a-sha256' }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('rejects a source identity that changed while the review was starting', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: null,
      error: { code: '40001', message: 'review source upload identity changed' },
    } as never)

    const response = await POST(makeRequest({
      expected_upload_id: sourceUploadId,
      expected_file_sha256: sourceFileHash,
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CONCURRENT_UPDATE')
    expect(claimContractAnalysisJobById).not.toHaveBeenCalled()
    expect(runStructuredAnalysis).not.toHaveBeenCalled()
  })

  it('stops the old executor explicitly when its lease was replaced', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'PARSING',
        job_status: 'queued',
        should_process: true,
        recovered: false,
      }],
      error: null,
    } as never)
    vi.mocked(markContractAnalysisRunning).mockRejectedValueOnce(new ContractAnalysisLeaseError(
      'ANALYSIS_LEASE_LOST',
      'job-1',
      'lease replaced',
    ))

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('ANALYSIS_LEASE_LOST')
    expect(markContractAnalysisFailed).not.toHaveBeenCalled()
    expect(runStructuredAnalysis).not.toHaveBeenCalled()
  })

  it('surfaces database transition failure instead of claiming completion', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'PARSING',
        job_status: 'queued',
        should_process: true,
        recovered: false,
      }],
      error: null,
    } as never)
    vi.mocked(markContractAnalysisRunning).mockRejectedValueOnce(new ContractAnalysisLeaseError(
      'ANALYSIS_STATE_WRITE_FAILED',
      'job-1',
      'write failed',
    ))

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe('ANALYSIS_STATE_WRITE_FAILED')
    expect(markContractAnalysisFailed).not.toHaveBeenCalled()
  })

  it('surfaces degraded review completion as a first-class business status', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(contractQuery() as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: [{
        review_id: 'review-1',
        job_id: 'job-1',
        review_status: 'PARSING',
        job_status: 'queued',
        should_process: true,
        recovered: false,
      }],
      error: null,
    } as never)
    vi.mocked(runStructuredAnalysis).mockResolvedValueOnce({
      result: {
        risks: [],
        summary: '需人工复核',
        appliedRules: 0,
        matchedRules: 0,
        provider: 'rule-engine',
        degraded: true,
        degradationReasons: ['skill_not_applied'],
      },
      risk_summary: {},
      compliance_check: {},
      effectiveness_analysis: '',
      clauses: [],
    } as never)

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(body).toMatchObject({
      status: 'DEGRADED',
      degraded: true,
      degradationReasons: ['skill_not_applied'],
    })
  })
})
