import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShippingWorkbench from './workbench'
import { workbenchOrdersForTest } from '@/lib/shipping/workbench-test-fixtures'
import type { ShippingSettings, ShipmentOrder } from '@/lib/shipping/types'

const settings: ShippingSettings = { environment: 'sandbox', ready: true, canSubmit: true, reason: '', services: [{ id: 2, name: '顺丰标快' }], monthlyTail: '0000', sender: { name: '前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '科苑路15号' } }
const fetcher = vi.fn()
const fixtureOrders: ShipmentOrder[] = workbenchOrdersForTest.map((order, index) => ({ ...order, id: `order-${index + 1}` }))

function useLedger(records: ShipmentOrder[]) {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/api/shipping/ledger?limit=50' ? { records } : {}), { status: 200 }))
}

beforeEach(() => { fetcher.mockReset(); useLedger([]); vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('self-service shipping workbench', () => {
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

  it('opens the in-page configuration drawer only for connection managers', async () => {
    fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/api/shipping/settings' ? { configuration: { connections: [], billingAccounts: [], sender: null } } : { records: [] }), { status: 200 }))
    render(<ShippingWorkbench settings={{ ...settings, canManageConnections: true }}/>)
    fireEvent.click(screen.getByRole('button', { name: '寄件配置' }))
    expect(await screen.findByRole('dialog', { name: '寄件配置' })).toBeTruthy()
  })

  it('renders a configuration-only view for managers without daily shipping permission', () => {
    render(<ShippingWorkbench settings={{ ...settings, canManageConnections: true, canOperate: false }}/>)
    expect(screen.getByText('你有寄件连接管理权限')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '收寄件台账与待办' })).toBeNull()
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

  it('does not resend successful rows when a real batch request partially fails', async () => {
    const sent: Array<{ key: string }> = []
    let failedOnce = false
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.body) return new Response(JSON.stringify({ records: [] }), { status: 200 })
      const body = JSON.parse(String(init.body)); sent.push(body)
      if (!failedOnce && sent.length === 2) { failedOnce = true; return new Response(JSON.stringify({ error: '临时失败' }), { status: 503 }) }
      return new Response(JSON.stringify({ waybill: `SF${sent.length}` }), { status: 200 })
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
    expect(await screen.findByText(/本次完成 3 票/)).toBeTruthy()
    const failedKey = sent[1].key
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/本次完成 1 票/)).toBeTruthy()
    expect(sent).toHaveLength(5)
    expect(sent[4].key).toBe(failedKey)
  })
})
