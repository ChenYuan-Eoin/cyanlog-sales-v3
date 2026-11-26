// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { CarrierAdapter } from './carrier-adapter'

const adapterOverride = vi.hoisted(() => ({ value: undefined as CarrierAdapter | undefined }))
vi.mock('./carrier-adapter', async importOriginal => {
  const real = await importOriginal<typeof import('./carrier-adapter')>()
  return { ...real, getCarrierAdapter: (key: string) => adapterOverride.value?.key === key ? adapterOverride.value : real.getCarrierAdapter(key) }
})

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), runtimeConfig: vi.fn(), service: vi.fn(), cancel: vi.fn(), lookup: vi.fn(), submit: vi.fn(), capability: vi.fn(), defaultOrg: vi.fn(), operator: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, AuthError: class extends Error {} }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: mocks.defaultOrg }))
vi.mock('./runtime-config', () => ({ getShippingRuntimeConfig: mocks.runtimeConfig, selectAuthorizedShippingService: mocks.service }))
vi.mock('./sf-client', () => ({ cancelSfOrder: mocks.cancel, lookupSfOrder: mocks.lookup, createSfOrder: vi.fn() }))
vi.mock('./service', async importOriginal => ({ ...await importOriginal<typeof import('./service')>(), submitShipping: mocks.submit, checkShippingPolicy: vi.fn() }))
vi.mock('./connections', () => ({ recordShippingCapability: mocks.capability }))
vi.mock('./store', () => ({ shippingStoreForOrg: vi.fn(() => ({})) }))
vi.mock('./operator-access', () => ({ requireShippingOperator: mocks.operator }))
import { POST as confirmShipment } from '@/app/api/shipping/ledger/[id]/confirm/route'
import { cancelShipmentOrder, confirmAndSubmitShipment, reconcileShipmentOrder, returnShipmentOrder, reopenFailedShipmentOrder } from './workflow'
import { ShippingError } from './config'

const runtime = { orgId: 'org-A', connectionId: 'connection-1', environment: 'sandbox', partnerId: 'synthetic-partner', checkWord: 'synthetic-checkword', services: [{ id: 1, name: '标快', preference: 'standard' }], billingAccountId: 'account-1', billingAccount: '123456', billingAccountTail: '3456', senderProfileId: 'sender-1', sender: { name: 'A', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路1号' }, connectionKey: 'key', snapshot: {} }
const order = { id: 'order-1', org_id: 'org-A' as string | null, intake_source: 'owner_web', status: 'waybill_created', shipment_payload: { source: 'manual', serviceId: 1, recipient: { ...runtime.sender, name: '示例收件人' } } as Record<string, unknown>, provider_key: 'sf', provider_order_id: 'provider-order-1', carrier_connection_id: 'connection-1', billing_account_id: 'account-1' as string | null, sender_profile_id: 'sender-1', connection_environment: 'sandbox', billing_account_tail: '3456', shipping_config_snapshot: {} }
let loadedOrder = { ...order }
let claimLost = false
const queries: Array<{ table: string; action: string; filters: Array<[string, unknown]>; values?: Record<string, unknown> }> = []

function makeQueryBuilder(table: string) {
  const query = { table, action: 'select', filters: [] as Array<[string, unknown]>, values: undefined as Record<string, unknown> | undefined }
  queries.push(query)
  const result = () => {
    if (query.action === 'update') {
      if (claimLost) return { data: null, error: null }
      if (table === 'shipping_orders') {
        const matched = query.filters.every(([key, value]) => {
          const actual = loadedOrder[key as keyof typeof loadedOrder]
          return Array.isArray(value) ? value.includes(actual) : value === actual
        })
        if (!matched) return { data: null, error: null }
        loadedOrder = { ...loadedOrder, ...query.values }
      }
      return { data: { id: order.id }, error: null }
    }
    return { data: table === 'shipping_orders' ? loadedOrder : loadedOrder.status === 'order_failed' ? null : { waybill_no: 'SF1234567890123' }, error: null }
  }
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
  adapterOverride.value = undefined
  loadedOrder = { ...order }
  claimLost = false
  queries.length = 0
  mocks.rpc.mockReset().mockImplementation(async (name, args) => {
    if (name === 'claim_shipping_cancellation_v1') {
      if (args.p_org !== loadedOrder.org_id) return {data:{result:'missing'}}
      if (loadedOrder.status !== 'waybill_created' || !loadedOrder.carrier_connection_id) return {data:{id:order.id,result:loadedOrder.status === 'cancelled' ? 'cancelled' : 'unavailable'}}
      return {data:{id:order.id,result:'dispatch', provider:loadedOrder.provider_key, providerOrderId:loadedOrder.provider_order_id,
        connectionId:loadedOrder.carrier_connection_id, billingAccountId:loadedOrder.billing_account_id, environment:loadedOrder.connection_environment}}
    }
    if (args.p_outcome === 'accepted') {
      if (loadedOrder.status === 'delivered') return {data:'manual_review'}
      loadedOrder.status='cancelled'
    }
    return {data:args.p_outcome}
  })
  mocks.from.mockReset().mockImplementation(makeQueryBuilder)
  mocks.runtimeConfig.mockReset().mockImplementation(async args => args.senderOverride ? { ...runtime, sender: args.senderOverride, senderProfileId: null, snapshot: { senderSource: 'workorder', senderProfileId: null } } : runtime)
  mocks.service.mockReset().mockReturnValue(runtime.services[0])
  mocks.cancel.mockReset().mockResolvedValue(true)
  mocks.lookup.mockReset().mockResolvedValue('SF1234567890123')
  mocks.submit.mockReset().mockResolvedValue({ id: 'provider-order-1', status: 'accepted', waybill: 'SF1234567890123' })
  mocks.capability.mockReset().mockResolvedValue(undefined)
  mocks.defaultOrg.mockReset().mockResolvedValue('org-A')
  mocks.operator.mockReset().mockResolvedValue('org-A')
  mocks.auth.mockReset().mockResolvedValue({ id: 'operator-1' })
})

const actions = [
  { name: 'confirm', status: 'awaiting_confirmation', call: (orgId: string) => confirmAndSubmitShipment('order-1', 'operator-1', orgId) },
  { name: 'return', status: 'awaiting_confirmation', call: (orgId: string) => returnShipmentOrder('order-1', 'operator-1', orgId, '补充门牌') },
  { name: 'reconcile', status: 'waybill_created', call: (orgId: string) => reconcileShipmentOrder('order-1', orgId) },
  { name: 'cancel', status: 'waybill_created', call: (orgId: string) => cancelShipmentOrder('order-1', 'operator-1', orgId) },
]

describe('work-order sender preservation at formal confirmation', () => {
  it('uses a sales sender snapshot and never substitutes the company sender', async () => {
    const salesSender = { ...runtime.sender, name: '  示例销售  ', address: '个人示例寄件路9号' }
    loadedOrder = { ...order, status: 'awaiting_confirmation', intake_source: 'anonymous_web', shipment_payload: { ...order.shipment_payload, sender: salesSender } }
    await confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')
    expect(mocks.runtimeConfig).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-A', senderOverride: { ...salesSender, name: '示例销售' } }))
    expect(mocks.submit.mock.calls[0][0].input.sender).toEqual({ ...salesSender, name: '示例销售' })
    const frozen = queries.find(query => query.values?.status === 'ordering')?.values
    expect(frozen?.shipment_payload).toMatchObject({ sender: { name: '示例销售', address: '个人示例寄件路9号' } })
    expect(frozen?.shipping_config_snapshot).toMatchObject({ senderSource: 'workorder', senderProfileId: null })
  })
  it('allows only a missing operator sender to use the company default', async () => {
    loadedOrder = { ...order, status: 'awaiting_confirmation' }
    await confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')
    expect(mocks.submit.mock.calls[0][0].input.sender).toEqual(runtime.sender)
    expect(queries.find(query => query.values?.status === 'ordering')?.values?.shipping_config_snapshot).toMatchObject({ senderSource: 'company_default' })
  })
  it.each(['anonymous_web', 'crm', 'wechat_bot'])('refuses missing %s sender before loading credentials or contacting SF', async intake_source => {
    loadedOrder = { ...order, status: 'awaiting_confirmation', intake_source }
    await expect(confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')).rejects.toMatchObject({ status: 400, requestStage: 'validation' })
    expect(mocks.runtimeConfig).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(queries.some(query => query.action !== 'select')).toBe(false)
  })
  it('does not replace an incomplete but nonempty operator sender with the company sender', async () => {
    loadedOrder = { ...order, status: 'awaiting_confirmation', shipment_payload: { ...order.shipment_payload, sender: { name: '示例本人', phone: '', province: '', city: '', county: '', address: '' } } }
    await expect(confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')).rejects.toMatchObject({ status: 400 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})

describe('shipping order organization boundaries', () => {
  it.each(actions)('$name rejects a returned row belonging to another organization before side effects', async ({ name, status, call }) => {
    loadedOrder = { ...order, org_id: 'org-B', status }
    await expect(call('org-A')).rejects.toMatchObject({ status: 404 })
    if (name === 'cancel') expect(mocks.rpc).toHaveBeenCalledWith('claim_shipping_cancellation_v1', expect.objectContaining({p_reference:'order-1',p_org:'org-A',p_owner:false}))
    else expect(queries[0].filters).toEqual(expect.arrayContaining([['id', 'order-1'], ['org_id', 'org-A']]))
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

  it('persists an accepted SF cancellation when tracking advances during the provider request', async () => {
    mocks.cancel.mockImplementation(async () => {
      loadedOrder = { ...loadedOrder, status: 'in_transit' }
      return true
    })
    await expect(cancelShipmentOrder('order-1', 'operator-1', 'org-A')).resolves.toEqual({ id: 'order-1', status: 'cancelled' })
    expect(loadedOrder.status).toBe('cancelled')
    expect(mocks.rpc).toHaveBeenCalledWith('finish_shipping_cancellation_v1', expect.objectContaining({ p_outcome:'accepted', p_org:'org-A' }))
  })

  it('does not overwrite a delivered order if tracking wins the cancellation race', async () => {
    mocks.cancel.mockImplementation(async () => {
      loadedOrder = { ...loadedOrder, status: 'delivered' }
      return true
    })
    await expect(cancelShipmentOrder('order-1', 'operator-1', 'org-A')).rejects.toMatchObject({ status: 409 })
    expect(loadedOrder.status).toBe('delivered')
    expect(queries.some(query => query.table === 'shipping_waybills' && query.action === 'update')).toBe(false)
  })

  it('returns success when another accepted cancellation has already updated the order', async () => {
    mocks.cancel.mockImplementation(async () => {
      loadedOrder = { ...loadedOrder, status: 'cancelled' }
      return true
    })
    await expect(cancelShipmentOrder('order-1', 'operator-1', 'org-A')).resolves.toEqual({ id: 'order-1', status: 'cancelled' })
    expect(loadedOrder.status).toBe('cancelled')
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
  })

  it.each(['provider_rejected', 'provider_unreachable'] as const)('does not mark cancellation when SF reports %s', async stage => {
    mocks.cancel.mockImplementation(async () => {
      loadedOrder = { ...loadedOrder, status: 'in_transit' }
      throw new ShippingError(502, 'synthetic cancellation failure', stage)
    })
    await expect(cancelShipmentOrder('order-1', 'operator-1', 'org-A')).rejects.toMatchObject({ requestStage: stage })
    expect(loadedOrder.status).toBe('in_transit')
    expect(queries.some(query => query.action === 'update')).toBe(false)
    expect(mocks.capability).not.toHaveBeenCalled()
  })

  it('reconciles an unknown order using its stored connection without submitting a second shipment', async () => {
    loadedOrder = { ...order, status: 'order_unknown' }
    await expect(confirmAndSubmitShipment('order-1', 'operator-1', 'org-A')).resolves.toEqual({ id: 'order-1', status: 'waybill_created', waybill: 'SF1234567890123' })
    expect(mocks.operator).toHaveBeenCalledWith('operator-1', 'shipping:order_reconcile')
    expect(mocks.lookup).toHaveBeenCalledWith('provider-order-1', runtime)
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(queries.filter(query => query.table === 'shipping_orders').every(query => query.filters.some(([key, value]) => key === 'org_id' && value === 'org-A'))).toBe(true)
  })

  it.each(['denied', 'other organization'])('does not look up an unknown shipment when the separate reconcile grant is %s', async decision => {
    loadedOrder = { ...order, status: 'order_unknown' }
    mocks.operator.mockImplementation(async (_actor, permission) => {
      if (permission === 'shipping:order_confirm') return 'org-A'
      if (decision === 'other organization') return 'org-B'
      throw new ShippingError(403, '当前账号没有下单结果查回权限。')
    })
    const request = new NextRequest('https://example.test/api/shipping/ledger/order-1/confirm', {
      method: 'POST', body: '{}',
    })
    const response = await confirmShipment(request, { params: Promise.resolve({ id: 'order-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.operator.mock.calls).toEqual([
      ['operator-1', 'shipping:order_confirm'], ['operator-1', 'shipping:order_reconcile'],
    ])
    expect(mocks.runtimeConfig).not.toHaveBeenCalled()
    expect(mocks.lookup).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.capability).not.toHaveBeenCalled()
    expect(queries.every(query => query.action === 'select')).toBe(true)
    expect(loadedOrder.status).toBe('order_unknown')
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

describe('workflow uses a carrier contract, not provider-specific calls', () => {
  it('freezes nonmonthly payment and recovers/cancels it without a billing account snapshot', async () => {
    loadedOrder = { ...order, status: 'awaiting_confirmation', billing_account_id: null }
    mocks.runtimeConfig.mockResolvedValue({ ...runtime, billingAccountId: null, billingAccount: '', billingAccountTail: '' })
    await confirmAndSubmitShipment(order.id, 'operator-1', 'org-A', { payment: 'recipient', connectionId: runtime.connectionId })
    expect(loadedOrder.shipment_payload.payment).toBe('recipient')
    expect(loadedOrder.shipping_config_snapshot).toMatchObject({ payment: 'recipient' })
    expect(loadedOrder.billing_account_id).toBeNull()
    expect(mocks.runtimeConfig).toHaveBeenCalledWith(expect.objectContaining({ payment: 'recipient', billingAccountId: undefined, connectionId: runtime.connectionId }))
    loadedOrder.status = 'order_unknown'
    await expect(reconcileShipmentOrder(order.id, 'org-A')).resolves.toMatchObject({ status: 'waybill_created' })
    await expect(cancelShipmentOrder(order.id, 'operator-1', 'org-A')).resolves.toMatchObject({ status: 'cancelled' })
    expect(mocks.lookup).toHaveBeenCalledOnce()
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })
  it('does not change a previously confirmed payment method during retry', async () => {
    loadedOrder = { ...order, status: 'confirmed', shipment_payload: { ...order.shipment_payload, payment: 'recipient' } }
    await expect(confirmAndSubmitShipment(order.id, 'operator-1', 'org-A', { payment: 'sender_monthly' })).rejects.toMatchObject({ status: 409 })
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('dispatches create, reconcile and cancel through the same installed test adapter', async () => {
    const create = vi.fn().mockResolvedValue('TEST-WAYBILL')
    const lookup = vi.fn().mockResolvedValue('TEST-WAYBILL')
    const cancel = vi.fn().mockResolvedValue(undefined)
    const { partnerId: _partner, checkWord: _word, billingAccount: _account, ...metadata } = runtime
    void _partner; void _word; void _account
    const connect = vi.fn().mockResolvedValue({ key: 'test-only', context: metadata, selectService: () => runtime.services[0], create, lookup, cancel })
    adapterOverride.value = { key: 'test-only', connect }
    loadedOrder = { ...order, provider_key: 'test-only', status: 'awaiting_confirmation' }
    mocks.submit.mockImplementation(async args => ({ id: 'original-provider-request', status: 'accepted', waybill: await args.send('original-provider-request', args.input) }))
    await expect(confirmAndSubmitShipment(order.id, 'operator-1', 'org-A')).resolves.toMatchObject({ status: 'waybill_created', waybill: 'TEST-WAYBILL' })
    expect(create).toHaveBeenCalledOnce()
    expect(queries.find(q => q.table === 'shipping_waybills' && q.action === 'upsert')?.values).toMatchObject({ carrier_key: 'test-only' })
    expect(mocks.submit.mock.calls[0][0].runtimeConfig).not.toHaveProperty('checkWord')
    loadedOrder = { ...order, provider_key: 'test-only', status: 'order_unknown' }
    await expect(reconcileShipmentOrder(order.id, 'org-A')).resolves.toMatchObject({ status: 'waybill_created' })
    expect(lookup).toHaveBeenCalledWith(order.provider_order_id)
    loadedOrder = { ...order, provider_key: 'test-only' }
    await expect(cancelShipmentOrder(order.id, 'operator-1', 'org-A')).resolves.toMatchObject({ status: 'cancelled' })
    expect(cancel).toHaveBeenCalledWith(order.provider_order_id)
    expect(mocks.runtimeConfig).not.toHaveBeenCalled()
    expect(mocks.lookup).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })
})

describe('definitively rejected original-order recovery', () => {
  it('retains the failure, reopens without calling carrier, and uses a fresh request only after confirmation', async () => {
    loadedOrder = { ...order, status: 'awaiting_confirmation' }
    mocks.submit.mockRejectedValueOnce(new ShippingError(422, '承运商明确拒绝', 'provider_rejected'))
    await expect(confirmAndSubmitShipment(order.id, 'operator-1', 'org-A')).rejects.toThrow('明确拒绝')
    expect(loadedOrder.status).toBe('order_failed')
    expect(loadedOrder.shipping_config_snapshot).toMatchObject({orderFailure:{message:'承运商明确拒绝'}})
    mocks.submit.mockClear()
    await reopenFailedShipmentOrder(order.id, 'operator-1', 'org-A')
    expect(loadedOrder.status).toBe('awaiting_confirmation')
    expect(mocks.submit).not.toHaveBeenCalled()
    const recovery = (loadedOrder.shipping_config_snapshot as {dispatchRecovery:{requestKey:string;history:unknown[]}}).dispatchRecovery
    expect(recovery.requestKey).not.toBe(order.id);expect(recovery.history).toHaveLength(1)
    await confirmAndSubmitShipment(order.id, 'operator-2', 'org-A')
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({key:recovery.requestKey}))
    expect(loadedOrder.status).toBe('waybill_created')
  })
  it('recovers an authentication failure on the original workorder without an automatic second submission', async () => {
    loadedOrder = { ...order, status: 'awaiting_confirmation' }
    mocks.submit.mockRejectedValueOnce(new ShippingError(502, '认证超时，下单请求尚未发送', 'provider_not_sent'))
    await expect(confirmAndSubmitShipment(order.id, 'operator-1', 'org-A')).rejects.toMatchObject({ requestStage: 'provider_not_sent' })
    expect(loadedOrder.status).toBe('order_failed')
    expect(loadedOrder.shipping_config_snapshot).toMatchObject({ orderFailure: { stage: 'provider_not_sent', message: expect.stringContaining('尚未发送') } })
    mocks.submit.mockClear()
    await reopenFailedShipmentOrder(order.id, 'operator-1', 'org-A')
    expect(loadedOrder.status).toBe('awaiting_confirmation')
    expect(mocks.submit).not.toHaveBeenCalled()
    await confirmAndSubmitShipment(order.id, 'operator-1', 'org-A')
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(loadedOrder.status).toBe('waybill_created')
  })
  it.each(['provider_unreachable', 'provider_http_error', 'provider_invalid_response'] as const)('keeps a post-send %s failure locked for reconciliation', async stage => {
    loadedOrder = { ...order, status: 'awaiting_confirmation' }
    mocks.submit.mockRejectedValueOnce(new ShippingError(502, '业务响应未确认', stage))
    await expect(confirmAndSubmitShipment(order.id, 'operator-1', 'org-A')).rejects.toMatchObject({ requestStage: stage })
    expect(loadedOrder.status).toBe('order_unknown')
    expect(loadedOrder.shipping_config_snapshot).toMatchObject({ orderFailure: { stage } })
    await expect(reopenFailedShipmentOrder(order.id, 'operator-1', 'org-A')).rejects.toThrow('结果未知请先查回')
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })
  it.each(['order_unknown','ordering','waybill_created'])('cannot reopen %s', async status => {
    loadedOrder = {...order,status}
    await expect(reopenFailedShipmentOrder(order.id,'operator-1','org-A')).rejects.toThrow('只有已明确拒绝')
    expect(mocks.submit).not.toHaveBeenCalled();expect(queries.some(q=>q.action==='update')).toBe(false)
  })
  it('does not overwrite another operator transition', async () => {
    loadedOrder={...order,status:'order_failed'};claimLost=true
    await expect(reopenFailedShipmentOrder(order.id,'operator-1','org-A')).rejects.toThrow('状态已变化')
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
