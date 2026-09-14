import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { ImportedOutbound } from './types'

export async function listImportedOutbound(userId: string): Promise<ImportedOutbound[]> {
  const { data, error } = await supabaseAdmin.from('shipping_outbound_imports')
    .select('id,waybill,source_time,source_status,imported_at')
    .eq('created_by', userId).order('source_rank', { ascending: true }).limit(1000)
  if (error) throw new ShippingError(503, '暂未能读取本人历史寄件，请稍后刷新。')
  return data || []
}

export async function importedOutboundSuffix(userId: string, waybill: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('shipping_outbound_imports')
    .select('verification_suffix').eq('created_by', userId).eq('waybill', waybill).maybeSingle()
  if (error) throw new ShippingError(503, '暂未能核对本人运单归属，请稍后重试。')
  return data?.verification_suffix || null
}
