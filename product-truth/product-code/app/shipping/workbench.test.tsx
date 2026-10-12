import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ShippingWorkbench from './workbench'
import { workbenchOrdersForTest } from '@/lib/shipping/workbench-test-fixtures'
import { parseAddress } from '@/lib/shipping/address'
import { ownerOrderSchema } from '@/lib/shipping/validation'
import type { ShippingSettings, ShipmentOrder } from '@/lib/shipping/types'
import type { ShippingWorkbenchRequest } from '@/lib/shipping/workbench-client'

const settings: ShippingSettings = { intakeRules: { companyName: { enabled: false, required: false, minLength: 0 }, team: { enabled: false, required: false, minLength: 0 }, teamOptions: [] }, environment: 'sandbox', ready: true, canSubmit: true, reason: '', services: [{ id: 2, name: '顺丰标快' }], monthlyTail: '0000', sender: { name: '前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '科苑路15号' } }
const fetcher = vi.fn()
const fixtureOrders: ShipmentOrder[] = workbenchOrdersForTest.map((order, index) => ({ ...order, id: `order-${index + 1}` }))

function useLedger(records: ShipmentOrder[]) {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/api/shipping/ledger?limit=50' ? { records } : {}), { status: 200 }))
}

beforeEach(() => { fetcher.mockReset(); useLedger([]); vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('self-service shipping workbench', () => {
  it('keeps an external failed query separate from the unrelated selected work order', async () => {
    const order = { ...fixtureOrders[0], status: 'returned' as const, waybill: null }
    fetcher.mockImplementation(async (url: string) => url.endsWith('/tracking') ? Response.json({ error: '请校验运单归属' }, { status: 403 }) : Response.json({ records: [order] }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText(order.orderNo)
    fireEvent.change(screen.getByLabelText('备用查询运单号'), { target: { value: 'SF0213179537901' } })
    fireEvent.click(screen.getByRole('button', { name: '查询轨迹' }))
    await screen.findByRole('alert')
    const detail = within(screen.getByRole('region', { name: '单据详情与物流轨迹' }))
    expect(detail.getByText('顺丰运单 SF0213179537901')).toBeTruthy()
    expect(detail.queryByText(order.orderNo)).toBeNull()
    expect(detail.queryByText('尚未出单')).toBeNull()
    expect(detail.getByRole('alert').textContent).toContain('请校验运单归属')
  })

  it('requires visible configured company and team fields and a complete parsed sender before intake', async () => {
    render(<ShippingWorkbench settings={{ ...settings, sender: { name: '', phone: '', province: '', city: '', county: '', address: '' }, intakeRules: { companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: true, minLength: 1 }, teamOptions: ['销售部'] } }}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '张三 13800000011 广东省深圳市南山区示例路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByRole('button', { name: '提交工单（0票）' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('第1行公司名称'), { target: { value: '示例公司' } })
    fireEvent.change(screen.getByLabelText('第1行所属团队'), { target: { value: '销售部' } })
    expect(screen.getByRole('button', { name: '提交工单（1票）' })).toHaveProperty('disabled', true)
    expect(screen.getByText('收件资料完整 · 待补寄方')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去补齐寄方' }))
    expect(document.activeElement).toBe(screen.getByLabelText('本批寄方信息文本'))
    fireEvent.change(screen.getByLabelText('本批寄方信息文本'), { target: { value: '李四 13900000011 广东省深圳市南山区科技园路8号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析本批寄方' }))
    expect(screen.getByLabelText('本批寄件人')).toHaveProperty('value', '李四')
    expect(screen.getByRole('button', { name: '提交工单（1票）' })).toHaveProperty('disabled', false)
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/owner/orders'))).toBe(false)
  })

  it.each(['sender_cash', 'recipient'])('confirms %s without a monthly account after explicit review', async payment => {
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null, input: { ...fixtureOrders[0].input, sender: settings.sender } }
    const connectionId = '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0'
    fetcher.mockImplementation(async (url: string) => url.endsWith('/confirm')
      ? Response.json({ id: order.id, status: 'waybill_created', waybill: 'SF1234567890123' })
      : Response.json({ records: [order] }))
    render(<ShippingWorkbench settings={{ ...settings, canSubmit: false, connectionId, carrierConnections: [{ id: connectionId, carrier: 'sf', environment: 'sandbox', status: 'connected', orderCapability: 'verified', services: [{ id: 2, name: '测试服务', preference: 'standard' }] }], billingAccounts: [] }}/>)
    const review = await screen.findByLabelText(`核对并选择工单 ${order.orderNo}`)
    fireEvent.click(review)
    expect(screen.getByRole('button', { name: '批量确认并下单（1票）' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('本批付款方式'), { target: { value: payment } })
    expect(review).toHaveProperty('checked', false)
    expect(screen.queryByLabelText('月结账号')).toBeNull()
    fireEvent.click(review)
    const confirm = screen.getByRole('button', { name: '批量确认并下单（1票）' })
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(true))
    const [, init] = fetcher.mock.calls.find(([url]) => String(url).endsWith('/confirm'))!
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ payment, connectionId })
    expect(body).not.toHaveProperty('serviceId')
    expect(body).not.toHaveProperty('billingAccountId')
  })
  it('keeps intake usable during configuration outages while disabling formal confirmation', async () => {
    const warning = '寄件配置暂时无法读取，正式下单暂不可用。'
    fetcher.mockImplementation(async (url: string) => url.endsWith('/owner/orders')
      ? Response.json({ orderId: 'intake-only', orderNo: 'SO-INTAKE-ONLY', status: 'awaiting_confirmation', waybill: null })
      : Response.json({ records: [] }))
    render(<ShippingWorkbench settings={{ ...settings, ready: false, canSubmit: false, services: [], carrierConnections: [], billingAccounts: [], configurationWarning: warning }}/>)
    await screen.findByText('暂无收寄记录')
    expect(screen.getByText(warning)).toBeTruthy()
    expect(screen.getByText('配置暂不可用')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '收件人：示例甲\n电话：13800000011\n地址：广东省深圳市南山区示例路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByRole('button', { name: '提交工单（1票）' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: '批量确认并下单（0票）' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    await screen.findByText(/已提报 1 票/)
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  })
  it('places missing phone and address errors on their own fields and clears each immediately after correction', async () => {
    const originalText = '收件人：示例甲\n电话：\n地址：'
    const generateKey = vi.spyOn(globalThis.crypto, 'randomUUID')
    let submitted: Record<string, unknown> | undefined
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/owner/orders')) {
        submitted = JSON.parse(String(init?.body))
        return Response.json({ orderId: 'corrected-order', orderNo: 'SO-CORRECTED', status: 'awaiting_confirmation', waybill: null })
      }
      return Response.json({ records: [] })
    })
    try {
      render(<ShippingWorkbench settings={settings}/>)
      await screen.findByText('暂无收寄记录')
      fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: originalText } })
      fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
      const phone = screen.getByLabelText('第1行联系电话')
      const address = screen.getByLabelText('第1行收件地址')
      expect(phone.getAttribute('aria-invalid')).toBe('true')
      expect(address.getAttribute('aria-invalid')).toBe('true')
      expect(document.getElementById(phone.getAttribute('aria-describedby') || '')?.textContent).toMatch(/电话|手机/)
      expect(document.getElementById(address.getAttribute('aria-describedby') || '')?.textContent).toMatch(/地址/)
      expect(screen.getByRole('button', { name: '提交工单（0票）' })).toHaveProperty('disabled', true)
      expect(screen.getByText('1 票需修正；仅 0 票有效资料可提交。')).toBeTruthy()
      fireEvent.click(screen.getByText('查看原文'))
      expect(screen.getByLabelText('第1票原文').textContent).toBe(originalText)
      const originalKey = generateKey.mock.results[0].value
      fireEvent.change(phone, { target: { value: '13800000011' } })
      expect(phone.getAttribute('aria-invalid')).toBe('false')
      expect(phone.hasAttribute('aria-describedby')).toBe(false)
      expect(address.getAttribute('aria-invalid')).toBe('true')
      fireEvent.change(address, { target: { value: '广东省深圳市南山区示例路1号' } })
      expect(address.getAttribute('aria-invalid')).toBe('false')
      expect(screen.queryByText('1 票需修正；仅 0 票有效资料可提交。')).toBeNull()
      expect(generateKey).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
      await screen.findByText(/已提报 1 票/)
      expect(submitted?.key).toBe(originalKey)
      expect(submitted).not.toHaveProperty('originalText')
      expect(submitted?.input).not.toHaveProperty('originalText')
      expect(JSON.stringify(submitted)).not.toContain(JSON.stringify(originalText))
    } finally { generateKey.mockRestore() }
  })

  it('explains that only valid tickets are submitted while retaining incomplete recipients for correction', async () => {
    const sentNames: string[] = []
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/owner/orders')) {
        sentNames.push(JSON.parse(String(init?.body)).input.recipient.name)
        return Response.json({ orderId: 'valid-order', orderNo: 'SO-VALID', status: 'awaiting_confirmation', waybill: null })
      }
      return Response.json({ records: [] })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    expect(screen.getByText('支持多位收件人；同一人的姓名、电话和地址可分行，空行有助于分票。解析后请核对每票资料。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '姓名：示例甲\n电话：\n地址：广东省深圳市南山区示例路1号\n\n示例乙 13800000022 上海市浦东新区示例路2号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByText('1 票需修正；仅 1 票有效资料可提交。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    await screen.findByText(/已提报 1 票/)
    expect(sentNames).toEqual(['示例乙'])
    expect(screen.getByLabelText('第1行联系电话')).toHaveProperty('disabled', false)
    expect(screen.getByLabelText('第1行联系电话').getAttribute('aria-invalid')).toBe('true')
  })

  it('intakes work orders before carrier configuration is ready and never sends confirmation or service parameters', async () => {
    let payload: Record<string, unknown> | undefined
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/owner/orders')) { payload = JSON.parse(String(init?.body)); return Response.json({ orderId: 'intake-only', orderNo: 'SO-INTAKE', status: 'awaiting_confirmation', waybill: null }) }
      return Response.json({ records: [] })
    })
    render(<ShippingWorkbench settings={{ ...settings, canSubmit: false, ready: false }}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    expect(await screen.findByText(/已提报 1 票/)).toBeTruthy()
    expect(screen.getByText(/已提报 · SO-INTAKE/)).toBeTruthy()
    expect(payload).not.toHaveProperty('confirmed')
    expect(payload).not.toHaveProperty('connectionId')
    expect(payload).not.toHaveProperty('billingAccountId')
    expect(payload?.input).not.toHaveProperty('serviceId')
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  })

  it.each(['network', 'server', 'invalid-response'] as const)('reclaims a %s intake receipt with the exact original key and input without reconciling an SF order', async failure => {
    const payloads: unknown[] = []
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/owner/orders')) return Response.json({ records: [] })
      payloads.push(JSON.parse(String(init?.body)))
      if (payloads.length === 1) {
        if (failure === 'network') throw new TypeError('network disconnected')
        if (failure === 'invalid-response') return new Response('not-json', { status: 200 })
        return Response.json({ error: '无法确认提报结果' }, { status: 500 })
      }
      return Response.json({ orderId: 'intake-only', orderNo: 'SO-INTAKE', status: 'awaiting_confirmation', waybill: null })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    await screen.findByText(/已提报 0 票；回执待确认 1 票/)
    expect(screen.getByLabelText('第1行收件人')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '解析为寄件行' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '重取第1行工单回执' }))
    await screen.findByText(/已提报 1 票；回执待确认 0 票/)
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).toEqual(payloads[0])
    expect(fetcher.mock.calls.some(([url]) => /confirm|reconcile/.test(String(url)))).toBe(false)
  })

  it('keeps incomplete sender drafts local until corrected', async () => {
    let payload: { input?: Record<string, unknown> } | undefined
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/owner/orders')) { payload = JSON.parse(String(init?.body)); return Response.json({ orderId: 'no-sender', orderNo: 'SO-NO-SENDER', status: 'awaiting_confirmation', waybill: null }) }
      return Response.json({ records: [] })
    })
    render(<ShippingWorkbench settings={{ ...settings, sender: { name: '', phone: '', province: '', city: '', county: '', address: '' }, canSubmit: false }}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    expect(screen.getByRole('button', { name: '提交工单（1票）' })).toHaveProperty('disabled', true)
    expect(payload).toBeUndefined()
  })

  it('keeps incomplete work-order receipts unresolved rather than counting an HTTP 200 as intake success', async () => {
    fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/owner/orders') ? { orderId: 'missing-number', status: 'awaiting_confirmation' } : { records: [] }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '客户甲 13800138011 广东省深圳市南山区科苑路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    expect(await screen.findByText(/已提报 0 票；回执待确认 1 票/)).toBeTruthy()
  })

  it('requires middle-column review and confirms multiple tickets with one final ledger refresh, retaining the sales sender', async () => {
    const salesSender = { ...settings.sender, name: '销售甲', phone: '13800000009', address: '销售办公室9号' }
    const pending = fixtureOrders.slice(0, 2).map((order, index) => ({ ...order, status: 'awaiting_confirmation' as const, waybill: null, input: { ...order.input, sender: index ? settings.sender : salesSender } }))
    const sent: Array<{ url: string; body: Record<string, unknown> }> = []
    let ledgerLoads = 0
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/confirm')) { sent.push({ url, body: JSON.parse(String(init?.body)) }); return Response.json({ status: 'waybill_created', waybill: `SF${String(sent.length).padStart(12, '0')}` }) }
      ledgerLoads += 1; return Response.json({ records: pending })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    const middle = within(screen.getByRole('region', { name: '收寄件台账与待办' }))
    const left = within(screen.getByRole('region', { name: '批量寄件操作台' }))
    expect(middle.getByRole('button', { name: '批量确认并下单（0票）' })).toHaveProperty('disabled', true)
    for (const order of pending) fireEvent.click(middle.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    const preview = within(middle.getByRole('region', { name: `工单 ${pending[0].orderNo} 收寄预览` }))
    expect(preview.getByText(/销售办公室9号/)).toBeTruthy()
    expect(preview.getByText(/销售甲/)).toBeTruthy()
    expect(middle.getByLabelText('月结账号')).toBeTruthy()
    expect(left.queryByLabelText('月结账号')).toBeNull()
    expect(sent).toHaveLength(0)
    fireEvent.click(middle.getByRole('button', { name: '批量确认并下单（2票）' }))
    await screen.findByText(/正式下单：成功 2 票/)
    expect(sent.map(item => item.url)).toEqual(pending.map(order => `/api/shipping/ledger/${order.id}/confirm`))
    expect(sent.every(item => !('sender' in item.body) && !('input' in item.body))).toBe(true)
    expect(ledgerLoads).toBe(2)
    expect(middle.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it.each(['owner_web', 'anonymous_web'] as const)('uses a valid %s sender snapshot even when the company sender has changed', async intakeSource => {
    const sender = { ...settings.sender, name: '原工单寄件人', address: '原工单寄出楼7号' }
    const order = { ...fixtureOrders[0], intakeSource, status: 'awaiting_confirmation' as const, waybill: null, input: { ...fixtureOrders[0].input, sender } }
    useLedger([order])
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    const review = within(screen.getByRole('region', { name: `工单 ${order.orderNo} 收寄预览` }))
    expect(review.getByText(/原工单寄出楼7号/)).toBeTruthy()
    expect(review.queryByText(/科苑路15号/)).toBeNull()
    expect(screen.getByRole('button', { name: '批量确认并下单（1票）' })).toHaveProperty('disabled', false)
  })

  it('previews the current company default only when an operator work order has no sender at all', async () => {
    const sender = { name: '', phone: '', province: '', city: '', county: '', address: '' }
    const order = { ...fixtureOrders[0], intakeSource: 'owner_web' as const, status: 'awaiting_confirmation' as const, waybill: null, input: { ...fixtureOrders[0].input, sender } }
    useLedger([order])
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    const review = within(screen.getByRole('region', { name: `工单 ${order.orderNo} 收寄预览` }))
    expect(review.getByText('实际寄件人（公司默认寄件资料）')).toBeTruthy()
    expect(review.getByText(/科苑路15号/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '批量确认并下单（1票）' })).toHaveProperty('disabled', false)
  })

  it.each([['anonymous_web', ''], ['owner_web', '已填个人姓名']] as const)('blocks %s missing or partial personal senders rather than substituting company details', async (intakeSource, name) => {
    const sender = { name, phone: '', province: '', city: '', county: '', address: '' }
    const order = { ...fixtureOrders[0], intakeSource, status: 'awaiting_confirmation' as const, waybill: null, input: { ...fixtureOrders[0].input, sender } }
    useLedger([order])
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    expect(screen.getByRole('alert').textContent).toContain('工单寄件资料不完整')
    expect(screen.getByRole('button', { name: '批量确认并下单（1票）' })).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  })

  it('excludes work orders hidden by the current filter from formal batch confirmation', async () => {
    const pending = fixtureOrders.slice(0, 2).map(order => ({ ...order, status: 'awaiting_confirmation' as const, waybill: null }))
    useLedger(pending)
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    for (const order of pending) fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    fireEvent.change(screen.getByLabelText('搜索台账'), { target: { value: pending[0].orderNo } })
    fireEvent.click(screen.getByRole('button', { name: '批量确认并下单（1票）' }))
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))).toHaveLength(1))
    expect(fetcher).toHaveBeenCalledWith(`/api/shipping/ledger/${pending[0].id}/confirm`, expect.objectContaining({ method: 'POST' }))
  })

  it('returns an unsubmitted work order without invoking cancellation or carrier creation', async () => {
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null }
    useLedger([order])
    {
      render(<ShippingWorkbench settings={settings}/>)
      await screen.findAllByText('华东建筑设计院')
      fireEvent.click(screen.getByRole('button', { name: '退回工单' }))
      fireEvent.change(screen.getByLabelText('退回原因'), { target: { value: '请补充材料说明' } })
      fireEvent.click(screen.getByRole('button', { name: '确认退回' }))
      await screen.findByText('工单已退回并记录原因，未向顺丰下单。')
      expect(fetcher).toHaveBeenCalledWith(`/api/shipping/ledger/${order.id}/return`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: '请补充材料说明' }) }))
      expect(fetcher.mock.calls.some(([url]) => /confirm|cancel/.test(String(url)))).toBe(false)
      expect(screen.getByText('工单已退回')).toBeTruthy()
    }
  })

  it('prefills actual defects, prevents blank returns, and keeps failed returns editable', async () => {
    const emptySender = { name: '', phone: '', province: '', city: '', county: '', address: '' }
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, intakeSource: 'owner_web' as const, input: { ...fixtureOrders[0].input, sender: emptySender } }
    fetcher.mockImplementation(async (url: string) => url.endsWith('/return') ? Response.json({ error: '服务暂不可用' }, { status: 503 }) : Response.json({ records: [order] }))
    render(<ShippingWorkbench settings={{ ...settings, sender: emptySender }}/>)
    fireEvent.click(await screen.findByRole('button', { name: '退回工单' }))
    expect((screen.getByLabelText('退回原因') as HTMLTextAreaElement).value).toContain('完整揽收地址')
    fireEvent.change(screen.getByLabelText('退回原因'), { target: { value: ' ' } })
    expect(screen.getByRole('button', { name: '确认退回' })).toHaveProperty('disabled', true)
    fireEvent.submit(screen.getByRole('form', { name: `退回工单 ${order.orderNo}` }))
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/return'))).toBe(false)
    fireEvent.change(screen.getByLabelText('退回原因'), { target: { value: '请补齐寄方资料' } })
    fireEvent.click(screen.getByRole('button', { name: '确认退回' }))
    await screen.findAllByText('退回未完成：服务暂不可用')
    expect(screen.getByLabelText('退回原因')).toHaveProperty('value', '请补齐寄方资料')
    expect(screen.queryByText('工单已退回')).toBeNull()
  })

  it.each([['real', 'order_unknown'], ['real', 'ordering'], ['simulation', 'order_unknown'], ['simulation', 'ordering']] as const)('retains %s middle-column %s outcomes for reconciliation without retrying confirmation', async (mode, status) => {
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null }
    const calls: string[] = []
    const dispatch = async (url: string) => {
      calls.push(url)
      if (url.endsWith('/confirm')) return { id: order.id, status, waybill: null }
      if (url.endsWith('/reconcile')) return { id: order.id, status: 'waybill_created', waybill: mode === 'real' ? 'SF1234567890123' : 'DEMO-000005' }
      return { records: [order] }
    }
    fetcher.mockImplementation(async (url: string) => Response.json(await dispatch(url)))
    render(<ShippingWorkbench settings={settings} simulation={mode === 'simulation' ? { request: dispatch as ShippingWorkbenchRequest, sampleText: '', onReset: vi.fn() } : undefined}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    fireEvent.click(screen.getByRole('button', { name: `${mode === 'real' ? '批量确认并下单' : '模拟确认并下单'}（1票）` }))
    expect(await screen.findByText(/下单结果待确认，请查回原单/)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查回所选单据下单结果' }))
    await screen.findByText(/已查回运单/)
    expect(calls.filter(url => url.endsWith('/confirm'))).toHaveLength(1)
    expect(calls.filter(url => url.endsWith('/reconcile'))).toEqual([`/api/shipping/ledger/${order.id}/reconcile`])
  })

  it.each([null, '', 'SF123', 'DEMO-000005'])('does not count an invalid real waybill %s as a successful formal order', async waybill => {
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null }
    fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/confirm') ? { orderId: order.id, status: 'waybill_created', waybill } : { records: [order] }))
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认并下单（1票）' }))
    expect(await screen.findByText(/成功 0 票；结果待确认 1 票/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '查回所选单据下单结果' })).toBeTruthy()
  })

  it('keeps a lost formal confirmation response addressable by original order ID', async () => {
    const order = { ...fixtureOrders[0], status: 'awaiting_confirmation' as const, waybill: null }
    fetcher.mockImplementation(async (url: string) => { if (url.endsWith('/confirm')) throw new TypeError('example connection lost'); return Response.json({ records: [order] }) })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认并下单（1票）' }))
    expect(await screen.findByText(/下单结果待确认，请查回原单/)).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: '查回所选单据下单结果' })).toBeTruthy()
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
    expect(screen.queryByRole('link', { name: '模拟体验' })).toBeNull()
  })

  it('keeps incomplete regions out of the real order request', async () => {
    render(<ShippingWorkbench settings={settings}/>)
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '演示张三 13800000001 广东省示例路88号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByText('地址需包含完整省市区，请补充后重新确认')).toBeTruthy()
    expect(screen.getByRole('button', { name: '提交工单（0票）' })).toHaveProperty('disabled', true)
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

  it('allows intake but requires a single reviewed ticket for the first unverified Production order', async () => {
    const pending = fixtureOrders.slice(0, 2).map(order => ({ ...order, status: 'awaiting_confirmation' as const, waybill: null }))
    useLedger(pending)
    const services = [{ id: 1, name: 'Production 标快', preference: 'standard' as const }]
    const productionSettings: ShippingSettings = { ...settings, environment: 'production', connectionId: 'production-connection', defaultBillingAccountId: 'production-account', services,
      carrierConnections: [{ id: 'production-connection', carrier: 'sf', environment: 'production', status: 'connected', orderCapability: 'not_tested', services }],
      billingAccounts: [{ id: 'production-account', connectionId: 'production-connection', environment: 'production', displayName: 'Production 月结', tail: '4321', isDefault: true, status: 'active' }] }
    render(<ShippingWorkbench settings={productionSettings}/>)
    await screen.findAllByText('华东建筑设计院')
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '李四 13800000000 上海市浦东新区张江路88号' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByRole('button', { name: '提交工单（1票）' })).toHaveProperty('disabled', false)
    for (const order of pending) fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${order.orderNo}` }))
    expect(screen.getByRole('button', { name: '批量确认并下单（2票）' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox', { name: `核对并选择工单 ${pending[1].orderNo}` }))
    fireEvent.click(screen.getByRole('button', { name: '批量确认并下单（1票）' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/shipping/ledger/${pending[0].id}/confirm`, expect.objectContaining({ method: 'POST' })))
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
    const createdOrder: ShipmentOrder = { ...fixtureOrders[0], id: 'new-sandbox-order', orderNo: 'SO-NEW-INTAKE', status: 'awaiting_confirmation', waybill: null }
    fetcher.mockImplementation(async (url: string) => {
      if (url === '/api/shipping/ledger?limit=50') {
        ledgerLoads += 1
        return new Response(JSON.stringify({ records: ledgerLoads === 1 ? [] : [createdOrder] }), { status: 200 })
      }
      return new Response(JSON.stringify({ orderId: createdOrder.id, orderNo: createdOrder.orderNo, status: createdOrder.status, waybill: null }), { status: 200 })
    })
    render(<ShippingWorkbench settings={settings}/>)
    await screen.findByText('暂无收寄记录')
    fireEvent.click(screen.getByRole('button', { name: '文本解析' }))
    fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '沙盒测试收件人 13800000000 广东省深圳市南山区科技园测试路88号A座' } })
    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    expect(await screen.findByText(/已提报 1 票/)).toBeTruthy()
    expect(screen.getAllByText('SO-NEW-INTAKE').length).toBeGreaterThanOrEqual(2)
    expect(ledgerLoads).toBe(2)
  })

  it('does not resubmit accepted work orders when intake partially fails', async () => {
    const sent: Array<{ key: string }> = []
    const sentBodies: unknown[] = []
    let failedOnce = false
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.body) return new Response(JSON.stringify({ records: [] }), { status: 200 })
      const body = JSON.parse(String(init.body)); sent.push(body); sentBodies.push(body)
      if (!failedOnce && sent.length === 2) { failedOnce = true; return new Response(JSON.stringify({ error: '请修正收件地区', requestStage: 'validation' }), { status: 400 }) }
      return new Response(JSON.stringify({ orderId: `created-${sent.length}`, orderNo: `SO-${sent.length}`, status: 'awaiting_confirmation', waybill: null }), { status: 200 })
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
    fireEvent.click(screen.getByRole('button', { name: '提交工单（4票）' }))
    expect(await screen.findByText(/已提报 3 票/)).toBeTruthy()
    const failedKey = sent[1].key
    fireEvent.click(screen.getByRole('button', { name: '提交工单（1票）' }))
    expect(await screen.findByText(/已提报 1 票/)).toBeTruthy()
    expect(sent).toHaveLength(5)
    expect(sent[4].key).toBe(failedKey)
    expect(sentBodies.every(body => ownerOrderSchema.safeParse(body).success)).toBe(true)
  })

  it('builds a valid intake payload from the synthetic domestic address example', () => {
    const recipientAddress = parseAddress('广东省深圳市南山区科技园测试路88号A座').contact
    const recipient = { ...recipientAddress, name: '沙盒测试收件人', phone: '13800000000' }
    const parsed = ownerOrderSchema.safeParse({
      key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0',
      input: { sender: settings.sender, recipient, cargo: '文件/合同', weight: 1, remark: '', source: 'manual', payment: 'sender_monthly' }
    })
    if (!parsed.success) throw new Error(`${JSON.stringify(recipient)} :: ${parsed.error.issues.map(issue => `${issue.path.join('.')}:${issue.message}`).join(' | ')}`)
    expect(parsed.success).toBe(true)
  })
})

it('removes one draft independently and preserves edits when replacement is cancelled', async () => {
  render(<ShippingWorkbench settings={settings}/>)
  fireEvent.change(screen.getByLabelText('多行地址文本'), { target: { value: '示例甲 13800000000 广东省深圳市南山区示例路88号\n\n示例乙 13900000000 广东省深圳市南山区示例路99号' } })
  fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
  fireEvent.change(screen.getByLabelText('第2行收件人'), { target: { value: '纠正姓名' } })
  fireEvent.click(screen.getByRole('button', { name: '移除第1票草稿' }))
  expect(screen.queryByLabelText('第1行收件人')).toBeNull()
  expect(screen.getByLabelText('第2行收件人')).toHaveProperty('value', '纠正姓名')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.queryByLabelText('第1行收件人')).toBeNull()
  expect(screen.getByLabelText('第2行收件人')).toHaveProperty('value', '纠正姓名')
  expect(screen.getByRole('button', { name: '提交工单（1票）' })).toBeTruthy()
  confirm.mockRestore()
})
