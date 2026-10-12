import { loadIntakeSettings } from '@/lib/shipping/intake-settings'
import { intakeFieldSchema } from '@/lib/shipping/intake-rules'
import { ShippingError } from '@/lib/shipping/config'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { contactSchema, ownerOrderSchema } from '@/lib/shipping/validation'
import { createOwnerShipment, publicShipmentReceipt } from '@/lib/shipping/collaboration'
import { loadDefaultShippingSender } from '@/lib/shipping/sender-profile'
import { type ShippingInput } from '@/lib/shipping/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const response = await shippingHandler(req, async (user, orgId) => {
    const submission = ownerOrderSchema.parse(await shippingJson(req))
    const sender = submission.input.sender || await loadDefaultShippingSender(orgId)
    if (!contactSchema.safeParse(sender).success) throw new ShippingError(422, '请先补齐寄件人姓名、联系电话和完整揽收地址，再提交工单。')
    const rules = await loadIntakeSettings(orgId)
    const company = intakeFieldSchema(rules.companyName, '公司名称', 120).parse(submission.input.customerName)
    const team = intakeFieldSchema(rules.team, '所属团队', 80, rules.teamOptions).parse(submission.input.submittedBy?.team)
    const input: ShippingInput = { ...submission.input, sender: contactSchema.parse(sender), customerName: company,
      submittedBy: { name: sender.name, phone: sender.phone, team } }
    delete input.serviceId
    const order = await createOwnerShipment({
      orgId, userId: user.id, key: submission.key, input, usesDefaultSender: !submission.input.sender,
    })
    return { ...publicShipmentReceipt(order), orderId: order.id, requestNumber: order.orderNo }
  })
  return response.ok ? new NextResponse(response.body, { status: 202, headers: response.headers }) : response
}
