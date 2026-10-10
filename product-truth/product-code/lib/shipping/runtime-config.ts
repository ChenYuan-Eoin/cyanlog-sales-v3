import { createHash } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { ShippingError } from './config'
import { decryptShippingSecret } from './connections'
import { contactSchema } from './validation'
import { emptyContact, type Contact, type ShippingSettings, type ShippingPayment } from './types'

const servicesSchema = z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(40), preference: z.enum(['standard', 'urgent']).default('standard') })).max(20)
const credentialsSchema = z.object({ partnerId: z.string().min(1), checkWord: z.string().min(1) }).strict()

export type ShippingRuntimeConfig = {
  orgId: string
  connectionId: string
  environment: 'sandbox' | 'production'
  partnerId: string
  checkWord: string
  services: Array<{ id: number; name: string; preference: 'standard' | 'urgent' }>
  billingAccountId: string | null
  billingAccount: string
  billingAccountTail: string
  senderProfileId: string | null
  sender: Contact
  connectionKey: string
  snapshot: Record<string, unknown>
}

export function selectAuthorizedShippingService(services: ShippingRuntimeConfig['services'], preference?: 'standard' | 'urgent', serviceId?: number) {
  const selected = serviceId ? services.find(service => service.id === serviceId) : preference ? services.find(service => service.preference === preference) : services[0]
  if (!selected) throw new ShippingError(409, serviceId ? '所选服务未在当前月结账号中授权。' : '当前连接未配置与该寄件偏好匹配的服务。')
  return selected
}

export function productionOrderCapabilityAllowsAttempt(capability: string | null | undefined) {
  // The first real Production order is the only safe way to verify create-order
  // permission. The operator's final per-order confirmation is the gate; only a
  // capability explicitly marked unavailable should hard-block later attempts.
  return capability !== 'unavailable'
}

export async function loadShippingSettings(orgId: string): Promise<ShippingSettings> {
  const { data: connectionRows, error: connectionError } = await supabaseAdmin.from('shipping_carrier_connections')
    .select('id,environment,connection_status,authorized_services,order_capability,partner_id_tail')
    .eq('org_id', orgId).eq('carrier_key', 'sf').neq('connection_status', 'disabled').order('environment', { ascending: true })
  if (connectionError) throw new ShippingError(503, '寄件连接读取失败。')
  const { data: accountRows, error: accountError } = await supabaseAdmin.from('shipping_billing_accounts')
    .select('id,connection_id,display_name,account_tail,status,is_default').eq('org_id', orgId).eq('status', 'active').order('created_at', { ascending: true })
  if (accountError) throw new ShippingError(503, '月结账号读取失败。')
  const { data: sender, error: senderError } = await supabaseAdmin.from('shipping_sender_profiles')
    .select('display_name,name,phone,province,city,county,address').eq('org_id', orgId).eq('is_default', true).maybeSingle()
  if (senderError) throw new ShippingError(503, '默认寄件人资料读取失败。')

  const connections = connectionRows || []
  const accounts = accountRows || []
  const preferred = connections.find(row => row.environment === 'sandbox' && row.connection_status === 'connected')
    || connections.find(row => row.environment === 'production' && row.connection_status === 'connected')
    || connections.find(row => row.environment === 'sandbox')
    || connections[0]
  const matchingAccounts = preferred ? accounts.filter(row => row.connection_id === preferred.id) : []
  const defaultAccount = matchingAccounts.find(row => row.is_default) || matchingAccounts[0]
  const services = preferred ? servicesSchema.safeParse(preferred.authorized_services || []) : null
  const normalizedServices = services?.success ? services.data : []
  const contact = sender ? { name: sender.name, phone: sender.phone, province: sender.province, city: sender.city, county: sender.county, address: sender.address } : { name: '', phone: '', province: '', city: '', county: '', address: '' }
  const connected = preferred?.connection_status === 'connected'
  const senderReady = Boolean(sender && sender.name && sender.phone && sender.address)
  const monthlyReady = Boolean(defaultAccount)
  const productionAuthorized = preferred?.environment !== 'production' || productionOrderCapabilityAllowsAttempt(preferred?.order_capability)
  const ready = Boolean(connected && senderReady && normalizedServices.length)
  const canSubmit = ready && monthlyReady && productionAuthorized
  const publicSettings: ShippingSettings = {
    environment: preferred?.environment || 'sandbox', ready, canSubmit,
    reason: !preferred ? '尚未配置快递平台连接。' : !connected ? '快递连接尚未通过当前环境只读连通检查。' : !senderReady ? '尚未配置公司默认寄件人。' : !monthlyReady ? '尚未绑定活动月结账号。' : !normalizedServices.length ? '尚未配置已授权服务产品。' : !productionAuthorized ? 'Production下单能力标记为不可用，请联系配置管理员复核。' : '',
    services: normalizedServices, sender: contact, monthlyTail: defaultAccount?.account_tail || '', connectionId: preferred?.id || '', defaultBillingAccountId: defaultAccount?.id || '',
    carrierConnections: connections.map(row => ({ id: row.id, carrier: 'sf', environment: row.environment, status: row.connection_status, orderCapability: row.order_capability, services: servicesSchema.safeParse(row.authorized_services || []).success ? servicesSchema.parse(row.authorized_services || []) : [] })),
    billingAccounts: accounts.map(row => ({ id: row.id, connectionId: row.connection_id, displayName: row.display_name, tail: row.account_tail, environment: connections.find(item => item.id === row.connection_id)?.environment || 'sandbox', isDefault: row.is_default, status: row.status }))
  }
  return publicSettings
}

export async function getUserShippingSettings(userId: string) {
  const orgId = await getDefaultOrgId(userId)
  if (!orgId) throw new ShippingError(403, '当前账号没有可用的组织寄件配置。')
  return { orgId, settings: await loadShippingSettings(orgId) }
}

export async function getPublicShippingDefaults(): Promise<{ orgId: string; sender: Contact }> {
  const { data, error } = await supabaseAdmin.from('shipping_sender_profiles')
    .select('org_id,name,phone,province,city,county,address').eq('is_default', true).limit(2)
  if (error) throw new ShippingError(503, '公司默认寄件配置暂不可用。')
  if (data?.length !== 1 || !data[0].org_id) throw new ShippingError(503, data?.length ? '公开寄件入口需要明确绑定一个公司组织。' : '公司默认寄件地址尚未配置，请联系管理员。')
  const row = data[0]
  return { orgId: row.org_id, sender: { name: row.name, phone: row.phone, province: row.province, city: row.city, county: row.county, address: row.address } }
}

export async function resolvePublicShippingOrgId() {
  // The public company deployment is unambiguous only with a single organization.
  // Caller-provided organization IDs are never accepted and no carrier setup is required.
  const { data, error } = await supabaseAdmin.from('organizations').select('id').limit(2)
  if (error) throw new ShippingError(503, '公开提报入口暂不可用。')
  if (data?.length !== 1 || !data[0].id) throw new ShippingError(503, '公开入口需要绑定明确的公司组织。')
  return String(data[0].id)
}
export async function getPublicDefaultSender(): Promise<Contact> { return (await getPublicShippingDefaults()).sender }

export async function getShippingRuntimeConfig(args: { orgId: string; billingAccountId?: string | null; connectionId?: string; payment?: ShippingPayment; requireOrderCapability?: boolean; allowHistorical?: boolean; senderOverride?: Contact }): Promise<ShippingRuntimeConfig> {
  const suppliedSender = args.senderOverride === undefined ? undefined : contactSchema.safeParse(args.senderOverride)
  if (suppliedSender && !suppliedSender.success) throw new ShippingError(400, '工单寄件人资料不完整或格式无效，请退回补齐。', 'validation')
  if (!args.orgId?.trim()) throw new ShippingError(403, '缺少组织范围。')
  const payment = args.payment || 'sender_monthly'
  const monthlyRequired = args.requireOrderCapability !== false && payment === 'sender_monthly'
  let account: { id: string; connection_id: string; account_ciphertext: string; account_tail: string } | null = null
  // A stored connection is sufficient for query/cancel/tracking. A new cash or
  // recipient-paid order must not depend on reading a monthly billing account.
  const billingAccountId = monthlyRequired || args.requireOrderCapability === false ? args.billingAccountId : undefined
  if (monthlyRequired || billingAccountId) {
    let accountQuery = supabaseAdmin.from('shipping_billing_accounts').select('id,connection_id,account_ciphertext,account_tail,status').eq('org_id', args.orgId)
    if (!args.allowHistorical) accountQuery = accountQuery.eq('status', 'active')
    if (billingAccountId) accountQuery = accountQuery.eq('id', billingAccountId)
    else {
      accountQuery = accountQuery.eq('is_default', true)
      if (args.connectionId) accountQuery = accountQuery.eq('connection_id', args.connectionId)
    }
    const { data, error } = await accountQuery.maybeSingle()
    if (error) throw new ShippingError(503, '月结账号读取失败。')
    account = data
    if (!account && (monthlyRequired || billingAccountId)) throw new ShippingError(409, billingAccountId ? '所选月结账号不存在或已停用。' : '请先设置一个活动的默认月结账号。')
  }
  if (args.connectionId && account && account.connection_id !== args.connectionId) throw new ShippingError(409, '所选月结账号与快递连接不匹配。')
  const connectionId = args.connectionId || account?.connection_id
  if (!connectionId) throw new ShippingError(409, '请先选择快递连接。')

  const { data: connection, error: connectionError } = await supabaseAdmin.from('shipping_carrier_connections')
    .select('id,environment,credentials_ciphertext,connection_status,authorized_services,order_capability,partner_id_tail')
    .eq('org_id', args.orgId).eq('id', connectionId).eq('carrier_key', 'sf').maybeSingle()
  if (connectionError) throw new ShippingError(503, '快递连接读取失败。')
  if (!connection || (!args.allowHistorical && connection.connection_status !== 'connected')) throw new ShippingError(409, '所选快递连接尚未通过当前环境连通检查。')
  if (connection.environment === 'production' && args.requireOrderCapability !== false && !productionOrderCapabilityAllowsAttempt(connection.order_capability)) throw new ShippingError(409, 'Production下单能力标记为不可用，请联系配置管理员复核。')
  let senderContact = emptyContact(), senderProfileId: string | null = null
  let senderSource = 'not_required'
  if (suppliedSender?.success) {
    senderContact = suppliedSender.data
    senderSource = 'workorder'
  } else if (args.requireOrderCapability !== false) {
    const { data: sender, error: senderError } = await supabaseAdmin.from('shipping_sender_profiles')
      .select('id,name,phone,province,city,county,address').eq('org_id', args.orgId).eq('is_default', true).maybeSingle()
    if (senderError || !sender) throw new ShippingError(409, '请先保存公司默认寄件人信息。')
    const parsed = contactSchema.safeParse({ name: sender.name, phone: sender.phone, province: sender.province, city: sender.city, county: sender.county, address: sender.address })
    if (!parsed.success) throw new ShippingError(400, '公司默认寄件人资料不完整或格式无效，请先补齐。', 'validation')
    senderContact = parsed.data
    senderProfileId = sender.id
    senderSource = 'company_default'
  }
  // Lookup, tracking and cancellation use stored provider identifiers. They do
  // not need a current company sender and never rewrite the order's sender.

  let credentials: z.infer<typeof credentialsSchema>
  let billingAccount: string
  try {
    credentials = credentialsSchema.parse(JSON.parse(decryptShippingSecret(connection.credentials_ciphertext)))
    billingAccount = account ? decryptShippingSecret(account.account_ciphertext) : ''
  } catch (error) {
    if (error instanceof ShippingError) throw error
    throw new ShippingError(503, '寄件连接凭据无法读取，请由配置管理员重新保存。')
  }
  const services = servicesSchema.safeParse(connection.authorized_services || [])
  if (!services.success || (args.requireOrderCapability !== false && services.data.length === 0)) throw new ShippingError(409, '该连接尚未配置已授权服务产品。')
  const environment = connection.environment as 'sandbox' | 'production'
  const connectionKey = createHash('sha256').update([args.orgId, connection.id, account?.id || 'no-monthly-account', environment].join(':')).digest('hex')
  const snapshot = { carrier: 'sf', connectionId: connection.id, environment, billingAccountId: account?.id || null, billingAccountTail: account?.account_tail || '', senderProfileId, senderSource, ...(args.requireOrderCapability === false ? {} : { payment }), services: services.data }
  return { orgId: args.orgId, connectionId: connection.id, environment, ...credentials, services: services.data, billingAccountId: account?.id || null, billingAccount, billingAccountTail: account?.account_tail || '', senderProfileId, sender: senderContact, connectionKey, snapshot }
}
