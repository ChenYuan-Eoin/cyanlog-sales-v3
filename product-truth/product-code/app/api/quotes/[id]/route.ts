// REQ:F002
// FREEZE-SPEC:4.5

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createApprovalWorkflow, loadPublishedApprovalConfig } from '@/lib/approval/workflow'
import { reviewQuote } from '@/lib/review/quote-review'
import { requireAuth } from '@/lib/auth'
import { contractIdSchema, dateTimeStringSchema } from '@/lib/validation'
import { z } from 'zod'
import { canManageOrg, getDefaultOrgId, getUserScopedRoleAssignments, listAccessibleUserIds } from '@/lib/scoped-access'
import { isSchemaDriftError } from '@/lib/db-compat'
import { loadProductsForOrg } from '@/lib/pricing/service'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import {
  buildLegacyQuoteUpdatePayload,
  normalizeQuote,
} from '../quote-compat'

export const preferredRegion = 'sin1'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

const QUOTE_DETAIL_RESPONSE_CACHE_TTL_MS = 30_000
const quoteDetailResponseCache = new Map<string, { quote: unknown; expiresAt: number }>()

function quoteDetailResponseCacheKey(userId: string, orgId: string, quoteId: string) {
  return `${userId}:${orgId}:${quoteId}`
}

function getCachedQuoteDetail(cacheKey: string) {
  const cached = quoteDetailResponseCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt < Date.now()) {
    quoteDetailResponseCache.delete(cacheKey)
    return null
  }
  return cached.quote
}

function setCachedQuoteDetail(cacheKey: string, quote: unknown) {
  quoteDetailResponseCache.set(cacheKey, {
    quote,
    expiresAt: Date.now() + QUOTE_DETAIL_RESPONSE_CACHE_TTL_MS,
  })
}

function invalidateQuoteDetailResponseCache(quoteId: string) {
  for (const cacheKey of quoteDetailResponseCache.keys()) {
    if (cacheKey.endsWith(`:${quoteId}`)) {
      quoteDetailResponseCache.delete(cacheKey)
    }
  }
}

async function fetchQuoteDetail(id: string, orgId: string, accessibleUserIds: string[] | null) {
  let modernQuery = supabaseAdmin
    .from('quotes')
    .select('*, quote_items(*)')
    .eq('id', id)
    .eq('org_id', orgId)

  if (accessibleUserIds) {
    modernQuery = modernQuery.in('created_by', accessibleUserIds)
  }

  const modernResult = await modernQuery
    .maybeSingle()

  if (!modernResult.error) {
    return modernResult.data ? normalizeQuote(modernResult.data, orgId) : null
  }

  if (!isSchemaDriftError(modernResult.error)) {
    throw modernResult.error
  }

  let legacyQuoteQuery = supabaseAdmin
    .from('quotes')
    .select('*')
    .eq('id', id)

  if (accessibleUserIds) {
    legacyQuoteQuery = legacyQuoteQuery.in('created_by', accessibleUserIds)
  }

  const legacyQuoteResult = await legacyQuoteQuery
    .maybeSingle()

  if (legacyQuoteResult.error) {
    throw legacyQuoteResult.error
  }

  if (!legacyQuoteResult.data) {
    return null
  }

  const legacyItemsResult = await supabaseAdmin
    .from('quote_items')
    .select('*')
    .eq('quote_id', id)
    .order('sort_order', { ascending: true })

  if (legacyItemsResult.error && !isSchemaDriftError(legacyItemsResult.error)) {
    throw legacyItemsResult.error
  }

  const legacyItems = legacyItemsResult.data || []

  if (legacyItems.length === 0) {
    return normalizeQuote(legacyQuoteResult.data, orgId, legacyItems)
  }

  const products = await loadProductsForOrg(orgId)
  const productByName = new Map(products.map((product) => [product.name, product]))
  const enrichedItems = legacyItems.map((item) => {
    const product = typeof item.name === 'string' ? productByName.get(item.name) : undefined
    if (!product) {
      return item
    }

    return {
      ...item,
      product_id: item.product_id ?? product.id,
      product_code: item.product_code ?? product.code,
      specification: item.specification ?? product.specification,
      unit: item.unit ?? product.unit,
    }
  })

  return normalizeQuote(legacyQuoteResult.data, orgId, enrichedItems)
}

async function fetchOwnedQuote(id: string, orgId: string, userId: string) {
  const result = await supabaseAdmin
    .from('quotes')
    .select('id, status, created_by, org_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('created_by', userId)
    .maybeSingle()

  if (!result.error) {
    return result.data
  }

  if (!isSchemaDriftError(result.error)) {
    throw result.error
  }

  const legacyResult = await supabaseAdmin
    .from('quotes')
    .select('id, status, created_by')
    .eq('id', id)
    .eq('created_by', userId)
    .maybeSingle()

  if (legacyResult.error) {
    throw legacyResult.error
  }

  if (!legacyResult.data) {
    return null
  }

  return {
    ...legacyResult.data,
    org_id: orgId,
  }
}

// 报价更新字段验证
const quoteStatusSchema = z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'])

const updateQuoteSchema = z.object({
  customer_name: z.string().min(1).max(255).optional(),
  customer_contact: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
  valid_until: z.preprocess(
    (value) => value === '' ? null : value,
    dateTimeStringSchema.nullable().optional()
  ),
  status: quoteStatusSchema.optional(),
})

type QuoteStatus = z.infer<typeof quoteStatusSchema>

const editableQuoteFields = ['customer_name', 'customer_contact', 'notes', 'valid_until'] as const

function isQuoteLocked(status: string): boolean {
  return status === 'APPROVED'
}

function getAllowedTransitions(status: QuoteStatus): QuoteStatus[] {
  switch (status) {
    case 'DRAFT':
      return ['PENDING_APPROVAL']
    case 'PENDING_APPROVAL':
      return ['APPROVED', 'REJECTED']
    case 'REJECTED':
      return ['DRAFT', 'PENDING_APPROVAL']
    case 'APPROVED':
    default:
      return []
  }
}

function hasEditableQuoteField(updateData: z.infer<typeof updateQuoteSchema>): boolean {
  return editableQuoteFields.some((field) => field in updateData)
}

function validateQuoteMutation(
  currentStatus: QuoteStatus,
  updateData: z.infer<typeof updateQuoteSchema>
): { valid: true } | { valid: false; message: string; code: string } {
  const nextStatus = updateData.status
  const editingBusinessFields = hasEditableQuoteField(updateData)

  if (isQuoteLocked(currentStatus)) {
    return {
      valid: false,
      message: '已批准的报价不能再修改，请基于当前报价新建版本',
      code: 'QUOTE_LOCKED',
    }
  }

  if (currentStatus === 'PENDING_APPROVAL' && editingBusinessFields) {
    return {
      valid: false,
      message: '审批中的报价不能直接修改，请先完成审批或驳回后再调整',
      code: 'INVALID_STATUS',
    }
  }

  if (!nextStatus || nextStatus === currentStatus) {
    return { valid: true }
  }

  const allowedTransitions = getAllowedTransitions(currentStatus)
  if (!allowedTransitions.includes(nextStatus)) {
    return {
      valid: false,
      message: `报价状态不允许从 ${currentStatus} 变更为 ${nextStatus}`,
      code: 'INVALID_STATUS',
    }
  }

  return { valid: true }
}

// GET /api/quotes/:id - 获取报价详情（需登录）
export async function GET(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const routeId = await resolveIdParam(params)

    const idResult = contractIdSchema.safeParse({ id: routeId })
    if (!idResult.success) {
      return errorResponse('无效的报价ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data
    const assignments = await getUserScopedRoleAssignments(user.id)
    const accessibleUserIds = canManageOrg(assignments, orgId)
      ? null
      : (await listAccessibleUserIds(user.id, orgId)).userIds
    const cacheKey = quoteDetailResponseCacheKey(user.id, orgId, id)
    const cachedQuote = getCachedQuoteDetail(cacheKey)
    if (cachedQuote) {
      return NextResponse.json(cachedQuote)
    }

    let quote
    try {
      quote = await fetchQuoteDetail(id, orgId, accessibleUserIds)
    } catch (queryError) {
      console.error('Get quote error:', queryError)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!quote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    setCachedQuoteDetail(cacheKey, quote)
    return NextResponse.json(quote)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// PUT /api/quotes/:id - 更新报价（需登录，仅能更新自己的报价）
export async function PUT(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const routeId = await resolveIdParam(params)

    const idResult = contractIdSchema.safeParse({ id: routeId })
    if (!idResult.success) {
      return errorResponse('无效的报价ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    const rawData = await req.json().catch(() => null)

    // Zod验证输入
    const validation = updateQuoteSchema.safeParse(rawData)
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    // 先查询当前报价状态（带 owner 校验）
    const orgId = await getDefaultOrgId(user.id)

    let existingQuote
    try {
      existingQuote = await fetchOwnedQuote(id, orgId, user.id)
    } catch (fetchError) {
      console.error('Fetch quote before update error:', fetchError)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!existingQuote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    const updateData = validation.data
    const mutationValidation = validateQuoteMutation(existingQuote.status as QuoteStatus, updateData)
    if (!mutationValidation.valid) {
      return errorResponse(mutationValidation.message, 409, mutationValidation.code)
    }

    let updateResult = await supabaseAdmin
      .from('quotes')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)
      .select()
      .single()

    if (updateResult.error && isSchemaDriftError(updateResult.error)) {
      updateResult = await supabaseAdmin
        .from('quotes')
        .update(buildLegacyQuoteUpdatePayload(updateData))
        .eq('id', id)
        .eq('created_by', user.id)
        .select()
        .single()
    }

    if (updateResult.error) {
      console.error('Update quote error:', updateResult.error)
      return errorResponse('更新失败', 500, 'DB_ERROR')
    }

    invalidateQuoteDetailResponseCache(id)

    // F047：提交审批前自动审核核验；BLOCK → 回滚状态并暂缓审批（不创建审批链）
    if (updateData.status === 'PENDING_APPROVAL' && existingQuote.status !== 'PENDING_APPROVAL') {
      try {
        const [itemsRes, versionsRes, productsRes] = await Promise.all([
          supabaseAdmin.from('quote_items').select('*').eq('quote_id', id).order('sort_order', { ascending: true }),
          supabaseAdmin.from('product_versions').select('version_code,deployments,auth_modes,status').eq('org_id', orgId).eq('status', 'PUBLISHED'),
          supabaseAdmin.from('products').select('id,code,attributes'),
        ])
        const products: Record<string, { code: string; attributes?: { category?: string; follows?: string[] } }> = {}
        for (const prod of productsRes.data || []) {
          products[String(prod.id)] = { code: String(prod.code), attributes: (prod.attributes ?? {}) as never }
        }
        const reviewResult = reviewQuote({
          quote: { ...(updateResult.data || {}), ...updateData },
          items: (itemsRes.data || []) as never,
          versions: (versionsRes.data || []) as never,
          products,
        })
        await supabaseAdmin
          .from('quotes')
          .update({ review_status: reviewResult.status, review_result: reviewResult })
          .eq('id', id)
          .eq('org_id', orgId)
        if (reviewResult.status === 'BLOCK') {
          await supabaseAdmin
            .from('quotes')
            .update({ status: existingQuote.status })
            .eq('id', id)
            .eq('org_id', orgId)
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'REVIEW_BLOCKED',
                message: '不满足审核要求，已暂缓审批',
                checks: reviewResult.checks,
                blocked: reviewResult.blocked,
              },
            },
            { status: 409 }
          )
        }
      } catch (reviewError) {
        console.error('[F047] review gate failed:', reviewError)
      }
    }

    // F043：DRAFT/REJECTED → PENDING_APPROVAL 时，按已发布审批规则创建审批链（失败不阻断状态流转）
    if (updateData.status === 'PENDING_APPROVAL' && existingQuote.status !== 'PENDING_APPROVAL') {
      try {
        const approvalConfig = await loadPublishedApprovalConfig(orgId)
        if (approvalConfig && approvalConfig.rules.length > 0) {
          await createApprovalWorkflow(id, Number((existingQuote as { discount_rate?: number }).discount_rate || 0), {
            scene: 'QUOTE_DISCOUNT',
            rules: approvalConfig.rules,
            chains: approvalConfig.chains,
            nodesByChain: approvalConfig.nodesByChain,
          })
        }
      } catch (approvalError) {
        console.error('[F043] createApprovalWorkflow failed:', approvalError)
      }
    }

    return NextResponse.json(normalizeQuote({
      ...existingQuote,
      ...updateData,
      ...(updateResult.data || {}),
    }, orgId))
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Update quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/quotes/:id - 删除报价（需登录，仅能删除自己的报价）
export async function DELETE(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const routeId = await resolveIdParam(params)

    const idResult = contractIdSchema.safeParse({ id: routeId })
    if (!idResult.success) {
      return errorResponse('无效的报价ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    // 查询报价是否存在（带 owner 校验）
    const orgId = await getDefaultOrgId(user.id)

    let quote
    try {
      quote = await fetchOwnedQuote(id, orgId, user.id)
    } catch (fetchError) {
      console.error('Fetch quote before delete error:', fetchError)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!quote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    if (quote.status === 'APPROVED') {
      return errorResponse('已批准的报价不能删除，请保留历史记录', 409, 'QUOTE_LOCKED')
    }

    if (quote.status === 'PENDING_APPROVAL') {
      return errorResponse('审批中的报价不能删除，请先完成审批或驳回', 409, 'INVALID_STATUS')
    }

    let deleteResult = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)

    if (deleteResult.error && isSchemaDriftError(deleteResult.error)) {
      deleteResult = await supabaseAdmin
        .from('quotes')
        .delete()
        .eq('id', id)
        .eq('created_by', user.id)
    }

    if (deleteResult.error) {
      console.error('Delete quote error:', deleteResult.error)
      return errorResponse('删除失败', 500, 'DB_ERROR')
    }

    invalidateQuoteDetailResponseCache(id)
    return NextResponse.json({ success: true, message: '报价已删除' })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
