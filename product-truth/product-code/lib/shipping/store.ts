import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { ShippingRecord, ShippingInput } from './types'
export type StoredShipping = ShippingRecord & { request_payload?: ShippingInput | null; created_by: string; connection_key: string; fingerprint: string; idempotency_key: string; org_id?: string | null; carrier_connection_id?: string | null; billing_account_id?: string | null; sender_profile_id?: string | null; billing_account_tail?: string | null; shipping_config_snapshot?: Record<string, unknown> | null }
export interface ShippingStore {
  reserve(row: StoredShipping): Promise<{ record: StoredShipping; inserted: boolean }>
  get(id: string, userId: string, connection?: string): Promise<StoredShipping | null>
  finish(id: string, userId: string, status: ShippingRecord['status'], waybill: string | null): Promise<StoredShipping>
  recent(userId: string, connection?: string): Promise<StoredShipping[]>
}
const columns = 'id,created_by,connection_key,fingerprint,idempotency_key,status,waybill,created_at,environment,org_id,carrier_connection_id,billing_account_id,sender_profile_id,billing_account_tail,shipping_config_snapshot'
function requireOrganization(orgId: string) {
  if (typeof orgId !== 'string' || !orgId.trim()) throw new ShippingError(403, '当前请求缺少组织寄件授权。')
}

export function shippingStoreForOrg(orgId: string): ShippingStore {
  requireOrganization(orgId)
  const store: ShippingStore = {
  async reserve(row) {
    if (row.org_id !== orgId) throw new ShippingError(403, '寄件记录不属于当前授权组织。')
    const { data, error } = await supabaseAdmin.from('shipping_requests').insert(row).select(columns).single()
    if (!error && data?.org_id === orgId) return { record: data as StoredShipping, inserted: true }
    if (!error) throw new ShippingError(503, '寄件记录归属核验失败。')
    if (error.code !== '23505') throw new ShippingError(503, '寄件记录暂不可用，尚未向顺丰发单。')
    const existing = await store.get(row.id, row.created_by, row.connection_key)
    if (!existing) throw new ShippingError(409, '请求编号冲突，请刷新后查看最近寄件。')
    return { record: existing, inserted: false }
  },
  async get(id, userId, connection) {
    let query = supabaseAdmin.from('shipping_requests').select(columns).eq('org_id', orgId).eq('id', id).eq('created_by', userId)
    if (connection) query = query.eq('connection_key', connection)
    const { data, error } = await query.maybeSingle()
    if (error) throw new ShippingError(503, '寄件记录读取失败，请稍后查询。')
    return data?.org_id === orgId ? data as StoredShipping : null
  },
  async finish(id, userId, status, waybill) {
    const current = await store.get(id, userId)
    if (!current) throw new ShippingError(404, '未找到当前组织内本人的寄件记录。')
    if (current.status === 'accepted' && (status !== 'accepted' || current.waybill)) return current
    // Never downgrade an accepted record during concurrent reconciliation.
    let mutation = supabaseAdmin.from('shipping_requests').update({ status, waybill }).eq('org_id', orgId).eq('id', id).eq('created_by', userId)
    mutation = status === 'accepted' ? mutation.or('status.neq.accepted,waybill.is.null') : mutation.neq('status', 'accepted')
    const { data, error } = await mutation.select(columns).maybeSingle()
    if (error) throw new ShippingError(503, '发单结果保存失败，请从最近寄件确认结果，勿重复寄件。')
    if (data?.org_id === orgId) return data as StoredShipping
    const result = await store.get(id, userId)
    if (!result) throw new ShippingError(503, '请稍后查询原发单结果。')
    return result
  },
  async recent(userId, connection) {
    let query = supabaseAdmin.from('shipping_requests').select(columns).eq('org_id', orgId).eq('created_by', userId)
    if (connection) query = query.eq('connection_key', connection)
    const { data, error } = await query.order('created_at', { ascending: false }).limit(10)
    if (error) throw new ShippingError(503, '最近寄件暂不可用，请检查寄件存储配置。')
    return (data || []).filter(row => row.org_id === orgId) as StoredShipping[]
  },
  }
  return store
}
export async function getOwnedShippingWaybill(userId: string, orgId: string, waybill: string): Promise<StoredShipping | null> {
  requireOrganization(orgId)
  const { data, error } = await supabaseAdmin.from('shipping_requests').select(columns).eq('org_id', orgId).eq('created_by', userId).eq('waybill', waybill).eq('status', 'accepted').maybeSingle()
  if (error) throw new ShippingError(503, '暂未能核对运单归属。')
  return data?.org_id === orgId ? data as StoredShipping : null
}
export function publicRecord(r: ShippingRecord): ShippingRecord { return { id: r.id, status: r.status, waybill: r.waybill, created_at: r.created_at, environment: r.environment } }
