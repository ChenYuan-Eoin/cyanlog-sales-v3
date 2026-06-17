// GET /api/quotes - 获取报价列表（需登录）
// POST /api/quotes - 创建报价（需登录）

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'
import { paginationSchema, quoteSchema } from '@/lib/validation'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { isSchemaDriftError } from '@/lib/db-compat'
import { calculateQuoteDraft } from '@/lib/pricing/service'
import {
  successResponse,
  errorResponse,
  paginatedResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuth } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import {
  buildLegacyQuoteInsertPayload,
  buildLegacyQuoteItemInsertPayload,
  normalizeQuote,
} from './quote-compat'

// GET - 获取报价列表
export async function GET(req: NextRequest) {
  return withAuth(req, async (user: AuthUser) => {
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)

    const { searchParams } = new URL(req.url)

    // Zod验证分页参数
    const pagination = paginationSchema.safeParse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })

    if (!pagination.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '分页参数无效'))
    }

    const { page, pageSize } = pagination.data
    const status = searchParams.get('status')

    let result = await buildQuoteListQuery(orgId, accessibleUserIds, status, true).range(
      (page - 1) * pageSize,
      page * pageSize - 1
    )

    if (result.error && isSchemaDriftError(result.error)) {
      result = await buildQuoteListQuery(orgId, accessibleUserIds, status, false).range(
        (page - 1) * pageSize,
        page * pageSize - 1
      )
    }

    if (result.error) {
      console.error('Get quotes error:', result.error)
      return errorResponse(createApiError('DB_ERROR'))
    }

    return paginatedResponse(
      (result.data || []).map((quote) => normalizeQuote(quote, orgId)),
      result.count || 0,
      pageSize,
      (page - 1) * pageSize
    )
  })
}

// POST - 创建报价
export async function POST(req: NextRequest) {
  return withAuth(req, async (user: AuthUser) => {
    const body = await req.json()

    // Zod验证
    const result = quoteSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(createApiError('VALIDATION_ERROR', firstError.message))
    }

    const orgId = await getDefaultOrgId(user.id)
    const { customer_name, customer_contact, valid_until, notes, discount_rate, items } = result.data

    // 生成报价单号
    const { data: quoteNoResult, error: seqError } = await supabaseAdmin.rpc('generate_quote_number')

    if (seqError) {
      console.error('Quote number generation failed:', seqError)
      return errorResponse(createApiError('INTERNAL_ERROR', '报价单号生成失败，请重试'))
    }

    const quoteNo = quoteNoResult

    const pricedDraft = await calculateQuoteDraft(orgId, items, discount_rate)
    const quoteId = uuidv4()

    const quotePayload = {
      id: quoteId,
      org_id: orgId,
      quote_no: quoteNo,
      customer_name,
      customer_contact,
      subtotal: pricedDraft.subtotal,
      discount_rate: pricedDraft.discountRate,
      discount_amount: pricedDraft.discountAmount,
      tax_rate: pricedDraft.taxRate,
      tax_amount: pricedDraft.taxAmount,
      total_amount: pricedDraft.totalAmount,
      notes,
      status: 'DRAFT',
      valid_until,
      created_by: user.id,
    }

    let quoteInsertResult = await supabaseAdmin
      .from('quotes')
      .insert(quotePayload)
      .select()
      .single()

    if (quoteInsertResult.error && isSchemaDriftError(quoteInsertResult.error)) {
      quoteInsertResult = await supabaseAdmin
        .from('quotes')
        .insert(
          buildLegacyQuoteInsertPayload({
            id: quoteId,
            quote_no: quoteNo,
            customer_name,
            customer_contact,
            subtotal: pricedDraft.subtotal,
            discount_amount: pricedDraft.discountAmount,
            tax_amount: pricedDraft.taxAmount,
            total_amount: pricedDraft.totalAmount,
            status: 'DRAFT',
            valid_until,
            created_by: user.id,
          })
        )
        .select()
        .single()
    }

    if (quoteInsertResult.error) {
      console.error('Create quote error:', quoteInsertResult.error)
      return errorResponse(createApiError('DB_ERROR', '创建报价失败'))
    }

    const quoteItemPayloads = pricedDraft.items.map((item) => ({
      id: uuidv4(),
      quote_id: quoteId,
      product_id: item.product_id,
      product_type: item.product_type,
      product_code: item.product_code,
      name: item.name,
      specification: item.specification,
      unit: item.unit,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount,
      line_total: item.line_total,
      sort_order: item.sort_order,
      pricing_source: item.pricing_source,
      tier_range: item.tier_range,
    }))

    let itemInsertResult = await supabaseAdmin.from('quote_items').insert(quoteItemPayloads)

    if (itemInsertResult.error && isSchemaDriftError(itemInsertResult.error)) {
      itemInsertResult = await supabaseAdmin
        .from('quote_items')
        .insert(quoteItemPayloads.map((item) => buildLegacyQuoteItemInsertPayload(item)))
    }

    if (itemInsertResult.error) {
      await supabaseAdmin.from('quotes').delete().eq('id', quoteId)
      console.error('Create quote items error:', itemInsertResult.error)
      return errorResponse(createApiError('DB_ERROR', '创建报价明细失败'))
    }

    const quoteForResponse = {
      ...quotePayload,
      ...(quoteInsertResult.data || {}),
    }

    return createdResponse(normalizeQuote(quoteForResponse, orgId, quoteItemPayloads))
  })
}

// 构建报价列表查询
function buildQuoteListQuery(
  orgId: string,
  accessibleUserIds: string[],
  status: string | null,
  includeOrgFilter: boolean
) {
  let query = supabaseAdmin
    .from('quotes')
    .select('*', { count: 'exact' })
    .in('created_by', accessibleUserIds)
    .order('created_at', { ascending: false })

  if (includeOrgFilter) {
    query = query.eq('org_id', orgId)
  }

  if (status) {
    query = query.eq('status', status)
  }

  return query
}
