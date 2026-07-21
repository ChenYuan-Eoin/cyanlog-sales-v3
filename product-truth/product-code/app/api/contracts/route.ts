import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import { logError } from '@/lib/error-log'
import {
  errorResponse,
  successResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { resolveReviewRunSourceVersion } from '@/lib/contracts/review-source-identity'
import { deriveContractSourceReadiness } from '@/lib/contracts/contract-source-readiness'

type ContractVersionRow = {
  id: string
  contract_id: string
  version_number: number | null
  source: string | null
  storage_path: string | null
  ingest_status: string | null
  ingest_error: string | null
  file_sha256: string | null
  text_sha256: string | null
  review_id: string | null
  created_at: string | null
}

type ContractListRow = {
  id: string
  org_id: string
  created_by: string | null
  filename: string | null
  status: string | null
  contract_no: string | null
  quote_id: string | null
  party_b_name: string | null
  created_at: string | null
  updated_at: string | null
  storage_path: string | null
  current_version_id: string | null
  contract_versions: ContractVersionRow[] | null
}

type ContractReviewRow = {
  id: string
  contract_id: string
  contract_version_id: string | null
  status: string | null
  review_trigger: string | null
  source_storage_path: string | null
  source_hash: string | null
  source_text_hash: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string | null
}

type ContractPageMapRow = {
  contract_id: string
  contract_version_id: string | null
  storage_path: string
  source_hash: string
  source_text_hash: string | null
  render_mode: string
  locator: string
  page_count: number
  generated_at: string
}

type ContractComparisonRow = {
  id: string
  contract_id: string | null
  baseline_type: string | null
  baseline_doc_id: string | null
  compare_doc_id: string | null
  status: string | null
  ai_summary: string | null
  created_at: string | null
  completed_at: string | null
  comparison_diffs: Array<{ id?: string | null; risk_level?: string | null }> | null
}

const OUTPUT_VERSION_SOURCES = new Set(['review_revision'])

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

function newestReviewFirst(left: ContractReviewRow, right: ContractReviewRow) {
  const timeDifference = timestamp(right.created_at) - timestamp(left.created_at)
  if (timeDifference !== 0) return timeDifference
  return right.id.localeCompare(left.id)
}

function isSourceVersion(version: ContractVersionRow) {
  return !OUTPUT_VERSION_SOURCES.has((version.source || '').trim().toLowerCase())
}

function reviewSummariesFor(contractId: string, versions: ContractVersionRow[], reviews: ContractReviewRow[]) {
  const sourceVersions = versions.filter(isSourceVersion)
  const outputVersions = versions.filter((version) => !isSourceVersion(version))
  return reviews
    .filter((candidate) => candidate.contract_id === contractId)
    .sort(newestReviewFirst)
    .map((review) => {
      const sourceVersion = resolveReviewRunSourceVersion(review, sourceVersions)
      const outputVersion = resolveReviewRunSourceVersion(review, outputVersions)
      return {
        ...review,
        source_binding: sourceVersion
          ? 'matched_source_version' as const
          : outputVersion
            ? 'points_to_output_version' as const
            : 'unresolved' as const,
      }
    })
}

// GET /api/contracts - 合同列表（支持分页和搜索）
export const preferredRegion = 'sin1'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    // The admin client bypasses RLS. Resolve the current organization and the
    // creator IDs visible through the user's org/department/space scopes before
    // constructing the list query, rather than treating an organization as one
    // shared visibility boundary.
    const {
      orgId,
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'view')) {
      return errorResponse(createApiError('FORBIDDEN', '没有查看合同的权限'))
    }
    const accessibleUserIdSet = new Set(accessibleUserIds)
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const includeTotal = searchParams.get('includeTotal') === '1'

    // 验证分页参数
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(100, Math.max(1, pageSize))
    const offset = (safePage - 1) * safePageSize
    const rangeEnd = includeTotal ? offset + safePageSize - 1 : offset + safePageSize

    // 构建查询
    let query = supabaseAdmin
      .from('contracts')
      .select(
        `
          id,
          org_id,
          created_by,
          filename,
          status,
          contract_no,
          quote_id,
          party_b_name,
          created_at,
          updated_at,
          storage_path,
          current_version_id,
          contract_versions!contract_versions_contract_id_fkey(
            id,
            contract_id,
            version_number,
            source,
            storage_path,
            ingest_status,
            ingest_error,
            file_sha256,
            text_sha256,
            review_id,
            created_at
          )
        `,
        includeTotal ? { count: 'exact' } : undefined
      )
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .order('created_at', { ascending: false })

    if (search.trim()) {
      query = query.or(`filename.ilike.%${search}%,parsed_text.ilike.%${search}%`)
    }

    if (status) {
      query = query.eq('status', status)
    }

    // Apply every authorization and business filter before range/count so the
    // list, total and page boundaries describe the same accessible dataset.
    query = query.range(offset, rangeEnd)

    const { data: contracts, error, count } = await query

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取合同列表失败'))
    }

    const rows = (contracts || []) as ContractListRow[]
    // Defense in depth for the service-role client: even if a future query
    // refactor, PostgREST embedding, or test double violates the SQL filters,
    // neither an out-of-org nor an out-of-scope creator can reach the response
    // or seed any nested evidence query.
    const scopedRows = rows.filter((contract) => (
      contract.org_id === orgId
      && typeof contract.created_by === 'string'
      && accessibleUserIdSet.has(contract.created_by)
    ))
    const droppedOutOfScopeRows = scopedRows.length !== rows.length
    const visibleRows = includeTotal ? scopedRows : scopedRows.slice(0, safePageSize)
    const visibleContractIds = visibleRows.map((contract) => contract.id).filter(Boolean)
    const visibleContractIdSet = new Set(visibleContractIds)

    const reviewByContract = new Map<string, ContractReviewRow[]>()
    const pageMapByContract = new Map<string, ContractPageMapRow[]>()
    const comparisonByContract = new Map<string, ContractComparisonRow[]>()
    if (visibleContractIds.length > 0) {
      const [reviewsResult, pageMapsResult, comparisonsResult] = await Promise.all([
        supabaseAdmin
          .from('contract_reviews')
          .select(`
            id,
            contract_id,
            contract_version_id,
            status,
            review_trigger,
            source_storage_path,
            source_hash,
            source_text_hash,
            started_at,
            completed_at,
            created_at
          `)
          .in('contract_id', visibleContractIds)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
        supabaseAdmin
          .from('contract_source_page_maps')
          .select(`
            contract_id,
            contract_version_id,
            storage_path,
            source_hash,
            source_text_hash,
            render_mode,
            locator,
            page_count,
            generated_at
          `)
          .in('contract_id', visibleContractIds),
        supabaseAdmin
          .from('contract_comparisons')
          .select(`
            id,
            contract_id,
            baseline_type,
            baseline_doc_id,
            compare_doc_id,
            status,
            ai_summary,
            created_at,
            completed_at,
            comparison_diffs(id, risk_level)
          `)
          .in('contract_id', visibleContractIds)
          .order('created_at', { ascending: false }),
      ])

      if (reviewsResult.error || pageMapsResult.error || comparisonsResult.error) {
        return errorResponse(createApiError('DB_ERROR', '获取合同任务身份失败'))
      }

      for (const review of (reviewsResult.data || []) as ContractReviewRow[]) {
        if (!visibleContractIdSet.has(review.contract_id)) continue
        const bucket = reviewByContract.get(review.contract_id) || []
        bucket.push(review)
        reviewByContract.set(review.contract_id, bucket)
      }

      for (const pageMap of (pageMapsResult.data || []) as ContractPageMapRow[]) {
        if (!visibleContractIdSet.has(pageMap.contract_id)) continue
        const bucket = pageMapByContract.get(pageMap.contract_id) || []
        bucket.push(pageMap)
        pageMapByContract.set(pageMap.contract_id, bucket)
      }

      for (const comparison of (comparisonsResult.data || []) as ContractComparisonRow[]) {
        const contractId = typeof comparison.contract_id === 'string' ? comparison.contract_id : ''
        if (!visibleContractIdSet.has(contractId)) continue
        const bucket = comparisonByContract.get(contractId) || []
        bucket.push(comparison)
        comparisonByContract.set(contractId, bucket)
      }
    }

    const visibleRowsWithTaskIdentity = visibleRows.map((contract) => {
      const versions = (contract.contract_versions || []).filter(
        (version) => version.contract_id === contract.id
      )
      const {
        org_id: _contractOrgId,
        created_by: _createdBy,
        contract_versions: _versions,
        ...safeContract
      } = contract
      const reviewRuns = reviewSummariesFor(
        contract.id,
        versions,
        reviewByContract.get(contract.id) || []
      )
      return {
        ...safeContract,
        contract_versions: versions,
        latest_review: reviewRuns[0] || null,
        review_runs: reviewRuns,
        source_identity: deriveContractSourceReadiness({
          contractId: contract.id,
          contractStoragePath: contract.storage_path,
          currentVersionId: contract.current_version_id,
          versions,
          pageMaps: pageMapByContract.get(contract.id) || [],
        }),
        contract_comparisons: comparisonByContract.get(contract.id) || [],
      }
    })
    // The database count is exact for the scoped query. If defensive filtering
    // ever had to reject a row, do not expose the untrusted count or infer a
    // next page from inaccessible records.
    const trustedCount = includeTotal && !droppedOutOfScopeRows
      ? Math.max(0, count || 0)
      : null
    const hasNext = includeTotal
      ? trustedCount !== null && safePage < Math.ceil(trustedCount / safePageSize)
      : scopedRows.length > safePageSize
    const total = includeTotal
      ? (trustedCount ?? offset + visibleRows.length)
      : offset + visibleRows.length + (hasNext ? 1 : 0)
    const totalPages = includeTotal
      ? Math.ceil(total / safePageSize)
      : safePage + (hasNext ? 1 : 0)

    return successResponse({
      data: visibleRowsWithTaskIdentity,
      meta: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages,
        hasNext,
        hasPrev: safePage > 1,
      },
    })
  })
}

// POST /api/contracts - 创建合同草稿
// 支持可选的 quote_id 参数，在创建时带入报价数据作为合同的一个章节

// 请求体验证
const createContractSchema = z.object({
  client_request_id: z.string().uuid().optional(),
  contract_no: z.string().optional(),
  party_a_name: z.string().optional(),
  party_b_name: z.string().min(1, '乙方名称不能为空').optional(),
  party_b_contact: z.string().optional(),
  contract_date: z.string().date().optional(),
  effective_date: z.string().date().optional(),
  expiry_date: z.string().date().optional(),
  contract_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
  payment_terms: z.string().optional(),
  delivery_terms: z.string().optional(),
  quote_id: z.string().uuid().optional(),
  include_quote_items: z.boolean().default(true),
  notes: z.string().optional(),
})

// 类型定义
interface QuoteData {
  id: string
  quote_no: string
  customer_name: string
  customer_contact: string | null
  total_amount: number
  tax_amount: number
  subtotal: number
  payment_terms: string | null
  valid_until: string | null
  status: string
}

type CreatedContractRecord = {
  id: string
  contract_no: string | null
  status: string | null
  party_b_name: string | null
  contract_amount: number | null
}

type ContractAggregateCreationRecord = {
  contract_id: string
  contract_no: string | null
  status: string | null
  party_b_name: string | null
  contract_amount: number | null
  recovered: boolean
  item_count: number
}

function contractCreateResponse(
  contract: CreatedContractRecord,
  options: {
    recovered: boolean
    quoteData?: QuoteData | null
    itemCount?: number
  }
) {
  const quoteData = options.quoteData || null
  return createdResponse({
    contract_id: contract.id,
    contract_no: contract.contract_no,
    status: contract.status,
    party_b_name: contract.party_b_name,
    contract_amount: contract.contract_amount,
    recovered: options.recovered,
    quote_ref: quoteData
      ? {
          quote_id: quoteData.id,
          quote_no: quoteData.quote_no,
          item_count: options.itemCount || 0,
        }
      : null,
    message: options.recovered ? '已恢复同一次合同创建' : '合同草稿已创建',
    next_steps: ['上传合同文件', '编辑合同条款', '提交审核'],
    edit_url: `/contracts/${contract.id}/edit`,
  })
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === '') {
    return undefined
  }
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

async function parseCreateContractPayload(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return req.json().catch(() => null)
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) return null

  return {
    client_request_id: optionalString(formData.get('client_request_id')),
    contract_no: optionalString(formData.get('contract_no')),
    party_a_name: optionalString(formData.get('party_a_name')),
    party_b_name: optionalString(formData.get('party_b_name')),
    party_b_contact: optionalString(formData.get('party_b_contact')),
    contract_date: optionalString(formData.get('contract_date')),
    effective_date: optionalString(formData.get('effective_date')),
    expiry_date: optionalString(formData.get('expiry_date')),
    contract_amount: optionalNumber(formData.get('contract_amount')),
    tax_amount: optionalNumber(formData.get('tax_amount')),
    payment_terms: optionalString(formData.get('payment_terms')),
    delivery_terms: optionalString(formData.get('delivery_terms')),
    quote_id: optionalString(formData.get('quote_id')),
    include_quote_items: formData.get('include_quote_items') !== 'false',
    notes: optionalString(formData.get('notes')),
  }
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    const body = await parseCreateContractPayload(req)
    const parsed = createContractSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          `参数验证失败: ${parsed.error.issues.map((e) => e.message).join(', ')}`
        )
      )
    }

    const { orgId, assignments } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'create_or_upload')) {
      return errorResponse(createApiError('FORBIDDEN', '没有创建或上传合同的权限'))
    }

    const { client_request_id, quote_id, include_quote_items, ...contractData } = parsed.data

    let quoteData: QuoteData | null = null
    let contractAmount = contractData.contract_amount

    // 查询报价数据
    if (quote_id) {
      const { data: quote, error: quoteError } = await supabaseAdmin
        .from('quotes')
        .select(
          `
          id,
          quote_no,
          customer_name,
          customer_contact,
          total_amount,
          tax_amount,
          subtotal,
          payment_terms,
          valid_until,
          status
        `
        )
        .eq('id', quote_id)
        .eq('org_id', orgId)
        .single()

      if (quoteError || !quote) {
        return errorResponse(createApiError('NOT_FOUND', '引用的报价不存在或无权访问'))
      }

      quoteData = quote as QuoteData

      if (!contractAmount) contractAmount = quote.total_amount
      if (!contractData.tax_amount) contractData.tax_amount = quote.tax_amount
      if (!contractData.party_b_contact) contractData.party_b_contact = quote.customer_contact
    }

    // An explicit business number is preserved. Automatic numbering stays
    // null here and is allocated under the aggregate RPC transaction lock.
    const requestedContractNo = contractData.contract_no || null

    // Contract head and copied quote items are one database aggregate. The RPC
    // serializes the request identity, repairs a legacy partial aggregate on
    // replay and rolls the head back when any item cannot be persisted.
    const { data: creationRows, error: creationError } = await supabaseAdmin
      .rpc('create_contract_aggregate_idempotent', {
        p_org_id: orgId,
        p_created_by: user.id,
        p_client_request_id: client_request_id || null,
        p_contract: {
          contract_no: requestedContractNo,
          quote_id: quote_id || null,
          party_a_name: contractData.party_a_name || '甲方（从配置读取）',
          party_b_name: contractData.party_b_name || '未命名合同',
          party_b_contact: contractData.party_b_contact || null,
          contract_amount: contractAmount || 0,
          tax_amount: contractData.tax_amount || 0,
          contract_date: contractData.contract_date || null,
          effective_date: contractData.effective_date || null,
          expiry_date: contractData.expiry_date || null,
          payment_terms: contractData.payment_terms || null,
          delivery_terms: contractData.delivery_terms || null,
          notes: contractData.notes || null,
        },
        p_include_quote_items: Boolean(quote_id && include_quote_items),
      })

    const creation = (
      Array.isArray(creationRows) ? creationRows[0] : creationRows
    ) as ContractAggregateCreationRecord | null

    if (creationError || !creation) {
      if (creationError?.code === '23505') {
        return errorResponse(
          createApiError(
            'DUPLICATE_KEY',
            requestedContractNo
              ? `合同编号 ${requestedContractNo} 已存在`
              : '合同编号冲突，请重试'
          )
        )
      }
      if (creationError?.code === '23514') {
        if (creationError.message?.includes('quote is unavailable or no longer confirmed')) {
          return errorResponse(
            createApiError(
              'QUOTE_NOT_CONFIRMED',
              `报价 ${quoteData?.quote_no || ''} 尚未确认或已失效，不能创建合同`
            )
          )
        }
        return errorResponse(
          createApiError(
            'VALIDATION_ERROR',
            '同一创建请求的合同内容已发生变化，请重新创建并使用新的请求标识'
          )
        )
      }

      await logError({
        message: '合同创建失败',
        error: creationError,
        context: {
          user_id: user.id,
          client_request_id: client_request_id || null,
        },
      })
      return errorResponse(createApiError('CONTRACT_CREATE_FAILED'))
    }

    return contractCreateResponse(
      {
        id: creation.contract_id,
        contract_no: creation.contract_no,
        status: creation.status,
        party_b_name: creation.party_b_name,
        contract_amount: creation.contract_amount,
      },
      {
        recovered: creation.recovered,
        quoteData,
        itemCount: creation.item_count,
      }
    )
  })
}
