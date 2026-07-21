/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(() => true),
  getAccessibleContract: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getAccessibleContract } from '@/lib/scoped-access'
import { GET } from './route'

type QueryResult = { data: unknown[] | null; error: unknown }

function makeQuery(result: QueryResult) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'in', 'maybeSingle']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

const v1 = {
  id: 'version-1',
  contract_id: 'contract-1',
  version_number: 1,
  source: 'original',
  storage_path: 'contracts/a/v1.docx',
  file_size: 100,
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  parent_version_id: null,
  change_summary: null,
  review_id: 'review-v1',
  upload_id: '11111111-1111-4111-8111-111111111111',
  file_sha256: '1'.repeat(64),
  text_sha256: 'a'.repeat(64),
  ingest_status: 'SOURCE_READY',
  ingest_error: null,
  created_at: '2026-07-21T01:00:00.000Z',
}

const v2 = {
  ...v1,
  id: 'version-2',
  version_number: 2,
  source: 'manual_revision',
  storage_path: 'contracts/a/v2.docx',
  review_id: null,
  upload_id: '22222222-2222-4222-8222-222222222222',
  file_sha256: '2'.repeat(64),
  text_sha256: 'b'.repeat(64),
  created_at: '2026-07-21T02:00:00.000Z',
}

const reviewV1 = {
  id: 'review-v1',
  status: 'COMPLETED',
  contract_version_id: v1.id,
  source_storage_path: v1.storage_path,
  source_hash: v1.file_sha256,
  source_text_hash: v1.text_sha256,
  rule_snapshot_ids: [],
  rule_set_snapshot_ids: [],
  model_invocation_ids: [],
  created_at: '2026-07-21T01:05:00.000Z',
  completed_at: '2026-07-21T01:06:00.000Z',
}

const v2PageMap = {
  contract_version_id: v2.id,
  storage_path: v2.storage_path,
  source_hash: v2.file_sha256,
  source_text_hash: v2.text_sha256,
  render_mode: 'browser-ooxml',
  locator: 'rendered',
  page_count: 2,
  generated_at: '2026-07-21T02:00:30.000Z',
}

function request(search = '') {
  return new NextRequest(`http://localhost:3000/api/contracts/contract-1/review${search}`, {
    headers: { authorization: 'Bearer token-1' },
  })
}

describe('GET /api/contracts/[id]/review current version identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAccessibleContract).mockResolvedValue({
      contract: {
        id: 'contract-1',
        filename: '双版本合同.docx',
        status: 'COMPLETED',
        storage_path: v2.storage_path,
        current_version_id: v2.id,
        contract_reviews: [reviewV1],
      },
      assignments: [],
    } as never)
  })

  it('returns current v2 as unreviewed and never falls back to v1 risks, jobs or evidence', async () => {
    const queries = {
      contract_versions: makeQuery({ data: [v2, v1], error: null }),
      contract_source_page_maps: makeQuery({ data: [v2PageMap], error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const query = queries[table as keyof typeof queries]
      if (query) return query as never
      throw new Error(`unexpected table for current-unreviewed view: ${table}`)
    })

    const response = await GET(request(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      currentVersion: { id: 'version-2', upload_id: v2.upload_id, file_sha256: v2.file_sha256 },
      reviewedVersion: { id: 'version-2' },
      current_review_status: 'PENDING',
      has_current_review: false,
      review_context: 'current_unreviewed',
      latestReview: null,
      latestJob: null,
      reviewRun: null,
      riskFindings: [],
      negotiationTasks: [],
      source_identity: {
        state: 'ready',
        label: '审核文件已准备完成',
        can_start_review: true,
        recovery_action: null,
      },
    })
    expect(body.data.review_history).toEqual([
      expect.objectContaining({ id: 'review-v1', contract_version_id: 'version-1', is_current: false }),
    ])
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('returns the complete review history in newest-first order without truncating older records', async () => {
    const reviewV1Middle = {
      ...reviewV1,
      id: 'review-v1-middle',
      created_at: '2026-07-21T01:04:00.000Z',
      completed_at: '2026-07-21T01:04:30.000Z',
    }
    const reviewV1Oldest = {
      ...reviewV1,
      id: 'review-v1-oldest',
      created_at: '2026-07-21T01:03:00.000Z',
      completed_at: '2026-07-21T01:03:30.000Z',
    }
    vi.mocked(getAccessibleContract).mockResolvedValue({
      contract: {
        id: 'contract-1',
        filename: '双版本合同.docx',
        status: 'COMPLETED',
        storage_path: v2.storage_path,
        current_version_id: v2.id,
        contract_reviews: [reviewV1Oldest, reviewV1, reviewV1Middle],
      },
      assignments: [],
    } as never)
    const queries = {
      contract_versions: makeQuery({ data: [v2, v1], error: null }),
      contract_source_page_maps: makeQuery({ data: [v2PageMap], error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const query = queries[table as keyof typeof queries]
      if (query) return query as never
      throw new Error(`unexpected table for complete history view: ${table}`)
    })

    const response = await GET(request('?view=summary'), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.review_history.map((review: { id: string }) => review.id)).toEqual([
      'review-v1',
      'review-v1-middle',
      'review-v1-oldest',
    ])
    expect(body.data.review_history).toHaveLength(3)
    expect(body.data.review_history).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_version_number: 1, source_identity_verified: true }),
    ]))
  })

  it('returns a business recovery action and blocks review when the current page map is missing', async () => {
    const queries = {
      contract_versions: makeQuery({ data: [v2, v1], error: null }),
      contract_source_page_maps: makeQuery({ data: [], error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const query = queries[table as keyof typeof queries]
      if (query) return query as never
      throw new Error(`unexpected table for missing-page-map view: ${table}`)
    })

    const response = await GET(request(), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.source_identity).toMatchObject({
      state: 'missing',
      label: '风险定位尚未准备完成',
      can_start_review: false,
      recovery_action: {
        label: '重新准备审核文件',
        href: '/contracts/contract-1/edit?intent=source-replacement',
      },
    })
  })

  it('loads v1 facts only in an explicit historical view and fences its job by review_id', async () => {
    const queries = {
      contract_versions: makeQuery({ data: [v2, v1], error: null }),
      contract_source_page_maps: makeQuery({ data: [v2PageMap], error: null }),
      contract_risk_cards: makeQuery({
        data: [{
          id: 'risk-v1',
          review_id: 'review-v1',
          contract_id: 'contract-1',
          level: 'red',
          title: 'v1 风险',
          status: 'open',
        }],
        error: null,
      }),
      contract_annotations: makeQuery({ data: [], error: null }),
      contract_analysis_jobs: makeQuery({
        data: [{ id: 'job-v1', review_id: 'review-v1', provider: 'provider-v1', status: 'completed' }],
        error: null,
      }),
      ask_items: makeQuery({ data: [], error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const query = queries[table as keyof typeof queries]
      if (!query) throw new Error(`unexpected table: ${table}`)
      return query as never
    })

    const response = await GET(request('?view=summary&review=review-v1'), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      currentVersion: { id: 'version-2' },
      reviewedVersion: { id: 'version-1' },
      has_current_review: false,
      review_context: 'historical',
      latestReview: { id: 'review-v1', contract_version_id: 'version-1' },
      latestJob: { id: 'job-v1', review_id: 'review-v1', provider: 'provider-v1' },
      reviewRun: {
        id: 'review-v1',
        contract_version_id: 'version-1',
        source_storage_path: v1.storage_path,
      },
      riskFindings: [{ id: 'risk-v1', title: 'v1 风险' }],
    })
    expect(queries.contract_risk_cards.eq).toHaveBeenCalledWith('review_id', 'review-v1')
    expect(queries.contract_annotations.eq).toHaveBeenCalledWith('review_id', 'review-v1')
    expect(queries.contract_annotations.eq).toHaveBeenCalledWith('contract_version_id', 'version-1')
    expect(queries.contract_annotations.eq).toHaveBeenCalledWith('binding_state', 'bound')
    expect(queries.contract_analysis_jobs.eq).toHaveBeenCalledWith('review_id', 'review-v1')
    expect(queries.ask_items.eq).toHaveBeenCalledWith('review_id', 'review-v1')
    expect(queries.ask_items.eq).toHaveBeenCalledWith('contract_version_id', 'version-1')
    expect(queries.ask_items.eq).toHaveBeenCalledWith('binding_state', 'bound')
  })
})
