import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { emptyContact, type Contact } from './types'

// Intake needs a sender profile, not carrier credentials, services or billing.
export async function loadDefaultShippingSender(orgId: string): Promise<Contact> {
  if (!orgId?.trim()) throw new ShippingError(403, '缺少组织范围。')
  const { data, error } = await supabaseAdmin.from('shipping_sender_profiles')
    .select('name,phone,province,city,county,address').eq('org_id', orgId).eq('is_default', true).maybeSingle()
  if (error) throw new ShippingError(503, '默认寄件资料暂时无法读取，请稍后重试。')
  if (!data) return emptyContact()
  return { name: data.name, phone: data.phone, province: data.province, city: data.city, county: data.county, address: data.address }
}
