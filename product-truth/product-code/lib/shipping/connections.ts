import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { Contact } from './types'

const credentialSchema = z.object({ partnerId: z.string().trim().min(1).max(64), checkWord: z.string().trim().min(1).max(256), environment: z.enum(['sandbox', 'production']) }).strict()
const accountSchema = z.object({ accountNumber: z.string().trim().regex(/^[0-9]{4,32}$/), displayName: z.string().trim().min(1).max(80), environment: z.enum(['sandbox', 'production']).default('sandbox'), isDefault: z.boolean().optional() }).strict()
const senderSchema = z.object({ displayName: z.string().trim().min(1).max(80), contact: z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().min(6).max(32), province: z.string().trim().min(1).max(80), city: z.string().trim().min(1).max(80), county: z.string().trim().min(1).max(80), address: z.string().trim().min(1).max(240) }).strict() }).strict()

export type CarrierEnvironment = 'sandbox' | 'production'
export type ShippingConfiguration = {
  connections: Array<{ id: string; carrier: 'sf'; environment: CarrierEnvironment; partnerIdTail: string; status: string; capabilities: { order: string; query: string; tracking: string; cancel: string }; lastTestedAt: string | null }>
  billingAccounts: Array<{ id: string; connectionId: string; environment: CarrierEnvironment; displayName: string; tail: string; status: 'active' | 'inactive'; isDefault: boolean }>
  sender: (Contact & { displayName: string }) | null
}

function masterKey(env: Record<string, string | undefined> = process.env) {
  const value = env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY || ''
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new ShippingError(503, '寄件凭据加密密钥尚未配置。')
  return Buffer.from(value, 'hex')
}

function encryptionKey(env: Record<string, string | undefined> = process.env) {
  return createHmac('sha256', masterKey(env)).update('shipping:credential-encryption:aes-256-gcm:v1').digest()
}

function fingerprintKey(env: Record<string, string | undefined> = process.env) {
  return createHmac('sha256', masterKey(env)).update('shipping:billing-account-fingerprint:v1').digest()
}

export function encryptShippingSecret(value: string, env: Record<string, string | undefined> = process.env) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

export function decryptShippingSecret(value: string, env: Record<string, string | undefined> = process.env) {
  const [version, encodedIv, encodedTag, encodedData, extra] = value.split('.')
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedData || extra) throw new ShippingError(503, '寄件凭据无法解密，请由配置管理员重新保存。')
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(encodedIv, 'base64url'))
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encodedData, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new ShippingError(503, '寄件凭据无法解密，请检查加密密钥或重新保存配置。')
  }
}

function databaseError() { return new ShippingError(503, '寄件配置保存失败，请检查数据库迁移与服务端连接。') }

export async function loadShippingConfiguration(orgId: string): Promise<ShippingConfiguration> {
  const [connections, accounts, sender] = await Promise.all([
    supabaseAdmin.from('shipping_carrier_connections').select('id,carrier_key,environment,partner_id_tail,connection_status,order_capability,query_capability,tracking_capability,cancel_capability,last_tested_at').eq('org_id', orgId).order('created_at', { ascending: true }),
    supabaseAdmin.from('shipping_billing_accounts').select('id,connection_id,display_name,account_tail,status,is_default').eq('org_id', orgId).order('created_at', { ascending: true }),
    supabaseAdmin.from('shipping_sender_profiles').select('display_name,name,phone,province,city,county,address').eq('org_id', orgId).eq('is_default', true).maybeSingle()
  ])
  if (connections.error || accounts.error || sender.error) throw databaseError()
  return {
    connections: (connections.data || []).map((row) => ({ id: row.id, carrier: 'sf', environment: row.environment, partnerIdTail: row.partner_id_tail, status: row.connection_status, capabilities: { order: row.order_capability, query: row.query_capability, tracking: row.tracking_capability, cancel: row.cancel_capability }, lastTestedAt: row.last_tested_at })),
    billingAccounts: (accounts.data || []).map((row) => ({ id: row.id, connectionId: row.connection_id, environment: (connections.data || []).find(connection => connection.id === row.connection_id)?.environment === 'production' ? 'production' : 'sandbox', displayName: row.display_name, tail: row.account_tail, status: row.status, isDefault: row.is_default })),
    sender: sender.data ? { displayName: sender.data.display_name, name: sender.data.name, phone: sender.data.phone, province: sender.data.province, city: sender.data.city, county: sender.data.county, address: sender.data.address } : null
  }
}

export async function saveCarrierCredentials(orgId: string, userId: string, input: unknown) {
  const parsed = credentialSchema.parse(input)
  const credentials = JSON.stringify({ partnerId: parsed.partnerId, checkWord: parsed.checkWord })
  const { data, error } = await supabaseAdmin.from('shipping_carrier_connections').upsert({
    org_id: orgId, carrier_key: 'sf', environment: parsed.environment,
    credentials_ciphertext: encryptShippingSecret(credentials), partner_id_tail: parsed.partnerId.slice(-4),
    connection_status: 'configured', order_capability: 'not_tested', query_capability: 'not_tested', tracking_capability: 'not_tested', cancel_capability: 'not_tested',
    last_tested_at: null, created_by: userId, updated_by: userId
  }, { onConflict: 'org_id,carrier_key,environment' }).select('id').single()
  if (error || !data) throw databaseError()
  return loadShippingConfiguration(orgId)
}

export async function saveBillingAccount(orgId: string, userId: string, input: unknown) {
  const parsed = accountSchema.parse(input)
  const config = await loadShippingConfiguration(orgId)
  const connection = config.connections.find((item) => item.carrier === 'sf' && item.environment === parsed.environment)
  if (!connection) throw new ShippingError(409, `请先保存顺丰${parsed.environment === 'sandbox' ? '沙盒' : '生产'}连接资料。`)
  const makeDefault = parsed.isDefault || !config.billingAccounts.some(account => account.connectionId === connection.id && account.status === 'active' && account.isDefault)
  const key = fingerprintKey()
  const accountFingerprint = createHmac('sha256', key).update(`billing-account:${parsed.accountNumber}`).digest('hex')
  if (makeDefault) {
    const { error } = await supabaseAdmin.from('shipping_billing_accounts').update({ is_default: false, updated_by: userId, updated_at: new Date().toISOString() }).eq('org_id', orgId).eq('connection_id', connection.id).eq('is_default', true)
    if (error) throw databaseError()
  }
  const { error } = await supabaseAdmin.from('shipping_billing_accounts').upsert({
    org_id: orgId, connection_id: connection.id, account_ciphertext: encryptShippingSecret(parsed.accountNumber), account_fingerprint: accountFingerprint,
    account_tail: parsed.accountNumber.slice(-4), display_name: parsed.displayName, status: 'active', is_default: makeDefault, updated_by: userId, updated_at: new Date().toISOString()
  }, { onConflict: 'org_id,connection_id,account_fingerprint' })
  if (error) throw databaseError()
  return loadShippingConfiguration(orgId)
}

export async function updateBillingAccount(orgId: string, userId: string, accountId: string, action: 'default' | 'deactivate') {
  if (action === 'default') {
    const { data: account, error: lookupError } = await supabaseAdmin.from('shipping_billing_accounts').select('id,connection_id,status').eq('org_id', orgId).eq('id', accountId).maybeSingle()
    if (lookupError || !account) throw new ShippingError(404, '月结账号不存在。')
    if (account.status !== 'active') throw new ShippingError(409, '已停用账号不能设为默认。')
    const { error: unsetError } = await supabaseAdmin.from('shipping_billing_accounts').update({ is_default: false, updated_by: userId, updated_at: new Date().toISOString() }).eq('org_id', orgId).eq('connection_id', account.connection_id).eq('is_default', true)
    if (unsetError) throw databaseError()
  }
  const update = action === 'default' ? { is_default: true, updated_by: userId, updated_at: new Date().toISOString() } : { is_default: false, status: 'inactive', updated_by: userId, updated_at: new Date().toISOString() }
  const { data, error } = await supabaseAdmin.from('shipping_billing_accounts').update(update).eq('org_id', orgId).eq('id', accountId).eq('status', 'active').select('id').maybeSingle()
  if (error) throw databaseError()
  if (!data) throw new ShippingError(404, '可用月结账号不存在。')
  return loadShippingConfiguration(orgId)
}

export async function saveDefaultSender(orgId: string, userId: string, input: unknown) {
  const parsed = senderSchema.parse(input)
  const contact = parsed.contact
  const { data: current, error: lookupError } = await supabaseAdmin.from('shipping_sender_profiles').select('id').eq('org_id', orgId).eq('is_default', true).maybeSingle()
  if (lookupError) throw databaseError()
  const row = { display_name: parsed.displayName, ...contact, is_default: true, updated_by: userId, updated_at: new Date().toISOString() }
  const result = current
    ? await supabaseAdmin.from('shipping_sender_profiles').update(row).eq('org_id', orgId).eq('id', current.id)
    : await supabaseAdmin.from('shipping_sender_profiles').insert({ org_id: orgId, ...row, created_by: userId })
  if (result.error) throw databaseError()
  return loadShippingConfiguration(orgId)
}

export async function getSandboxProbeCredentials(orgId: string) {
  const { data, error } = await supabaseAdmin.from('shipping_carrier_connections').select('id,credentials_ciphertext,connection_status').eq('org_id', orgId).eq('carrier_key', 'sf').eq('environment', 'sandbox').maybeSingle()
  if (error) throw databaseError()
  if (!data) throw new ShippingError(409, '请先保存顺丰沙盒连接资料。')
  const credentials = credentialSchema.pick({ partnerId: true, checkWord: true }).parse(JSON.parse(decryptShippingSecret(data.credentials_ciphertext)))
  return { id: data.id as string, ...credentials }
}

export async function recordSandboxProbe(orgId: string, connectionId: string, connected: boolean) {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('shipping_carrier_connections').update({ connection_status: connected ? 'connected' : 'failed', last_tested_at: now, updated_at: now }).eq('org_id', orgId).eq('id', connectionId)
  if (error) throw databaseError()
  return loadShippingConfiguration(orgId)
}

export type { Contact }
