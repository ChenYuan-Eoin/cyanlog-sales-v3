// REQ: F029/F030
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

    return NextResponse.json({ success: true, data: result.data })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Export quote error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
