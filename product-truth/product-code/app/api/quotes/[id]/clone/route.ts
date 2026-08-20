// REQ: WP10 阶段2
// PURPOSE: 报价复制/复用——基于历史报价生成新 DRAFT，source_quote_id 留痕
// 语义：复制=继承业务事实（客户/区域/明细行），价格作为"历史价"参照重新计算；
//      审批/状态不继承（新单从 DRAFT 开始，留痕后可追溯复用链）
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { isSchemaDriftError } from '@/lib/db-compat'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { v4 as uuidv4 } from 'uuid'
import { buildReusedQuoteItem } from '@/lib/quote/quote-reuse'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: { code: code || 'ERROR', message } }, { status })
}

export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    // 读源报价（仅本人/本组织）
    const { data: sourceQuote, error: qErr } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()
    if (qErr && !isSchemaDriftError(qErr)) {
      return errorResponse('查询源报价失败', 500, 'DB_ERROR')
    }
    if (!sourceQuote) {
      return errorResponse('源报价不存在', 404, 'NOT_FOUND')
    }

    const { data: sourceItems, error: iErr } = await supabaseAdmin
      .from('quote_items')
      .select('*')
      .eq('quote_id', id)
      .order('sort_order', { ascending: true })
    if (iErr && !isSchemaDriftError(iErr)) {
      return errorResponse('查询源明细失败', 500, 'DB_ERROR')
    }

    // 新单号
    const { data: quoteNo, error: seqErr } = await supabaseAdmin.rpc('generate_quote_number')
    if (seqErr) {
      return errorResponse('生成报价单号失败', 500, 'DB_ERROR')
    }

    const newId = uuidv4()
    const now = new Date().toISOString()
    const clonedHeader = {
      id: newId,
      org_id: orgId,
      quote_no: quoteNo,
      customer_name: sourceQuote.customer_name,
      customer_contact: sourceQuote.customer_contact,
      subtotal: 0,
      discount_rate: 0,
      discount_amount: 0,
      tax_rate: null,
      tax_amount: 0,
      total_amount: 0,
      notes: `复制自 ${sourceQuote.quote_no}${sourceQuote.notes ? `；${sourceQuote.notes}` : ''}`,
      status: 'DRAFT',
      valid_until: null,
      currency: sourceQuote.currency || 'CNY',
      exchange_rate: null,
      tax_inclusive: false,
      amount_in_words: '',
      quote_kind: sourceQuote.quote_kind || 'STANDARD',
      region: sourceQuote.region || 'CN',
      opportunity_id: sourceQuote.opportunity_id ?? null,
      source_quote_id: id,
      discount_reason: null,
      change_reason: 'REUSE_FROM_' + (sourceQuote.quote_no || ''),
      created_by: user.id,
      created_at: now,
      updated_at: now,
    }

    const { error: insertErr } = await supabaseAdmin.from('quotes').insert(clonedHeader)
    if (insertErr && !isSchemaDriftError(insertErr)) {
      console.error('Clone quote insert failed:', insertErr)
      return errorResponse('复制报价失败', 500, 'DB_ERROR')
    }

    // 复制明细：继承业务事实，历史价作参照，价格/折扣/成本重置（纯函数语义）
    const clonedItems = (sourceItems || []).map((item, index) => {
      const reused = buildReusedQuoteItem(item, sourceQuote.region || 'CN')
      return {
        id: uuidv4(),
        quote_id: newId,
        ...reused,
        sort_order: index,
        region: reused.region,
      }
    })

    const { error: itemsErr } = await supabaseAdmin.from('quote_items').insert(clonedItems)
    if (itemsErr && !isSchemaDriftError(itemsErr)) {
      console.error('Clone quote items failed:', itemsErr)
      await supabaseAdmin.from('quotes').delete().eq('id', newId)
      return errorResponse('复制报价明细失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      success: true,
      data: { id: newId, quote_no: quoteNo, source_quote_id: id, message: '已复制为草稿，价格需按当前价盘重新计算' },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Clone quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
