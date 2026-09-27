// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackingResult } from './types'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
import { recordTrackingResult } from './tracking-store'

type Waybill = { id: string; shipping_order_id: string; carrier_key: string; waybill_no: string; shipping_orders: { org_id: string | null } | Array<{ org_id: string | null }> | null }
type Query = { table: string; action: 'select' | 'upsert' | 'update'; select?: string; filters: Array<[string, unknown]>; values?: unknown }
let waybill: Waybill | null
let queries: Query[]
let returnUnfiltered = false
let databaseError = false
const result: TrackingResult = { waybill: 'SF1234567890123', queriedAt: '2026-09-27T00:00:00Z', events: [{ time: '2026-09-27T00:00:00Z', location: '模拟城市', description: '模拟运输中' }] }

function builder(table: string) {
  const query: Query = { table, action: 'select', filters: [] }; queries.push(query)
  const resolve = () => {
    if (databaseError) return { data: null, error: { message: 'synthetic failure' } }
    if (query.action !== 'select' || !waybill) return { data: null, error: null }
    const order = Array.isArray(waybill.shipping_orders) ? waybill.shipping_orders[0] : waybill.shipping_orders
    const matches = query.filters.every(([key, value]) => key === 'shipping_orders.org_id'
      ? (!query.select?.includes('!inner') || order?.org_id === value)
      : waybill![key as keyof Waybill] === value)
    return { data: matches || returnUnfiltered ? waybill : null, error: null }
  }
  const api = {
    select: (fields: string) => { query.select = fields; return api },
    eq: (key: string, value: unknown) => { query.filters.push([key, value]); return api },
    upsert: (values: unknown) => { query.action = 'upsert'; query.values = values; return api },
    update: (values: unknown) => { query.action = 'update'; query.values = values; return api },
    maybeSingle: async () => resolve(),
    then: (fulfilled: (value: ReturnType<typeof resolve>) => unknown) => Promise.resolve(resolve()).then(fulfilled),
  }
  return api
}

beforeEach(() => {
  waybill = { id: 'waybill-1', shipping_order_id: 'order-1', carrier_key: 'sf', waybill_no: result.waybill, shipping_orders: { org_id: 'org-A' } }
  queries = []; returnUnfiltered = false; databaseError = false
  mocks.from.mockReset().mockImplementation(builder)
})

describe('tracking event organization scope', () => {
  it('rejects missing organization before accessing storage', async () => {
    await expect(recordTrackingResult('', result)).rejects.toMatchObject({ status: 403 })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(['org-B', null])('does not write a matching waybill owned by %s', async orgId => {
    waybill!.shipping_orders = { org_id: orgId }
    expect(await recordTrackingResult('org-A', result)).toEqual({ recorded: 0 })
    expect(queries).toHaveLength(1)
    expect(queries[0].select).toContain('shipping_orders!inner(org_id)')
    expect(queries[0].filters).toContainEqual(['shipping_orders.org_id', 'org-A'])
    expect(queries.every(query => query.action === 'select')).toBe(true)
  })

  it.each([{ org_id: 'org-B' }, { org_id: null }, null])('fails closed if the returned order association is not authorized', async order => {
    waybill!.shipping_orders = order; returnUnfiltered = true
    expect(await recordTrackingResult('org-A', result)).toEqual({ recorded: 0 })
    expect(queries.every(query => query.action === 'select')).toBe(true)
  })

  it('does not attach a personal imported waybill when no company order is found', async () => {
    waybill = null
    expect(await recordTrackingResult('org-A', result)).toEqual({ recorded: 0 })
    expect(queries.every(query => query.action === 'select')).toBe(true)
  })

  it.each([false, true])('records only the verified company waybill (array relation: %s)', async arrayRelation => {
    if (arrayRelation) waybill!.shipping_orders = [{ org_id: 'org-A' }]
    expect(await recordTrackingResult('org-A', result)).toEqual({ recorded: 1 })
    const events = queries.find(query => query.table === 'shipping_tracking_events')
    expect(events?.values).toEqual([expect.objectContaining({ waybill_id: 'waybill-1', description: '模拟运输中' })])
    const update = queries.find(query => query.action === 'update')
    expect(update?.filters).toContainEqual(['id', 'waybill-1'])
    expect(update?.filters).toContainEqual(['shipping_order_id', 'order-1'])
  })

  it('does not write when ownership lookup fails', async () => {
    databaseError = true
    await expect(recordTrackingResult('org-A', result)).rejects.toMatchObject({ status: 503 })
    expect(queries.every(query => query.action === 'select')).toBe(true)
  })
})
