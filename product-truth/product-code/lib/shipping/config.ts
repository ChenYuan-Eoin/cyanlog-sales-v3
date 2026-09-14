import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AuthUser } from '@/lib/auth'
import { emptyContact, type ShippingSettings } from './types'
export class ShippingError extends Error { constructor(public status: number, message: string, public requestStage?: 'validation') { super(message) } }
export function allowedShippingUser(user: Pick<AuthUser, 'id'>, env: Record<string, string | undefined> = process.env): boolean {
  return (env.SHIPPING_ALLOWED_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean).includes(user.id)
}
const servicesSchema = z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(40) })).max(10)
export function shippingConfig(env: Record<string, string | undefined> = process.env) {
  const environment = env.SF_ENVIRONMENT === 'production' ? 'production' as const : 'sandbox' as const
  let services: { id: number; name: string }[] = []
  try { services = servicesSchema.parse(JSON.parse(env.SF_SERVICES_JSON || '[]')) } catch { /* disabled until valid */ }
  const partner = env.SF_PARTNER_ID || '', checkWord = env.SF_CHECK_WORD || '', monthly = (environment === 'sandbox' ? env.SF_SANDBOX_MONTHLY_CARD : env.SF_MONTHLY_CARD) || ''
  const ready = Boolean(partner && checkWord && services.length)
  // Production monthly billing stays hard-disabled until a payer-per-order approval
  // contract is implemented and verified. An environment flag alone must never
  // turn a reusable monthly-card credential into direct billing authority.
  const canSubmit = ready && environment === 'sandbox'
  const sender = emptyContact()
  try { const data = JSON.parse(env.SHIPPING_SENDER_JSON || '{}'); for (const key of Object.keys(sender) as (keyof typeof sender)[]) if (typeof data[key] === 'string') sender[key] = data[key].slice(0, 200) } catch { /* manual entry */ }
  const publicSettings: ShippingSettings = { environment, ready, canSubmit, reason: !ready ? '顺丰接口尚未接通，可先整理地址。' : !canSubmit ? '可填写寄件信息并查询本人运单；真实下单尚未接通。' : '', services, sender, monthlyTail: monthly.slice(-4) }
  return { environment, partner, checkWord, monthly, services, publicSettings, connectionKey: createHash('sha256').update([environment, partner, monthly].join(':')).digest('hex') }
}
export function requireShippingConnection(submit = false) {
  const config = shippingConfig()
  if (!config.publicSettings.ready || (submit && !config.publicSettings.canSubmit)) throw new ShippingError(503, config.publicSettings.reason)
  return config
}
