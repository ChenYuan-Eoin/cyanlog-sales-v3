import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/contract-analysis', () => ({
  enqueueContractAnalysisJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
  processContractAnalysisJob: vi.fn().mockResolvedValue(undefined),
  runStructuredAnalysis: vi.fn().mockResolvedValue({ result: { summary: 'test' } }),
  markContractAnalysisRunning: vi.fn().mockResolvedValue(undefined),
  markContractAnalysisCompleted: vi.fn().mockResolvedValue(undefined),
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
import { enqueueContractAnalysisJob, processContractAnalysisJob } from '@/lib/contract-analysis'
import { resolveIdParam } from '@/lib/route-params'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/contracts/contract-1/analyze', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-1',
    },
  })
}

function makeChain(method: string, result: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  }

  chain[method] = vi.fn().mockResolvedValue(result)
  return chain
}

function makeUpdateChain() {
  return {
    error: null,
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  }
}

function makeInsertChain(result: unknown) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

describe('POST /api/contracts/[id]/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(requireAuth as any).mockResolvedValue({ id: 'u-admin' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['u-admin', 'u-owner'] })
    ;(resolveIdParam as any).mockResolvedValue('contract-1')
    ;(enqueueContractAnalysisJob as any).mockResolvedValue({ id: 'job-1' })
    ;(processContractAnalysisJob as any).mockResolvedValue(undefined)
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })

  it('允许对可访问用户创建的合同发起审核', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', storage_path: 'contracts/a.docx', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    const updateQuery = makeUpdateChain()
    const reviewInsertQuery = makeInsertChain({
      data: { id: 'review-1' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(reviewInsertQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      jobId: 'job-1',
      reviewId: 'review-1',
      status: 'COMPLETED',
    })
  })

  it('合同不存在或无权访问时返回 404', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: null,
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any).mockReturnValueOnce(contractQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toEqual({
      error: '合同不存在或无权访问',
      code: 'NOT_FOUND',
    })
  })
})
