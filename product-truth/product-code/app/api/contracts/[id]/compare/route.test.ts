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
  isLikelyReadableContractText: vi.fn((text: string | null | undefined) => {
    const value = (text || '').trim()
    return Boolean(value) && !value.includes('ÚØëü') && !value.includes('乱码')
  }),
}))

import { extractContractText } from '@/lib/contracts/text-extraction'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, POST } from './route'

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeGetRequest(url = 'http://localhost/api/contracts/11111111-1111-4111-8111-111111111111/compare'): any {
  return {
    url,
    method: 'GET',
    headers: new Headers(),
  }
}

function installSupabaseMock(contracts: any[], versions: any[] = [], comparisons: any[] = []) {
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

  const versionTable: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(async () => ({ data: versions, error: null })),
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
    select: vi.fn().mockImplementation(() => comparisonQuery),
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
  const comparisonQuery: any = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: any, reject: any) => Promise.resolve({ data: comparisons, error: null }).then(resolve, reject),
  }

  const diffTable: any = {
    insert: vi.fn(async (payload) => {
      diffInserts.push(payload)
      return { error: null }
    }),
  }

  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    if (table === 'contracts') return contractTable
    if (table === 'contract_versions') return versionTable
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

  it('缓存 parsed_text 不可读时不复用坏证据，会重新从源文件提取', async () => {
    ;(extractContractText as any).mockReturnValue('第一条 付款期限为30日')
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.pdf',
        status: 'COMPLETED',
        parsed_text: 'ÚØëü n#ÜCóS$±vÁ N\ri»êiÀöAOHr4ÙUù gÓÆ0nR',
        storage_path: 'baseline.pdf',
        mime_type: 'application/pdf',
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

    expect(res.status).toBe(201)
    expect(body.data.diffs[0]).toMatchObject({
      baseline_text: '第一条 付款期限为30日',
      compare_text: '第一条 付款期限为60日',
    })
    expect(supabase.storageBucket.download).toHaveBeenCalledWith('baseline.pdf')
    expect(extractContractText).toHaveBeenCalled()
    expect(supabase.updates[0]).toMatchObject({
      parsed_text: '第一条 付款期限为30日',
      ocr_status: 'COMPLETED',
    })
  })

  it('将同一条款的内容变化归并为一条修改差异', async () => {
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为30日\n第二条 服务范围保持不变',
        storage_path: 'baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为60日\n第二条 服务范围保持不变',
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
    const diffs = supabase.diffInserts[0]

    expect(res.status).toBe(201)
    expect(body.data.diffs).toHaveLength(1)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({
      diff_type: 'modified',
      baseline_text: '第一条 付款期限为30日',
      compare_text: '第一条 付款期限为60日',
      risk_level: 'red',
    })
  })

  it('尊重 baseline_doc_id，不把路由合同锁死为基准文件', async () => {
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'route-current.docx',
        status: 'COMPLETED',
        party_b_name: '同一客户',
        parsed_text: '这份路由合同不应该成为本次基准',
        storage_path: 'route-current.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        filename: 'selected-baseline.docx',
        status: 'COMPLETED',
        party_b_name: '同一客户',
        parsed_text: '第一条 付款期限为30日',
        storage_path: 'selected-baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        party_b_name: '同一客户',
        parsed_text: '第一条 付款期限为60日',
        storage_path: 'compare.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ])

    const res = await POST(makeJsonRequest({
      baseline_type: 'previous_version',
      baseline_doc_id: '33333333-3333-4333-8333-333333333333',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.diffs[0]).toMatchObject({
      baseline_text: '第一条 付款期限为30日',
      compare_text: '第一条 付款期限为60日',
    })
    expect(supabase.comparisonInserts[0]).toMatchObject({
      contract_id: '11111111-1111-4111-8111-111111111111',
      baseline_doc_id: '33333333-3333-4333-8333-333333333333',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('支持选择当前合同历史版本作为旧文件，再与候选合同比对', async () => {
    ;(extractContractText as any).mockReturnValue('第一条 付款期限为30日')
    const supabase = installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'route-current.docx',
        status: 'COMPLETED',
        party_b_name: '同一客户',
        parsed_text: '当前合同文本不应覆盖历史版本',
        storage_path: 'route-current.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        filename: 'compare.docx',
        status: 'COMPLETED',
        party_b_name: '同一客户',
        parsed_text: '第一条 付款期限为60日',
        storage_path: 'compare.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ], [
      {
        id: '33333333-3333-4333-8333-333333333333',
        contract_id: '11111111-1111-4111-8111-111111111111',
        version_number: 1,
        source: 'original',
        storage_path: 'baseline-v1.docx',
        file_size: 1024,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        parent_version_id: null,
        change_summary: '源文件',
        review_id: null,
        created_at: '2026-07-03T00:00:00.000Z',
      },
    ])

    const res = await POST(makeJsonRequest({
      baseline_type: 'previous_version',
      baseline_doc_id: '33333333-3333-4333-8333-333333333333',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    }), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.diffs[0]).toMatchObject({
      baseline_text: '第一条 付款期限为30日',
      compare_text: '第一条 付款期限为60日',
    })
    expect(supabase.storageBucket.download).toHaveBeenCalledWith('baseline-v1.docx')
    expect(supabase.comparisonInserts[0]).toMatchObject({
      contract_id: '11111111-1111-4111-8111-111111111111',
      baseline_doc_id: '33333333-3333-4333-8333-333333333333',
      compare_doc_id: '22222222-2222-4222-8222-222222222222',
    })
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

  it('查询历史比对结果时隐藏旧乱码证据文本', async () => {
    installSupabaseMock([
      {
        id: '11111111-1111-4111-8111-111111111111',
        filename: 'baseline.docx',
        status: 'COMPLETED',
        parsed_text: '第一条 付款期限为30日',
        storage_path: 'baseline.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        created_by: 'user-1',
        org_id: 'org-1',
      },
    ], [], [
      {
        id: 'comparison-1',
        contract_id: '11111111-1111-4111-8111-111111111111',
        baseline_doc_id: null,
        compare_doc_id: null,
        comparison_diffs: [
          {
            id: 'diff-1',
            diff_type: 'deleted',
            baseline_text: 'ÚØëü n#ÜCóS$±vÁ N\ri»êiÀöAOHr4ÙUù gÓÆ0nR',
            compare_text: '第一条 付款期限为60日',
            semantic_change: '旧证据不可读',
            risk_level: 'yellow',
            sort_order: 1,
          },
        ],
      },
    ])

    const res = await GET(makeGetRequest(), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.diffs[0]).toMatchObject({
      baseline_text: '文件文本层不可读；请以原件预览和人工/OCR定位为准。',
      compare_text: '第一条 付款期限为60日',
    })
  })
})
