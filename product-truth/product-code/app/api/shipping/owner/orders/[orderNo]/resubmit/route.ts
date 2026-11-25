import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { loadReturnedOwnerShipment, ownerResubmitSchema, resubmitReturnedOwnerShipment } from '@/lib/shipping/owner-resubmit'
import { prepareOwnerSubmission } from '@/lib/shipping/owner-submission'

export const runtime = 'nodejs'
type Context = { params: Promise<{ orderNo: string }> }

export async function GET(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) =>
    loadReturnedOwnerShipment(orgId, user.id, (await params).orderNo), {
    allowFxiaokeSelfSubmit: true,
    requiresOwnerWrite: true,
  })
}

export async function POST(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId, selfSubmit) => {
    const submission = ownerResubmitSchema.parse(await shippingJson(req))
    const input = await prepareOwnerSubmission(user, orgId, selfSubmit, submission.input)
    return resubmitReturnedOwnerShipment(orgId, user.id, (await params).orderNo, submission, input)
  }, { allowFxiaokeSelfSubmit: true })
}
