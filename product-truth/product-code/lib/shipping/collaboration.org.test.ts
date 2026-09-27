// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ShippingInput } from './types'
const mocks = vi.hoisted(() => ({ from: vi.fn(), recipients: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('./operator-access', () => ({ listShippingOperatorRecipients: mocks.recipients }))
import { assignShipmentRelation, createAnonymousShipment, createOwnerShipment, createDueShipmentReviewReminders, listShipmentLedger } from './collaboration'

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
const input: ShippingInput = { sender: { name: '示例前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例路1号' }, recipient: { name: '示例收件人', phone: '13800000001', province: '上海市', city: '上海市', county: '浦东新区', address: '示例路2号' }, cargo: '文件', weight: 1, remark: '', source: 'manual' }
function row(id: string, org_id: string | null): Row { return { id, org_id, order_no: id, intake_source: 'anonymous_web', confirmation_policy: 'scheduled_review', status: 'awaiting_confirmation', sales_ref: null, customer_ref: null, assignment_status: 'unassigned', shipment_payload: input, payload_hash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), created_at: '2026-09-27T00:00:00Z', next_review_at: '2026-09-27T01:00:00Z', review_notified_at: null } }

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined, inserts: Row[] | undefined
  const finish = (single = false) => {
    const data = tables[table] ||= []
    if (inserts) {
      if (table === 'shipping_orders' && inserts.some(item => data.some(old => old.intake_source === item.intake_source && old.idempotency_key === item.idempotency_key))) return { data: null, error: { code: '23505' } }
      for (const item of inserts) data.push({ id: `new-${data.length}`, created_at: new Date().toISOString(), ...item })
      const added = data.slice(-inserts.length)
      return { data: single ? added[0] : added, error: null }
    }
    const matched = data.filter(item => filters.every(filter => filter(item)))
    if (patch) matched.forEach(item => Object.assign(item, patch))
    return { data: single ? matched[0] || null : matched, error: null }
  }
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { filters.push(item => item[key] === value); return builder },
    is: (key: string, value: unknown) => { filters.push(item => item[key] === value); return builder },
    in: (key: string, values: unknown[]) => { filters.push(item => values.includes(item[key])); return builder },
    lte: (key: string, value: string) => { filters.push(item => String(item[key]) <= value); return builder },
    order: () => builder, limit: () => builder,
    update: (value: Row) => { patch = value; return builder },
    insert: (value: Row | Row[]) => { inserts = Array.isArray(value) ? value : [value]; return builder },
    single: async () => finish(true), maybeSingle: async () => finish(true),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(finish()).then(resolve),
  }
  return builder
}
beforeEach(() => {
  tables = { shipping_orders: [row('A-order', 'org-A'), row('B-order', 'org-B'), row('legacy-order', null)], reminders: [] }
  mocks.from.mockReset().mockImplementation(query)
  mocks.recipients.mockReset().mockResolvedValue([{ userId: 'operator-A', orgId: 'org-A' }, { userId: 'operator-B', orgId: 'org-B' }])
  vi.stubEnv('SHIPPING_RECEIPT_SECRET', 's'.repeat(32))
})
afterEach(() => vi.unstubAllEnvs())

describe('shipping collaboration organization boundary', () => {
  it('returns only the authorized organization and excludes legacy unassigned orders', async () => {
    const records = await listShipmentLedger('org-A', { limit: 50 })
    expect(records.map(item => item.id)).toEqual(['A-order'])
  })
  it('does not assign a foreign or unassigned order to the caller', async () => {
    await expect(assignShipmentRelation('B-order', 'org-A', 'new-sales')).rejects.toThrow()
    await expect(assignShipmentRelation('legacy-order', 'org-A', 'new-sales')).rejects.toThrow()
    expect(tables.shipping_orders[1].sales_ref).toBeNull()
    expect(tables.shipping_orders[2].org_id).toBeNull()
  })
  it('binds new anonymous submissions to the server-resolved organization', async () => {
    await createAnonymousShipment({ orgId: 'org-A', key: 'anonymous-key', input })
    expect(tables.shipping_orders.at(-1)?.org_id).toBe('org-A')
  })
  it('does not expose an anonymous receipt from another organization on a reused key', async () => {
    await createAnonymousShipment({ orgId: 'org-A', key: 'same-key', input })
    await expect(createAnonymousShipment({ orgId: 'org-B', key: 'same-key', input })).rejects.toMatchObject({ status: 409 })
  })
  it('preserves anonymous retry receipts within the original organization', async () => {
    const first = await createAnonymousShipment({ orgId: 'org-A', key: 'repeat-key', input })
    const retry = await createAnonymousShipment({ orgId: 'org-A', key: 'repeat-key', input })
    expect(retry.receiptToken).toBe(first.receiptToken)
    expect(retry.order.id).toBe(first.order.id)
    expect(tables.shipping_orders.filter(item => item.idempotency_key === 'repeat-key')).toHaveLength(1)
  })
  it('does not expose an owner order to another user reusing its key', async () => {
    const snapshot = { orgId: 'org-A', connectionId: 'conn', billingAccountId: 'account', senderProfileId: 'sender', environment: 'sandbox' as const, billingAccountTail: '0000', serviceId: 2, serviceName: '示例服务' }
    await createOwnerShipment({ userId: 'owner-A', key: 'same-owner-key', input, snapshot })
    await expect(createOwnerShipment({ userId: 'owner-B', key: 'same-owner-key', input, snapshot })).rejects.toMatchObject({ status: 409 })
  })
  it('groups reminders by organization without exposing other order numbers', async () => {
    expect(await createDueShipmentReviewReminders(new Date('2026-09-27T12:00:00Z'))).toEqual({ orders: 2, reminders: 2 })
    const a = tables.reminders.find(item => item.org_id === 'org-A')!
    const b = tables.reminders.find(item => item.org_id === 'org-B')!
    expect(a.description).toContain('A-order'); expect(a.description).not.toContain('B-order')
    expect(b.description).toContain('B-order'); expect(b.description).not.toContain('A-order')
    expect(tables.shipping_orders[2].review_notified_at).toBeNull()
  })
})
