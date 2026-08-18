// GET /api/quotes - 获取报价列表（需登录）
// POST /api/quotes - 创建报价（需登录）

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'
import { paginationSchema, quoteSchema } from '@/lib/validation'
import { canManageOrg, getDefaultOrgId, getUserScopedRoleAssignments, listAccessibleUserIds } from '@/lib/scoped-access'
import { isSchemaDriftError } from '@/lib/db-compat'
import { calculateQuoteDraft, calculateQuoteDraftOnes } from '@/lib/pricing/service'
import { numberToChineseUpper } from '@/lib/pricing/quote-builder'
import { getQuoteFxRate, parseBocRateType } from '@/lib/quote/fx-rate'
import { getPublishedParamString, getRegionTaxRates } from '@/lib/config-center/runtime'
import {
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

function addMonths(date: Date, months: number): string {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

export const preferredRegion = 'sin1'

// GET - 获取报价列表
export async function GET(req: NextRequest) {
  return withAuth(req, async (user: AuthUser) => {
    const orgId = await getDefaultOrgId(user.id)
    const assignments = await getUserScopedRoleAssignments(user.id)
    const accessibleUserIds = canManageOrg(assignments, orgId)
      ? null
      : (await listAccessibleUserIds(user.id, orgId)).userIds

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
    const body = await req.json().catch(() => null)

    // Zod验证
    const result = quoteSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(createApiError('VALIDATION_ERROR', firstError.message))
    }

    const orgId = await getDefaultOrgId(user.id)
    const { customer_name, customer_contact, valid_until, notes, discount_rate, discount_reason, quote_kind, change_reason, region: regionRaw, items } = result.data

    // 生成报价单号
    const { data: quoteNoResult, error: seqError } = await supabaseAdmin.rpc('generate_quote_number')

    if (seqError) {
      console.error('Quote number generation failed:', seqError)
      return errorResponse(createApiError('INTERNAL_ERROR', '报价单号生成失败，请重试'))
    }

    const quoteNo = quoteNoResult

    // F049：区域（默认 CN）+ 区域税率
    const region = (regionRaw || 'CN').toUpperCase().slice(0, 10)
    const regionTax = await getRegionTaxRates(orgId, region).catch(() => null)

    const hasOnesFields = items.some((item) => item.version_code || item.deployment || item.auth_mode)
    let pricedDraft
    if (hasOnesFields) {
      try {
        pricedDraft = await calculateQuoteDraftOnes(orgId, items, discount_rate, {
          region,
          softwareTaxRate: regionTax?.softwareRate,
          serviceTaxRate: regionTax?.serviceRate,
        })
      } catch (onesError) {
        console.error('[F038] calculateQuoteDraftOnes failed, fallback legacy:', onesError)
        pricedDraft = await calculateQuoteDraft(orgId, items, discount_rate)
      }
    } else {
      pricedDraft = await calculateQuoteDraft(orgId, items, discount_rate)
    }
    const quoteId = uuidv4()

    // F048：从产品目录带出成本/底价（内部字段，客户输出永不出现）
    const productCostRes = await supabaseAdmin.from('products').select('id,cost_price,min_price').in('id', items.map((i) => i.product_id).filter(Boolean))
    const productCostMap = new Map<string, { cost: number; floor: number }>()
    for (const prod of productCostRes.data || []) {
      productCostMap.set(String(prod.id), { cost: Number(prod.cost_price || 0), floor: Number(prod.min_price || 0) })
    }
    const totalCost = pricedDraft.items.reduce((sum, item, index) => {
      const requested = items[index] || {}
      const cost = productCostMap.get(String(item.product_id || requested.product_id))?.cost ?? Number(requested.cost_price || 0)
      return sum + cost * item.quantity
    }, 0)
    const netRevenue = pricedDraft.subtotal - pricedDraft.discountAmount
    const quoteMarginRate = totalCost > 0 && netRevenue > 0 ? Math.round((netRevenue - totalCost) / netRevenue * 10000) / 10000 : null

    // F042：汇率源按业务参数 FX_SOURCE 配置（默认/未发布=BOC）；中行官方牌价接入，
    // 失败不阻断报价创建、不伪造数据（exchange_rate 留空由字段字典口径继续按输入处理）。
    let exchangeRate: number | null = null
    try {
      const fxSource = await getPublishedParamString(orgId, 'FX_SOURCE').catch(() => null)
      if (fxSource === null || fxSource === 'BOC') {
        const fxRateType = parseBocRateType(await getPublishedParamString(orgId, 'FX_RATE_TYPE').catch(() => null))
        const fx = await getQuoteFxRate('美元', fxRateType)
        exchangeRate = fx ? fx.ratePerUnit : null
      }
    } catch (fxError) {
      console.error('[F042] BOC exchange rate resolution failed:', fxError)
    }

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
      currency: 'CNY',
      exchange_rate: exchangeRate,
      tax_inclusive: false,
      amount_in_words: numberToChineseUpper(pricedDraft.totalAmount),
      total_cost: totalCost,
      margin_rate: quoteMarginRate,
      quote_kind: quote_kind ?? 'STANDARD',
      region,
      discount_reason: discount_reason ?? null,
      change_reason: change_reason ?? null,
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

    const quoteItemPayloads = pricedDraft.items.map((item, index) => {
      const requested = items[index] || {}
      return {
        id: uuidv4(),
        quote_id: quoteId,
        product_id: item.product_id ?? requested.product_id ?? null,
        product_type: item.product_type,
        product_code: item.product_code ?? null,
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
        // F038/F044 结构化源字段（migration 后落库；未迁移时 schema-drift 回退 legacy）
        version_code: requested.version_code ?? null,
        deployment: requested.deployment ?? null,
        auth_mode: requested.auth_mode ?? null,
        term_months: requested.term_months ?? null,
        list_price: requested.list_price ?? null,
        is_gift: requested.is_gift ?? false,
        gift_original_amount: requested.gift_original_amount ?? null,
        tax_rate: requested.tax_rate ?? (requested.line_type === 'product' || !requested.line_type ? pricedDraft.taxRate : null),
        tax_amount: requested.tax_amount ?? null,
        maintenance_months: requested.maintenance_months ?? null,
        version_from: requested.version_from ?? null,
        version_to: requested.version_to ?? null,
        line_type: requested.line_type ?? 'product',
        discount_reason: requested.discount_reason ?? null,
        line_note: requested.line_note ?? null,
        subscription_start: requested.subscription_start ?? (requested.auth_mode?.startsWith('SUB_') ? new Date().toISOString().slice(0, 10) : null),
        subscription_end: requested.subscription_end ?? (requested.auth_mode?.startsWith('SUB_') ? addMonths(new Date(), requested.term_months ?? 12).slice(0, 10) : null),
        region: requested.region ?? region,
        cost_price: productCostMap.get(String(item.product_id || requested.product_id))?.cost ?? Number(requested.cost_price || 0),
        floor_price: productCostMap.get(String(item.product_id || requested.product_id))?.floor ?? Number(requested.floor_price || 0),
        line_cost: (() => { const c = productCostMap.get(String(item.product_id || requested.product_id))?.cost ?? Number(requested.cost_price || 0); return c > 0 ? Math.round(c * item.quantity * 100) / 100 : 0 })(),
        margin_rate: item.unit_price > 0 ? (() => { const c = productCostMap.get(String(item.product_id || requested.product_id))?.cost ?? Number(requested.cost_price || 0); return c > 0 ? Math.round((item.unit_price - c) / item.unit_price * 10000) / 10000 : null })() : null,
      }
    })

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
  accessibleUserIds: string[] | null,
  status: string | null,
  includeOrgFilter: boolean
) {
  let query = supabaseAdmin
    .from('quotes')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (accessibleUserIds) {
    query = query.in('created_by', accessibleUserIds)
  }

  if (includeOrgFilter) {
    query = query.eq('org_id', orgId)
  }

  if (status) {
    query = query.eq('status', status)
  }

  return query
}
