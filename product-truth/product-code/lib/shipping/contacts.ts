import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { contactSchema, savedContactSchema, shippingInputSchema } from './validation'
import type { Contact, SavedShippingContact, ShippingInput } from './types'
import type { AuthUser } from '@/lib/auth'
import { loadDefaultShippingSender } from './sender-profile'

const NO_PROFILE_VERSION = '1970-01-01T00:00:00.000Z'
// A reserved fingerprint identifies one sender profile per user and organization.
// Content fingerprints belong to the ordinary address book and must not be reused.
const commonSenderFingerprint = (orgId: string) => `sender:${createHash('sha256').update(orgId).digest('hex')}`
const commonSenderLabel = '我的常用寄方'

async function latestCommonSender(userId: string, orgId: string) {
  const { data, error } = await supabaseAdmin.from('shipping_contacts')
    .select('id,contact,updated_at').eq('created_by', userId).eq('fingerprint', commonSenderFingerprint(orgId)).maybeSingle()
  if (error) throw new ShippingError(503, '常用寄件地址暂时无法读取，请稍后重试。')
  return data
}

export async function loadFxiaokeSenderChoices(user: AuthUser, orgId: string) {
  const [company, saved] = await Promise.all([loadDefaultShippingSender(orgId), latestCommonSender(user.id, orgId)])
  const raw = saved?.contact
  const parsed = contactSchema.safeParse(raw && {
    name: raw.name, phone: raw.phone, province: raw.province,
    city: raw.city, county: raw.county, address: raw.address,
  })
  const personal = parsed.success ? parsed.data : null
  const companyChoice = company.address ? company : null
  const personalChoice = personal
  const senderSource: 'personal' | 'company' | 'custom' = personalChoice ? 'personal' : companyChoice ? 'company' : 'custom'
  const sender = personalChoice || companyChoice || { name:user.display_name?.trim() || '', phone:user.phone || '', province:'', city:'', county:'', address:'' }
  return {
    id: user.id,
    email: user.email || '',
    identityName: user.display_name?.trim() || '',
    identityPhone: user.phone || '',
    sender,
    senderChoices: { company: companyChoice, personal: personalChoice },
    senderSource,
    team: typeof saved?.contact?.team === 'string' ? saved.contact.team : '',
    updatedAt: saved?.updated_at || NO_PROFILE_VERSION,
    fxiaoke: true as const,
  }
}

export async function saveFxiaokeCommonSender(user: AuthUser, orgId: string, contact: Contact, expectedUpdatedAt: string, team = '') {
  const current = await latestCommonSender(user.id, orgId)
  if ((current?.updated_at || NO_PROFILE_VERSION) !== expectedUpdatedAt) {
    throw new ShippingError(409, '常用寄件地址已在其他页面更新，请刷新后核对再保存。')
  }
  const savedContact = { ...contactSchema.parse(contact), team: team.trim().slice(0, 80) }
  const fingerprint = commonSenderFingerprint(orgId)
  const updatedAt = new Date().toISOString()
  if (current) {
    const { data, error } = await supabaseAdmin.from('shipping_contacts')
      .update({ contact: savedContact, updated_at: updatedAt })
      .eq('id', current.id).eq('created_by', user.id).eq('fingerprint', fingerprint)
      .eq('updated_at', expectedUpdatedAt).select('id').maybeSingle()
    if (error) throw new ShippingError(503, '常用寄件地址暂时无法保存，请稍后重试。')
    if (!data) throw new ShippingError(409, '常用寄件地址已在其他页面更新，请刷新后核对再保存。')
  } else {
    const { error } = await supabaseAdmin.from('shipping_contacts').insert({
      created_by: user.id, label: commonSenderLabel, contact: savedContact, fingerprint, updated_at: updatedAt,
    })
    if (error) throw new ShippingError(error.code === '23505' ? 409 : 503,
      error.code === '23505' ? '常用寄件地址已在其他页面创建，请刷新后核对再保存。' : '常用寄件地址暂时无法保存，请稍后重试。')
  }
  return loadFxiaokeSenderChoices(user, orgId)
}

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
    .eq('created_by', userId).order('updated_at', { ascending: false }).limit(1000)
  if (error) throw new ShippingError(503, '地址簿暂不可用，请稍后重试。')
  return (data || []).flatMap(row => { const result = savedContactSchema.safeParse(row.contact); return result.success ? [{ id: row.id, label: row.label, contact: result.data }] : [] })
}
export async function saveShippingContact(userId: string, label: string, contact: Contact, id?: string): Promise<SavedShippingContact> {
  const parsed = contactSchema.parse(contact)
  const fingerprint = createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
  if (id) {
    const { data, error } = await supabaseAdmin.from('shipping_contacts').update({ label, contact: parsed, fingerprint, updated_at: new Date().toISOString() }).eq('id', id).eq('created_by', userId).select('id,label,contact').maybeSingle()
    if (error) throw new ShippingError(409, '地址保存失败，可能与已有地址重复。')
    if (!data) throw new ShippingError(404, '地址不存在或无权修改。')
    return data as SavedShippingContact
  }
  const { data, error } = await supabaseAdmin.from('shipping_contacts').upsert({ created_by: userId, label, contact: parsed, fingerprint, updated_at: new Date().toISOString() }, { onConflict: 'created_by,fingerprint' }).select('id,label,contact').single()
  if (error) throw new ShippingError(503, '地址保存失败，请稍后重试。')
  return data as SavedShippingContact
}
