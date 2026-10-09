import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { decryptShippingSecret, encryptShippingSecret } from './connections'
import { normalizeCompanyEmailDomains, normalizeEmployeeEmail } from './company-email'
import { verifyCompanyMailer, CompanyMailError, type CompanyMailerConfig } from './company-mailer'

type SettingsRow = {
  org_id: string; enabled: boolean; allowed_domains: string[]; smtp_host: string | null
  smtp_port: 465 | 587; smtp_secure: boolean; from_email: string | null; from_name: string
  credentials_ciphertext: string | null; connection_status: 'unconfigured' | 'configured' | 'verified' | 'failed'
  last_tested_at: string | null; last_error_kind: CompanyMailError['reason'] | null; updated_at: string
}
export type CompanyEmailSettings = {
  enabled: boolean; allowedDomains: string[]; smtpHost: string; smtpPort: 465 | 587
  fromEmail: string; fromName: string; hasCredentials: boolean
  connectionStatus: SettingsRow['connection_status']; lastTestedAt: string | null; updatedAt: string | null
  lastErrorKind: CompanyMailError['reason'] | null
}
const columns = 'org_id,enabled,allowed_domains,smtp_host,smtp_port,smtp_secure,from_email,from_name,credentials_ciphertext,connection_status,last_tested_at,last_error_kind,updated_at'
const credentialsSchema = z.object({ kind: z.literal('shipping_smtp'), host: z.string(), username: z.email(), password: z.string().min(1).max(1024) }).strict()
const saveSchema = z.object({
  enabled: z.boolean(), allowedDomains: z.array(z.string()).max(20),
  smtpHost: z.string().trim().toLowerCase().max(253), smtpPort: z.union([z.literal(465), z.literal(587)]),
  fromEmail: z.string().trim().max(254), fromName: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/),
  password: z.string().min(1).max(1024).refine(value => value.trim().length > 0).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict()

async function readSettings(orgId: string): Promise<SettingsRow | null> {
  if (!orgId) throw new ShippingError(403, '缺少组织范围。')
  const { data, error } = await supabaseAdmin.from('shipping_email_access_settings').select(columns).eq('org_id', orgId).maybeSingle()
  if (error) throw new ShippingError(503, '邮箱验证配置暂不可用。')
  return data as SettingsRow | null
}
function toPublicSettings(row: SettingsRow | null): CompanyEmailSettings {
  return {
    enabled: row?.enabled ?? false, allowedDomains: row?.allowed_domains ?? [],
    smtpHost: row?.smtp_host ?? '', smtpPort: row?.smtp_port ?? 465,
    fromEmail: row?.from_email ?? '', fromName: row?.from_name ?? '自助收寄',
    hasCredentials: Boolean(row?.credentials_ciphertext), connectionStatus: row?.connection_status ?? 'unconfigured',
    lastTestedAt: row?.last_tested_at ?? null, updatedAt: row?.updated_at ?? null,
    lastErrorKind: row?.last_error_kind ?? null,
  }
}
export async function loadCompanyEmailSettings(orgId: string) { return toPublicSettings(await readSettings(orgId)) }

export async function saveCompanyEmailSettings(orgId: string, userId: string, input: unknown) {
  const parsed = saveSchema.parse(input)
  const allowedDomains = normalizeCompanyEmailDomains(parsed.allowedDomains)
  const current = await readSettings(orgId)
  if ((current?.updated_at ?? null) !== parsed.expectedUpdatedAt) throw new ShippingError(409, '邮箱配置已更新，请刷新后再保存。')
  const fromEmail = parsed.fromEmail ? normalizeEmployeeEmail(parsed.fromEmail) : null
  if (parsed.smtpHost && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(parsed.smtpHost)) throw new ShippingError(400, '请填写合法的SMTP服务器域名。')
  const destinationChanged = Boolean(current && (current.smtp_host !== (parsed.smtpHost || null) || current.from_email !== fromEmail))
  if (destinationChanged && current?.credentials_ciphertext && !parsed.password) throw new ShippingError(400, '变更发信邮箱或SMTP服务器时，请重新填写对应的授权信息。')
  if (parsed.password && (!parsed.smtpHost || !fromEmail)) throw new ShippingError(400, '请先填写SMTP服务器和系统发信邮箱。')
  const credentials = parsed.password
    ? encryptShippingSecret(JSON.stringify({ kind: 'shipping_smtp', host: parsed.smtpHost, username: fromEmail, password: parsed.password }))
    : current?.credentials_ciphertext ?? null
  if (parsed.enabled && (!allowedDomains.length || !parsed.smtpHost || !fromEmail || !credentials)) throw new ShippingError(400, '请先补齐公司邮箱域和发信配置，再启用员工入口。')
  const changed = !current || destinationChanged || Boolean(parsed.password) || current.smtp_port !== parsed.smtpPort
  const row = { org_id: orgId, enabled: parsed.enabled, allowed_domains: allowedDomains, smtp_host: parsed.smtpHost || null, smtp_port: parsed.smtpPort, smtp_secure: parsed.smtpPort === 465, from_email: fromEmail, from_name: parsed.fromName, credentials_ciphertext: credentials, connection_status: changed ? credentials ? 'configured' : 'unconfigured' : current.connection_status, last_tested_at: changed ? null : current.last_tested_at, last_error_kind: changed ? null : current.last_error_kind, updated_by: userId, updated_at: new Date().toISOString() }
  const result = current
    ? await supabaseAdmin.from('shipping_email_access_settings').update(row).eq('org_id', orgId).eq('updated_at', current.updated_at).select(columns).maybeSingle()
    : await supabaseAdmin.from('shipping_email_access_settings').insert(row).select(columns).single()
  if (result.error || !result.data) throw new ShippingError(result.error?.code === '23505' || !result.error ? 409 : 503, '邮箱配置未能保存，请刷新配置后重试。')
  return toPublicSettings(result.data as SettingsRow)
}

export async function loadCompanyMailerConfig(orgId: string): Promise<{ settings: SettingsRow; mailer: CompanyMailerConfig }> {
  const settings = await readSettings(orgId)
  if (!settings?.credentials_ciphertext || !settings.smtp_host || !settings.from_email) throw new ShippingError(503, '系统发信邮箱尚未配置。')
  let credentials: z.infer<typeof credentialsSchema>
  try { credentials = credentialsSchema.parse(JSON.parse(decryptShippingSecret(settings.credentials_ciphertext))) }
  catch { throw new ShippingError(503, '系统发信授权信息无法读取，请联系配置管理员。') }
  if (credentials.host !== settings.smtp_host || credentials.username !== settings.from_email) throw new ShippingError(503, '系统发信授权信息与服务器不匹配。')
  return { settings, mailer: { host: settings.smtp_host, port: settings.smtp_port, secure: settings.smtp_secure, username: credentials.username, password: credentials.password, fromEmail: settings.from_email, fromName: settings.from_name, allowedDomains: settings.allowed_domains } }
}

export async function probeCompanyEmailSettings(orgId: string) {
  const { settings, mailer } = await loadCompanyMailerConfig(orgId)
  let connected = true, message = 'SMTP连接与认证通过；尚未验证真实邮件投递。'
  let failureKind: CompanyMailError['reason'] | null = null
  try { await verifyCompanyMailer(mailer) }
  catch (error) {
    connected = false
    failureKind = error instanceof CompanyMailError ? error.reason : 'connection'
    message = error instanceof CompanyMailError && error.reason === 'authentication'
      ? 'SMTP认证未通过，请核对系统发信邮箱及客户端授权信息。'
      : '暂时无法连接或验证发信服务，请检查SMTP配置与网络。'
  }
  // A transient network failure does not invalidate previously accepted credentials.
  const status = connected ? 'verified' : failureKind === 'authentication' || failureKind === 'configuration' ? 'failed' : settings.connection_status
  const { data, error } = await supabaseAdmin.from('shipping_email_access_settings').update({ connection_status: status, last_error_kind: failureKind, last_tested_at: new Date().toISOString() }).eq('org_id', orgId).eq('updated_at', settings.updated_at).select('org_id').maybeSingle()
  if (error || !data) throw new ShippingError(409, '测试期间邮箱配置已变化，请刷新后重新测试。')
  return { connected, message, settings: await loadCompanyEmailSettings(orgId) }
}
