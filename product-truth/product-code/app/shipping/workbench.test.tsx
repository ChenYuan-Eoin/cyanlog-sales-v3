import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShippingWorkbench from './workbench'
import type { ShippingSettings } from '@/lib/shipping/types'

const settings: ShippingSettings = { environment: 'sandbox', ready: true, canSubmit: true, reason: '', services: [{ id: 2, name: '顺丰标快' }], monthlyTail: '0000', sender: { name: '前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '科苑路15号' } }
const fetcher = vi.fn()
beforeEach(() => { fetcher.mockReset(); fetcher.mockImplementation(async () => new Response(JSON.stringify({ records: [] }), { status: 200 })); vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('self-service shipping workbench', () => {
  it('renders one screen with three operational columns and no tabs', () => {
    render(<ShippingWorkbench settings={settings}/>)
    expect(screen.getByRole('region', { name: '批量寄件操作台' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '收寄件台账与待办' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '单据详情与物流轨迹' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '寄件协同功能' })).toBeNull()
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
  it('loads five example rows and fixes the invalid phone inline', () => {
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.click(screen.getByRole('button', { name: '导入示例数据' }))
    expect(screen.getByText('4 票待下单')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('第3行联系电话'), { target: { value: '13600136013' } })
    expect(screen.getByText('5 票待下单')).toBeTruthy()
  })
  it('shows only customer recipient and city as the card core and links details', async () => {
    render(<ShippingWorkbench settings={settings}/>)
    expect(screen.getAllByText('华东建筑设计院').length).toBeGreaterThan(0)
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0)
    expect(screen.getAllByText('上海市').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('星河科技')[0])
    await waitFor(() => expect(screen.getAllByText(/样品易碎，请轻拿轻放/).length).toBeGreaterThan(0))
  })
  it('filters explicit inbound records and exposes the manual tracking fallback', () => {
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.click(screen.getByRole('button', { name: '收到件' }))
    expect(screen.getAllByText('金蝶软件').length).toBeGreaterThan(0)
    expect(screen.getAllByText('华东建筑设计院')).toHaveLength(1)
    expect(screen.getByLabelText('备用查询运单号')).toBeTruthy()
    expect(screen.getByText('当前轨迹未提供快递员姓名、工号或电话')).toBeTruthy()
  })
  it('only offers cancellation for a generated but uncollected waybill', async () => {
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.click(screen.getAllByText('远景能源')[0])
    fireEvent.click(screen.getByRole('button', { name: '取消运单' }))
    expect(await screen.findByText('已模拟取消未揽收运单。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消运单' })).toBeNull()
  })
  it('does not resend successful rows when a partial batch is retried', async () => {
    const sent: Array<{ key: string }> = []; let failedOnce = false
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.body) return new Response(JSON.stringify({ records: [] }), { status: 200 })
      const body = JSON.parse(String(init.body)); sent.push(body)
      if (!failedOnce && sent.length === 2) { failedOnce = true; return new Response(JSON.stringify({ error: '临时失败' }), { status: 503 }) }
      return new Response(JSON.stringify({ waybill: `SF${sent.length}` }), { status: 200 })
    })
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.click(screen.getByRole('button', { name: '导入示例数据' }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（4票）' }))
    expect(await screen.findByText(/本次完成 3 票/)).toBeTruthy()
    const failedKey = sent[1].key
    fireEvent.click(screen.getByRole('button', { name: '批量确认下单（1票）' }))
    expect(await screen.findByText(/本次完成 1 票/)).toBeTruthy()
    expect(sent).toHaveLength(5)
    expect(sent[4].key).toBe(failedKey)
  })
})
