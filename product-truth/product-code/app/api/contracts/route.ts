// GET /api/contracts - 合同列表（支持分页和搜索）
export const preferredRegion = 'sin1'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
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
      .select('id, filename, status, created_at, updated_at', includeTotal ? { count: 'exact' } : undefined)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, rangeEnd)

    if (search.trim()) {
      query = query.or(`filename.ilike.%${search}%,parsed_text.ilike.%${search}%`)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data: contracts, error, count } = await query

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取合同列表失败'))
    }

    const rows = contracts || []
    const visibleRows = includeTotal ? rows : rows.slice(0, safePageSize)
    const hasNext = includeTotal
      ? safePage < Math.ceil((count || 0) / safePageSize)
      : rows.length > safePageSize
    const total = includeTotal
      ? (count || 0)
      : offset + visibleRows.length + (hasNext ? 1 : 0)
    const totalPages = includeTotal
      ? Math.ceil(total / safePageSize)
      : safePage + (hasNext ? 1 : 0)

    return successResponse({
      data: visibleRows,
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

// 请求体验证
const createContractSchema = z.object({
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
interface QuoteItem {
  id: string
  name: string
  specification: string | null
  quantity: number
  unit: string
  unit_price: number
  line_total: number
  sort_order: number
}

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
  quote_items: QuoteItem[] | null
}

interface ContractItemInput {
  quote_item_id: string
  name: string
  specification: string | null
  quantity: number
  unit: string
  unit_price: number
  line_total: number
  sort_order: number
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
    return req.json()
  }

  const formData = await req.formData()
  return {
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
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
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

    const { quote_id, include_quote_items, ...contractData } = parsed.data

    let quoteData: QuoteData | null = null
    let contractAmount = contractData.contract_amount
    let contractItems: ContractItemInput[] = []

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
          status,
          quote_items (
            id, name, specification, quantity, unit, unit_price, line_total, sort_order
          )
        `
        )
        .eq('id', quote_id)
        .eq('org_id', orgId)
        .single()

      if (quoteError || !quote) {
        return errorResponse(createApiError('NOT_FOUND', '引用的报价不存在或无权访问'))
      }

      if (quote.status !== 'CONFIRMED') {
        return errorResponse(
          createApiError(
            'QUOTE_NOT_CONFIRMED',
            `报价 ${quote.quote_no} 状态为 ${quote.status}，需要已确认才能引用`
          )
        )
      }

      quoteData = quote as QuoteData

      if (!contractAmount) contractAmount = quote.total_amount
      if (!contractData.tax_amount) contractData.tax_amount = quote.tax_amount
      if (!contractData.party_b_contact) contractData.party_b_contact = quote.customer_contact

      if (include_quote_items && quote.quote_items) {
        contractItems = (quote.quote_items as QuoteItem[]).map((item) => ({
          quote_item_id: item.id,
          name: item.name,
          specification: item.specification,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          line_total: item.line_total,
          sort_order: item.sort_order,
        }))
      }
    }

    // 生成合同编号
    const contractNo = contractData.contract_no || (await generateContractNo())

    // 检查编号唯一性
    const { data: existingNo } = await supabaseAdmin
      .from('contracts')
      .select('id')
      .eq('contract_no', contractNo)
      .eq('org_id', orgId)
      .maybeSingle()

    if (existingNo) {
      return errorResponse(
        createApiError('DUPLICATE_KEY', `合同编号 ${contractNo} 已存在`)
      )
    }

    // 创建合同
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .insert({
        contract_no: contractNo,
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
        filename: '',
        storage_path: '',
        size: 0,
        mime_type: 'application/octet-stream',
        status: 'DRAFT',
        created_by: user.id,
        org_id: orgId,
      })
      .select()
      .single()

    if (contractError || !contract) {
      await logError({
        message: '合同创建失败',
        error: contractError,
        context: { user_id: user.id },
      })
      return errorResponse(createApiError('CONTRACT_CREATE_FAILED'))
    }

    // 创建合同标的
    if (contractItems.length > 0) {
      const itemsToInsert = contractItems.map((item) => ({
        contract_id: contract.id,
        ...item,
      }))

      const { error: itemsError } = await supabaseAdmin
        .from('contract_items')
        .insert(itemsToInsert)

      if (itemsError) {
        await logError({
          source: 'api',
          message: itemsError.message,
          context: { contract_id: contract.id },
        })
      }
    }

    // 返回结果
    return createdResponse({
      contract_id: contract.id,
      contract_no: contract.contract_no,
      status: contract.status,
      party_b_name: contract.party_b_name,
      contract_amount: contract.contract_amount,
      quote_ref: quoteData
        ? {
            quote_id: quoteData.id,
            quote_no: quoteData.quote_no,
            item_count: contractItems.length,
          }
        : null,
      message: '合同草稿已创建',
      next_steps: ['上传合同文件', '编辑合同条款', '提交审核'],
      edit_url: `/contracts/${contract.id}/edit`,
    })
  })
}

// 生成合同编号：CT-YYYYMMDD-XXX
async function generateContractNo(): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')

  const { data: maxContract } = await supabaseAdmin
    .from('contracts')
    .select('contract_no')
    .ilike('contract_no', `CT-${dateStr}-%`)
    .order('contract_no', { ascending: false })
    .limit(1)
    .single()

  let seq = 1
  if (maxContract?.contract_no) {
    const match = maxContract.contract_no.match(/-(\d{3})$/)
    if (match) {
      seq = parseInt(match[1], 10) + 1
    }
  }

  return `CT-${dateStr}-${seq.toString().padStart(3, '0')}`
}
