import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { newShippingOrderNo } from './collaboration'
import { ShippingError } from './config'
import type { ShippingInput } from './types'
import { contactSchema, ownerOrderSchema } from './validation'
import { z } from 'zod'

export const ownerResubmitSchema = ownerOrderSchema.extend({ expectedRevision: z.number().int().min(1).max(2147483646) })

// Historical snapshots may contain missing or now-invalid fields. Let the owner
// correct them, while exposing only the fields of the employee intake form.
function editableFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return Object.fromEntries(keys.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]]))
}

export async function loadReturnedOwnerShipment(orgId: string, userId: string, orderNo: string) {
  const { data, error } = await supabaseAdmin.from('shipping_orders')
    .select('order_no,revision,status,shipment_payload,returned_reason,provider_order_id,cancellation,shipping_waybills(waybill_no)')
    .eq('org_id', orgId).eq('created_by', userId).eq('intake_source', 'owner_web').eq('order_no', orderNo)
    .maybeSingle()
  if (error) throw new ShippingError(503, '本人提报资料暂时无法读取，请稍后重试。')
  if (!data) throw new ShippingError(404, '本人提报记录中没有这张工单。')
  const hasWaybill = Array.isArray(data.shipping_waybills) ? data.shipping_waybills.length > 0 : Boolean(data.shipping_waybills)
  if (data.status !== 'returned' || hasWaybill || data.provider_order_id != null
    || (data.cancellation != null && data.cancellation.phase !== 'not_sent')) throw new ShippingError(409, '工单状态已变化，只有尚未出运单的退回工单可以重提。')
  const input = editableFields(data.shipment_payload, Object.keys(ownerOrderSchema.shape.input.shape))
  for (const key of ['sender', 'recipient']) {
    if (input[key]) input[key] = editableFields(input[key], Object.keys(contactSchema.shape))
  }
  if (input.submittedBy) input.submittedBy = editableFields(input.submittedBy, ['name', 'phone', 'team', 'departmentId'])
  return { orderNo: data.order_no, status: data.status, revision: data.revision, returnedReason: data.returned_reason, input }
}

export async function resubmitReturnedOwnerShipment(
  orgId: string, userId: string, orderNo: string, submission: z.infer<typeof ownerResubmitSchema>, input: ShippingInput,
) {
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const { data, error } = await supabaseAdmin.rpc('resubmit_returned_owner_shipment_v2', {
    p_org_id: orgId,
    p_actor_id: userId,
    p_order_no: orderNo,
    p_expected_revision: submission.expectedRevision,
    p_request_key: submission.key,
    p_request_hash: digest(submission.input),
    p_shipment_payload: input,
    p_payload_hash: digest(input),
    p_new_order_no: newShippingOrderNo(),
    p_receipt_token_hash: randomBytes(32).toString('hex'),
  })
  if (error?.code === '40001') throw new ShippingError(409, '工单或本次重提内容已变化，请刷新提报记录后重新核对。')
  if (error?.code === '23514') throw new ShippingError(409, '工单状态已变化，只有尚未出运单的退回工单可以重提。')
  if (error) throw new ShippingError(503, '暂时无法核实重提结果，请保留本次内容并重试。')
  if (!data) throw new ShippingError(404, '本人提报记录中没有这张工单。')
  return data
}
