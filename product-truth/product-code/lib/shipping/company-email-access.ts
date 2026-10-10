import { createHmac, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { loadIntakeSettings } from './intake-settings'
import { intakeFieldSchema } from './intake-rules'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { contactSchema } from './validation'
import type { Contact } from './types'
import { normalizeDomesticShippingPhone } from './phone'
import { CompanyMailError, sendEmployeeEmailCode } from './company-mailer'
import { loadCompanyMailerConfig } from './company-email-settings'
import { companyEmailAllowed, employeeEmailCodeHash, employeeSessionTokenHash, EMPLOYEE_SESSION_COOKIE, newEmployeeEmailCode, newEmployeeSessionToken, normalizeEmployeeEmail } from './company-email'

export type ShippingEmployee = { id: string; orgId: string; email: string; sender: Contact | null; team: string; updatedAt: string; sessionVersion: number }
export type ShippingEmployeeSession = { tokenHash: string; employee: ShippingEmployee }
type EmployeeRow = { id: string; org_id: string; email: string; sender_contact: unknown; team: string | null; is_active: boolean; session_version: number; updated_at: string }
const employeeColumns = 'id,org_id,email,sender_contact,team,is_active,session_version,updated_at'

function pepper() {
  const secret = process.env.SHIPPING_RECEIPT_SECRET
  if (!secret || secret.length < 32) throw new ShippingError(503, '邮箱验证安全配置尚未完成。')
  return secret
}
function toEmployee(row: EmployeeRow): ShippingEmployee {
  const sender = contactSchema.safeParse(row.sender_contact)
  return { id: row.id, orgId: row.org_id, email: row.email, sender: sender.success ? sender.data : null, team: row.team || '', updatedAt: row.updated_at, sessionVersion: Number(row.session_version) }
}
export function employeePublicProfile(employee: ShippingEmployee) {
  return { id: employee.id, email: employee.email, sender: employee.sender, team: employee.team, updatedAt: employee.updatedAt }
}

export async function requestEmployeeEmailCode(req: NextRequest, rawEmail: string) {
  const email = normalizeEmployeeEmail(rawEmail), domain = email.slice(email.lastIndexOf('@') + 1)
  const { data: entries, error: entryError } = await supabaseAdmin.from('shipping_email_access_settings').select('org_id').eq('enabled', true).contains('allowed_domains', [domain]).limit(2)
  if (entryError) throw new ShippingError(503, '员工邮箱入口暂不可用。')
  if (!entries || entries.length !== 1) throw new ShippingError(403, '此邮箱尚未获准使用员工寄件入口，请联系管理员。')
  const { settings, mailer } = await loadCompanyMailerConfig(entries[0].org_id)
  if (!settings.enabled || !companyEmailAllowed(email, settings.allowed_domains)) throw new ShippingError(403, '此邮箱尚未获准使用员工寄件入口。')
  if (settings.connection_status === 'failed' && settings.last_error_kind === 'authentication') throw new ShippingError(503, '系统发信账号需要管理员维护，暂时无法发送验证码。')
  const id = randomUUID(), code = newEmployeeEmailCode(), secret = pepper()
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim()
  const ipHash = createHmac('sha256', secret).update(`shipping-email-ip-v1\0${ip}`).digest('hex')
  const { data: reservation, error } = await supabaseAdmin.rpc('reserve_shipping_email_challenge', {
    p_id: id, p_org_id: settings.org_id, p_email: email, p_ip_hash: ipHash,
    p_code_hash: employeeEmailCodeHash({ secret, orgId: settings.org_id, email, challengeId: id, code }),
  })
  if (error || !reservation) throw new ShippingError(503, '验证码请求暂未受理，请稍后重试。')
  if (reservation.status === 'rate_limited') throw new ShippingError(429, '验证码请求过于频繁，请稍后再试。')
  // Do not disclose disabled profile membership to an unverified caller.
  if (reservation.status !== 'reserved') return { challengeId: id, delivery: 'requested' as const, retryAfter: 60 }
  let delivery: 'accepted' | 'unknown' | 'failed' = 'accepted'
  try { await sendEmployeeEmailCode(mailer, email, code) }
  catch (failure) {
    delivery = failure instanceof CompanyMailError && failure.reason !== 'connection' ? 'failed' : 'unknown'
    const reason = failure instanceof CompanyMailError ? failure.reason : 'connection'
    const update = { last_error_kind: reason, ...(reason === 'authentication' || reason === 'configuration' ? { connection_status: 'failed' } : {}) }
    await supabaseAdmin.from('shipping_email_access_settings').update(update).eq('org_id', settings.org_id).eq('updated_at', settings.updated_at)
  }
  const recorded = await supabaseAdmin.from('shipping_email_challenges').update({ delivery_status: delivery }).eq('id', id).eq('org_id', settings.org_id)
  if (recorded.error) console.error('shipping.email.delivery_record_failed')
  return { challengeId: id, delivery, retryAfter: 60 }
}

export async function verifyEmployeeEmailCode(input: unknown) {
  const submitted = z.object({ email: z.string(), challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict().parse(input)
  const email = normalizeEmployeeEmail(submitted.email)
  const { data: challenge, error: lookupError } = await supabaseAdmin.from('shipping_email_challenges').select('org_id').eq('id', submitted.challengeId).eq('email', email).maybeSingle()
  if (lookupError) throw new ShippingError(503, '邮箱验证服务暂不可用。')
  if (!challenge) throw new ShippingError(400, '验证码无效或已过期，请使用最新验证码。')
  const sessionToken = newEmployeeSessionToken(), tokenHash = employeeSessionTokenHash(sessionToken)
  const { data: result, error } = await supabaseAdmin.rpc('verify_shipping_email_challenge', {
    p_id: submitted.challengeId, p_org_id: challenge.org_id, p_email: email,
    p_code_hash: employeeEmailCodeHash({ secret: pepper(), orgId: challenge.org_id, email, challengeId: submitted.challengeId, code: submitted.code }),
    p_session_hash: tokenHash,
  })
  if (error) throw new ShippingError(503, '邮箱验证结果暂未确认，请稍后再试。')
  if (result?.status !== 'verified' || !result.employeeId) throw new ShippingError(400, '验证码无效、已使用或已过期，请重新获取。')
  const { data: row, error: profileError } = await supabaseAdmin.from('shipping_employee_profiles').select(employeeColumns).eq('id', result.employeeId).eq('org_id', challenge.org_id).single()
  if (profileError || !row || row.email !== email || !row.is_active) throw new ShippingError(503, '员工资料暂不可用，请稍后重新验证。')
  return { sessionToken, employee: toEmployee(row as EmployeeRow) }
}

export async function getShippingEmployeeSession(req: NextRequest): Promise<ShippingEmployeeSession | null> {
  const token = req.cookies.get(EMPLOYEE_SESSION_COOKIE)?.value
  if (!token) return null
  let tokenHash: string
  try { tokenHash = employeeSessionTokenHash(token) } catch { return null }
  const { data: session, error } = await supabaseAdmin.from('shipping_employee_sessions').select('org_id,employee_id,issued_version,expires_at,revoked_at').eq('token_hash', tokenHash).maybeSingle()
  if (error) throw new ShippingError(503, '暂时无法读取邮箱会话，请稍后刷新。')
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) return null
  const [profile, settings] = await Promise.all([
    supabaseAdmin.from('shipping_employee_profiles').select(employeeColumns).eq('id', session.employee_id).eq('org_id', session.org_id).maybeSingle(),
    supabaseAdmin.from('shipping_email_access_settings').select('enabled,allowed_domains').eq('org_id', session.org_id).maybeSingle(),
  ])
  if (profile.error || settings.error) throw new ShippingError(503, '暂时无法核对员工身份，请稍后刷新。')
  const employee = profile.data as EmployeeRow | null
  if (!employee || employee.id !== session.employee_id || employee.org_id !== session.org_id || !employee.is_active || Number(employee.session_version) !== Number(session.issued_version) || !settings.data?.enabled || !companyEmailAllowed(employee.email, settings.data.allowed_domains)) return null
  return { tokenHash, employee: toEmployee(employee) }
}

export async function requireShippingEmployee(req: NextRequest) {
  const session = await getShippingEmployeeSession(req)
  if (!session) throw new ShippingError(401, '请先验证本人的公司邮箱。')
  return session
}

export async function saveShippingEmployeeProfile(session: ShippingEmployeeSession, input: unknown) {
  const rules = await loadIntakeSettings(session.employee.orgId)
  const data = z.object({ sender: z.preprocess(value => value && typeof value === 'object' && 'phone' in value && typeof value.phone === 'string' ? { ...value, phone: normalizeDomesticShippingPhone(value.phone) } : value, contactSchema), team: intakeFieldSchema(rules.team, '所属团队', 80, rules.teamOptions), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict().parse(input)
  const sender = contactSchema.parse({ ...data.sender, phone: normalizeDomesticShippingPhone(data.sender.phone) })
  const { data: row, error } = await supabaseAdmin.from('shipping_employee_profiles').update({ sender_contact: sender, team: data.team, updated_at: new Date().toISOString() })
    .eq('id', session.employee.id).eq('org_id', session.employee.orgId).eq('is_active', true).eq('session_version', session.employee.sessionVersion).eq('updated_at', data.expectedUpdatedAt).select(employeeColumns).maybeSingle()
  if (error) throw new ShippingError(503, '个人寄件资料暂未保存，请稍后重试。')
  if (!row) throw new ShippingError(409, '个人资料或访问状态已变化，请刷新后再保存。')
  return toEmployee(row as EmployeeRow)
}

export async function revokeShippingEmployeeSession(req: NextRequest) {
  const token = req.cookies.get(EMPLOYEE_SESSION_COOKIE)?.value
  if (!token) return
  let tokenHash: string
  try { tokenHash = employeeSessionTokenHash(token) } catch { return }
  const { error } = await supabaseAdmin.from('shipping_employee_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash)
  if (error) throw new ShippingError(503, '退出暂未完成，请稍后重试。')
}
