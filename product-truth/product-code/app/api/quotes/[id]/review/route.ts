// REQ: F047
// PURPOSE: 报价审核自动化——GET 读核验结果（实时重算），POST 重跑并落库快照
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, getOrgRoleCodes, getUserScopedRoleAssignments } from '@/lib/scoped-access'
import { getPublishedParamNumber } from '@/lib/config-center/runtime'
import { generateQuoteReviewAiSummary } from '@/lib/review/ai-review'
import { reviewQuote, type QuoteReviewResult } from '@/lib/review/quote-review'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: { code: code || 'ERROR', message } }, { status })
}

async function loadReviewData(quoteId: string, orgId: string, userId: string) {
  const [quoteRes, itemsRes, versionsRes, productsRes] = await Promise.all([
    supabaseAdmin.from('quotes').select('*').eq('id', quoteId).eq('org_id', orgId).maybeSingle(),
    supabaseAdmin.from('quote_items').select('*').eq('quote_id', quoteId).order('sort_order', { ascending: true }),
    supabaseAdmin.from('product_versions').select('version_code,deployments,auth_modes,status').eq('org_id', orgId).eq('status', 'PUBLISHED'),
    supabaseAdmin.from('products').select('id,code,attributes'),
  ])
  if (quoteRes.error || itemsRes.error || versionsRes.error || productsRes.error) {
    throw new Error('审核数据加载失败')
  }
  const quote = quoteRes.data
  if (!quote) return null
  const products: Record<string, { code: string; attributes?: { category?: string; follows?: string[] } }> = {}
  for (const p of productsRes.data || []) {
    products[String(p.id)] = { code: String(p.code), attributes: (p.attributes ?? {}) as never }
  }
  const discountMax = await getPublishedParamNumber(orgId, 'DISCOUNT_MAX').catch(() => null)
  const assignments = await getUserScopedRoleAssignments(userId).catch(() => [])
  const roleCodes = getOrgRoleCodes(assignments, orgId)
  const policyRes = await supabaseAdmin.from('discount_policies').select('*').eq('org_id', orgId).eq('status', 'PUBLISHED')
  const policies: Record<string, { maxDiscount: number; hardCap: number | null }> = {}
  for (const pol of policyRes.data || []) {
    policies[String(pol.role_code)] = { maxDiscount: Number(pol.max_discount ?? 0), hardCap: pol.hard_cap != null ? Number(pol.hard_cap) : null }
  }
  const result = reviewQuote({
    quote,
    items: (itemsRes.data || []).map((it: Record<string, unknown>) => ({ ...it })),
    versions: (versionsRes.data || []) as never,
    products,
    discountMaxPercent: discountMax !== null && discountMax !== undefined ? discountMax : undefined,
    userRoleCodes: roleCodes,
    discountPolicies: policies,
  })
  return { quote, result }
}

export async function GET(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const id = await resolveIdParam(params)
    const orgId = await getDefaultOrgId(user.id)
    const data = await loadReviewData(id, orgId, user.id)
    if (!data) return errorResponse('报价不存在', 404, 'NOT_FOUND')
    const wantAi = new URL(req.url).searchParams.get('ai') === '1'
    if (!wantAi) {
      return NextResponse.json({ success: true, data: data.result })
    }
    const aiOutput = await generateQuoteReviewAiSummary({ orgId, review: data.result, quote: data.quote })
    return NextResponse.json({ success: true, data: data.result, aiSummary: aiOutput })
  } catch (error) {
    console.error('[F047] review GET failed:', error)
    return errorResponse('审核核验失败', 500, 'REVIEW_ERROR')
  }
}

export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const id = await resolveIdParam(params)
    const orgId = await getDefaultOrgId(user.id)
    const data = await loadReviewData(id, orgId, user.id)
    if (!data) return errorResponse('报价不存在', 404, 'NOT_FOUND')
    const result: QuoteReviewResult = data.result
    const { error } = await supabaseAdmin
      .from('quotes')
      .update({ review_status: result.status, review_result: result })
      .eq('id', id)
      .eq('org_id', orgId)
    if (error) {
      console.error('[F047] review persist failed:', error)
      return errorResponse('核验结果保存失败', 500, 'REVIEW_PERSIST')
    }
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('[F047] review POST failed:', error)
    return errorResponse('审核核验失败', 500, 'REVIEW_ERROR')
  }
}
