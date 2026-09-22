import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AuthUser } from '@/lib/auth'
import { emptyContact, type ShippingSettings } from './types'
export class ShippingError extends Error { constructor(public status: number, message: string, public requestStage?: 'validation' | 'provider_rejected') { super(message) } }
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
  // Production is additionally gated by an explicit deployment setting. Routes
  // must still enforce F054 confirmation policy before calling the adapter.
  const canSubmit = ready && (environment === 'sandbox' || env.SF_PRODUCTION_ORDER_ENABLED === 'true')
  const sender = emptyContact()
  try { const data = JSON.parse(env.SHIPPING_SENDER_JSON || '{}'); for (const key of Object.keys(sender) as (keyof typeof sender)[]) if (typeof data[key] === 'string') sender[key] = data[key].slice(0, 200) } catch { /* manual entry */ }
  const publicSettings: ShippingSettings = { environment, ready, canSubmit, reason: !ready ? '顺丰接口尚未接通，可先整理地址。' : !canSubmit ? '寄件登记可用；Production真实发单尚未启用。' : '', services, sender, monthlyTail: monthly.slice(-4) }
  return { environment, partner, checkWord, monthly, services, publicSettings, connectionKey: createHash('sha256').update([environment, partner, monthly].join(':')).digest('hex') }
}
export function requireShippingConnection(submit = false) {
  const config = shippingConfig()
  if (!config.publicSettings.ready || (submit && !config.publicSettings.canSubmit)) throw new ShippingError(503, config.publicSettings.reason)
  return config
}
