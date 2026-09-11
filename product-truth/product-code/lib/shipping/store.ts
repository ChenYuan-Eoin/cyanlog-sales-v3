import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { ShippingRecord, ShippingInput } from './types'
export type StoredShipping = ShippingRecord & { request_payload?: ShippingInput | null; created_by: string; connection_key: string; fingerprint: string; idempotency_key: string }
export interface ShippingStore {
  reserve(row: StoredShipping): Promise<{ record: StoredShipping; inserted: boolean }>
  get(id: string, userId: string, connection: string): Promise<StoredShipping | null>
  finish(id: string, userId: string, status: ShippingRecord['status'], waybill: string | null): Promise<StoredShipping>
  recent(userId: string, connection: string): Promise<StoredShipping[]>
}
const columns = 'id,created_by,connection_key,fingerprint,idempotency_key,status,waybill,created_at,environment'
export const shippingStore: ShippingStore = {
  async reserve(row) {
    const { data, error } = await supabaseAdmin.from('shipping_requests').insert(row).select(columns).single()
    if (!error) return { record: data as StoredShipping, inserted: true }
    if (error.code !== '23505') throw new ShippingError(503, '寄件记录暂不可用，尚未向顺丰发单。')
    const existing = await this.get(row.id, row.created_by, row.connection_key)
    if (!existing) throw new ShippingError(409, '请求编号冲突，请刷新后查看最近寄件。')
    return { record: existing, inserted: false }
  },
  async get(id, userId, connection) {
    const { data, error } = await supabaseAdmin.from('shipping_requests').select(columns).eq('id', id).eq('created_by', userId).eq('connection_key', connection).maybeSingle()
    if (error) throw new ShippingError(503, '寄件记录读取失败，请稍后查询。')
    return data as StoredShipping | null
  },
  async finish(id, userId, status, waybill) {
    // Never downgrade an accepted record during concurrent reconciliation.
    let mutation = supabaseAdmin.from('shipping_requests').update({ status, waybill }).eq('id', id).eq('created_by', userId)
    mutation = status === 'accepted' ? mutation.or('status.neq.accepted,waybill.is.null') : mutation.neq('status', 'accepted')
    const { data, error } = await mutation.select(columns).maybeSingle()
    if (error) throw new ShippingError(503, '发单结果保存失败，请从最近寄件确认结果，勿重复寄件。')
    if (data) return data as StoredShipping
    const result = await supabaseAdmin.from('shipping_requests').select(columns).eq('id', id).eq('created_by', userId).single()
    if (result.error) throw new ShippingError(503, '请稍后查询原发单结果。')
    return result.data as StoredShipping
  },
  async recent(userId, connection) {
    const { data, error } = await supabaseAdmin.from('shipping_requests').select(columns).eq('created_by', userId).eq('connection_key', connection).order('created_at', { ascending: false }).limit(10)
    if (error) throw new ShippingError(503, '最近寄件暂不可用，请检查寄件存储配置。')
    return data as StoredShipping[]
  },
}
export function publicRecord(r: ShippingRecord): ShippingRecord { return { id: r.id, status: r.status, waybill: r.waybill, created_at: r.created_at, environment: r.environment } }
