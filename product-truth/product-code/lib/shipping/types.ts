import type { IntakeRules } from './intake-rules'
// REQ: F054 — shared UI contract; no provider secrets.
export type Contact = { name: string; phone: string; province: string; city: string; county: string; address: string }
export type ShippingPayment = 'sender_cash' | 'recipient' | 'sender_monthly'
export type ShippingSubmitter = { name: string; phone: string; team: string; departmentId?: string }
export type ShippingInput = { sender: Contact; recipient: Contact; cargo: string; weight: number; serviceId?: number; serviceName?: string; servicePreference?: 'standard' | 'urgent'; remark: string; source: 'manual'; payment?: ShippingPayment; customerName?: string; submittedBy?: ShippingSubmitter; specialRequirements?: string; pickupWindow?: string }
export type ShippingRecord = { id: string; status: 'pending' | 'accepted' | 'unknown'; waybill: string | null; created_at: string; environment: 'sandbox' | 'production' }
export type ImportedOutbound = { id: string; waybill: string; source_time: string; source_status: string; imported_at: string }
export type TrackingEventStatus = 'waybill_created' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown'
export type RouteEvent = { time: string; location: string; description: string; status?: TrackingEventStatus }
export type TrackingResult = { waybill: string; events: RouteEvent[]; queriedAt: string; shipmentStatus?: ShipmentOrderStatus; source?: 'carrier' | 'sandbox_mock' | 'simulation'; courier?: { name?: string; employeeId?: string; phone?: string } }
export type SavedShippingContact = { id: string; label: string; contact: Contact }
export type ShippingSettings = { intakeRules?: IntakeRules; intakeRulesWarning?: string; guest?: boolean; canOperate?: boolean; canManageConnections?: boolean; lastShipment?: ShippingInput; defaultsWarning?: string; configurationWarning?: string; environment: 'sandbox' | 'production'; ready: boolean; reason: string; services: Array<{ id: number; name: string; preference?: 'standard' | 'urgent' }>; monthlyTail: string; sender: Contact; canSubmit: boolean; connectionId?: string; defaultBillingAccountId?: string; carrierConnections?: Array<{ id: string; carrier: 'sf'; environment: 'sandbox' | 'production'; status: string; orderCapability: string; services: Array<{ id: number; name: string; preference: 'standard' | 'urgent' }> }>; billingAccounts?: Array<{ id: string; connectionId: string; displayName: string; tail: string; environment: 'sandbox' | 'production'; isDefault: boolean; status: 'active' | 'inactive' }> }
export type ShipmentOrderStatus = 'accepted' | 'awaiting_confirmation' | 'returned' | 'confirmed' | 'ordering' | 'order_unknown' | 'waybill_created' | 'in_transit' | 'delivered' | 'cancelled' | 'order_failed'
export type ShipmentRelation = { salesRef: string | null; customerRef: string | null; assignmentStatus: 'assigned' | 'unassigned' }
export type ShipmentOrder = {
  failure?: { message: string; at: string }
  identityVerified?: boolean
  id: string
  orderNo: string
  intakeSource: 'anonymous_web' | 'owner_web' | 'crm' | 'wechat_bot'
  confirmationPolicy: 'direct' | 'scheduled_review'
  status: ShipmentOrderStatus
  relation: ShipmentRelation
  input: ShippingInput
  waybill: string | null
  revision?: number
  amendedAt?: string | null
  nextReviewAt: string | null
  createdAt: string
  direction?: 'outbound' | 'inbound'
}
export type ShipmentReceipt = Pick<ShipmentOrder, 'orderNo' | 'status' | 'waybill' | 'nextReviewAt' | 'createdAt'> & {
  customerName?: string | null
  revision?: number
  canCancel?: boolean
  cancellationState?: string | null
  returnedReason?: string | null
}
export const emptyContact = (): Contact => ({ name: '', phone: '', province: '', city: '', county: '', address: '' })
