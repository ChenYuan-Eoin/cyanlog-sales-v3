import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ShippingWorkbench from './workbench'
import { workbenchOrdersForTest } from '@/lib/shipping/workbench-test-fixtures'
import type { ShipmentOrder, ShippingSettings } from '@/lib/shipping/types'

const services = [
  { id: 2, name: '顺丰标快', preference: 'standard' as const },
  { id: 1, name: '顺丰特快', preference: 'urgent' as const },
]
const settings: ShippingSettings = {
  environment: 'sandbox', ready: true, canSubmit: true, reason: '', services, monthlyTail: '0000',
  sender: { name: '测试寄方', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路15号' },
}
const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
const confirmPath = (order: ShipmentOrder) => `/api/shipping/ledger/${order.id}/confirm`

function pendingOrders(): ShipmentOrder[] {
  return workbenchOrdersForTest.slice(0, 2).map((order, index) => ({
    ...order, id: `service-ticket-${index + 1}`, orderNo: `TEST-SERVICE-${index + 1}`,
    status: 'awaiting_confirmation', waybill: null,
    input: { ...order.input, sender: settings.sender, serviceId: 2, serviceName: '顺丰标快' },
  }))
}

type SetupBehavior = {
  ledgerUnavailableAfterConfirmation?: boolean
  confirmationStates?: ShipmentOrder['status'][]
  afterConfirmation?: (orders: ShipmentOrder[]) => ShipmentOrder[]
  afterReconciliation?: (orders: ShipmentOrder[]) => ShipmentOrder[]
}
function setup(orders = pendingOrders(), configuration = settings, behavior: SetupBehavior = {}) {
  let ledger = orders
  const outcomes = [...(behavior.confirmationStates || [])]
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  fetcher.mockImplementation(async (url, init) => {
    if (url === '/api/shipping/ledger?limit=50&page=0') {
      if (sent.length && behavior.ledgerUnavailableAfterConfirmation) throw new TypeError('fixture ledger unavailable')
      return Response.json({ records: ledger })
    }
    if (url === '/api/shipping/settings?workspace=1') return Response.json({ settings: configuration })
    if (url.endsWith('/confirm')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      sent.push({ url, body })
      const order = ledger.find(row => confirmPath(row) === url)
      if (!order) return Response.json({ error: 'unknown fixture order' }, { status: 404 })
      const serviceId = typeof body.serviceId === 'number' ? body.serviceId : order.input.serviceId
      const status = outcomes.shift() || 'waybill_created'
      const waybill = status === 'waybill_created' ? `SF${String(sent.length).padStart(12, '0')}` : null
      ledger = ledger.map(row => row.id === order.id ? {
        ...row, status, waybill,
        ...(status === 'order_failed' ? { failure: { message: '测试承运商明确拒绝', at: '2026-11-03T00:00:00Z' } } : {}),
        input: { ...row.input, serviceId, serviceName: services.find(service => service.id === serviceId)?.name },
      } : row)
      if (behavior.afterConfirmation) ledger = behavior.afterConfirmation(ledger)
      return Response.json({ id: order.id, status, waybill })
    }
    if (url.endsWith('/reopen')) {
      const order = ledger.find(row => url === `/api/shipping/ledger/${row.id}/reopen`)!
      ledger = ledger.map(row => row.id === order.id ? { ...row, status: 'awaiting_confirmation' } : row)
      return Response.json({ id: order.id, status: 'awaiting_confirmation' })
    }
    if (url.endsWith('/reconcile')) {
      const order = ledger.find(row => url === `/api/shipping/ledger/${row.id}/reconcile`)!
      const waybill = 'SF1234567890123'
      ledger = ledger.map(row => row.id === order.id ? { ...row, status: 'waybill_created', waybill } : row)
      if (behavior.afterReconciliation) ledger = behavior.afterReconciliation(ledger)
      return Response.json({ id: order.id, status: 'waybill_created', waybill })
    }
    return Response.json({})
  })
  render(<ShippingWorkbench settings={configuration}/>)
  return { orders, sent }
}

async function selectOrders(orders: ShipmentOrder[]) {
  for (const order of orders) fireEvent.click(await screen.findByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
}
function expand(order: ShipmentOrder) {
  fireEvent.click(screen.getByRole('button', { name: `展开工单 ${order.orderNo}` }))
  return within(screen.getByRole('region', { name: `工单 ${order.orderNo} 收寄预览` }))
}
function collapse(order: ShipmentOrder) {
  fireEvent.click(screen.getByRole('button', { name: `收起工单 ${order.orderNo}` }))
}
function choose(order: ShipmentOrder, label: string) {
  const choices = within(screen.getByRole('radiogroup', { name: `工单 ${order.orderNo} 快递服务` }))
  fireEvent.click(choices.getByRole('radio', { name: new RegExp(label) }))
}

function serviceSummary(order: ShipmentOrder) {
  const region = within(screen.getByRole('region', { name: '逐票下单产品核对' }))
  const row = region.getByText(`${order.input.customerName} · ${order.input.recipient.name}`).closest('li')
  expect(row).not.toBeNull()
  return row!.textContent || ''
}
function batchParameters() {
  const region = within(screen.getByRole('region', { name: '正式下单参数' }))
  const toggle = region.queryByRole('button', { name: '调整参数' })
  if (toggle) fireEvent.click(toggle)
  return region
}
function confirm(count: number) {
  fireEvent.click(screen.getByRole('button', { name: `批量确认并下单（${count}票）` }))
}
function connectedSettings(): ShippingSettings {
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  return {
    ...settings, connectionId: first, defaultBillingAccountId: '33333333-3333-4333-8333-333333333333',
    carrierConnections: [first, second].map(id => ({ id, carrier: 'sf', environment: 'sandbox', status: 'connected', orderCapability: 'verified', services })),
    billingAccounts: [first, second].map((connectionId, index) => ({ id: index ? '44444444-4444-4444-8444-444444444444' : '33333333-3333-4333-8333-333333333333', connectionId, displayName: `测试月结${index + 1}`, tail: '0000', environment: 'sandbox', isDefault: true, status: 'active' })),
  }
}

beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('per-order shipping service selection', () => {
  it('RED-UI: changing A to express preserves B standard selection and truthful per-order summaries', async () => {
    const { orders, sent } = setup()
    await selectOrders(orders)
    const previewA = expand(orders[0])
    choose(orders[0], '顺丰特快')
    expect(previewA.getByText('顺丰特快', { selector: 'strong' })).toBeTruthy()
    collapse(orders[0])
    const previewB = expand(orders[1])
    const standard = within(previewB.getByRole('radiogroup', { name: `工单 ${orders[1].orderNo} 快递服务` })).getByRole('radio', { name: /顺丰标快/ })
    expect(standard.getAttribute('aria-checked')).toBe('true')
    expect(previewB.getByText('顺丰标快', { selector: 'strong' })).toBeTruthy()
    collapse(orders[1])
    expect(serviceSummary(orders[0])).toContain('顺丰特快')
    expect(serviceSummary(orders[1])).toContain('顺丰标快')
    expect(sent).toEqual([])
  })

  it('RED-PAYLOAD: confirming A express and untouched B freezes serviceId 1 and 2 in their own requests', async () => {
    const { orders, sent } = setup()
    await selectOrders(orders)
    expand(orders[0])
    choose(orders[0], '顺丰特快')
    collapse(orders[0])
    fireEvent.click(screen.getByRole('button', { name: '批量确认并下单（2票）' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => ({ url: item.url, serviceId: item.body.serviceId }))).toEqual([
      { url: confirmPath(orders[0]), serviceId: 1 },
      { url: confirmPath(orders[1]), serviceId: 2 },
    ])
    expect(sent.every(item => !('sender' in item.body) && !('input' in item.body))).toBe(true)
  })
  it('keeps different original products when neither ticket has an override', async () => {
    const original = pendingOrders()
    original[0] = { ...original[0], input: { ...original[0].input, serviceId: 1, serviceName: '顺丰特快' } }
    const { orders, sent } = setup(original)
    await selectOrders(orders)
    expect(serviceSummary(orders[0])).toContain('顺丰特快')
    expect(serviceSummary(orders[1])).toContain('顺丰标快')
    confirm(2)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => item.body.serviceId)).toEqual([1, 2])
  })

  it('changing a batch dropdown is only a pending choice until explicitly applied', async () => {
    const { orders, sent } = setup()
    await selectOrders(orders)
    batchParameters()
    fireEvent.change(screen.getByLabelText('寄件服务'), { target: { value: '1' } })
    expect(serviceSummary(orders[0])).toContain('顺丰标快')
    expect(serviceSummary(orders[1])).toContain('顺丰标快')
    confirm(2)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => item.body.serviceId)).toEqual([2, 2])
  })

  it('explicit batch application changes only the tickets selected at that moment', async () => {
    const { orders, sent } = setup()
    await selectOrders([orders[0]])
    const batch = batchParameters()
    fireEvent.change(screen.getByLabelText('寄件服务'), { target: { value: '1' } })
    fireEvent.click(batch.getByRole('button', { name: '应用到已选工单' }))
    expect(serviceSummary(orders[0])).toContain('顺丰特快')
    await selectOrders([orders[1]])
    expect(serviceSummary(orders[1])).toContain('顺丰标快')
    confirm(2)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => item.body.serviceId)).toEqual([1, 2])
  })

  it('explicit empty batch application restores each ticket own original product', async () => {
    const original = pendingOrders()
    original[1] = { ...original[1], input: { ...original[1].input, serviceId: 1, serviceName: '顺丰特快' } }
    const { orders, sent } = setup(original)
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    expand(orders[1]); choose(orders[1], '顺丰标快'); collapse(orders[1])
    const batch = batchParameters()
    fireEvent.change(screen.getByLabelText('寄件服务'), { target: { value: '' } })
    fireEvent.click(batch.getByRole('button', { name: '应用到已选工单' }))
    expect(serviceSummary(orders[0])).toContain('顺丰标快')
    expect(serviceSummary(orders[1])).toContain('顺丰特快')
    confirm(2)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => item.body.serviceId)).toEqual([2, 1])
  })

  it('blocks sending an unavailable product instead of silently substituting a service', async () => {
    const original = pendingOrders()
    original[0] = { ...original[0], input: { ...original[0].input, serviceId: 999, serviceName: '已停用产品' } }
    const { orders, sent } = setup(original)
    await selectOrders(orders)
    expect(screen.getByRole('button', { name: '批量确认并下单（2票）' })).toHaveProperty('disabled', true)
    confirm(2)
    expect(sent).toEqual([])
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    confirm(2)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => item.body.serviceId)).toEqual([1, 2])
  })

  it.each(['configuration refresh', 'connection switch'] as const)('clears overrides and requires review after %s', async mode => {
    const configuration = connectedSettings()
    const { orders, sent } = setup(pendingOrders(), configuration)
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    if (mode === 'configuration refresh') {
      fireEvent.click(screen.getByRole('button', { name: '刷新寄件配置' }))
      await screen.findByText(/寄件配置已刷新/)
    } else {
      batchParameters()
      fireEvent.change(screen.getByLabelText('承运商连接'), { target: { value: configuration.carrierConnections![1].id } })
    }
    expect(screen.getByRole('button', { name: '批量确认并下单（0票）' })).toHaveProperty('disabled', true)
    expect(sent).toEqual([])
    await selectOrders(orders)
    expect(serviceSummary(orders[0])).toContain('顺丰标快')
    confirm(2)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => item.body.serviceId)).toEqual([2, 2])
  })

  it('reopens a definite failure without dispatch, then retries only that ticket with its saved service', async () => {
    const { orders, sent } = setup(pendingOrders().slice(0, 1), settings, { confirmationStates: ['order_failed', 'waybill_created'] })
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    confirm(1)
    await screen.findByText(/失败 1 票/)
    fireEvent.click(screen.getByRole('button', { name: '重新核对原工单' }))
    await screen.findByText(/原工单已回到待核对/)
    expect(sent).toHaveLength(1)
    expect(serviceSummary(orders[0])).toContain('顺丰特快')
    confirm(1)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => ({ url: item.url, serviceId: item.body.serviceId }))).toEqual([
      { url: confirmPath(orders[0]), serviceId: 1 }, { url: confirmPath(orders[0]), serviceId: 1 },
    ])
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/reopen'))).toHaveLength(1)
  })

  it('keeps an unknown outcome locked and reconciles without issuing another confirmation', async () => {
    const { orders, sent } = setup(pendingOrders().slice(0, 1), settings, { confirmationStates: ['order_unknown'] })
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    confirm(1)
    await screen.findByText(/下单结果待确认，请查回原单/)
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查回所选单据下单结果' }))
    await screen.findByText(/已查回运单/)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.serviceId).toBe(1)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/reconcile')).map(([url]) => url)).toEqual([`/api/shipping/ledger/${orders[0].id}/reconcile`])
  })

  it('invalidates an unsent override when the ledger returns a newer revision of that ticket', async () => {
    const { orders, sent } = setup(pendingOrders(), settings, {
      afterConfirmation: rows => rows.map((row, index) => index === 0 ? { ...row, revision: 2, input: { ...row.input, serviceId: 2, serviceName: '顺丰标快' } } : row),
    })
    await selectOrders([orders[0]])
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${orders[0].orderNo}` }))
    await selectOrders([orders[1]])
    confirm(1)
    await screen.findByText(/成功 1 票/)
    await selectOrders([orders[0]])
    expect(serviceSummary(orders[0])).toContain('顺丰标快')
    confirm(1)
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(item => ({ url: item.url, serviceId: item.body.serviceId }))).toEqual([
      { url: confirmPath(orders[1]), serviceId: 2 }, { url: confirmPath(orders[0]), serviceId: 2 },
    ])
  })

  it('RED-AUTHORITATIVE: successful readback product wins over the service requested by a stale confirmation', async () => {
    const { orders, sent } = setup(pendingOrders().slice(0, 1), settings, {
      afterConfirmation: rows => rows.map(row => ({ ...row, input: { ...row.input, serviceId: 2, serviceName: '顺丰标快' } })),
    })
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    confirm(1)
    await screen.findByText(/正式下单：成功 1 票/)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.serviceId).toBe(1)
    const detail = screen.getByRole('region', { name: '单据详情与物流轨迹' })
    expect(detail.textContent).toContain('顺丰标快')
    expect(detail.textContent).not.toContain('顺丰特快')
    expect(detail.textContent).not.toContain('产品待回读')
  })

  it.each(['unavailable', 'stale_pending'] as const)('RED-READBACK: successful confirmation with %s ledger labels the requested product as pending', async mode => {
    const { orders, sent } = setup(pendingOrders().slice(0, 1), settings, {
      ledgerUnavailableAfterConfirmation: mode === 'unavailable',
      ...(mode === 'stale_pending' ? { afterConfirmation: (rows: ShipmentOrder[]) => rows.map(row => ({ ...row, status: 'awaiting_confirmation' as const, waybill: null, input: { ...row.input, serviceId: 2, serviceName: '顺丰标快' } })) } : {}),
    })
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    confirm(1)
    if (mode === 'unavailable') await screen.findByText(/台账刷新失败/)
    else await screen.findByText(/正式下单：成功 1 票/)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.serviceId).toBe(1)
    const detail = screen.getByRole('region', { name: '单据详情与物流轨迹' })
    expect(detail.textContent).toContain('产品待回读（本次请求：顺丰特快）')
  })

  it('RED-RECONCILE: unknown confirmation reads the actual standard product after reconciliation without reconfirming', async () => {
    const { orders, sent } = setup(pendingOrders().slice(0, 1), settings, {
      confirmationStates: ['order_unknown'],
      afterReconciliation: rows => rows.map(row => ({ ...row, input: { ...row.input, serviceId: 2, serviceName: '顺丰标快' } })),
    })
    await selectOrders(orders)
    expand(orders[0]); choose(orders[0], '顺丰特快'); collapse(orders[0])
    confirm(1)
    await screen.findByText(/下单结果待确认，请查回原单/)
    fireEvent.click(screen.getByRole('button', { name: '查回所选单据下单结果' }))
    await screen.findByText(/已查回运单/)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.serviceId).toBe(1)
    const detail = screen.getByRole('region', { name: '单据详情与物流轨迹' })
    expect(detail.textContent).toContain('顺丰标快')
    expect(detail.textContent).not.toContain('顺丰特快')
    expect(detail.textContent).not.toContain('产品待回读')
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/reconcile'))).toHaveLength(1)
  })

})
