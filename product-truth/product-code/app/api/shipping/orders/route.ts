import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { shippingConfig, requireShippingConnection, ShippingError } from '@/lib/shipping/config'
import { shippingStore, publicRecord } from '@/lib/shipping/store'
import { submitShipping, checkShippingPolicy, shippingRequestId } from '@/lib/shipping/service'
import { createSfOrder } from '@/lib/shipping/sf-client'
import { z } from 'zod'
import { createSchema } from '@/lib/shipping/validation'
export const runtime = 'nodejs'
export async function GET(req: NextRequest) { return shippingHandler(req, async user => { const connection = shippingConfig().connectionKey; const key = req.nextUrl.searchParams.get('key'); const current = key ? await shippingStore.get(shippingRequestId(user.id, z.string().uuid().parse(key)), user.id, connection) : null; return { records: (await shippingStore.recent(user.id, connection)).map(publicRecord), current: current ? publicRecord(current) : null } }) }
export async function POST(req: NextRequest) {
  return shippingHandler(req, async user => {
    let submission: z.infer<typeof createSchema>
    let c: ReturnType<typeof requireShippingConnection>
    try {
      submission = createSchema.parse(await shippingJson(req))
      c = requireShippingConnection(true)
      checkShippingPolicy(submission.input, c.services)
    } catch (error) {
      const status = error instanceof ShippingError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503
      const message = error instanceof ShippingError ? error.message : '请核对必填字段、电话、重量和快递服务。'
      // This invocation has not reserved or sent a request. Keep the SAME key on edits:
      // a prior uncertain invocation may still exist and must retain its idempotency protection.
      throw new ShippingError(status, message, 'validation')
    }
    const { key, input } = submission
    return publicRecord(await submitShipping({ userId: user.id, key, input, connection: c.connectionKey, environment: c.environment, store: shippingStore, send: createSfOrder }))
  })
}
