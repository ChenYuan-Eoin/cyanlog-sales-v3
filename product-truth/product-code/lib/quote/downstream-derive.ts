// REQ: WP10 阶段4/7
// PURPOSE: 冻结版本 → 下游派生（订单/盖章/标书）统一服务
// 原则：下游全部从 quote_versions 派生，字段逐位一致；quote_derivations 统一留痕
// 兼容：新表未应用时抛 DERIVE_TABLES_MISSING，由调用方提示迁移（不伪造数据）
import { supabaseAdmin } from '@/lib/supabase'
import { isSchemaDriftError } from '@/lib/db-compat'
import { v4 as uuidv4 } from 'uuid'

export type DerivationType = 'order' | 'seal' | 'tender'

export interface DeriveSource {
  quote_id: string
  org_id: string
  quote_no: string
  customer_name: string
  customer_contact: string | null
  currency: string
  version: {
    id: string
    version_no: number
    header: Record<string, unknown>
    items: Array<Record<string, unknown>>
  }
}

export interface DeriveOrderInput extends DeriveSource { order_no?: string }
export interface DeriveSealInput extends DeriveSource { reason?: string }
export interface DeriveTenderInput extends DeriveSource { title?: string }

/** 从版本构建下游业务参数（含明细行，逐位一致） */
export function buildDownstreamParams(source: DeriveSource): Record<string, unknown> {
  const header = source.version.header
  return {
    quote_no: source.quote_no,
    currency: source.currency,
    version_no: source.version.version_no,
    discount_rate: header.discount_rate ?? 0,
    discount_amount: header.discount_amount ?? 0,
    tax_summary: header.tax_summary ?? null,
    valid_until: header.valid_until ?? null,
    line_items: (source.version.items || []).map((it) => ({
      product_code: it.product_code,
      name: it.name,
      version_code: it.version_code,
      deployment: it.deployment,
      auth_mode: it.auth_mode,
      term_months: it.term_months,
      quantity: it.quantity,
      unit_price: it.unit_price,
      list_price: it.list_price,
      line_total: it.line_total,
      tax_rate: it.tax_rate,
      is_gift: it.is_gift,
    })),
  }
}

function isDownstreamTableMissing(error: unknown): boolean {
  return isSchemaDriftError(error) || String((error as { message?: string })?.message || '').includes('relation "quote_derivations" does not exist')
}

async function recordDerivation(input: DeriveSource, type: DerivationType, targetId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('quote_derivations').insert({
    org_id: input.org_id,
    quote_id: input.quote_id,
    version_id: input.version.id,
    derivation_type: type,
    target_id: targetId,
    created_by: null,
  })
  if (error) {
    // 留痕失败不阻断派生（目标已生成）；仅记录
    console.error(`[WP10] record derivation failed (${type}):`, error)
  }
}

/** 派生销售订单草稿 */
export async function deriveOrder(input: DeriveOrderInput): Promise<{ id: string; type: DerivationType }> {
  const id = uuidv4()
  const header = input.version.header
  const params = buildDownstreamParams(input)
  const { error } = await supabaseAdmin.from('order_drafts').insert({
    id,
    org_id: input.org_id,
    created_by: null,
    quote_id: input.quote_id,
    source_version_id: input.version.id,
    order_no: input.order_no ?? null,
    customer_name: input.customer_name,
    currency: input.currency,
    subtotal: Number(header.subtotal ?? 0),
    discount_amount: Number(header.discount_amount ?? 0),
    tax_amount: Number(header.tax_amount ?? 0),
    total_amount: Number(header.total_amount ?? 0),
    business_params: params,
    status: 'draft',
  })
  if (error) {
    if (isDownstreamTableMissing(error)) {
      throw new Error('DERIVE_TABLES_MISSING: 数据库尚未应用报价下游派生迁移，请先执行 migration 20260820000002')
    }
    throw error
  }
  await recordDerivation(input, 'order', id)
  return { id, type: 'order' }
}

/** 派生盖章申请 */
export async function deriveSeal(input: DeriveSealInput): Promise<{ id: string; type: DerivationType }> {
  const id = uuidv4()
  const header = input.version.header
  const params = buildDownstreamParams(input)
  const { error } = await supabaseAdmin.from('seal_requests').insert({
    id,
    org_id: input.org_id,
    created_by: null,
    quote_id: input.quote_id,
    source_version_id: input.version.id,
    reason: input.reason ?? null,
    customer_name: input.customer_name,
    total_amount: Number(header.total_amount ?? 0),
    business_params: params,
    status: 'pending',
  })
  if (error) {
    if (isDownstreamTableMissing(error)) {
      throw new Error('DERIVE_TABLES_MISSING: 数据库尚未应用报价下游派生迁移，请先执行 migration 20260820000002')
    }
    throw error
  }
  await recordDerivation(input, 'seal', id)
  return { id, type: 'seal' }
}

/** 派生标书数据包（供标书填写/审核盖章使用） */
export async function deriveTender(input: DeriveTenderInput): Promise<{ id: string; type: DerivationType }> {
  const id = uuidv4()
  const params = buildDownstreamParams(input)
  const { error } = await supabaseAdmin.from('tender_quote_packages').insert({
    id,
    org_id: input.org_id,
    created_by: null,
    quote_id: input.quote_id,
    source_version_id: input.version.id,
    title: input.title ?? `${input.customer_name} 标书数据包（源自报价 ${input.quote_no}）`,
    package_data: { ...params, customer_name: input.customer_name, customer_contact: input.customer_contact },
    status: 'draft',
  })
  if (error) {
    if (isDownstreamTableMissing(error)) {
      throw new Error('DERIVE_TABLES_MISSING: 数据库尚未应用报价下游派生迁移，请先执行 migration 20260820000002')
    }
    throw error
  }
  await recordDerivation(input, 'tender', id)
  return { id, type: 'tender' }
}
