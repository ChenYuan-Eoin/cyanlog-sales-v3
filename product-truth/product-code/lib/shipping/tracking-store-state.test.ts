// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShipmentOrderStatus, TrackingEventStatus, TrackingResult } from './types'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
import { recordTrackingResult } from './tracking-store'

type Query = { table: string; action: 'select' | 'upsert' | 'update'; fields?: string; filters: Array<[string, unknown]>; values?: Record<string, unknown> | Array<Record<string, unknown>> }
let order: { id: string; org_id: string | null; status: ShipmentOrderStatus }
let waybill: { id: string; shipping_order_id: string; carrier_key: string; waybill_no: string; latest_event_at: string | null; latest_status: string }
let events: Map<string, Record<string, unknown>>
let queries: Query[]
let beforeWaybillUpdate: (() => void) | undefined
let beforeOrderUpdate: (() => void) | undefined
let failTable = ''

const eventResult = (description: string, time = '2026-09-27T09:30:00.000Z', status?: TrackingEventStatus): TrackingResult => ({ waybill: 'SF1234567890123', queriedAt: '2026-09-27T10:00:00.000Z', events: [{ description, time, location: '模拟深圳', ...(status ? { status } : {}) }] })

function builder(table: string) {
  const query: Query = { table, action: 'select', filters: [] }; queries.push(query)
  const matches = (row: Record<string, unknown>) => query.filters.every(([key, value]) => (key === 'shipping_orders.org_id' ? order.org_id : row[key]) === value)
  const resolve = () => {
    if (table === failTable && query.action !== 'select') return { data: null, error: { message: 'synthetic write failure' } }
    if (query.action === 'upsert') {
      for (const event of query.values as Array<Record<string, unknown>>) {
        const key = `${event.waybill_id}:${event.provider_key}:${event.provider_event_id}`
        if (!events.has(key)) events.set(key, structuredClone(event))
      }
      return { data: null, error: null }
    }
    if (query.action === 'update') {
      const hook = table === 'shipping_waybills' ? beforeWaybillUpdate : beforeOrderUpdate
      if (table === 'shipping_waybills') beforeWaybillUpdate = undefined
      else beforeOrderUpdate = undefined
      hook?.()
      const row = table === 'shipping_waybills' ? waybill : order
      if (!matches(row)) return { data: null, error: null }
      Object.assign(row, query.values)
      return { data: structuredClone(row), error: null }
    }
    if (table === 'shipping_waybills') {
      if (!matches(waybill)) return { data: null, error: null }
      return { data: structuredClone({ ...waybill, shipping_orders: order }), error: null }
    }
    return { data: null, error: null }
  }
  const api = {
    select: (fields: string) => { query.fields = fields; return api },
    eq: (key: string, value: unknown) => { query.filters.push([key, value]); return api },
    is: (key: string, value: unknown) => { query.filters.push([key, value]); return api },
    upsert: (values: Array<Record<string, unknown>>) => { query.action = 'upsert'; query.values = values; return api },
    update: (values: Record<string, unknown>) => { query.action = 'update'; query.values = values; return api },
    maybeSingle: async () => resolve(),
    then: (fulfilled: (value: ReturnType<typeof resolve>) => unknown) => Promise.resolve(resolve()).then(fulfilled),
  }
  return api
}

beforeEach(() => {
  order = { id: 'order-A', org_id: 'org-A', status: 'waybill_created' }
  waybill = { id: 'waybill-A', shipping_order_id: order.id, carrier_key: 'sf', waybill_no: 'SF1234567890123', latest_event_at: null, latest_status: 'waybill_created' }
  events = new Map(); queries = []; beforeWaybillUpdate = undefined; beforeOrderUpdate = undefined; failTable = ''
  mocks.from.mockReset().mockImplementation(builder)
})

describe('persisted shipment tracking progression', () => {
  it('treats 已收取 as pickup, normalizes China time, and advances the order to in_transit', async () => {
    const recorded = await recordTrackingResult('org-A', eventResult('顺丰速运 已收取快件', '2026-09-27 17:30:00'))
    expect(recorded).toEqual({ recorded: 1, shipmentStatus: 'in_transit' })
    expect([...events.values()][0]).toMatchObject({ status: 'in_transit', event_at: '2026-09-27T09:30:00.000Z' })
    expect(waybill).toMatchObject({ latest_status: 'in_transit', latest_event_at: '2026-09-27T09:30:00.000Z' })
    expect(order.status).toBe('in_transit')
    expect(queries.find(query => query.table === 'shipping_orders' && query.action === 'update')?.filters).toEqual(expect.arrayContaining([['org_id', 'org-A'], ['id', 'order-A'], ['status', 'waybill_created']]))
    expect(queries.find(query => query.table === 'shipping_waybills' && query.action === 'update')?.filters).toEqual(expect.arrayContaining([['latest_event_at', null], ['latest_status', 'waybill_created']]))
  })

  it.each<TrackingEventStatus>(['unknown', 'exception', 'waybill_created'])('does not reinterpret an explicit %s status using a delivery-looking description', async status => {
    expect(await recordTrackingResult('org-A', eventResult('快件已签收', undefined, status))).toMatchObject({ shipmentStatus: 'waybill_created' })
    expect([...events.values()][0].status).toBe(status)
    expect(queries.some(query => query.table === 'shipping_orders' && query.action === 'update')).toBe(false)
  })

  it.each(['尚未揽收', '未签收', '签收失败，请联系快递员'])('does not advance an ambiguous or negative event: %s', async description => {
    expect(await recordTrackingResult('org-A', eventResult(description))).toMatchObject({ shipmentStatus: 'waybill_created' })
    expect(order.status).toBe('waybill_created')
  })

  it('maps out_for_delivery to in_transit and later delivery to delivered', async () => {
    expect(await recordTrackingResult('org-A', eventResult('正在派送', undefined, 'out_for_delivery'))).toMatchObject({ shipmentStatus: 'in_transit' })
    expect(await recordTrackingResult('org-A', eventResult('收件人已签收', '2026-09-27T10:00:00.000Z', 'delivered'))).toMatchObject({ shipmentStatus: 'delivered' })
    expect(order.status).toBe('delivered')
  })

  it.each<ShipmentOrderStatus>(['cancelled', 'delivered'])('keeps terminal state %s despite a newer transport event', async status => {
    order.status = status; waybill.latest_status = status; waybill.latest_event_at = '2026-09-27T09:00:00.000Z'
    expect(await recordTrackingResult('org-A', eventResult('运输中', undefined, 'in_transit'))).toMatchObject({ shipmentStatus: status })
    expect(order.status).toBe(status)
    expect(waybill.latest_status).toBe(status)
    expect(queries.some(query => query.action === 'update')).toBe(false)
  })

  it('keeps delivered final even when contradictory newer transport follows delivery in the same response', async () => {
    const response = eventResult('已签收', '2026-09-27T09:00:00.000Z', 'delivered')
    response.events.push({ description: '运输中', time: '2026-09-27T09:30:00.000Z', location: '模拟', status: 'in_transit' })
    expect(await recordTrackingResult('org-A', response)).toMatchObject({ shipmentStatus: 'delivered' })
  })

  it('stores old history without letting an older delivery response override a newer transport state', async () => {
    order.status = 'in_transit'; waybill.latest_status = 'in_transit'; waybill.latest_event_at = '2026-09-27T10:00:00.000Z'
    expect(await recordTrackingResult('org-A', eventResult('已签收', '2026-09-27T09:30:00.000Z', 'delivered'))).toMatchObject({ shipmentStatus: 'in_transit' })
    expect(waybill.latest_event_at).toBe('2026-09-27T10:00:00.000Z')
    expect(queries.some(query => query.action === 'update')).toBe(false)
  })

  it('makes equal-time repetitions idempotent across equivalent time formats', async () => {
    await recordTrackingResult('org-A', eventResult('已揽收', '2026-09-27 17:30:00', 'in_transit'))
    queries = []
    expect(await recordTrackingResult('org-A', eventResult('已揽收', '2026-09-27T09:30:00.000Z', 'in_transit'))).toMatchObject({ shipmentStatus: 'in_transit' })
    expect(events.size).toBe(1)
    expect(queries.some(query => query.action === 'update')).toBe(false)
  })

  it('allows a higher status at the same timestamp without allowing a downgrade', async () => {
    await recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))
    expect(await recordTrackingResult('org-A', eventResult('已签收', undefined, 'delivered'))).toMatchObject({ shipmentStatus: 'delivered' })
    expect(await recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))).toMatchObject({ shipmentStatus: 'delivered' })
  })

  it.each(['not-a-date', '2026-02-30 12:00:00', '2026-09-27T17:30:00'])('does not write or advance events with invalid time %s', async time => {
    expect(await recordTrackingResult('org-A', eventResult('已签收', time, 'delivered'))).toEqual({ recorded: 0, shipmentStatus: 'waybill_created' })
    expect(events.size).toBe(0)
    expect(queries.every(query => query.action === 'select')).toBe(true)
  })

  it('excludes invalid-time delivery while keeping a valid pickup event', async () => {
    const response = eventResult('已签收', 'invalid-time', 'delivered')
    response.events.push({ description: '已揽收', time: '2026-09-27T09:30:00.000Z', location: '模拟', status: 'in_transit' })
    expect(await recordTrackingResult('org-A', response)).toEqual({ recorded: 1, shipmentStatus: 'in_transit' })
    expect(events.size).toBe(1)
  })

  it('does not overwrite a newer response winning the waybill CAS', async () => {
    beforeWaybillUpdate = () => { waybill.latest_event_at = '2026-09-27T10:00:00.000Z'; waybill.latest_status = 'delivered'; order.status = 'delivered' }
    expect(await recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))).toMatchObject({ shipmentStatus: 'delivered' })
    expect(waybill.latest_event_at).toBe('2026-09-27T10:00:00.000Z')
    expect(queries.filter(query => query.action === 'update')).toHaveLength(1)
  })

  it('does not overwrite a concurrent cancellation that leaves the provider timestamp unchanged', async () => {
    beforeWaybillUpdate = () => { waybill.latest_status = 'cancelled'; order.status = 'cancelled' }
    expect(await recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))).toMatchObject({ shipmentStatus: 'cancelled' })
    expect(waybill.latest_status).toBe('cancelled')
    expect(waybill.latest_event_at).toBeNull()
    expect(queries.filter(query => query.action === 'update')).toHaveLength(1)
  })

  it('retries against a racing older response so the newer delivery can be persisted', async () => {
    beforeWaybillUpdate = () => { waybill.latest_event_at = '2026-09-27T09:00:00.000Z'; waybill.latest_status = 'in_transit'; order.status = 'in_transit' }
    expect(await recordTrackingResult('org-A', eventResult('已签收', undefined, 'delivered'))).toMatchObject({ shipmentStatus: 'delivered' })
    expect(waybill.latest_event_at).toBe('2026-09-27T09:30:00.000Z')
    expect(queries.filter(query => query.table === 'shipping_waybills' && query.action === 'update')).toHaveLength(2)
  })

  it('returns the persisted cancellation when it wins the order CAS', async () => {
    beforeOrderUpdate = () => { order.status = 'cancelled'; waybill.latest_status = 'cancelled' }
    expect(await recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))).toMatchObject({ shipmentStatus: 'cancelled' })
    expect(order.status).toBe('cancelled')
    expect(waybill.latest_status).toBe('cancelled')
  })

  it('retries a concurrent order advance without regressing it', async () => {
    beforeOrderUpdate = () => { order.status = 'in_transit' }
    expect(await recordTrackingResult('org-A', eventResult('已签收', undefined, 'delivered'))).toMatchObject({ shipmentStatus: 'delivered' })
    expect(queries.filter(query => query.table === 'shipping_orders' && query.action === 'update')).toHaveLength(2)
  })

  it('recovers an already persisted waybill status if the earlier order update failed', async () => {
    waybill.latest_status = 'in_transit'; waybill.latest_event_at = '2026-09-27T09:30:00.000Z'
    expect(await recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))).toMatchObject({ shipmentStatus: 'in_transit' })
    expect(queries.some(query => query.table === 'shipping_waybills' && query.action === 'update')).toBe(false)
  })

  it.each(['shipping_tracking_events', 'shipping_waybills', 'shipping_orders'])('surfaces failed writes to %s instead of reporting unsaved status', async table => {
    failTable = table
    await expect(recordTrackingResult('org-A', eventResult('已揽收', undefined, 'in_transit'))).rejects.toMatchObject({ status: 503 })
  })

  it.each(['org-B', null])('never writes a matching waybill belonging to %s', async orgId => {
    order.org_id = orgId
    expect(await recordTrackingResult('org-A', eventResult('已签收', undefined, 'delivered'))).toEqual({ recorded: 0 })
    expect(queries.every(query => query.action === 'select')).toBe(true)
    expect(events.size).toBe(0)
  })
})
