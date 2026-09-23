// REQ: F054 — shared UI contract; no provider secrets.
export type Contact = { name: string; phone: string; province: string; city: string; county: string; address: string }
export type ShippingPayment = 'sender_cash' | 'recipient' | 'sender_monthly'
export type ShippingSubmitter = { name: string; phone: string; team: string }
export type ShippingInput = { sender: Contact; recipient: Contact; cargo: string; weight: number; serviceId: number; remark: string; source: 'manual'; payment?: ShippingPayment; customerName?: string; submittedBy?: ShippingSubmitter; specialRequirements?: string; pickupWindow?: string }
export type ShippingRecord = { id: string; status: 'pending' | 'accepted' | 'unknown'; waybill: string | null; created_at: string; environment: 'sandbox' | 'production' }
export type ImportedOutbound = { id: string; waybill: string; source_time: string; source_status: string; imported_at: string }
export type RouteEvent = { time: string; location: string; description: string }
export type TrackingResult = { waybill: string; events: RouteEvent[]; queriedAt: string; courier?: { name?: string; employeeId?: string; phone?: string } }
export type SavedShippingContact = { id: string; label: string; contact: Contact }
export type ShippingSettings = { guest?: boolean; canOperate?: boolean; canManageConnections?: boolean; lastShipment?: ShippingInput; defaultsWarning?: string; environment: 'sandbox' | 'production'; ready: boolean; reason: string; services: { id: number; name: string }[]; monthlyTail: string; sender: Contact; canSubmit: boolean }
export type ShipmentOrderStatus = 'accepted' | 'awaiting_confirmation' | 'returned' | 'confirmed' | 'ordering' | 'order_unknown' | 'waybill_created' | 'in_transit' | 'delivered' | 'cancelled' | 'order_failed'
export type ShipmentRelation = { salesRef: string | null; customerRef: string | null; assignmentStatus: 'assigned' | 'unassigned' }
export type ShipmentOrder = {
  id: string
  orderNo: string
  intakeSource: 'anonymous_web' | 'owner_web' | 'crm' | 'wechat_bot'
  confirmationPolicy: 'direct' | 'scheduled_review'
  status: ShipmentOrderStatus
  relation: ShipmentRelation
  input: ShippingInput
  waybill: string | null
  nextReviewAt: string | null
  createdAt: string
  direction?: 'outbound' | 'inbound'
}
export type ShipmentReceipt = Pick<ShipmentOrder, 'orderNo' | 'status' | 'waybill' | 'nextReviewAt' | 'createdAt'>
export const emptyContact = (): Contact => ({ name: '', phone: '', province: '', city: '', county: '', address: '' })
