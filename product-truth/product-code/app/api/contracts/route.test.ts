/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(() => true),
  listFreshAccessibleUserIds: vi.fn(async () => ({
    orgId: 'org-1',
    assignments: [],
    userIds: ['user-1'],
  })),
}))

import { supabaseAdmin } from '@/lib/supabase'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { GET, POST } from './route'

type QueryResult = {
  data: unknown[] | null
  error: unknown
  count?: number | null
}

function makeQuery(result: QueryResult) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'order', 'range', 'or', 'in', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

function installGetDatabase(input: {
  contracts: unknown[]
  reviews?: unknown[]
  pageMaps?: unknown[]
  comparisons?: unknown[]
  count?: number
}) {
  const queries = {
    contracts: makeQuery({ data: input.contracts, error: null, count: input.count ?? input.contracts.length }),
    contract_reviews: makeQuery({ data: input.reviews || [], error: null }),
    contract_source_page_maps: makeQuery({ data: input.pageMaps || [], error: null }),
    contract_comparisons: makeQuery({ data: input.comparisons || [], error: null }),
  }
  const fromMock = supabaseAdmin.from as any
  fromMock.mockImplementation((table: string) => {
    const query = queries[table as keyof typeof queries]
    if (!query) throw new Error(`unexpected table: ${table}`)
    return query
  })
  return queries
}

function makeGetRequest(search = ''): any {
  return {
    url: `https://app.example.test/api/contracts${search}`,
    method: 'GET',
    headers: new Headers(),
  }
}

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    formData: vi.fn(),
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeMalformedFormRequest(): any {
  return {
    formData: async () => {
      throw new TypeError('invalid multipart')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeSingleQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(async () => result)
  return query
}

describe('POST /api/contracts validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(canAccessContractAction).mockReturnValue(true)
  })

  it('无效 JSON 返回参数错误且不访问业务数据库', async () => {
    const res = await POST(makeMalformedJsonRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('无效表单数据返回参数错误且不访问业务数据库', async () => {
    const res = await POST(makeMalformedFormRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('按组织、创建人和 client_request_id 恢复同一次合同创建', async () => {
    const recovered = [{
      contract_id: 'contract-existing',
      contract_no: 'CT-20260721-001',
      status: 'DRAFT',
      party_b_name: '待识别客户',
      contract_amount: 0,
      recovered: true,
      item_count: 0,
    }]
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: recovered, error: null })

    const res = await POST(makeJsonRequest({
      client_request_id: '04c00000-0000-4000-8000-000000000001',
      party_b_name: '待识别客户',
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({
      contract_id: 'contract-existing',
      recovered: true,
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_contract_aggregate_idempotent',
      expect.objectContaining({
        p_org_id: 'org-1',
        p_created_by: 'user-1',
        p_client_request_id: '04c00000-0000-4000-8000-000000000001',
        p_include_quote_items: false,
        p_contract: expect.objectContaining({ contract_no: null }),
      })
    )
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('显式合同编号保留，自动编号不在路由做 max+1', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: [{
        contract_id: 'contract-explicit-number',
        contract_no: 'HT-CUSTOM-001',
        status: 'DRAFT',
        party_b_name: '客户',
        contract_amount: 0,
        recovered: false,
        item_count: 0,
      }],
      error: null,
    })

    const res = await POST(makeJsonRequest({
      client_request_id: '04c00000-0000-4000-8000-000000000006',
      contract_no: 'HT-CUSTOM-001',
      party_b_name: '客户',
    }))

    expect(res.status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_contract_aggregate_idempotent',
      expect.objectContaining({
        p_contract: expect.objectContaining({ contract_no: 'HT-CUSTOM-001' }),
      })
    )
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('只传递报价身份和复制选择，合同条目由原子 RPC 从服务端报价生成', async () => {
    const quoteId = '04c00000-0000-4000-8000-000000000002'
    const quoteQuery = makeSingleQuery({
      data: {
        id: quoteId,
        quote_no: 'BJ-001',
        customer_name: '客户 A',
        customer_contact: '联系人',
        total_amount: 50000,
        tax_amount: 3000,
        subtotal: 47000,
        payment_terms: '验收后付款',
        valid_until: '2026-08-01',
        status: 'CONFIRMED',
      },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'quotes') return quoteQuery
      throw new Error(`unexpected table: ${table}`)
    })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: [{
        contract_id: 'contract-from-quote',
        contract_no: 'CT-20260721-002',
        status: 'DRAFT',
        party_b_name: '客户 A',
        contract_amount: 50000,
        recovered: true,
        item_count: 2,
      }],
      error: null,
    })

    const res = await POST(makeJsonRequest({
      client_request_id: '04c00000-0000-4000-8000-000000000003',
      quote_id: quoteId,
      include_quote_items: true,
      party_b_name: '客户 A',
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.quote_ref).toEqual({
      quote_id: quoteId,
      quote_no: 'BJ-001',
      item_count: 2,
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'create_contract_aggregate_idempotent',
      expect.objectContaining({
        p_include_quote_items: true,
        p_contract: expect.objectContaining({ quote_id: quoteId }),
      })
    )
    const rpcPayload = (supabaseAdmin.rpc as any).mock.calls[0]?.[1]
    expect(rpcPayload).not.toHaveProperty('p_items')
  })

  it('同一 client_request_id 改换报价时返回业务可读的请求冲突', async () => {
    const quoteId = '04c00000-0000-4000-8000-000000000004'
    const quoteQuery = makeSingleQuery({
      data: {
        id: quoteId,
        quote_no: 'BJ-002',
        customer_name: '客户 B',
        customer_contact: null,
        total_amount: 10000,
        tax_amount: 0,
        subtotal: 10000,
        payment_terms: null,
        valid_until: null,
        status: 'CONFIRMED',
      },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'quotes') return quoteQuery
      throw new Error(`unexpected table: ${table}`)
    })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'client_request_id is already bound to another quote' },
    })

    const res = await POST(makeJsonRequest({
      client_request_id: '04c00000-0000-4000-8000-000000000005',
      quote_id: quoteId,
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'V001',
      message: '同一创建请求的合同内容已发生变化，请重新创建并使用新的请求标识',
    })
  })

  it('报价状态由原子 RPC 二次裁定并返回业务错误', async () => {
    const quoteId = '04c00000-0000-4000-8000-000000000007'
    const quoteQuery = makeSingleQuery({
      data: {
        id: quoteId,
        quote_no: 'BJ-DRAFT',
        customer_name: '客户 C',
        customer_contact: null,
        total_amount: 10000,
        tax_amount: 0,
        subtotal: 10000,
        payment_terms: null,
        valid_until: null,
        status: 'DRAFT',
      },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'quotes') return quoteQuery
      throw new Error(`unexpected table: ${table}`)
    })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: 'contract quote is unavailable or no longer confirmed',
      },
    })

    const res = await POST(makeJsonRequest({
      client_request_id: '04c00000-0000-4000-8000-000000000008',
      quote_id: quoteId,
    }))
    const body = await res.json()

    expect(supabaseAdmin.rpc).toHaveBeenCalledOnce()
    expect(res.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'B002',
      message: '报价 BJ-DRAFT 尚未确认或已失效，不能创建合同',
    })
  })

  it('拒绝没有创建或上传权限的已登录用户且不访问业务数据库', async () => {
    vi.mocked(canAccessContractAction).mockReturnValueOnce(false)

    const res = await POST(makeJsonRequest({ party_b_name: '待识别客户' }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'create_or_upload')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe('GET /api/contracts task identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(canAccessContractAction).mockReturnValue(true)
  })

  it('拒绝没有查看权限的已登录用户且不查询合同或嵌套证据', async () => {
    vi.mocked(canAccessContractAction).mockReturnValueOnce(false)

    const res = await GET(makeGetRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'view')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('返回当前源版本、精确审核绑定、可验证 source identity 与已有对比', async () => {
    const fileHash = 'a'.repeat(64)
    const textHash = 'b'.repeat(64)
    const queries = installGetDatabase({
      contracts: [
        {
          id: 'contract-1',
          org_id: 'org-1',
          created_by: 'user-1',
          filename: '采购合同.docx',
          status: 'COMPLETED',
          contract_no: 'HT-001',
          quote_id: null,
          party_b_name: '供应商',
          created_at: '2026-07-21T01:00:00.000Z',
          updated_at: '2026-07-21T03:00:00.000Z',
          storage_path: 'org-1/contract-1/current.docx',
          current_version_id: 'version-2',
          contract_versions: [
            {
              id: 'version-1',
              contract_id: 'contract-1',
              version_number: 1,
              source: 'original',
              storage_path: 'org-1/contract-1/original.docx',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: 'c'.repeat(64),
              text_sha256: 'd'.repeat(64),
              review_id: 'review-1',
              created_at: '2026-07-21T01:00:00.000Z',
            },
            {
              id: 'version-2',
              contract_id: 'contract-1',
              version_number: 2,
              source: 'manual_revision',
              storage_path: 'org-1/contract-1/current.docx',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: fileHash,
              text_sha256: textHash,
              review_id: 'review-2',
              created_at: '2026-07-21T02:00:00.000Z',
            },
            {
              id: 'version-output',
              contract_id: 'contract-1',
              version_number: 3,
              source: 'review_revision',
              storage_path: 'org-1/contract-1/annotated.docx',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: null,
              text_sha256: null,
              review_id: 'review-2',
              created_at: '2026-07-21T03:00:00.000Z',
            },
          ],
        },
      ],
      reviews: [
        {
          id: 'review-2',
          contract_id: 'contract-1',
          contract_version_id: 'version-2',
          status: 'COMPLETED',
          review_trigger: 'initial_upload',
          source_storage_path: 'org-1/contract-1/current.docx',
          source_hash: fileHash,
          source_text_hash: textHash,
          started_at: '2026-07-21T02:01:00.000Z',
          completed_at: '2026-07-21T02:03:00.000Z',
          created_at: '2026-07-21T02:01:00.000Z',
        },
        {
          id: 'review-1',
          contract_id: 'contract-1',
          contract_version_id: 'version-1',
          status: 'COMPLETED',
          review_trigger: 'initial_upload',
          source_storage_path: 'org-1/contract-1/original.docx',
          source_hash: 'c'.repeat(64),
          source_text_hash: 'd'.repeat(64),
          started_at: '2026-07-21T01:01:00.000Z',
          completed_at: '2026-07-21T01:03:00.000Z',
          created_at: '2026-07-21T01:01:00.000Z',
        },
      ],
      pageMaps: [
        {
          contract_id: 'contract-1',
          contract_version_id: 'version-2',
          storage_path: 'org-1/contract-1/current.docx',
          source_hash: fileHash,
          source_text_hash: textHash,
          render_mode: 'browser-ooxml',
          locator: 'rendered',
          page_count: 3,
          generated_at: '2026-07-21T02:00:30.000Z',
        },
      ],
      comparisons: [
        {
          id: 'comparison-1',
          contract_id: 'contract-1',
          baseline_type: 'contract_version',
          baseline_doc_id: 'version-1',
          compare_doc_id: 'version-2',
          status: 'completed',
          ai_summary: '付款条款有变化',
          created_at: '2026-07-21T03:00:00.000Z',
          completed_at: '2026-07-21T03:01:00.000Z',
          comparison_diffs: [{ id: 'diff-1', risk_level: 'red' }],
        },
      ],
    })

    const res = await GET(makeGetRequest('?includeTotal=1&pageSize=20'))
    const body = await res.json()
    const contract = body.data.data[0]

    expect(res.status).toBe(200)
    expect(queries.contracts.select.mock.calls[0]?.[0]).toContain(
      'contract_versions!contract_versions_contract_id_fkey'
    )
    expect(listFreshAccessibleUserIds).toHaveBeenCalledWith('user-1')
    expect(queries.contracts.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(queries.contracts.in).toHaveBeenCalledWith('created_by', ['user-1'])
    expect(queries.contract_reviews.in).toHaveBeenCalledWith('contract_id', ['contract-1'])
    expect(queries.contract_source_page_maps.in).toHaveBeenCalledWith('contract_id', ['contract-1'])
    expect(contract).toMatchObject({
      id: 'contract-1',
      current_version_id: 'version-2',
      latest_review: {
        id: 'review-2',
        contract_version_id: 'version-2',
        source_storage_path: 'org-1/contract-1/current.docx',
        source_binding: 'matched_source_version',
      },
      source_identity: {
        state: 'ready',
        label: '审核文件已准备完成',
        ready: true,
        can_start_review: true,
        source_version_id: 'version-2',
        storage_path: 'org-1/contract-1/current.docx',
        file_sha256: fileHash,
        text_sha256: textHash,
        page_map: {
          contract_version_id: 'version-2',
          source_hash: fileHash,
          source_text_hash: textHash,
        },
        recovery_action: null,
      },
    })
    expect(contract.contract_versions).toHaveLength(3)
    expect(contract.review_runs).toEqual([
      expect.objectContaining({ id: 'review-2', contract_version_id: 'version-2' }),
      expect.objectContaining({ id: 'review-1', contract_version_id: 'version-1' }),
    ])
    expect(contract.contract_versions[1]).toMatchObject({
      id: 'version-2',
      source: 'manual_revision',
      storage_path: 'org-1/contract-1/current.docx',
      ingest_status: 'SOURCE_READY',
      ingest_error: null,
      file_sha256: fileHash,
      text_sha256: textHash,
      review_id: 'review-2',
    })
    expect(contract.contract_comparisons).toEqual([
      expect.objectContaining({ id: 'comparison-1', contract_id: 'contract-1' }),
    ])
    expect(contract).not.toHaveProperty('org_id')
    expect(contract).not.toHaveProperty('created_by')
  })

  it('returns both v1 history and current v2 review identity instead of collapsing to overall latest', async () => {
    const v1FileHash = '1'.repeat(64)
    const v1TextHash = 'a'.repeat(64)
    const v2FileHash = '2'.repeat(64)
    const v2TextHash = 'b'.repeat(64)
    installGetDatabase({
      contracts: [{
        id: 'contract-1',
        org_id: 'org-1',
        created_by: 'user-1',
        filename: '双版本合同.docx',
        status: 'COMPLETED',
        contract_no: null,
        quote_id: null,
        party_b_name: null,
        created_at: '2026-07-21T01:00:00.000Z',
        updated_at: '2026-07-21T04:00:00.000Z',
        storage_path: 'contracts/a/v2.docx',
        current_version_id: 'version-2',
        contract_versions: [{
          id: 'version-1',
          contract_id: 'contract-1',
          version_number: 1,
          source: 'original',
          storage_path: 'contracts/a/v1.docx',
          ingest_status: 'SOURCE_READY',
          ingest_error: null,
          file_sha256: v1FileHash,
          text_sha256: v1TextHash,
          review_id: 'review-v1-newer',
          created_at: '2026-07-21T01:00:00.000Z',
        }, {
          id: 'version-2',
          contract_id: 'contract-1',
          version_number: 2,
          source: 'manual_revision',
          storage_path: 'contracts/a/v2.docx',
          ingest_status: 'SOURCE_READY',
          ingest_error: null,
          file_sha256: v2FileHash,
          text_sha256: v2TextHash,
          review_id: 'review-v2-older',
          created_at: '2026-07-21T02:00:00.000Z',
        }],
      }],
      reviews: [{
        id: 'review-v1-newer',
        contract_id: 'contract-1',
        contract_version_id: 'version-1',
        status: 'COMPLETED',
        review_trigger: 'manual_rerun',
        source_storage_path: 'contracts/a/v1.docx',
        source_hash: v1FileHash,
        source_text_hash: v1TextHash,
        started_at: '2026-07-21T03:00:00.000Z',
        completed_at: '2026-07-21T03:02:00.000Z',
        created_at: '2026-07-21T03:00:00.000Z',
      }, {
        id: 'review-v2-older',
        contract_id: 'contract-1',
        contract_version_id: 'version-2',
        status: 'COMPLETED',
        review_trigger: 'initial_upload',
        source_storage_path: 'contracts/a/v2.docx',
        source_hash: v2FileHash,
        source_text_hash: v2TextHash,
        started_at: '2026-07-21T02:10:00.000Z',
        completed_at: '2026-07-21T02:12:00.000Z',
        created_at: '2026-07-21T02:10:00.000Z',
      }],
      pageMaps: [{
        contract_id: 'contract-1',
        contract_version_id: 'version-2',
        storage_path: 'contracts/a/v2.docx',
        source_hash: v2FileHash,
        source_text_hash: v2TextHash,
        render_mode: 'browser-ooxml',
        locator: 'rendered',
        page_count: 1,
        generated_at: '2026-07-21T02:01:00.000Z',
      }],
    })

    const res = await GET(makeGetRequest())
    const contract = (await res.json()).data.data[0]

    expect(contract.latest_review.id).toBe('review-v1-newer')
    expect(contract.review_runs).toEqual([
      expect.objectContaining({ id: 'review-v1-newer', contract_version_id: 'version-1' }),
      expect.objectContaining({ id: 'review-v2-older', contract_version_id: 'version-2' }),
    ])
  })

  it('does not call a ReviewRun matched when its source hashes are missing', async () => {
    installGetDatabase({
      contracts: [{
        id: 'contract-1',
        org_id: 'org-1',
        created_by: 'user-1',
        filename: '待核对合同.docx',
        status: 'COMPLETED',
        contract_no: null,
        quote_id: null,
        party_b_name: null,
        created_at: '2026-07-21T01:00:00.000Z',
        updated_at: '2026-07-21T01:00:00.000Z',
        storage_path: 'org-1/contract-1/source',
        current_version_id: 'version-1',
        contract_versions: [{
          id: 'version-1',
          contract_id: 'contract-1',
          version_number: 1,
          source: 'original',
          storage_path: 'org-1/contract-1/source',
          ingest_status: 'SOURCE_READY',
          ingest_error: null,
          file_sha256: null,
          text_sha256: null,
          review_id: 'review-1',
          created_at: '2026-07-21T01:00:00.000Z',
        }],
      }],
      reviews: [{
        id: 'review-1',
        contract_id: 'contract-1',
        contract_version_id: 'version-1',
        status: 'COMPLETED',
        review_trigger: 'initial_upload',
        source_storage_path: 'org-1/contract-1/source',
        source_hash: null,
        source_text_hash: null,
        started_at: '2026-07-21T01:01:00.000Z',
        completed_at: '2026-07-21T01:02:00.000Z',
        created_at: '2026-07-21T01:01:00.000Z',
      }],
    })

    const res = await GET(makeGetRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.data[0].latest_review.source_binding).toBe('unresolved')
  })

  it('returns legacy DOC as waiting for conversion instead of generic preparation', async () => {
    installGetDatabase({
      contracts: [{
        id: 'contract-doc',
        org_id: 'org-1',
        created_by: 'user-1',
        filename: '旧版合同.doc',
        status: 'DRAFT',
        contract_no: null,
        quote_id: null,
        party_b_name: null,
        created_at: '2026-07-21T01:00:00.000Z',
        updated_at: '2026-07-21T01:00:00.000Z',
        storage_path: 'org-1/contract-doc/source.doc',
        current_version_id: 'version-doc',
        contract_versions: [{
          id: 'version-doc',
          contract_id: 'contract-doc',
          version_number: 1,
          source: 'original',
          storage_path: 'org-1/contract-doc/source.doc',
          ingest_status: 'AWAITING_CONVERSION',
          ingest_error: null,
          file_sha256: 'a'.repeat(64),
          text_sha256: null,
          review_id: null,
          created_at: '2026-07-21T01:00:00.000Z',
        }],
      }],
    })

    const res = await GET(makeGetRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.data[0].source_identity).toMatchObject({
      state: 'waiting_conversion',
      ready: false,
      can_start_review: false,
      source_version_id: 'version-doc',
      failure_reason: expect.stringContaining('转换为 DOCX'),
      recovery_action: {
        label: '补传 DOCX',
        href: '/contracts/contract-doc/edit?intent=source-replacement',
      },
    })
  })

  it('Service Role 查询异常返回跨组织行时仍不会泄漏合同、版本、审核、页映射或对比', async () => {
    const fileHash = 'e'.repeat(64)
    const textHash = 'f'.repeat(64)
    const queries = installGetDatabase({
      contracts: [
        {
          id: 'contract-visible',
          org_id: 'org-1',
          created_by: 'user-1',
          filename: '本组织合同.pdf',
          status: 'PENDING',
          contract_no: 'HT-ORG-1',
          quote_id: null,
          party_b_name: null,
          created_at: '2026-07-21T01:00:00.000Z',
          updated_at: '2026-07-21T01:00:00.000Z',
          storage_path: 'org-1/visible.pdf',
          current_version_id: 'version-visible',
          contract_versions: [
            {
              id: 'version-visible',
              contract_id: 'contract-visible',
              version_number: 1,
              source: 'original',
              storage_path: 'org-1/visible.pdf',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: fileHash,
              text_sha256: textHash,
              review_id: null,
              created_at: '2026-07-21T01:00:00.000Z',
            },
            {
              id: 'version-hidden',
              contract_id: 'contract-hidden',
              version_number: 99,
              source: 'original',
              storage_path: 'org-2/hidden.pdf',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: '1'.repeat(64),
              text_sha256: '2'.repeat(64),
              review_id: 'review-hidden',
              created_at: '2026-07-21T09:00:00.000Z',
            },
          ],
        },
        {
          id: 'contract-hidden',
          org_id: 'org-2',
          created_by: 'user-2',
          filename: '其他组织合同.pdf',
          status: 'COMPLETED',
          contract_no: 'HT-ORG-2',
          quote_id: null,
          party_b_name: '不应出现',
          created_at: '2026-07-21T09:00:00.000Z',
          updated_at: '2026-07-21T09:00:00.000Z',
          storage_path: 'org-2/hidden.pdf',
          current_version_id: 'version-hidden',
          contract_versions: [],
        },
      ],
      reviews: [
        {
          id: 'review-visible',
          contract_id: 'contract-visible',
          contract_version_id: 'version-visible',
          status: 'PARSING',
          review_trigger: 'initial_upload',
          source_storage_path: 'org-1/visible.pdf',
          source_hash: fileHash,
          source_text_hash: textHash,
          started_at: '2026-07-21T01:01:00.000Z',
          completed_at: null,
          created_at: '2026-07-21T01:01:00.000Z',
        },
        {
          id: 'review-hidden',
          contract_id: 'contract-hidden',
          contract_version_id: 'version-hidden',
          status: 'COMPLETED',
          review_trigger: 'initial_upload',
          source_storage_path: 'org-2/hidden.pdf',
          source_hash: '1'.repeat(64),
          source_text_hash: '2'.repeat(64),
          started_at: '2026-07-21T09:01:00.000Z',
          completed_at: '2026-07-21T09:02:00.000Z',
          created_at: '2026-07-21T09:01:00.000Z',
        },
      ],
      pageMaps: [
        {
          contract_id: 'contract-visible',
          contract_version_id: 'version-visible',
          storage_path: 'org-1/visible.pdf',
          source_hash: fileHash,
          source_text_hash: textHash,
          render_mode: 'native-pdf',
          locator: 'provisional',
          page_count: 1,
          generated_at: '2026-07-21T01:00:30.000Z',
        },
        {
          contract_id: 'contract-hidden',
          contract_version_id: 'version-hidden',
          storage_path: 'org-2/hidden.pdf',
          source_hash: '1'.repeat(64),
          source_text_hash: '2'.repeat(64),
          render_mode: 'native-pdf',
          locator: 'provisional',
          page_count: 1,
          generated_at: '2026-07-21T09:00:30.000Z',
        },
      ],
      comparisons: [
        { id: 'comparison-hidden', contract_id: 'contract-hidden', status: 'completed' },
      ],
    })

    const res = await GET(makeGetRequest())
    const body = await res.json()

    expect(body.data.data).toHaveLength(1)
    expect(body.data.data[0].id).toBe('contract-visible')
    expect(body.data.data[0].contract_versions.map((version: any) => version.id)).toEqual([
      'version-visible',
    ])
    expect(body.data.data[0].latest_review.id).toBe('review-visible')
    expect(body.data.data[0].contract_comparisons).toEqual([])
    expect(JSON.stringify(body)).not.toContain('contract-hidden')
    expect(JSON.stringify(body)).not.toContain('org-2')
    expect(queries.contract_reviews.in).toHaveBeenCalledWith('contract_id', ['contract-visible'])
  })

  it('同组织非授权创建人的合同及嵌套证据不进入列表、计数或分页', async () => {
    const visibleHash = '3'.repeat(64)
    const visibleTextHash = '4'.repeat(64)
    const queries = installGetDatabase({
      contracts: [
        {
          id: 'contract-visible',
          org_id: 'org-1',
          created_by: 'user-1',
          filename: '可访问合同.docx',
          status: 'COMPLETED',
          contract_no: 'HT-VISIBLE',
          quote_id: null,
          party_b_name: '可访问客户',
          created_at: '2026-07-21T01:00:00.000Z',
          updated_at: '2026-07-21T01:05:00.000Z',
          storage_path: 'org-1/contract-visible/source.docx',
          current_version_id: 'version-visible',
          contract_versions: [
            {
              id: 'version-visible',
              contract_id: 'contract-visible',
              version_number: 1,
              source: 'original',
              storage_path: 'org-1/contract-visible/source.docx',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: visibleHash,
              text_sha256: visibleTextHash,
              review_id: 'review-visible',
              created_at: '2026-07-21T01:00:00.000Z',
            },
            {
              id: 'version-hidden-embedded',
              contract_id: 'contract-hidden-same-org',
              version_number: 99,
              source: 'original',
              storage_path: 'org-1/contract-hidden/source.pdf',
              ingest_status: 'SOURCE_READY',
              ingest_error: null,
              file_sha256: '5'.repeat(64),
              text_sha256: '6'.repeat(64),
              review_id: 'review-hidden',
              created_at: '2026-07-21T02:00:00.000Z',
            },
          ],
        },
        {
          id: 'contract-hidden-same-org',
          org_id: 'org-1',
          created_by: 'user-2',
          filename: '同组织但无权合同.pdf',
          status: 'COMPLETED',
          contract_no: 'HT-HIDDEN',
          quote_id: null,
          party_b_name: '不应出现',
          created_at: '2026-07-21T02:00:00.000Z',
          updated_at: '2026-07-21T02:05:00.000Z',
          storage_path: 'org-1/contract-hidden/source.pdf',
          current_version_id: 'version-hidden',
          contract_versions: [],
        },
      ],
      reviews: [
        {
          id: 'review-visible',
          contract_id: 'contract-visible',
          contract_version_id: 'version-visible',
          status: 'COMPLETED',
          review_trigger: 'initial_upload',
          source_storage_path: 'org-1/contract-visible/source.docx',
          source_hash: visibleHash,
          source_text_hash: visibleTextHash,
          started_at: '2026-07-21T01:01:00.000Z',
          completed_at: '2026-07-21T01:04:00.000Z',
          created_at: '2026-07-21T01:01:00.000Z',
        },
        {
          id: 'review-hidden',
          contract_id: 'contract-hidden-same-org',
          contract_version_id: 'version-hidden',
          status: 'COMPLETED',
          review_trigger: 'initial_upload',
          source_storage_path: 'org-1/contract-hidden/source.pdf',
          source_hash: '5'.repeat(64),
          source_text_hash: '6'.repeat(64),
          started_at: '2026-07-21T02:01:00.000Z',
          completed_at: '2026-07-21T02:04:00.000Z',
          created_at: '2026-07-21T02:01:00.000Z',
        },
      ],
      pageMaps: [
        {
          contract_id: 'contract-visible',
          contract_version_id: 'version-visible',
          storage_path: 'org-1/contract-visible/source.docx',
          source_hash: visibleHash,
          source_text_hash: visibleTextHash,
          render_mode: 'browser-ooxml',
          locator: 'rendered',
          page_count: 1,
          generated_at: '2026-07-21T01:00:30.000Z',
        },
        {
          contract_id: 'contract-hidden-same-org',
          contract_version_id: 'version-hidden',
          storage_path: 'org-1/contract-hidden/source.pdf',
          source_hash: '5'.repeat(64),
          source_text_hash: '6'.repeat(64),
          render_mode: 'native-pdf',
          locator: 'rendered',
          page_count: 9,
          generated_at: '2026-07-21T02:00:30.000Z',
        },
      ],
      comparisons: [
        {
          id: 'comparison-visible',
          contract_id: 'contract-visible',
          status: 'completed',
        },
        {
          id: 'comparison-hidden',
          contract_id: 'contract-hidden-same-org',
          status: 'completed',
          ai_summary: '不应泄露的对比摘要',
        },
      ],
      // Simulate a service-role query/test double returning an out-of-scope row
      // and an untrusted count despite the created_by filter.
      count: 2,
    })

    const res = await GET(makeGetRequest('?includeTotal=1&page=1&pageSize=20'))
    const body = await res.json()
    const serialized = JSON.stringify(body)

    expect(res.status).toBe(200)
    expect(queries.contracts.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(queries.contracts.in).toHaveBeenCalledWith('created_by', ['user-1'])
    expect(queries.contracts.range).toHaveBeenCalledWith(0, 19)
    expect(body.data.data).toHaveLength(1)
    expect(body.data.data[0].id).toBe('contract-visible')
    expect(body.data.data[0].contract_versions.map((version: any) => version.id)).toEqual([
      'version-visible',
    ])
    expect(body.data.data[0].latest_review.id).toBe('review-visible')
    expect(body.data.data[0].contract_comparisons).toEqual([
      expect.objectContaining({ id: 'comparison-visible' }),
    ])
    expect(body.data.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    })
    expect(queries.contract_reviews.in).toHaveBeenCalledWith('contract_id', ['contract-visible'])
    expect(queries.contract_source_page_maps.in).toHaveBeenCalledWith(
      'contract_id',
      ['contract-visible']
    )
    expect(queries.contract_comparisons.in).toHaveBeenCalledWith(
      'contract_id',
      ['contract-visible']
    )
    expect(serialized).not.toContain('contract-hidden-same-org')
    expect(serialized).not.toContain('review-hidden')
    expect(serialized).not.toContain('version-hidden')
    expect(serialized).not.toContain('comparison-hidden')
    expect(serialized).not.toContain('不应泄露')

    const cursorRes = await GET(makeGetRequest('?page=1&pageSize=1'))
    const cursorBody = await cursorRes.json()

    expect(cursorRes.status).toBe(200)
    expect(queries.contracts.range).toHaveBeenCalledWith(0, 1)
    expect(cursorBody.data.data.map((contract: any) => contract.id)).toEqual([
      'contract-visible',
    ])
    expect(cursorBody.data.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    })
    expect(JSON.stringify(cursorBody)).not.toContain('contract-hidden-same-org')
  })
})
