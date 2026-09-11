import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { contactSchema, shippingInputSchema } from './validation'
import type { Contact, SavedShippingContact, ShippingInput } from './types'

export async function lastShippingInput(userId: string, connectionKey: string): Promise<ShippingInput | undefined> {
  const { data, error } = await supabaseAdmin.from('shipping_requests').select('request_payload')
    .eq('created_by', userId).eq('connection_key', connectionKey).eq('status', 'accepted')
    .not('request_payload', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new ShippingError(503, '暂未能读取上次寄件信息，可手工填写。')
  const parsed = shippingInputSchema.safeParse(data?.request_payload)
  return parsed.success ? parsed.data : undefined
}
export async function listShippingContacts(userId: string): Promise<SavedShippingContact[]> {
  const { data, error } = await supabaseAdmin.from('shipping_contacts').select('id,label,contact')
    .eq('created_by', userId).order('updated_at', { ascending: false }).limit(100)
  if (error) throw new ShippingError(503, '地址簿暂不可用，请稍后重试。')
  return (data || []).flatMap(row => { const result = contactSchema.safeParse(row.contact); return result.success ? [{ id: row.id, label: row.label, contact: result.data }] : [] })
}
export async function saveShippingContact(userId: string, label: string, contact: Contact): Promise<SavedShippingContact> {
  const parsed = contactSchema.parse(contact)
  const fingerprint = createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
  const { data, error } = await supabaseAdmin.from('shipping_contacts').upsert({ created_by: userId, label, contact: parsed, fingerprint, updated_at: new Date().toISOString() }, { onConflict: 'created_by,fingerprint' }).select('id,label,contact').single()
  if (error) throw new ShippingError(503, '地址保存失败，请稍后重试。')
  return data as SavedShippingContact
}
