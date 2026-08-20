// REQ: WP10 阶段4
// PURPOSE: 从冻结报价版本派生合同草稿（结构化版本 = 合同源数据）
// 原则：只允许已冻结版本派生；字段逐位一致（客户/金额/税/明细由版本带出）；quote_id 关联留痕
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { v4 as uuidv4 } from 'uuid'
import { deriveContractFromVersion, assertVersionMatchesQuote } from '@/lib/quote/contract-derive'
import { buildQuoteVersionPayload } from '@/lib/quote/version-builder'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: { code: code || 'ERROR', message } }, { status })
}

export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    // 1) 读报价（必须存在且已冻结版本）
    const { data: quote, error: qErr } = await supabaseAdmin
      .from('quotes')
      .select('id, quote_no, customer_name, customer_contact, org_id, status, total_amount, tax_amount, currency')
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
      return errorResponse('读取报价版本失败', 500, 'DB_ERROR')
    }
    if (!version) {
      return errorResponse('该报价尚未冻结版本，无法派生合同；请先在详情页冻结', 409, 'NO_FROZEN_VERSION')
    }

    // 2) 读版本明细
    const { data: items, error: iErr } = await supabaseAdmin
      .from('quote_version_items')
      .select('*')
      .eq('version_id', version.id)
      .order('sort_order', { ascending: true })
    if (iErr) {
      return errorResponse('读取版本明细失败', 500, 'DB_ERROR')
    }

    const header = (version.header ?? {}) as Record<string, unknown>

    // 3) 字段逐位一致性校验：版本金额与报价当前金额必须一致（防漂移，纯函数契约）
    const versionTotal = Number(header.total_amount ?? 0)
    const quoteTotal = Number(quote.total_amount ?? 0)
    const drift = assertVersionMatchesQuote(versionTotal, quoteTotal)
    if (drift) {
      return errorResponse(`${drift}，拒绝派生，请先重新冻结`, 409, 'VERSION_DRIFT')
    }

    // 4) 派生合同草稿（结构化数据 → contract_drafts，纯函数保证逐位一致）
    const draftId = uuidv4()
    const versionPayload = buildQuoteVersionPayload(
      { ...quote, ...header },
      (items || []).map((it: Record<string, unknown>) => ({ ...it })),
      version.version_no
    )
    const derived = deriveContractFromVersion({
      quote_no: quote.quote_no,
      customer_name: quote.customer_name,
      customer_contact: quote.customer_contact ?? null,
      currency: (header.currency as string) ?? quote.currency ?? 'CNY',
      version: versionPayload,
    })
    const businessParams = {
      ...derived.business_params,
      derived_from_version_id: version.id,
    }

    const { data: draft, error: dErr } = await supabaseAdmin
      .from('contract_drafts')
      .insert({
        id: draftId,
        org_id: orgId,
        created_by: user.id,
        title: derived.title,
        party_b_name: derived.party_b_name,
        party_b_contact: derived.party_b_contact,
        contract_amount: derived.contract_amount,
        tax_amount: derived.tax_amount,
        quote_id: id,
        business_params: businessParams,
        status: 'draft',
      })
      .select()
      .single()

    if (dErr) {
      console.error('[WP10] derive contract draft failed:', dErr)
      return errorResponse('派生合同草稿失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      success: true,
      data: {
        draft_id: draftId,
        title: draft?.title,
        version_no: version.version_no,
        quote_no: quote.quote_no,
        message: '已从冻结版本派生合同草稿，字段与版本逐位一致',
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('[WP10] derive contract error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
