/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/scoped-access', () => ({
  listAccessibleUserIds: vi.fn(async () => ({ userIds: ['user-1'] })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}))

vi.mock('@/lib/contracts/text-extraction', () => ({
  extractContractText: vi.fn(),
}))

import { extractContractText } from '@/lib/contracts/text-extraction'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function installSupabaseMock(contracts: any[]) {
  const updates: any[] = []
  const diffInserts: any[] = []
  const comparisonInserts: any[] = []
  const comparisonUpdates: any[] = []
  const contractQueue = [...contracts]

  const contractTable: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: contractQueue.shift() || null, error: null })),
    update: vi.fn((payload) => {
      updates.push(payload)
      return contractTable
    }),
  }

  const comparisonInsertChain: any = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({
      data: {
        id: 'comparison-1',
        contract_id: '11111111-1111-4111-8111-111111111111',
        baseline_type: 'previous_version',
        compare_doc_id: '22222222-2222-4222-8222-222222222222',
        status: 'pending',
      },
      error: null,
    })),
  }
  const comparisonTable: any = {
    insert: vi.fn((payload) => {
      comparisonInserts.push(payload)
      return comparisonInsertChain
    }),
    update: vi.fn((payload) => {
      comparisonUpdates.push(payload)
      return comparisonTable
    }),
    eq: vi.fn().mockReturnThis(),
  }

  const diffTable: any = {
    insert: vi.fn(async (payload) => {
      diffInserts.push(payload)
      return { error: null }
    }),
  }

  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    if (table === 'contracts') return contractTable
    if (table === 'contract_comparisons') return comparisonTable
    if (table === 'comparison_diffs') return diffTable
    throw new Error(`unexpected table ${table}`)
  })

  const storageBucket = {
    download: vi.fn(async () => ({ data: new Blob(['docx-bytes']), error: null })),
  }
  ;(supabaseAdmin.storage.from as any).mockReturnValue(storageBucket)

  return { updates, diffInserts, comparisonInserts, comparisonUpdates, storageBucket }
}

describe('POST /api/contracts/[id]/compare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('缺少 parsed_text 但有源文件时懒抽取并回填后完成比对', async () => {
    ;(extractContractText as any).mockReturnValue('第一条 付款期限为30日\n第二条 违约责任')
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        parsed_text: null,
        storage_path: 'baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为60日\n第三条 知识产权归属客户',
        storage_path: 'compare.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ])

    const res = await POST(makeJsonRequest({
      baseline_type: 'previous_version',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.diffs.length).toBeGreaterThan(0)
    expect(supabase.storageBucket.download).toHaveBeenCalledWith('baseline.docx')
    expect(extractContractText).toHaveBeenCalled()
    expect(supabase.updates[0]).toMatchObject({
      parsed_text: '第一条 付款期限为30日\n第二条 违约责任',
      ocr_status: 'COMPLETED',
    })
    expect(supabase.comparisonInserts[0]).toMatchObject({
      contract_id: '11111111-1111-4111-8111-111111111111',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    })
    expect(supabase.comparisonUpdates[0]).toMatchObject({
      status: 'completed',
    })
    expect(supabase.diffInserts[0].length).toBeGreaterThan(0)
  })

  it('缺少 parsed_text 且没有源文件时返回可解释的校验错误', async () => {
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        parsed_text: null,
        storage_path: null,
        mime_type: null,
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为60日',
        storage_path: 'compare.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ])

    const res = await POST(makeJsonRequest({
      baseline_type: 'previous_version',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toBe('baseline.docx 缺少源文件和可比对的解析文本')
    expect(supabase.storageBucket.download).not.toHaveBeenCalled()
    expect(extractContractText).not.toHaveBeenCalled()
    expect(supabase.diffInserts).toHaveLength(0)
  })

  it('拒绝与当前合同缺少同客户或同报价关系的对比合同', async () => {
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        contract_no: 'CT-001',
        quote_id: null,
        party_b_name: 'ONES E2E 客户',
        parsed_text: '第一条 付款期限为30日',
        storage_path: 'baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'hemory.docx',
        status: 'COMPLETED',
        contract_no: null,
        quote_id: null,
        party_b_name: '',
        parsed_text: 'Hemory 服务条款',
        storage_path: 'hemory.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-2',
        org_id: 'org-1',
      },
    ])

    const res = await POST(makeJsonRequest({
      baseline_type: 'previous_version',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toContain('缺少同客户、同报价或同上传者的关系')
    expect(supabase.comparisonInserts).toHaveLength(0)
    expect(supabase.diffInserts).toHaveLength(0)
  })

  it('源文件读取超时时返回可恢复的校验错误而不是卡住', async () => {
    vi.useFakeTimers()
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        parsed_text: null,
        storage_path: 'baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为60日',
        storage_path: 'compare.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ])
    supabase.storageBucket.download.mockImplementation(() => new Promise(() => {}))

    const pending = POST(makeJsonRequest({
      baseline_type: 'previous_version',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })

    await vi.advanceTimersByTimeAsync(8000)
    const res = await pending
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toBe('baseline.docx 源文件读取超时，请稍后重试或重新上传')
    expect(supabase.diffInserts).toHaveLength(0)
  })

  it('源文件解析异常时返回可解释的校验错误', async () => {
    ;(extractContractText as any).mockImplementation(() => {
      throw new Error('bad zip')
    })
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        parsed_text: null,
        storage_path: 'baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为60日',
        storage_path: 'compare.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ])

    const res = await POST(makeJsonRequest({
      baseline_type: 'previous_version',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toBe('baseline.docx 无法提取可比对文本，请上传可复制文本的 docx/pdf')
    expect(supabase.storageBucket.download).toHaveBeenCalledWith('baseline.docx')
    expect(supabase.diffInserts).toHaveLength(0)
  })
})
