import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShippingWorkbench from './workbench'
import { workbenchOrdersForTest } from '@/lib/shipping/workbench-test-fixtures'
import { parseAddress } from '@/lib/shipping/address'
import { ownerOrderSchema } from '@/lib/shipping/validation'
import type { ShippingSettings, ShipmentOrder } from '@/lib/shipping/types'
import type { ShippingWorkbenchRequest } from '@/lib/shipping/workbench-client'

const settings: ShippingSettings = { environment: 'sandbox', ready: true, canSubmit: true, reason: '', services: [{ id: 2, name: '顺丰标快' }], monthlyTail: '0000', sender: { name: '前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '科苑路15号' } }
const fetcher = vi.fn()
const fixtureOrders: ShipmentOrder[] = workbenchOrdersForTest.map((order, index) => ({ ...order, id: `order-${index + 1}` }))

function useLedger(records: ShipmentOrder[]) {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/api/shipping/ledger?limit=50' ? { records } : {}), { status: 200 }))
}

beforeEach(() => { fetcher.mockReset(); useLedger([]); vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('self-service shipping workbench', () => {
  it.each([['real', 'order_unknown'], ['real', 'ordering'], ['simulation', 'order_unknown'], ['simulation', 'ordering']] as const)('keeps %s %s batch orders locked until reconciliation returns a real waybill', async (mode, initialStatus) => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    let submitted = false, reconciles = 0
    const waybill = mode === 'real' ? 'SF1234567890123' : 'DEMO-000005'
    const order: ShipmentOrder = { ...fixtureOrders[0], id: 'pending-order', status: initialStatus, waybill: null }
    const dispatch = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === '/api/shipping/owner/orders') { submitted = true; return { orderId: order.id, status: initialStatus, waybill: null } }
      if (url.endsWith('/reconcile')) {
        reconciles += 1
        if (reconciles === 1) return { id: order.id, status: 'order_unknown', waybill: null }
        order.status = 'waybill_created'; order.waybill = waybill
        return { id: order.id, status: order.status, waybill }
      }
      if (url.startsWith('/api/shipping/ledger')) return { records: submitted ? [structuredClone(order)] : [] }
      throw new Error('Unexpected request '+url)
    }
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => new Response(JSON.stringify(await dispatch(url, init)), { status: 200 }))
    render(<ShippingWorkbench settings={settings} simulation={mode === 'simulation' ? { request: dispatch as ShippingWorkbenchRequest, sampleText: '', onReset: vi.fn() } : undefined}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: mode === 'real' ? '批量确认下单（1票）' : '模拟批量下单（1票）' }))
    expect(await screen.findByText(/成功 0 票；待确认 1 票/)).toBeTruthy()
    expect(screen.getByLabelText('第1行收件人')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '解析为寄件行' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '文件导入' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: mode === 'real' ? '批量确认下单（0票）' : '模拟批量下单（0票）' })).toHaveProperty('disabled', true)
    const originalKey = calls.find(call => call.url === '/api/shipping/owner/orders')?.body?.key
    fireEvent.click(screen.getByRole('button', { name: '查回第1行下单结果' }))
    expect(await screen.findByText(/查回结果仍待确认/)).toBeTruthy()
    expect(screen.getByLabelText('第1行收件地址')).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '查回第1行下单结果' }))
    expect(await screen.findByText(/已查回运单/)).toBeTruthy()
    expect(screen.getAllByText(waybill).length).toBeGreaterThan(0)
    expect(calls.filter(call => call.url === '/api/shipping/owner/orders')).toHaveLength(1)
    expect(calls.filter(call => call.url.endsWith('/reconcile')).map(call => call.url)).toEqual(['/api/shipping/ledger/pending-order/reconcile', '/api/shipping/ledger/pending-order/reconcile'])
    expect(calls.find(call => call.url === '/api/shipping/owner/orders')?.body?.key).toBe(originalKey)
    if (mode === 'simulation') expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([['real', 'order_unknown'], ['real', 'ordering'], ['simulation', 'order_unknown'], ['simulation', 'ordering']] as const)('does not announce a %s middle-column %s confirmation as successful', async (mode, status) => {
    let submitted = false
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null }
    const dispatch = async (url: string) => {
      if (url.endsWith('/confirm')) { submitted = true; return { id: order.id, status, waybill: null } }
      return { records: [{ ...order, status: submitted ? status : order.status }] }
    }
    fetcher.mockImplementation(async (url: string) => Response.json(await dispatch(url)))
    render(<ShippingWorkbench settings={settings} simulation={mode === 'simulation' ? { request: dispatch as ShippingWorkbenchRequest, sampleText: '', onReset: vi.fn() } : undefined}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('button', { name: mode === 'real' ? '确认下单' : '模拟确认下单' }))
    expect(await screen.findByText(/下单结果待确认，请查回原单/)).toBeTruthy()
    expect(screen.queryByText('已确认下单，单据状态已更新。')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认下单' })).toBeNull()
    expect(screen.getByRole('button', { name: '查回所选单据下单结果' })).toBeTruthy()
  })
  it.each([null, '', 'SF123', 'DEMO-000005'])('does not count waybill_created with invalid real waybill %s as successful', async waybill => {
    fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/owner/orders') ? { orderId: 'uncertain-order', status: 'waybill_created', waybill } : { records: [] }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/成功 0 票；待确认 1 票/)).toBeTruthy()
    expect(screen.getByLabelText('第1行联系电话')).toHaveProperty('disabled', true)
    expect(screen.queryByText('已下单')).toBeNull()
  })

  it('preserves the locked batch when reconciliation fails and never creates another order', async () => {
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/owner/orders')) return Response.json({ orderId: 'uncertain-order', status: 'order_unknown', waybill: null })
      if (url.endsWith('/reconcile')) return Response.json({ error: '查询暂时不可用' }, { status: 502 })
      return Response.json({ records: [] })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    await screen.findByText(/成功 0 票；待确认 1 票/)
    fireEvent.click(screen.getByRole('button', { name: '查回第1行下单结果' }))
    expect(await screen.findByText(/查回失败：查询暂时不可用/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '解析为寄件行' })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('第1行收件人')).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/shipping/owner/orders')).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith('/api/shipping/ledger/uncertain-order/reconcile', expect.objectContaining({ method: 'POST' }))
  })

  it.each(['network', 'server', 'conflict', 'invalid-response'] as const)('locks an uncertain %s failure without allowing a new batch key', async failure => {
    let ledgerLoads = 0
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/owner/orders')) {
        if (failure === 'network') throw new TypeError('network disconnected')
        if (failure === 'invalid-response') return new Response('not-json', { status: 400 })
        return Response.json({ error: '无法确认结果' }, { status: failure === 'conflict' ? 409 : 500 })
      }
      ledgerLoads += 1
      return Response.json({ records: [] })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/成功 0 票；待确认 1 票；失败 0 票/)).toBeTruthy()
    expect(screen.getByLabelText('第1行收件人')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '解析为寄件行' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '批量确认下单（0票）' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/请从台账查回原单/)).toBeTruthy()
    expect(ledgerLoads).toBe(2)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/shipping/owner/orders')).toHaveLength(1)
  })

  it('keeps an explicit validation rejection editable', async () => {
    fetcher.mockImplementation(async (url: string) => url.endsWith('/owner/orders')
      ? Response.json({ error: '收件地区不正确', requestStage: 'validation' }, { status: 400 })
      : Response.json({ records: [] }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/成功 0 票；待确认 0 票；失败 1 票/)).toBeTruthy()
    expect(screen.getByLabelText('第1行收件地址')).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: '解析为寄件行' })).toHaveProperty('disabled', false)
  })

  it('allocates a fresh request only when the user explicitly retries a provider-rejected row', async () => {
    const keys: string[] = []
    let ledgerLoads = 0
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/owner/orders')) {
        keys.push(JSON.parse(String(init?.body)).key)
        return keys.length === 1 ? Response.json({ error: '顺丰明确未受理', requestStage: 'provider_rejected' }, { status: 422 })
          : Response.json({ orderId: 'retry-order', status: 'waybill_created', waybill: 'SF1234567890123' })
      }
      ledgerLoads += 1
      return Response.json({ records: [] })
    })
    const generateKey = vi.spyOn(globalThis.crypto, 'randomUUID')
    try {
      render(<ShippingWorkbench settings={settings}/>)
      await screen.findByText('暂无收寄记录')
      fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
      fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
      expect(generateKey).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
      await screen.findByText(/待确认 0 票；失败 1 票/)
      expect(keys).toHaveLength(1)
      expect(generateKey).toHaveBeenCalledTimes(1)
      expect(ledgerLoads).toBe(2)
      fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
      await screen.findByText(/成功 1 票；待确认 0 票/)
      expect(keys).toHaveLength(2)
      expect(keys[1]).not.toBe(keys[0])
      expect(generateKey).toHaveBeenCalledTimes(2)
    } finally { generateKey.mockRestore() }
  })

  it('reuses the original request on an explicit retry after pre-submission validation rejection', async () => {
    const keys: string[] = []
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/owner/orders')) return Response.json({ records: [] })
      keys.push(JSON.parse(String(init?.body)).key)
      return keys.length === 1 ? Response.json({ error: '请修正收件地区', requestStage: 'validation' }, { status: 400 })
        : Response.json({ orderId: 'validated-order', status: 'waybill_created', waybill: 'SF1234567890123' })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    await screen.findByText(/待确认 0 票；失败 1 票/)
    expect(keys).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    await screen.findByText(/成功 1 票；待确认 0 票/)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('keeps a middle-column order addressable for reconciliation after a lost confirmation response', async () => {
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null }
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/confirm')) throw new TypeError('example connection lost')
      return Response.json({ records: [order] })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('button', { name: '确认下单' }))
    expect(await screen.findByText(/下单结果待确认，请查回原单/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '确认下单' })).toBeNull()
    expect(screen.getByRole('button', { name: '查回所选单据下单结果' })).toBeTruthy()
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))).toHaveLength(1)
  })

  it('renders the workbench without inventing orders or waybills', async () => {
    render(<ShippingWorkbench settings={settings}/>)
    expect(screen.getByRole('region', { name: '批量寄件操作台' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '收寄件台账与待办' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '单据详情与物流轨迹' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '销售寄件提报' }).getAttribute('href')).toBe('/sales-portal')
    expect(await screen.findByText('暂无收寄记录')).toBeTruthy()
    expect(screen.getByRole('form', { name: '物流轨迹查询' })).toBeTruthy()
    expect(screen.getByLabelText('备用查询运单号')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '导入示例数据' })).toBeNull()
    expect(screen.queryByText('SF1234567890123')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '寄件协同功能' })).toBeNull()
    expect(screen.getByLabelText('多行地址文本')).toBeTruthy()
    expect(screen.getByRole('button', { name: '文本解析' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('link', { name: '模拟体验' }).getAttribute('href')).toBe('/shipping/demo')
  })

  it('keeps incomplete regions out of the real order request', async () => {
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '演示张三 13800000001 广东省示例路88号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByText('地址需包含完整省市区，请补充后重新确认')).toBeTruthy()
    expect(screen.getByRole('button', { name: '批量确认下单（0票）' })).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.some((call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '文件导入' }))
    expect(screen.getByText('选择 Excel 或 CSV')).toBeTruthy()
  })

  it('shows a standalone tracking result when the ledger has no selected order', async () => {
    fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/api/shipping/tracking' ? { waybill: 'SF1234567890', queriedAt: '2026-09-24T00:00:00.000Z', events: [{ time: '2026-09-24 08:00:00', location: '深圳', description: '已揽收' }] } : { records: [] }), { status: 200 }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('备用查询运单号'), { target: { value: 'sf1234567890' } })
    fireEvent.click(screen.getByRole('button', { name: '查询轨迹' }))
    expect(await screen.findByText('顺丰运单 SF1234567890')).toBeTruthy()
    expect(await screen.findByText('已揽收')).toBeTruthy()
  })

  it('keeps configuration controls out of the business workbench', async () => {
    render(<ShippingWorkbench settings={{ ...settings, canManageConnections: true }}/>)
    expect(await screen.findByText('暂无收寄记录')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '寄件配置' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '寄件配置' })).toBeNull()
    expect(screen.getByRole('region', { name: '批量寄件操作台' })).toBeTruthy()
  })

  it('shows database-backed orders in the ledger and links their real details', async () => {
    useLedger(fixtureOrders)
    render(<ShippingWorkbench settings={settings}/>)
    expect((await screen.findAllByText('华东建筑设计院')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0)
    expect(screen.getAllByText('上海市').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('星河科技')[0])
    await waitFor(() => expect(screen.getAllByText(/样品易碎，请轻拿轻放/).length).toBeGreaterThan(0))
  })

  it('requires right-pane per-ticket review before the first unverified Production order', async () => {
    useLedger(fixtureOrders)
    const productionSettings: ShippingSettings = {
      ...settings,
      environment: 'production',
      connectionId: 'production-connection',
      defaultBillingAccountId: 'production-account',
      canSubmit: true,
      services: [{ id: 1, name: 'Production 标快', preference: 'standard' }],
      carrierConnections: [{ id: 'production-connection', carrier: 'sf', environment: 'production', status: 'connected', orderCapability: 'not_tested', services: [{ id: 1, name: 'Production 标快', preference: 'standard' }] }],
      billingAccounts: [{ id: 'production-account', connectionId: 'production-connection', environment: 'production', displayName: 'Production 月结', tail: '4321', isDefault: true, status: 'active' }]
    }
    render(<ShippingWorkbench settings={productionSettings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('button', { name: '文本解析' }))
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '李四 13800000000 上海市浦东新区张江路88号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByRole('button', { name: '批量确认下单（1票）' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getAllByRole('button', { name: '确认下单' })[0])

    expect(await screen.findByRole('group', { name: '首票Production订单复核' })).toBeTruthy()
    expect(screen.getAllByText(/张江路88号/).length).toBeGreaterThan(1)
    expect(screen.getAllByText(/Production 月结 · 尾号 4321/).length).toBeGreaterThan(1)
    expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '确认首票Production下单' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/shipping/ledger/order-1/confirm', expect.objectContaining({ method: 'POST' })))
  })

  it('filters explicit inbound records and exposes the manual tracking fallback', async () => {
    useLedger(fixtureOrders)
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('button', { name: '收到件' }))
    expect(screen.getAllByText('金蝶软件').length).toBeGreaterThan(0)
    expect(screen.getAllByText('华东建筑设计院')).toHaveLength(1)
    expect(screen.getByLabelText('备用查询运单号')).toBeTruthy()
    expect(screen.getByText('当前轨迹未提供快递员姓名、工号或电话')).toBeTruthy()
  })

  it('cancels an actual uncollected ledger order through the cancellation API', async () => {
    const uncollected = { ...fixtureOrders[1], id: 'real-order-1', status: 'waybill_created' as const }
    fetcher.mockImplementation(async (url: string) => {
      if (url === '/api/shipping/ledger?limit=50') return new Response(JSON.stringify({ records: [uncollected] }), { status: 200 })
      return new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 })
    })
    render(<ShippingWorkbench settings={settings}/>)
    expect((await screen.findAllByText('远景能源')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '取消运单' }))
    expect(await screen.findByText('顺丰运单已取消。')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith('/api/shipping/ledger/real-order-1/cancel', expect.objectContaining({ method: 'POST' }))
    expect(screen.queryByRole('button', { name: '取消运单' })).toBeNull()
  })

  it('updates the ledger from saved pickup status and removes cancellation without another ledger request', async () => {
    const order = { ...fixtureOrders[1], status: 'waybill_created' as const }
    fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/shipping/ledger') ? { records: [order] } : { waybill: order.waybill, queriedAt: '2026-09-27T00:00:00Z', shipmentStatus: 'in_transit', events: [{ time: '2026-09-27 08:00:00', location: '深圳市', description: '顺丰速运 已收取快件', status: 'in_transit' }] }), { status: 200 }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('远景能源')
    expect(screen.getByRole('button', { name: '取消运单' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText('顺丰速运 已收取快件')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '运输中' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消运单' })).toBeNull()
    expect(fetcher.mock.calls.filter(([url]) => String(url).startsWith('/api/shipping/ledger'))).toHaveLength(1)
  })

  it.each(['cancelled', 'delivered'] as const)('does not downgrade a %s order after a stale tracking response', async status => {
    const order = { ...fixtureOrders[1], status }
    fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/shipping/ledger') ? { records: [order] } : { waybill: order.waybill, queriedAt: '2026-09-27T00:00:00Z', shipmentStatus: 'waybill_created', events: [{ time: '2026-09-20 08:00:00', location: '深圳市', description: '旧的待揽收事件' }] }), { status: 200 }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('远景能源')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await screen.findByText('旧的待揽收事件')
    expect(screen.getByRole('heading', { name: status === 'cancelled' ? '已取消' : '已签收' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消运单' })).toBeNull()
  })

  it('labels sandbox mock tracking without treating its delivery claim as actual shipment progress', async () => {
    const order = { ...fixtureOrders[1], status: 'waybill_created' as const }
    fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/shipping/ledger') ? { records: [order] } : { waybill: order.waybill, queriedAt: '2026-09-27T00:00:00Z', source: 'sandbox_mock', shipmentStatus: 'delivered', events: [{ time: '2026-09-27 08:00:00', location: '模拟地点', description: '已签收' }] }), { status: 200 }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('远景能源')
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('note')).toHaveProperty('textContent', '顺丰沙盒返回的是模拟轨迹，不用于判断实际揽收、签收或取消状态。')
    expect(screen.getByRole('heading', { name: '等待揽收' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消运单' })).toBeTruthy()
  })

  it('reloads and selects a newly created order in the ledger after batch success', async () => {
    let ledgerLoads = 0
    const createdOrder: ShipmentOrder = { ...fixtureOrders[0], id: 'new-sandbox-order', status: 'waybill_created', waybill: 'SF12345678901234' }
    fetcher.mockImplementation(async (url: string) => {
      if (url === '/api/shipping/ledger?limit=50') {
        ledgerLoads += 1
        return new Response(JSON.stringify({ records: ledgerLoads === 1 ? [] : [createdOrder] }), { status: 200 })
      }
      return new Response(JSON.stringify({ orderId: createdOrder.id, status: 'waybill_created', waybill: createdOrder.waybill }), { status: 200 })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.click(screen.getByRole('button', { name: '文本解析' }))
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '沙盒测试收件人 13800000000 广东省深圳市南山区科技园测试路88号A座' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/成功 1 票/)).toBeTruthy()
    expect(screen.getAllByText('SF12345678901234').length).toBeGreaterThanOrEqual(2)
    expect(ledgerLoads).toBe(2)
  })

  it('does not resend successful rows when a real batch request partially fails', async () => {
    const sent: Array<{ key: string }> = []
    const sentBodies: unknown[] = []
    let failedOnce = false
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.body) return new Response(JSON.stringify({ records: [] }), { status: 200 })
      const body = JSON.parse(String(init.body)); sent.push(body); sentBodies.push(body)
      if (!failedOnce && sent.length === 2) { failedOnce = true; return new Response(JSON.stringify({ error: '请修正收件地区', requestStage: 'validation' }), { status: 400 }) }
      return new Response(JSON.stringify({ orderId: `created-${sent.length}`, status: 'waybill_created', waybill: `SF${String(sent.length).padStart(12, '0')}` }), { status: 200 })
    })
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.click(screen.getByRole('button', { name: '文本解析' }))
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: [
      '客户甲 13800138011 广东省深圳市南山区科苑路1号',
      '客户乙 13900139012 上海市浦东新区张江路2号',
      '客户丙 13600136013 北京市朝阳区望京路3号',
      '客户丁 13500135014 浙江省杭州市余杭区文一西路4号',
    ].join('\n') } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（4票）' }))
    expect(await screen.findByText(/成功 3 票/)).toBeTruthy()
    const failedKey = sent[1].key
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/成功 1 票/)).toBeTruthy()
    expect(sent).toHaveLength(5)
    expect(sent[4].key).toBe(failedKey)
    expect(sentBodies.every(body => ownerOrderSchema.safeParse(body).success)).toBe(true)
  })

  it('builds a valid order payload from the synthetic SF sandbox address example', () => {
    const recipientAddress = parseAddress('广东省深圳市南山区科技园测试路88号A座').contact
    const recipient = { ...recipientAddress, name: '沙盒测试收件人', phone: '13800000000' }
    const parsed = ownerOrderSchema.safeParse({
      key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0',
      confirmed: true,
      connectionId: '23a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0',
      billingAccountId: '33a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0',
      input: { sender: settings.sender, recipient, cargo: '文件/合同', weight: 1, serviceId: 2, remark: '', source: 'manual', payment: 'sender_monthly', pickupWindow: '今天 17:00 统一揽收' }
    })
    if (!parsed.success) throw new Error(`${JSON.stringify(recipient)} :: ${parsed.error.issues.map(issue => `${issue.path.join('.')}:${issue.message}`).join(' | ')}`)
    expect(parsed.success).toBe(true)
  })
})
