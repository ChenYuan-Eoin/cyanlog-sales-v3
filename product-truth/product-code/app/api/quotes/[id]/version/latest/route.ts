// REQ: WP10 阶段3
// PURPOSE: 读取最新冻结报价版本（客户可交互视图数据源）
// 原则：只读已冻结版本（合同源数据），不读实时可变草稿；内部字段（成本/毛利/审批）不返回
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: { code: code || 'ERROR', message } }, { status })
}

export async function GET(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const { data: quote, error: qErr } = await supabaseAdmin
      .from('quotes')
      .select('id, quote_no, customer_name, customer_contact, org_id, status, version_no, valid_until, currency')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()
    if (qErr || !quote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    const { data: version, error: vErr } = await supabaseAdmin
      .from('quote_versions')
      .select('*')
      .eq('quote_id', id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (vErr) {
      console.error('[WP10] load quote version failed:', vErr)
      return errorResponse('读取报价版本失败', 500, 'DB_ERROR')
    }
    if (!version) {
      return errorResponse('该报价尚未冻结版本，请先在详情页完成冻结', 409, 'NO_FROZEN_VERSION')
    }

    const { data: items, error: iErr } = await supabaseAdmin
      .from('quote_version_items')
      .select('*')
      .eq('version_id', version.id)
      .order('sort_order', { ascending: true })
    if (iErr) {
      console.error('[WP10] load quote version items failed:', iErr)
      return errorResponse('读取版本明细失败', 500, 'DB_ERROR')
    }

    // 客户视图白名单：只暴露展示与交互所需字段，剔除内部成本/毛利/审批
    const header = (version.header ?? {}) as Record<string, unknown>
    const whitelistHeader = {
      quote_no: quote.quote_no,
      customer_name: header.customer_name ?? quote.customer_name,
      customer_contact: header.customer_contact ?? quote.customer_contact,
      currency: header.currency ?? quote.currency ?? 'CNY',
      subtotal: header.subtotal,
      discount_rate: header.discount_rate,
      discount_amount: header.discount_amount,
      tax_amount: header.tax_amount,
      total_amount: header.total_amount,
      tax_summary: header.tax_summary,
      valid_until: header.valid_until ?? quote.valid_until,
      notes: header.notes,
      amount_in_words: header.amount_in_words,
    }
    const whitelistItems = (items || []).map((it: Record<string, unknown>) => ({
      sort_order: it.sort_order,
      product_code: it.product_code,
      name: it.name,
      version_code: it.version_code,
      deployment: it.deployment,
      auth_mode: it.auth_mode,
      term_months: it.term_months,
      quantity: it.quantity,
      unit_price: it.unit_price,
      list_price: it.list_price,
      discount: it.discount,
      line_total: it.line_total,
      tax_rate: it.tax_rate,
      tax_amount: it.tax_amount,
      is_gift: it.is_gift,
      gift_original_amount: it.gift_original_amount,
      tier_range: it.tier_range,
      maintenance_months: it.maintenance_months,
    }))

    return NextResponse.json({
      success: true,
      data: {
        version_no: version.version_no,
        frozen_at: version.frozen_at,
        checksum: version.checksum,
        header: whitelistHeader,
        items: whitelistItems,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('[WP10] quote version latest error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
