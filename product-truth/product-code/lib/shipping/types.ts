// REQ: F054 — shared UI contract; no provider secrets.
export type Contact = { name: string; phone: string; province: string; city: string; county: string; address: string }
export type ShippingPayment = 'sender_cash' | 'recipient' | 'sender_monthly'
export type ShippingInput = { sender: Contact; recipient: Contact; cargo: string; weight: number; serviceId: number; remark: string; source: 'manual'; payment?: ShippingPayment }
export type ShippingRecord = { id: string; status: 'pending' | 'accepted' | 'unknown'; waybill: string | null; created_at: string; environment: 'sandbox' | 'production' }
export type ImportedOutbound = { id: string; waybill: string; source_time: string; source_status: string; imported_at: string }
export type RouteEvent = { time: string; location: string; description: string }
export type TrackingResult = { waybill: string; events: RouteEvent[]; queriedAt: string }
export type SavedShippingContact = { id: string; label: string; contact: Contact }
export type ShippingSettings = { guest?: boolean; lastShipment?: ShippingInput; defaultsWarning?: string; environment: 'sandbox' | 'production'; ready: boolean; reason: string; services: { id: number; name: string }[]; monthlyTail: string; sender: Contact; canSubmit: boolean }
export const emptyContact = (): Contact => ({ name: '', phone: '', province: '', city: '', county: '', address: '' })
