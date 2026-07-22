import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_request, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/contracts/review-workbench-server', () => ({
  loadReviewBundleSnapshot: vi.fn(),
}))

vi.mock('@/lib/documents/source-render-server', () => ({
  ensureContractPageMap: vi.fn(),
}))

vi.mock('@/lib/contract-analysis', () => ({
  processContractAnalysisJob: vi.fn().mockResolvedValue({
    risks: [], summary: 'ok', appliedRules: 0, matchedRules: 0,
    provider: 'provider-1', degraded: false,
  }),
  readContractAnalysisTerminalState: vi.fn().mockResolvedValue('completed'),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: 0, error: null }) },
}))

import { POST } from './route'
import { supabaseAdmin } from '@/lib/supabase'
import { loadReviewBundleSnapshot } from '@/lib/contracts/review-workbench-server'
import { ensureContractPageMap } from '@/lib/documents/source-render-server'
import { processContractAnalysisJob } from '@/lib/contract-analysis'

function builder(result: { data?: unknown; error?: unknown }, singleResult?: { data?: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(singleResult || result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
  }
  return chain
}

describe('POST review batch submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadReviewBundleSnapshot).mockResolvedValue({
      id: 'bundle-1', version: 18, published_at: null,
      rule_snapshot_ids: ['snapshot-1'], rule_set_snapshot_ids: [], model_policy_id: null, model_policy: null,
      output_schema: {}, release_meta: {}, execution_contract: 'legacy_risk_v1', rules: [],
    })
    ;(supabaseAdmin.rpc as unknown as { mockImplementation: (implementation: (name: string) => Promise<unknown>) => void })
      .mockImplementation(async (name: string) => {
      if (name === 'expire_stale_contract_review_setups') return { data: 0, error: null } as never
      if (name === 'start_contract_review_decision_batch') {
        return { data: [{ batch_id: 'batch-1', review_id: 'review-new', job_id: 'job-1' }], error: null } as never
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } } as never
      })
    vi.mocked(ensureContractPageMap).mockResolvedValue({
      page_count: 1,
      locator: 'rendered',
      pages: [],
      source_hash: 'a'.repeat(64),
      source_text_hash: 'cf51732f125ac4e6190784e49a0acff591d183cb10e572706df1140475a3929c',
    })
  })

  it('returns 202 after atomic setup and immediately consumes the exact lease-safe job', async () => {
    const reviewId = '11111111-1111-4111-8111-111111111111'
    const option = {
      id: 'snapshot-1:B', rule_snapshot_id: 'snapshot-1', rule_code: 'R001', rule_name: '付款节奏',
      level: 'B', label: '协商付款节奏', action: 'negotiate_with_counterparty', comment_template: '请调整付款节奏。',
      negotiation_guidance: null, bottom_line: null, change_mode: 'comment', revision_text: null,
      consistency_key: null, conflict_group: null, mutually_exclusive_with: [],
    }
    const draft = {
      id: 'draft-1', risk_id: 'risk-1', decision_kind: 'customer_feedback', feedback: '客户要求延长账期',
      selected_option_id: option.id, selected_option_snapshot: option, optimistic_version: 2,
      source_anchor: { page: 1, start: 0, end: 10, clause_ref: '第一条', excerpt: '付款', exact_text: '付款', locator: 'rendered' },
      source_storage_path: 'contract-1/source.pdf', source_hash: 'a'.repeat(64),
      source_text_hash: 'cf51732f125ac4e6190784e49a0acff591d183cb10e572706df1140475a3929c',
    }
    const staleFixedDraft = {
      ...draft,
      id: 'draft-fixed',
      risk_id: 'risk-fixed',
      source_hash: 'b'.repeat(64),
    }
    const draftBuilder = builder({ data: [draft, staleFixedDraft], error: null })
    const riskBuilder = builder({ data: [{ id: 'risk-1', level: 'red', title: '付款节奏', rule_code: 'R001' }], error: null })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(builder({ data: { id: 'contract-1' }, error: null }) as never)
      .mockReturnValueOnce(builder({ data: {
        id: 'contract-1', status: 'COMPLETED', filename: 'source.pdf', mime_type: 'application/pdf',
        storage_path: 'contract-1/source.pdf', parsed_text: '付款条款',
      }, error: null }) as never)
      .mockReturnValueOnce(riskBuilder as never)
      .mockReturnValueOnce(draftBuilder as never)
      .mockReturnValueOnce(builder({ data: {
        id: reviewId, status: 'COMPLETED', source_storage_path: 'contract-1/source.pdf',
        source_hash: 'a'.repeat(64),
        source_text_hash: 'cf51732f125ac4e6190784e49a0acff591d183cb10e572706df1140475a3929c',
        skill_bundle_id: 'bundle-1', rule_version: 18,
      }, error: null }) as never)
      .mockReturnValueOnce(builder({ data: {
        id: 'contract-1', filename: 'source.pdf', mime_type: 'application/pdf',
        storage_path: 'contract-1/source.pdf', parsed_text: '付款条款',
      }, error: null }) as never)

    const request = new NextRequest('http://localhost/api/contracts/contract-1/review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        review_id: reviewId,
        review_style: 'strict',
        source_identity: {
          storage_path: 'contract-1/source.pdf',
          source_hash: 'a'.repeat(64),
          source_text_hash: 'cf51732f125ac4e6190784e49a0acff591d183cb10e572706df1140475a3929c',
        },
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data).toMatchObject({ batch_id: 'batch-1', review_id: 'review-new', job_id: 'job-1', status: 'completed' })
    expect(riskBuilder.eq).toHaveBeenCalledWith('status', 'open')
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'start_contract_review_decision_batch',
      expect.objectContaining({
        p_contract_id: 'contract-1',
        p_source_review_id: reviewId,
        p_decision_snapshot: [expect.objectContaining({ id: 'draft-1', optimistic_version: 2 })],
      })
    )
    expect(processContractAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1', contract_id: 'contract-1', review_id: 'review-new', status: 'queued',
    }))
    expect(loadReviewBundleSnapshot).toHaveBeenCalledWith('org-1', 'bundle-1', 18)
  })

  it('does not create an empty review loop when there are no open risks', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(builder({ data: { id: 'contract-1' }, error: null }) as never)
      .mockReturnValueOnce(builder({ data: {
        id: 'contract-1', status: 'COMPLETED', filename: 'source.pdf', mime_type: 'application/pdf',
        storage_path: 'contract-1/source.pdf', parsed_text: '',
      }, error: null }) as never)
      .mockReturnValueOnce(builder({ data: [], error: null }) as never)
      .mockReturnValueOnce(builder({ data: [], error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        review_id: '11111111-1111-4111-8111-111111111111',
        source_identity: {
          storage_path: 'contract-1/source.pdf',
          source_hash: 'a'.repeat(64),
          source_text_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(response.status).toBe(409)
    expect(ensureContractPageMap).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('start_contract_review_decision_batch', expect.anything())
  })

  it('fails closed before creating a decision batch for a facts_v1 candidate ReviewRun', async () => {
    const reviewId = '11111111-1111-4111-8111-111111111111'
    vi.mocked(loadReviewBundleSnapshot).mockResolvedValue({
      id: 'bundle-facts', version: 22, published_at: null,
      rule_snapshot_ids: ['snapshot-1'], rule_set_snapshot_ids: [], model_policy_id: 'policy-1', model_policy: null,
      output_schema: { contract: 'contract_review_facts_v1', version: 1 },
      release_meta: { stage: 'candidate', release_eligible: false },
      execution_contract: 'facts_v1', rules: [],
    })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(builder({ data: { id: 'contract-1' }, error: null }) as never)
      .mockReturnValueOnce(builder({ data: {
        id: 'contract-1', status: 'COMPLETED', filename: 'source.pdf', mime_type: 'application/pdf',
        storage_path: 'contract-1/source.pdf', parsed_text: '付款条款',
      }, error: null }) as never)
      .mockReturnValueOnce(builder({ data: [{
        id: 'risk-1', level: 'red', title: '付款节奏', description: '', suggestion: '', rule_code: 'R001',
      }], error: null }) as never)
      .mockReturnValueOnce(builder({ data: [], error: null }) as never)
      .mockReturnValueOnce(builder({ data: {
        id: reviewId, status: 'COMPLETED', source_storage_path: 'contract-1/source.pdf',
        source_hash: 'a'.repeat(64),
        source_text_hash: 'cf51732f125ac4e6190784e49a0acff591d183cb10e572706df1140475a3929c',
        skill_bundle_id: 'bundle-facts', rule_version: 22,
      }, error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        review_id: reviewId,
        source_identity: {
          storage_path: 'contract-1/source.pdf',
          source_hash: 'a'.repeat(64),
          source_text_hash: 'cf51732f125ac4e6190784e49a0acff591d183cb10e572706df1140475a3929c',
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(JSON.stringify(body)).toContain('FACTS_V1_DECISION_REVIEW_NOT_READY')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('start_contract_review_decision_batch', expect.anything())
    expect(processContractAnalysisJob).not.toHaveBeenCalled()
  })

  it('requires source identity before expiring or creating any review setup', async () => {
    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        review_id: '11111111-1111-4111-8111-111111111111',
        review_style: 'balanced',
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
