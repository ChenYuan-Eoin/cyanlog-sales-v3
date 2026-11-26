import { loadIntakeSettings } from '@/lib/shipping/intake-settings'
import { intakeFieldSchema } from '@/lib/shipping/intake-rules'
import { loadDefaultShippingSender } from '@/lib/shipping/sender-profile'
import { type ShippingInput } from '@/lib/shipping/types'
import { DOMESTIC_SHIPPING_PHONE_PATTERN, normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { loadEmployeeShippingDepartments, resolveEmployeeShippingDepartment } from '@/lib/shipping/department-access'
import type { AuthUser } from '@/lib/auth'
import type { z } from 'zod'
import { createOwnerShipment, publicShipmentReceipt } from './collaboration'
import { ShippingError } from './config'
import { contactSchema, ownerOrderSchema } from './validation'

export async function prepareOwnerSubmission(
  user: AuthUser, orgId: string, selfSubmit: boolean, form: z.infer<typeof ownerOrderSchema>['input'],
): Promise<ShippingInput> {
  const sender = form.sender || await loadDefaultShippingSender(orgId)
  if (!contactSchema.safeParse(sender).success) throw new ShippingError(422, '请先补齐寄件人姓名、联系电话和完整揽收地址，再提交工单。')
  const rules = await loadIntakeSettings(orgId)
  const company = intakeFieldSchema(rules.companyName, '公司名称', 120).parse(form.customerName)
  const department = selfSubmit
    ? resolveEmployeeShippingDepartment(await loadEmployeeShippingDepartments(user.id, orgId, rules), form.submittedBy?.departmentId, form.submittedBy?.team)
    : null
  const team = department?.name || intakeFieldSchema(rules.team, '所属团队', 80, rules.teamOptions).parse(form.submittedBy?.team)
  const accountPhone = normalizeDomesticShippingPhone(user.phone || '')
  const input: ShippingInput = { ...form, sender: contactSchema.parse(sender), customerName: company,
    submittedBy: { name: selfSubmit ? user.display_name?.trim().slice(0, 60) || sender.name : sender.name,
      phone: selfSubmit && DOMESTIC_SHIPPING_PHONE_PATTERN.test(accountPhone) ? accountPhone : sender.phone, team,
      ...(department ? { departmentId: department.id } : {}) } }
  delete input.serviceId
  return input
}

export async function submitShippingWorkorder(user: AuthUser, orgId: string, selfSubmit: boolean, body: unknown) {
  const submission = ownerOrderSchema.parse(body)
  const input = await prepareOwnerSubmission(user, orgId, selfSubmit, submission.input)
  const attributedDepartmentId = selfSubmit ? input.submittedBy?.departmentId : undefined
  const order = await createOwnerShipment({
    orgId, userId: user.id, key: submission.key, input, usesDefaultSender: !submission.input.sender,
    ...(attributedDepartmentId ? { attributedDepartmentId } : {}),
  })
  return { ...publicShipmentReceipt(order), orderId: order.id, requestNumber: order.orderNo }
}
