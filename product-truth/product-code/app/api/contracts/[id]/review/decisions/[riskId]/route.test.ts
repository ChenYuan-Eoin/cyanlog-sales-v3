import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_request, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/contracts/review-workbench-server', () => ({
  loadReviewBundleSnapshot: vi.fn(),
}))

vi.mock('@/lib/documents/source-render-server', () => ({
  ensureContractPageMap: vi.fn().mockResolvedValue({
    source_hash: 'a'.repeat(64),
    source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
    page_count: 2,
    locator: 'rendered',
    pages: [{ page: 1, start: 0, end: 99, locator: 'rendered' }],
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}))

import { PUT } from './route'
import { supabaseAdmin } from '@/lib/supabase'
import { loadReviewBundleSnapshot } from '@/lib/contracts/review-workbench-server'

function query(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

describe('PUT review decision draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadReviewBundleSnapshot).mockResolvedValue({
      id: 'bundle-1',
      version: 18,
      published_at: null,
      rule_snapshot_ids: ['snapshot-1'],
      rule_set_snapshot_ids: [],
      model_policy_id: null,
      model_policy: null,
      output_schema: {},
      release_meta: {},
      execution_contract: 'legacy_risk_v1',
      rules: [{
        snapshot_id: 'snapshot-1',
        code: 'R001',
        name: '付款节奏',
        level_a_action: 'auto_accept',
        level_b_action: null,
        level_c_action: null,
        message_template: { levels: { level_a: '首期不低于30%' }, comment: '请调整付款节奏。' },
      }],
    })
  })

  it('returns 409 when expected_version is stale', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'a.docx', parsed_text: '第一条 付款节奏' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'risk-1', contract_id: 'contract-1', review_id: 'review-1', level: 'red', title: '付款节奏', position_start: 4, position_end: 8, rule_code: 'R001', evidence: { rule_snapshot_id: 'snapshot-1' }, status: 'open' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'review-1', status: 'COMPLETED', source_storage_path: 'a.docx', source_hash: 'a'.repeat(64), source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054', skill_bundle_id: 'bundle-1', rule_version: 18 }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'draft-1', status: 'draft_selected', optimistic_version: 3 }, error: null }) as never)

    const request = new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: 'snapshot-1:A',
        negotiation_result: 'customer_agreed',
        expected_version: 2,
        source_identity: {
          storage_path: 'a.docx',
          source_hash: 'a'.repeat(64),
          source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
        },
      }),
    })
    const response = await PUT(request, { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('其他会话更新')
    expect(loadReviewBundleSnapshot).toHaveBeenCalledWith('org-1', 'bundle-1', 18)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(4)
  })

  it('rejects page-point overrides for Word because native comments require text anchors', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'a.docx', parsed_text: '第一条 付款节奏' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'risk-1', contract_id: 'contract-1', review_id: 'review-1', level: 'red', title: '付款节奏', position_start: 4, position_end: 8, rule_code: 'R001', evidence: { rule_snapshot_id: 'snapshot-1' }, status: 'open' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'review-1', status: 'COMPLETED', source_storage_path: 'a.docx', source_hash: 'a'.repeat(64), source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054', skill_bundle_id: 'bundle-1', rule_version: 18 }, error: null }) as never)

    const request = new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: 'snapshot-1:A',
        negotiation_result: 'customer_agreed',
        expected_version: 0,
        source_anchor_override: { kind: 'point', page: 1, point: { x: 0.4, y: 0.6 } },
        source_identity: {
          storage_path: 'a.docx',
          source_hash: 'a'.repeat(64),
          source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
        },
      }),
    })
    const response = await PUT(request, { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-1' }) })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error.message).toContain('当前仅用于 PDF')
  })

  it('rejects edits to a fixed risk before reading or writing a decision draft', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.docx', storage_path: 'a.docx', parsed_text: '第一条' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'risk-1', contract_id: 'contract-1', review_id: 'review-1', level: 'red', title: '付款节奏', status: 'fixed', evidence: {} }, error: null }) as never)

    const request = new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: null,
        negotiation_result: 'customer_feedback',
        feedback: '旧标签页修改',
        expected_version: 1,
        source_identity: {
          storage_path: 'a.docx',
          source_hash: 'a'.repeat(64),
          source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
        },
      }),
    })
    const response = await PUT(request, { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-1' }) })

    expect(response.status).toBe(409)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('rejects document-coverage conclusions before source positioning or decision export state', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.pdf', storage_path: 'a.pdf', parsed_text: '第一条' }, error: null }) as never)
      .mockReturnValueOnce(query({
        data: {
          id: 'risk-document',
          contract_id: 'contract-1',
          review_id: 'review-1',
          level: 'yellow',
          title: '未发现数据处理协议',
          position_start: null,
          position_end: null,
          status: 'open',
          evidence: { evidence_scope: 'document_coverage', customer_output_eligible: false },
        },
        error: null,
      }) as never)

    const response = await PUT(new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-document', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: null,
        negotiation_result: 'customer_feedback',
        feedback: '请人工核对',
        expected_version: 0,
        source_anchor_override: { kind: 'point', page: 1, point: { x: 0.5, y: 0.5 } },
        source_identity: {
          storage_path: 'a.pdf',
          source_hash: 'a'.repeat(64),
          source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-document' }) })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error.message).toContain('文档级覆盖结论')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(loadReviewBundleSnapshot).not.toHaveBeenCalled()
  })

  it('rejects reopening a decision draft that was already submitted by an older ReviewRun', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'a.docx', parsed_text: '第一条 付款节奏' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'risk-1', contract_id: 'contract-1', review_id: 'review-old', level: 'red', title: '付款节奏', position_start: 4, position_end: 8, rule_code: 'R001', evidence: {}, status: 'open' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'review-old', status: 'COMPLETED', source_storage_path: 'a.docx', source_hash: 'a'.repeat(64), source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054', skill_bundle_id: 'bundle-1', rule_version: 18 }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'draft-old', status: 'batch_submitted', optimistic_version: 1 }, error: null }) as never)

    const response = await PUT(new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: null,
        negotiation_result: 'customer_feedback',
        feedback: '旧标签页修改',
        expected_version: 1,
        source_identity: {
          storage_path: 'a.docx',
          source_hash: 'a'.repeat(64),
          source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('已提交复审')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(4)
  })

  it('requires the browser source identity before any database read', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: null,
        negotiation_result: 'customer_feedback',
        feedback: '缺少身份',
        expected_version: 0,
      }),
    }), { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-1' }) })

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('通过同一个 RPC 按合同、ReviewRun、风险、草稿的锁序原子保存', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'a.docx', parsed_text: '第一条 付款节奏' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'risk-1', contract_id: 'contract-1', review_id: 'review-1', level: 'red', title: '付款节奏', description: '存在风险', suggestion: '请调整', position_start: 4, position_end: 8, rule_code: 'R001', evidence: { rule_snapshot_id: 'snapshot-1' }, status: 'open' }, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'review-1', status: 'COMPLETED', source_storage_path: 'a.docx', source_hash: 'a'.repeat(64), source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054', skill_bundle_id: 'bundle-1', rule_version: 18 }, error: null }) as never)
      .mockReturnValueOnce(query({ data: null, error: null }) as never)
      .mockReturnValueOnce(query({ data: { id: 'contract-1', filename: 'a.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storage_path: 'a.docx', parsed_text: '第一条 付款节奏' }, error: null }) as never)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{ id: 'draft-1', optimistic_version: 1, status: 'draft_selected' }],
      error: null,
    } as never)

    const response = await PUT(new NextRequest('http://localhost/api/contracts/contract-1/review/decisions/risk-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution_strategy_id: 'snapshot-1:A',
        negotiation_result: 'customer_agreed',
        expected_version: 0,
        source_identity: {
          storage_path: 'a.docx',
          source_hash: 'a'.repeat(64),
          source_text_hash: '4c4800b66f951a636e5dfb7cea1f0d76a011a9d42a5ae2ce522c455a32271054',
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1', riskId: 'risk-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ id: 'draft-1', optimistic_version: 1 })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('save_contract_review_decision_draft', expect.objectContaining({
      p_contract_id: 'contract-1',
      p_review_id: 'review-1',
      p_risk_id: 'risk-1',
      p_expected_version: 0,
      p_draft: expect.objectContaining({ rule_bundle_id: 'bundle-1', rule_bundle_version: 18 }),
    }))
  })
})
