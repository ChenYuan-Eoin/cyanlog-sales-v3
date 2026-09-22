import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const contextSchema = z.object({ salesRef: z.string().min(1).max(120), customerRef: z.string().min(1).max(120).optional(), exp: z.number().int().positive() }).strict()
export type ShipmentContext = z.infer<typeof contextSchema>

function secret(env: Record<string, string | undefined>) {
  const value = env.SHIPPING_CONTEXT_SECRET
  if (!value || value.length < 32) return null
  return value
}

export function signShipmentContext(context: ShipmentContext, env: Record<string, string | undefined> = process.env) {
  const key = secret(env)
  if (!key) throw new Error('SHIPPING_CONTEXT_SECRET is not configured')
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url')
  const signature = createHmac('sha256', key).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyShipmentContext(token: string, env: Record<string, string | undefined> = process.env): ShipmentContext | null {
  const key = secret(env), [payload, signature, extra] = token.split('.')
  if (!key || !payload || !signature || extra) return null
  const expected = createHmac('sha256', key).update(payload).digest()
  let actual: Buffer
  try { actual = Buffer.from(signature, 'base64url') } catch { return null }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const parsed = contextSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    return parsed.exp * 1000 > Date.now() ? parsed : null
  } catch { return null }
}

export function resolveBusinessContext(code: string | undefined, env: Record<string, string | undefined> = process.env): Omit<ShipmentContext, 'exp'> | null {
  if (!code) return null
  try {
    const record = z.record(z.string(), z.object({ salesRef: z.string().min(1).max(120), customerRef: z.string().min(1).max(120).optional() })).parse(JSON.parse(env.SHIPPING_BUSINESS_CONTEXTS_JSON || '{}'))
    return record[code] || null
  } catch { return null }
}
