// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), runtimeConfig: vi.fn(), service: vi.fn(), cancel: vi.fn(), lookup: vi.fn(), submit: vi.fn(), capability: vi.fn(), defaultOrg: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: mocks.defaultOrg }))
vi.mock('./runtime-config', () => ({ getShippingRuntimeConfig: mocks.runtimeConfig, selectAuthorizedShippingService: mocks.service }))
vi.mock('./sf-client', () => ({ cancelSfOrder: mocks.cancel, lookupSfOrder: mocks.lookup, createSfOrder: vi.fn() }))
vi.mock('./service', () => ({ submitShipping: mocks.submit, checkShippingPolicy: vi.fn() }))
vi.mock('./connections', () => ({ recordShippingCapability: mocks.capability }))
vi.mock('./store', () => ({ shippingStoreForOrg: vi.fn(() => ({})) }))
import { cancelShipmentOrder, confirmAndSubmitShipment, reconcileShipmentOrder, returnShipmentOrder } from './workflow'
import { ShippingError } from './config'

const runtime = { orgId: 'org-A', connectionId: 'connection-1', environment: 'sandbox', partnerId: 'synthetic-partner', checkWord: 'synthetic-checkword', services: [{ id: 1, name: '标快', preference: 'standard' }], billingAccountId: 'account-1', billingAccount: '123456', billingAccountTail: '3456', senderProfileId: 'sender-1', sender: { name: 'A', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路1号' }, connectionKey: 'key', snapshot: {} }
const order = { id: 'order-1', org_id: 'org-A' as string | null, status: 'waybill_created', shipment_payload: { source: 'manual', serviceId: 1 }, provider_key: 'sf', provider_order_id: 'provider-order-1', carrier_connection_id: 'connection-1', billing_account_id: 'account-1', sender_profile_id: 'sender-1', connection_environment: 'sandbox', billing_account_tail: '3456', shipping_config_snapshot: {} }
let loadedOrder = { ...order }
let claimLost = false
const queries: Array<{ table: string; action: string; filters: Array<[string, unknown]>; values?: Record<string, unknown> }> = []

function makeQueryBuilder(table: string) {
  const query = { table, action: 'select', filters: [] as Array<[string, unknown]>, values: undefined as Record<string, unknown> | undefined }
  queries.push(query)
  const result = () => ({ data: query.action === 'update' ? (claimLost ? null : { id: order.id }) : table === 'shipping_orders' ? loadedOrder : { waybill_no: 'SF1234567890123' }, error: null })
  const builder = {
    select: () => builder,
    update: (values: Record<string, unknown>) => { query.action = 'update'; query.values = values; return builder },
    upsert: (values: Record<string, unknown>) => { query.action = 'upsert'; query.values = values; return builder },
    eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder },
    in: (key: string, value: unknown) => { query.filters.push([key, value]); return builder },
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(resolve(result())),
  }
  return builder
}

beforeEach(() => {
  loadedOrder = { ...order }
  claimLost = false
  queries.length = 0
  mocks.from.mockReset().mockImplementation(makeQueryBuilder)
  mocks.runtimeConfig.mockReset().mockResolvedValue(runtime)
  mocks.service.mockReset().mockReturnValue(runtime.services[0])
  mocks.cancel.mockReset().mockResolvedValue(true)
  mocks.lookup.mockReset().mockResolvedValue('SF1234567890123')
  mocks.submit.mockReset().mockResolvedValue({ id: 'provider-order-1', status: 'accepted', waybill: 'SF1234567890123' })
  mocks.capability.mockReset().mockResolvedValue(undefined)
  mocks.defaultOrg.mockReset().mockResolvedValue('org-A')
})

const actions = [
  { name: 'confirm', status: 'awaiting_confirmation', call: (orgId: string) => confirmAndSubmitShipment('order-1', 'operator-1', orgId) },
  { name: 'return', status: 'awaiting_confirmation', call: (orgId: string) => returnShipmentOrder('order-1', 'operator-1', orgId, '补充门牌') },
  { name: 'reconcile', status: 'waybill_created', call: (orgId: string) => reconcileShipmentOrder('order-1', orgId) },
  { name: 'cancel', status: 'waybill_created', call: (orgId: string) => cancelShipmentOrder('order-1', 'operator-1', orgId) },
]

describe('shipping order organization boundaries', () => {
  it.each(actions)('$name rejects a returned row belonging to another organization before side effects', async ({ status, call }) => {
    loadedOrder = { ...order, org_id: 'org-B', status }
    await expect(call('org-A')).rejects.toMatchObject({ status: 404 })
    expect(queries[0].filters).toEqual(expect.arrayContaining([['id', 'order-1'], ['org_id', 'org-A']]))
    expect(queries.some(query => query.action !== 'select' || query.table !== 'shipping_orders')).toBe(false)
    expect(mocks.runtimeConfig).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.lookup).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it.each(actions)('$name never adopts a historical order without an organization', async ({ status, call }) => {
    loadedOrder = { ...order, org_id: null, status }
    await expect(call('org-A')).rejects.toMatchObject({ status: 404 })
    expect(mocks.defaultOrg).not.toHaveBeenCalled()
    expect(queries.every(query => query.action === 'select' && query.table === 'shipping_orders')).toBe(true)
  })

  it.each(actions)('$name rejects an absent organization before querying', async ({ call }) => {
    await expect(call('')).rejects.toMatchObject({ status: 403 })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(actions)('$name scopes its read and all order updates to the authorized organization', async ({ status, call }) => {
    loadedOrder = { ...order, status }
    await call('org-A')
    for (const query of queries.filter(query => query.table === 'shipping_orders')) {
      expect(query.filters).toEqual(expect.arrayContaining([['id', 'order-1'], ['org_id', 'org-A']]))
    }
    for (const query of queries.filter(query => query.table === 'shipping_waybills')) {
      expect(query.filters.some(([key, value]) => key === 'shipping_order_id' && value === 'order-1') || query.values?.shipping_order_id === 'order-1').toBe(true)
    }
  })
})

describe('historical carrier snapshot operations', () => {
  it('cancels an uncollected order through its original connection/account snapshot', async () => {
    expect(await cancelShipmentOrder('order-1', 'operator-1', 'org-A')).toEqual({ id: 'order-1', status: 'cancelled' })
    expect(mocks.runtimeConfig).toHaveBeenCalledWith({ orgId: 'org-A', billingAccountId: 'account-1', connectionId: 'connection-1', allowHistorical: true, requireOrderCapability: false })
    expect(mocks.cancel).toHaveBeenCalledWith('provider-order-1', runtime)
    expect(mocks.lookup).not.toHaveBeenCalled()
  })

  it('does not call SF cancellation after pickup has begun', async () => {
    loadedOrder = { ...order, status: 'in_transit' }
    await expect(cancelShipmentOrder('order-1', 'operator-1', 'org-A')).rejects.toThrow('只有未揽收且已生成运单的订单可以取消')
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('keeps cancellation idempotent within the same organization', async () => {
    loadedOrder = { ...order, status: 'cancelled' }
    await expect(cancelShipmentOrder('order-1', 'operator-1', 'org-A')).resolves.toEqual({ id: 'order-1', status: 'cancelled' })
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('reconciles an unknown order using its stored connection without submitting a second shipment', async () => {
    loadedOrder = { ...order, status: 'order_unknown' }
    await expect(confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')).resolves.toEqual({ id: 'order-1', status: 'waybill_created', waybill: 'SF1234567890123' })
    expect(mocks.lookup).toHaveBeenCalledWith('provider-order-1', runtime)
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(queries.filter(query => query.table === 'shipping_orders').every(query => query.filters.some(([key, value]) => key === 'org_id' && value === 'org-A'))).toBe(true)
  })

  it('keeps an inconclusive lookup unknown without writing or resubmitting', async () => {
    loadedOrder = { ...order, status: 'order_unknown' }
    mocks.lookup.mockResolvedValue(null)
    await expect(reconcileShipmentOrder('order-1', 'org-A')).resolves.toEqual({ id: 'order-1', status: 'order_unknown', waybill: null })
    expect(queries.every(query => query.action === 'select')).toBe(true)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it.each(['accepted', 'unknown', 'rejected'] as const)('scopes confirmed-order retry and %s result updates', async result => {
    loadedOrder = { ...order, status: 'confirmed' }
    if (result === 'unknown') mocks.submit.mockResolvedValue({ id: 'provider-order-1', status: 'unknown', waybill: null })
    if (result === 'rejected') mocks.submit.mockRejectedValue(new ShippingError(502, 'synthetic rejection', 'provider_rejected'))
    const submission = confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')
    if (result === 'rejected') await expect(submission).rejects.toThrow('synthetic rejection')
    else await submission
    const updates = queries.filter(query => query.table === 'shipping_orders' && query.action === 'update')
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(updates.every(query => query.filters.some(([key, value]) => key === 'org_id' && value === 'org-A'))).toBe(true)
  })

  it('does not contact SF when a concurrent process already claimed a confirmed order', async () => {
    loadedOrder = { ...order, status: 'confirmed' }
    claimLost = true
    await expect(confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')).rejects.toMatchObject({ status: 409 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
