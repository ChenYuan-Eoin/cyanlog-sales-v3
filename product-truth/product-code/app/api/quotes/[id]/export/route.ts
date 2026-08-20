// REQ: F039/F040
// PURPOSE: 标准报价单导出数据（白名单脱敏，内部字段零泄漏）
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { buildQuoteExportData } from '@/lib/export/quote-export'
import { numberToChineseUpper } from '@/lib/pricing/quote-builder'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params

    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!quote) {
      return errorResponse(createApiError('NOT_FOUND', '报价不存在'))
    }

    const { data: items } = await supabaseAdmin
      .from('quote_items')
      .select('*')
      .eq('quote_id', id)
      .order('sort_order')

    // WP10 阶段1：命中的标准输出模板（配置数据，非硬编码布局）
    let templates: Array<Record<string, unknown>> | null = null
    try {
      const tplRes = await supabaseAdmin
        .from('output_templates')
        .select('code, name, doc_type, scene, match_rule, variables')
        .eq('org_id', orgId)
        .eq('status', 'PUBLISHED')
        .eq('doc_type', 'standard')
        .eq('scene', 'quote')
        .limit(20)
      templates = (tplRes.data ?? null) as Array<Record<string, unknown>> | null
    } catch {
      templates = null
    }
    const matchedTemplate = (() => {
      const rows = (templates ?? []) as Array<{ code: string; name: string; match_rule?: Record<string, unknown>; variables?: unknown }>
      const auth = (quote as Record<string, unknown>).auth_mode ?? null
      const deploy = (quote as Record<string, unknown>).deployment ?? null
      if (!rows.length) return null
      const exact = rows.find((t) => {
        const rule = (t.match_rule ?? {}) as Record<string, string>
        return (!rule.v_type || rule.v_type === (auth === 'ONETIME' ? 'perpetual' : 'subscription'))
          && (!rule.deploy || rule.deploy === deploy)
      })
      return exact ?? rows[0]
    })()

    const result = buildQuoteExportData({
      quoteNo: quote.quote_no,
      customerName: quote.customer_name,
      customerContact: quote.customer_contact,
      validUntil: quote.valid_until,
      currency: quote.currency ?? 'CNY',
      subtotal: Number(quote.subtotal ?? 0),
      discountRate: Number(quote.discount_rate ?? 0),
      discountAmount: Number(quote.discount_amount ?? 0),
      taxAmount: Number(quote.tax_amount ?? 0),
      totalAmount: Number(quote.total_amount ?? 0),
      totalInWords: quote.total_in_words ?? numberToChineseUpper(Number(quote.total_amount ?? 0)),
      taxSummary: quote.tax_summary ?? null,
      items: (items ?? []) as Array<Record<string, unknown>>,
    })

    const payload = {
      ...result.data,
      template: matchedTemplate
        ? { code: matchedTemplate.code, name: matchedTemplate.name, variables: matchedTemplate.variables ?? [] }
        : null,
    }
    return NextResponse.json({ success: true, data: payload })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Export quote error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
