import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), runtimeConfig: vi.fn(), cancel: vi.fn(), lookup: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('./runtime-config', () => ({ getShippingRuntimeConfig: mocks.runtimeConfig, selectAuthorizedShippingService: vi.fn() }))
vi.mock('./sf-client', () => ({ cancelSfOrder: mocks.cancel, lookupSfOrder: mocks.lookup, createSfOrder: vi.fn() }))
vi.mock('./store', () => ({ shippingStore: {} }))
import { cancelShipmentOrder } from './workflow'

const runtime = { orgId: 'org-1', connectionId: 'connection-1', environment: 'sandbox', partnerId: 'p', checkWord: 'secret', services: [], billingAccountId: 'account-1', billingAccount: '123456', billingAccountTail: '3456', senderProfileId: 'sender-1', sender: { name: 'A', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路1号' }, connectionKey: 'key', snapshot: {} }
const order = { id: 'order-1', org_id: 'org-1', status: 'waybill_created', shipment_payload: {}, provider_key: 'sf', provider_order_id: 'provider-order-1', carrier_connection_id: 'connection-1', billing_account_id: 'account-1', sender_profile_id: 'sender-1', connection_environment: 'sandbox', billing_account_tail: '3456', shipping_config_snapshot: {} }

type QueryResult = { data: unknown; error: null }
type QueryBuilder = {
  select: () => QueryBuilder
  update: () => QueryBuilder
  eq: () => QueryBuilder
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>
}

function makeQueryBuilder(): QueryBuilder {
  let action: 'select' | 'update' | '' = ''
  const builder = {} as QueryBuilder
  builder.select = () => { action = 'select'; return builder }
  builder.update = () => { action = 'update'; return builder }
  builder.eq = () => builder
  builder.single = async () => ({ data: order, error: null })
  builder.maybeSingle = async () => ({ data: { id: 'order-1' }, error: null })
  builder.then = resolve => Promise.resolve(resolve({ data: action === 'select' ? order : null, error: null }))
  return builder
}

beforeEach(() => {
  mocks.from.mockReset().mockImplementation(() => makeQueryBuilder())
  mocks.runtimeConfig.mockReset().mockResolvedValue(runtime)
  mocks.cancel.mockReset().mockResolvedValue(true)
  mocks.lookup.mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('historical carrier snapshot operations', () => {
  it('cancels an uncollected order through its original connection/account snapshot', async () => {
    expect(await cancelShipmentOrder('order-1', 'operator-1')).toEqual({ id: 'order-1', status: 'cancelled' })
    expect(mocks.runtimeConfig).toHaveBeenCalledWith({ orgId: 'org-1', billingAccountId: 'account-1', connectionId: 'connection-1', allowHistorical: true, requireOrderCapability: false })
    expect(mocks.cancel).toHaveBeenCalledWith('provider-order-1', runtime)
    expect(mocks.lookup).not.toHaveBeenCalled()
  })

  it('does not call SF cancellation after pickup has begun', async () => {
    mocks.from.mockImplementation(() => {
      const builder = makeQueryBuilder()
      builder.single = async () => ({ data: { ...order, status: 'in_transit' }, error: null })
      return builder
    })
    await expect(cancelShipmentOrder('order-1', 'operator-1')).rejects.toThrow('只有未揽收且已生成运单的订单可以取消')
    expect(mocks.cancel).not.toHaveBeenCalled()
  })
})
