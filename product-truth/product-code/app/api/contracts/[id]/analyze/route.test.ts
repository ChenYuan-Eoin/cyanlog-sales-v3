import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/contract-analysis', () => ({
  processContractAnalysisJob: vi.fn().mockResolvedValue({
    risks: [], summary: 'test', appliedRules: 0, matchedRules: 0, provider: 'rule_engine', degraded: false,
  }),
  readContractAnalysisTerminalState: vi.fn().mockResolvedValue('active'),
}))

vi.mock('@/lib/ai/failover', () => ({
  getAIRuntimeReadiness: vi.fn().mockResolvedValue({
    providers: [
      { id: 'local_primary', providerKind: 'openai_compatible', baseUrl: 'http://127.0.0.1:1234/v1' },
      { id: 'sales_cloud_backup', providerKind: 'openai_compatible', baseUrl: 'https://cloud.example.com/v1' },
      { id: 'rule_engine', providerKind: 'builtin' },
    ],
  }),
  resolvePreferredProviderId: vi.fn((_readiness, reference: string) => (
    ['local_primary', 'sales_cloud_backup', 'rule_engine'].includes(reference)
      ? reference
      : undefined
  )),
}))

vi.mock('@/lib/documents/source-render-server', () => ({
  verifyContractReviewSource: vi.fn().mockResolvedValue({
    source_hash: 'a'.repeat(64),
    source_text_hash: 'b'.repeat(64),
    page_count: 1,
    locator: 'provisional',
    render_mode: 'browser-ooxml',
    pages: [],
  }),
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
    rpc: vi.fn(),
  },
}))

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import { processContractAnalysisJob, readContractAnalysisTerminalState } from '@/lib/contract-analysis'
import { resolveIdParam } from '@/lib/route-params'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyContractReviewSource } from '@/lib/documents/source-render-server'

function makeRequest(body?: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/contracts/contract-1/analyze', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body || {}),
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

describe('POST /api/contracts/[id]/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(requireAuth as any).mockResolvedValue({ id: 'u-admin' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['u-admin', 'u-owner'] })
    ;(resolveIdParam as any).mockResolvedValue('contract-1')
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: [{ review_id: 'review-1', job_id: 'job-1' }],
      error: null,
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })

  it('允许对可访问用户创建的合同发起审核', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      jobId: 'job-1',
      reviewId: 'review-1',
      status: 'COMPLETED',
    })
    expect(processContractAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1',
      review_id: 'review-1',
      contract_id: 'contract-1',
    }))
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('start_contract_analysis_job', expect.objectContaining({
      p_org_id: 'org-1',
      p_start_request_id: expect.any(String),
      p_source_storage_path: 'contracts/a.docx',
      p_source_hash: 'a'.repeat(64),
      p_source_text_hash: 'b'.repeat(64),
      p_preferred_provider: null,
    }))
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

  it('Word 源字节与当前正文不一致时停止审核且不创建 ReviewRun', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any).mockReturnValueOnce(contractQuery)
    ;(verifyContractReviewSource as any).mockRejectedValueOnce(new Error('当前源文件正文与数据库解析文本不一致'))
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({ code: 'SOURCE_IDENTITY_UNAVAILABLE' })
    expect(body.error).toContain('正文与数据库解析文本不一致')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('start RPC 响应不确定时按 exact request id 恢复已排队任务而不重复执行', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
    ;(supabaseAdmin.rpc as any).mockImplementation(async (name: string) => {
      if (name === 'start_contract_analysis_job') return { data: null, error: { code: 'ECONNRESET', message: 'response lost' } }
      if (name === 'recover_contract_analysis_start') {
        return { data: [{ review_id: 'review-recovered', job_id: 'job-recovered', job_status: 'queued', review_status: 'PARSING' }], error: null }
      }
      return { data: null, error: { message: `unexpected ${name}` } }
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toMatchObject({ jobId: 'job-recovered', reviewId: 'review-recovered', status: 'PARSING', jobStatus: 'queued' })
    expect(processContractAnalysisJob).not.toHaveBeenCalled()
    const rpcCalls = (supabaseAdmin.rpc as unknown as {
      mock: { calls: Array<[string, Record<string, unknown>]> }
    }).mock.calls
    const startCall = rpcCalls.find(([name]) => name === 'start_contract_analysis_job')
    const recoveryCall = rpcCalls.find(([name]) => name === 'recover_contract_analysis_start')
    expect(recoveryCall?.[1]).toMatchObject({
      p_org_id: 'org-1',
      p_start_request_id: startCall?.[1]?.p_start_request_id,
      p_strategy_id: null,
      p_preferred_provider: null,
    })
  })

  it('exact request 已快速失败时恢复真实终态，不误报未找到', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
    ;(supabaseAdmin.rpc as any).mockImplementation(async (name: string) => {
      if (name === 'start_contract_analysis_job') return { data: null, error: { code: 'ETIMEDOUT', message: 'response lost' } }
      if (name === 'recover_contract_analysis_start') {
        return { data: [{ review_id: 'review-failed', job_id: 'job-failed', job_status: 'failed', review_status: 'FAILED' }], error: null }
      }
      return { data: null, error: { message: `unexpected ${name}` } }
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ jobId: 'job-failed', reviewId: 'review-failed', status: 'FAILED', jobStatus: 'failed' })
    expect(body.message).toContain('失败终态')
    expect(processContractAnalysisJob).not.toHaveBeenCalled()
  })

  it('start RPC 返回确定数据库错误时不尝试认领其他任务', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
    ;(supabaseAdmin.rpc as any).mockImplementation(async (name: string) => {
      if (name === 'start_contract_analysis_job') {
        return { data: null, error: { code: '55000', message: 'contract already has an active analysis job' } }
      }
      return { data: null, error: { message: `unexpected recovery ${name}` } }
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('CONCURRENT_UPDATE')
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
  })

  it('拒绝未发布的模型实例且不修改合同状态', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'COMPLETED', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })

    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any).mockReturnValueOnce(contractQuery)
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest({ force: true, preferredProvider: 'unknown-provider' }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_PROVIDER')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('审核执行链已回写失败终态时返回失败状态', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'COMPLETED', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
    ;(processContractAnalysisJob as any).mockRejectedValueOnce(new Error('model failed'))
    ;(readContractAnalysisTerminalState as any).mockResolvedValueOnce('failed')
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest({ force: true, preferredProvider: 'local_primary' }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('FAILED')
    expect(body.preferredProvider).toBe('local_primary')
  })

  it('队列 worker 先抢到 exact job 时保持处理中，不用本地无租约记录覆盖', async () => {
    const contractQuery = makeChain('maybeSingle', {
      data: { id: 'contract-1', status: 'PENDING', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'contracts/a.docx', parsed_text: '合同正文', created_by: 'u-owner' },
      error: null,
    })
    const recentReviewQuery = makeChain('single', {
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    })
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(contractQuery)
      .mockReturnValueOnce(recentReviewQuery)
    ;(processContractAnalysisJob as any).mockRejectedValueOnce(new Error('analysis job lease is owned by another worker'))
    ;(readContractAnalysisTerminalState as any).mockResolvedValueOnce('active')
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ status: 'PARSING', message: '审核任务已由队列接管' })
    expect(body.processingError).toBeUndefined()
  })
})
