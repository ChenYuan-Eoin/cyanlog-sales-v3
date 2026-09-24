// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { parseAddress } from './address'
import { anonymousShipmentSchema, shippingInputSchema, trackingSchema } from './validation'
import { allowedShippingUser, ShippingError } from './config'
import { decodeSfResponse, buildSfOrder, extractCancellation, extractOrder, extractTracking } from './sf-client'
import { checkShippingPolicy, submitShipping } from './service'
import type { ShippingStore, StoredShipping } from './store'
import type { ShippingInput } from './types'
import { resolveBusinessContext, signShipmentContext, verifyShipmentContext } from './context'
import { nextShippingReviewAt } from './collaboration'
const contact = { name: '测试联系人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号测试楼' }
const input: ShippingInput = { sender: contact, recipient: contact, cargo: '文件', weight: 1, remark: '', serviceId: 2, source: 'manual' }
const key = '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0'
function memoryStore(): ShippingStore {
  const rows = new Map<string, StoredShipping>()
  return { reserve: async r => { const old = rows.get(r.id); if (old) return { record: old, inserted: false }; rows.set(r.id, r); return { record: r, inserted: true } }, get: async (id, user, c) => { const r = rows.get(id); return r?.created_by === user && r.connection_key === c ? r : null }, finish: async (id, user, status, waybill) => { const r = rows.get(id)!; if (r.created_by !== user) throw new Error('denied'); const updated = { ...r, status, waybill }; rows.set(id, updated); return updated }, recent: async user => [...rows.values()].filter(r => r.created_by === user) }
}
describe('address extraction', () => {
  it('extracts a full mainland address without inventing values', () => { const r = parseAddress('张三 13800000000 广东省深圳市南山区科技路1号'); expect(r.contact).toEqual({ name: '张三', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '科技路1号' }) })
  it('handles labeled municipality and landline', () => { const r = parseAddress('收件人：李四 电话：010-12345678 地址：北京市朝阳区测试路2号'); expect(r.contact.city).toBe('北京市'); expect(r.contact.county).toBe('朝阳区'); expect(r.contact.name).toBe('李四'); expect(r.contact.phone).toBe('010-12345678') })
  it('does not select one of multiple recipients', () => { const r = parseAddress('张三13800000000李四13900000000'); expect(r.contact.phone).toBe(''); expect(r.warnings.join()).toContain('多个') })
  it('preserves unresolved addresses for manual correction', () => { const r = parseAddress('深圳南山测试园区'); expect(r.contact.province).toBe(''); expect(r.contact.address).toBe('深圳南山测试园区') })
})
describe('boundary validation', () => {
  it('accepts a simple valid shipment', () => expect(shippingInputSchema.parse(input)).toEqual(input))
  it.each([0, -1, Infinity, NaN, 21])('rejects unsafe weight %s', weight => expect(shippingInputSchema.safeParse({ ...input, weight }).success).toBe(false))
  it('rejects unimplemented order source and forged metadata', () => { expect(shippingInputSchema.safeParse({ ...input, source: 'order' }).success).toBe(false); expect(shippingInputSchema.safeParse({ ...input, created_by: 'other' }).success).toBe(false) })
  it('only accepts one tracking number and a valid phone suffix', () => { expect(trackingSchema.safeParse({ waybill: 'SF1234567890123', phoneSuffix: '1234' }).success).toBe(true); expect(trackingSchema.safeParse({ waybill: 'SF1234567890123,SF9876543210123' }).success).toBe(false); expect(trackingSchema.safeParse({ waybill: 'SF1234567890123', phoneSuffix: '1' }).success).toBe(false) })
  it('requires explicit allowlisting; no default admin bypass', () => { expect(allowedShippingUser({ id: 'a' }, {})).toBe(false); expect(allowedShippingUser({ id: 'a' }, { SHIPPING_ALLOWED_USER_IDS: 'b, a' })).toBe(true); expect(allowedShippingUser({ id: 'aa' }, { SHIPPING_ALLOWED_USER_IDS: 'a' })).toBe(false) })
  it('keeps external intake provider-independent and accepts a neutral delivery preference', () => {
    const externalInput = { ...input }
    delete externalInput.serviceId
    const parsed = anonymousShipmentSchema.parse({ key, input: { ...externalInput, servicePreference: 'urgent', customerName: '星河科技', submittedBy: { name: '张三', phone: '13800000000', team: '华南销售部' } } })
    expect(parsed.input.servicePreference).toBe('urgent')
    expect(parsed.input).not.toHaveProperty('serviceId')
  })
  it('blocks nonconfigured products', () => expect(() => checkShippingPolicy(input, [{ id: 1 }])).toThrow())
  it('accepts provider-independent sales preferences without trusting relation IDs', () => {
    const salesInput = { ...input }
    delete salesInput.serviceId
    const valid = { ...salesInput, servicePreference: 'standard', customerName: '星河科技', submittedBy: { name: '张三', phone: '13800000000', team: '华南销售部' }, specialRequirements: '样品易碎' }
    expect(anonymousShipmentSchema.safeParse({ key, input: valid, rawInput: '测试地址' }).success).toBe(true)
    expect(anonymousShipmentSchema.safeParse({ key, input: valid, salesRef: 'forged' }).success).toBe(false)
  })
})
describe('anonymous shipment context', () => {
  const contextKey = ['SHIPPING', 'CONTEXT', 'SECRET'].join('_')
  const env = { [contextKey]: 'x'.repeat(32) }
  it('round-trips signed sales and customer context', () => { const value = { salesRef: 'sales-1', customerRef: 'customer-1', exp: Math.floor(Date.now() / 1000) + 60 }; expect(verifyShipmentContext(signShipmentContext(value, env), env)).toEqual(value) })
  it('rejects tampered and expired context', () => { const value = { salesRef: 'sales-1', exp: Math.floor(Date.now() / 1000) - 1 }, token = signShipmentContext(value, env); expect(verifyShipmentContext(token, env)).toBeNull(); expect(verifyShipmentContext(token + 'x', env)).toBeNull() })
  it('resolves configured business codes without exposing the directory', () => expect(resolveBusinessContext('ABCD', { SHIPPING_BUSINESS_CONTEXTS_JSON: '{"ABCD":{"salesRef":"sales-1","customerRef":"customer-1"}}' })).toEqual({ salesRef: 'sales-1', customerRef: 'customer-1' }))
  it('uses explicit Shanghai 11:00 and 17:00 review cutoffs', () => { expect(nextShippingReviewAt(new Date('2026-09-22T01:00:00Z'))).toBe('2026-09-22T03:00:00.000Z'); expect(nextShippingReviewAt(new Date('2026-09-22T04:00:00Z'))).toBe('2026-09-22T09:00:00.000Z'); expect(nextShippingReviewAt(new Date('2026-09-22T10:00:00Z'))).toBe('2026-09-23T03:00:00.000Z') })
})
describe('SF protocol', () => {
  it('requires gateway AND business success', () => { expect(() => decodeSfResponse({ apiResultCode: 'bad', apiResultData: '{"success":true}' })).toThrow(); expect(() => decodeSfResponse({ apiResultCode: 'A1000', apiResultData: '{"success":false}' })).toThrow(); expect(decodeSfResponse({ apiResultCode: 'A1000', apiResultData: '{"success":true,"msgData":{"ok":1}}' })).toEqual({ ok: 1 }) })
  it('marks an explicit SF business rejection as definitive', () => { try { decodeSfResponse({ apiResultCode: 'A1000', apiResultData: '{"success":false,"errorCode":"6150"}' }); throw new Error('expected rejection') } catch (error) { expect(error).toMatchObject({ status: 422, requestStage: 'provider_rejected' }) } })
  it('keeps supplied monthly account out of user input', () => { const order = buildSfOrder('id', input, 'test-account'); expect(order.monthlyCard).toBe('test-account'); expect(order.contactInfoList.map(c => c.contactType)).toEqual([1, 2]); expect(order.payMethod).toBe(1) })
  it('checks returned order identity and prefers primary waybill', () => { expect(() => extractOrder({ orderId: 'other' }, 'id')).toThrow(); expect(extractOrder({ orderId: 'id', waybillNoInfoList: [{ waybillType: 2, waybillNo: 'child' }, { waybillType: 1, waybillNo: 'parent' }] }, 'id')).toBe('parent') })
  it('accepts cancellation only when the provider echoes the same order id', () => { expect(extractCancellation({ orderId: 'id' }, 'id')).toBe(true); expect(() => extractCancellation({ orderId: 'other' }, 'id')).toThrow('编号不一致') })
  it('never presents a different waybill trajectory', () => expect(() => extractTracking({ routeResps: [{ mailNo: 'other', routes: [{ acceptTime: '2026-01-01', remark: 'picked' }] }] }, 'wanted')).toThrow())
  it('shows empty and reverse chronological actual routes', () => { expect(extractTracking({ routeResps: [] }, 'wanted').events).toEqual([]); expect(extractTracking({ routeResps: [{ mailNo: 'wanted', routes: [{ acceptTime: '2026-01-01', remark: 'old' }, { acceptTime: '2026-01-02', remark: 'new' }] }] }, 'wanted').events[0].description).toBe('new') })
})
describe('durable request lifecycle', () => {
  const base = { userId: 'user1', key, input, connection: 'sandbox-p1', environment: 'sandbox' as const }
  it('concurrent duplicate requests send once', async () => { const store = memoryStore(); const send = vi.fn(async () => 'SF1234567890123'); const rows = await Promise.all(Array.from({ length: 8 }, () => submitShipping({ ...base, store, send }))); expect(send).toHaveBeenCalledTimes(1); expect(new Set(rows.map(r => r.id)).size).toBe(1) })
  it('timeout stays unknown; retry never sends a second time', async () => { const store = memoryStore(), send = vi.fn(async () => { throw new Error('timeout') }); const first = await submitShipping({ ...base, store, send }); const second = await submitShipping({ ...base, store, send }); expect(first.status).toBe('unknown'); expect(second.id).toBe(first.id); expect(send).toHaveBeenCalledTimes(1) })
  it('surfaces a definitive provider rejection instead of pretending it may reconcile', async () => { const store = memoryStore(), send = vi.fn(async () => { throw new ShippingError(422, 'rejected', 'provider_rejected') }); await expect(submitShipping({ ...base, store, send })).rejects.toMatchObject({ requestStage: 'provider_rejected' }); expect(send).toHaveBeenCalledTimes(1) })
  it('fails before external side effect when reservation fails', async () => { const store = memoryStore(), send = vi.fn(); store.reserve = async () => { throw new Error('DB unavailable') }; await expect(submitShipping({ ...base, store, send })).rejects.toThrow(); expect(send).not.toHaveBeenCalled() })
  it('save failure after upstream acceptance cannot resubmit', async () => { const store = memoryStore(), send = vi.fn(async () => 'SF1234567890123'); store.finish = async () => { throw new Error('write lost') }; await expect(submitShipping({ ...base, store, send })).rejects.toThrow(); expect((await submitShipping({ ...base, store, send })).status).toBe('pending'); expect(send).toHaveBeenCalledTimes(1) })
  it('same key cannot silently change payload', async () => { const store = memoryStore(), send = vi.fn(async () => 'SF1234567890123'); await submitShipping({ ...base, store, send }); await expect(submitShipping({ ...base, input: { ...input, weight: 2 }, store, send })).rejects.toThrow('发生变化'); expect(send).toHaveBeenCalledTimes(1) })
  it('separates user identity with the same browser key', async () => { const store = memoryStore(), send = vi.fn(async () => 'SF1234567890123'); const a = await submitShipping({ ...base, store, send }), b = await submitShipping({ ...base, userId: 'user2', store, send }); expect(a.id).not.toBe(b.id); expect(await store.get(a.id, 'user2', base.connection)).toBeNull() })
})
