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

export interface DeriveOrderInput extends DeriveSource { actor_id: string; order_no?: string }
export interface DeriveSealInput extends DeriveSource { actor_id: string; reason?: string }
export interface DeriveTenderInput extends DeriveSource { actor_id: string; title?: string }

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

async function persistDerivation(
  input: DeriveSource & { actor_id: string },
  type: DerivationType,
  target: Record<string, unknown>,
): Promise<void> {
  if (!input.actor_id) throw new Error('DERIVE_ACTOR_REQUIRED')
  const { data, error } = await supabaseAdmin.rpc('persist_quote_derivation_v1', {
    p_org_id: input.org_id,
    p_actor_id: input.actor_id,
    p_quote_id: input.quote_id,
    p_version_id: input.version.id,
    p_type: type,
    p_target: target,
  })
  if (error) {
    if (isSchemaDriftError(error) || error.code === 'PGRST202') {
      throw new Error('DERIVE_TABLES_MISSING: 报价派生数据库结构尚未就绪，请联系管理员完成迁移')
    }
    throw error
  }
  if (data !== target.id) throw new Error('DERIVE_RECEIPT_MISMATCH')
}

/** 派生销售订单草稿 */
export async function deriveOrder(input: DeriveOrderInput): Promise<{ id: string; type: DerivationType }> {
  const id = uuidv4()
  const header = input.version.header
  const params = buildDownstreamParams(input)
  await persistDerivation(input, 'order', {
    id,
    org_id: input.org_id,
    created_by: input.actor_id,
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
  return { id, type: 'order' }
}

/** 派生盖章申请 */
export async function deriveSeal(input: DeriveSealInput): Promise<{ id: string; type: DerivationType }> {
  const id = uuidv4()
  const header = input.version.header
  const params = buildDownstreamParams(input)
  await persistDerivation(input, 'seal', {
    id,
    org_id: input.org_id,
    created_by: input.actor_id,
    quote_id: input.quote_id,
    source_version_id: input.version.id,
    reason: input.reason ?? null,
    customer_name: input.customer_name,
    total_amount: Number(header.total_amount ?? 0),
    business_params: params,
    status: 'pending',
  })
  return { id, type: 'seal' }
}

/** 派生标书数据包（供标书填写/审核盖章使用） */
export async function deriveTender(input: DeriveTenderInput): Promise<{ id: string; type: DerivationType }> {
  const id = uuidv4()
  const params = buildDownstreamParams(input)
  await persistDerivation(input, 'tender', {
    id,
    org_id: input.org_id,
    created_by: input.actor_id,
    quote_id: input.quote_id,
    source_version_id: input.version.id,
    title: input.title ?? `${input.customer_name} 标书数据包（源自报价 ${input.quote_no}）`,
    package_data: { ...params, customer_name: input.customer_name, customer_contact: input.customer_contact },
    status: 'draft',
  })
  return { id, type: 'tender' }
}
