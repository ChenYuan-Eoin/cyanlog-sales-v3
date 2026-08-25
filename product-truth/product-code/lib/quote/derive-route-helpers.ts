// REQ: WP10 阶段4/7
// PURPOSE: 下游派生 route 共享逻辑（读冻结版本 → 防漂移 → 调用派生服务）
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { assertVersionMatchesQuote } from './contract-derive'
import type { DeriveSource } from './downstream-derive'

export function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, error: { code: code || 'ERROR', message } }, { status })
}

export type LoadDeriveContextResult =
  | { ok: true; source: DeriveSource }
  | { ok: false; response: NextResponse }

/** 加载报价 + 最新冻结版本，做防漂移校验，返回派生源 */
export async function loadDeriveContext(orgId: string, id: string): Promise<LoadDeriveContextResult> {
  const { data: quote, error: qErr } = await supabaseAdmin
    .from('quotes')
    .select('id, quote_no, customer_name, customer_contact, org_id, total_amount, currency')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (qErr || !quote) {
    return { ok: false, response: errorResponse('报价不存在', 404, 'NOT_FOUND') }
  }

  const { data: version, error: vErr } = await supabaseAdmin
    .from('quote_versions')
    .select('*')
    .eq('quote_id', id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (vErr) {
    return { ok: false, response: errorResponse('读取报价版本失败', 500, 'DB_ERROR') }
  }
  if (!version) {
    return { ok: false, response: errorResponse('该报价尚未冻结版本，请先在详情页冻结', 409, 'NO_FROZEN_VERSION') }
  }

  const header = (version.header ?? {}) as Record<string, unknown>
  const versionTotal = Number(header.total_amount ?? 0)
  const quoteTotal = Number(quote.total_amount ?? 0)
  const drift = assertVersionMatchesQuote(versionTotal, quoteTotal)
  if (drift) {
    return { ok: false, response: errorResponse(`${drift}，拒绝派生，请先重新冻结`, 409, 'VERSION_DRIFT') }
  }

  const { data: items, error: iErr } = await supabaseAdmin
    .from('quote_version_items')
    .select('*')
    .eq('version_id', version.id)
    .order('sort_order', { ascending: true })
  if (iErr) {
    return { ok: false, response: errorResponse('读取版本明细失败', 500, 'DB_ERROR') }
  }

  return {
    ok: true,
    source: {
      quote_id: quote.id,
      org_id: quote.org_id,
      quote_no: quote.quote_no,
      customer_name: quote.customer_name,
      customer_contact: quote.customer_contact ?? null,
      currency: (header.currency as string) ?? quote.currency ?? 'CNY',
      version: {
        id: version.id,
        version_no: version.version_no,
        header,
        items: (items || []).map((it: Record<string, unknown>) => ({ ...it })),
      },
    },
  }
}
