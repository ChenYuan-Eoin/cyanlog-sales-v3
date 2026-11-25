import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MyWorkorders from './my-workorders'

const fetcher = vi.fn()
const order = (orderNo: string, extra: Record<string, unknown> = {}) => ({
  orderNo,
  revision: 1,
  status: 'waybill_created',
  waybill: `SF-${orderNo}`,
  nextReviewAt: null,
  createdAt: '2026-11-09T08:00:00Z',
  ...extra,
})
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
})

afterEach(() => {
  cleanup()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
})

it('loads shared records, appends a page from the primary action and refreshes from page zero', async () => {
  fetcher.mockResolvedValueOnce(response({ orders: [order('ONE')], nextPage: 1 }))
    .mockResolvedValueOnce(response({ orders: [order('ONE'), order('TWO')], nextPage: null }))
    .mockResolvedValueOnce(response({ orders: [order('NEW')], nextPage: null }))
  render(<MyWorkorders />)

  await screen.findByRole('listitem', { name: '提报 ONE' })
  expect(fetcher).toHaveBeenCalledWith('/api/shipping/public/orders?page=0', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }))
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  expect(await screen.findByRole('listitem', { name: '提报 TWO' })).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('已显示 2 条，已加载全部记录')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '刷新提报记录' }))
  expect(await screen.findByRole('listitem', { name: '提报 NEW' })).toBeInTheDocument()
  expect(screen.queryByRole('listitem', { name: '提报 ONE' })).toBeNull()
})

it('reads only the authenticated owner endpoint in employee mode', async () => {
  fetcher.mockResolvedValue(response({ orders: [], nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  expect(await screen.findByText('尚无提报记录')).toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledWith('/api/shipping/owner/orders?page=0', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }))
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/public/orders'))).toBe(false)
})

it('refreshes current waybill status from SF and reloads the owner list before showing action availability', async () => {
  const fresh = order('LIVE', { status: 'delivered', trackingStatus: 'delivered', waybill: 'SF1234567890123' })
  fetcher.mockResolvedValueOnce(response({ orders: [order('LIVE', { waybill: 'SF1234567890123' })], nextPage: null }))
    .mockResolvedValueOnce(response({ verified: true, waybill: 'SF1234567890123', source: 'carrier', shipmentStatus: 'delivered', events: [{time:'2026-11-20 18:41:00',location:'北京',description:'已签收',status:'delivered'}] }))
    .mockResolvedValueOnce(response({ orders: [fresh], nextPage: null }))
  render(<MyWorkorders scope="owner" />)
  const card = await screen.findByRole('listitem', { name: '提报 LIVE' })
  expect(await within(card).findByText('已签收')).toBeInTheDocument()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/shipping/owner/orders?page=0', '/api/shipping/owner/orders/LIVE/tracking', '/api/shipping/owner/orders?page=0',
  ])
  expect(within(card).queryByRole('button', { name: '取消寄件' })).toBeNull()
})

it('refreshes newly exposed owner records and keeps the expanded window on manual refresh', async () => {
  const records = Array.from({ length: 8 }, (_, i) => order(`ORDER-${i}`, { status: i === 7 ? 'waybill_created' : 'delivered', waybill: `SF123456789012${i}` }))
  fetcher.mockImplementation(async (url: string) => url.endsWith('/tracking')
    ? response({ verified: true, source: 'carrier', waybill: 'SF1234567890127', shipmentStatus: 'waybill_created', events: [{ status: 'waybill_created' }] })
    : response({ orders: records, nextPage: null }))
  render(<MyWorkorders scope="owner" />)
  await screen.findByRole('listitem', { name: '提报 ORDER-0' })
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === '/api/shipping/owner/orders/ORDER-7/tracking')).toBe(true))
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
  fireEvent.click(screen.getByRole('button', { name: '刷新提报记录' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
})

it('does not lock returned-record resubmission when a different waybill refresh fails', async () => {
  fetcher.mockImplementation(async (url: string) => url.endsWith('/tracking') ? response({ error: '顺丰不可用' }, 503) : response({ orders: [
    order('FAILED', { waybill: 'SF1234567890123' }), order('RETURNED', { status: 'returned', waybill: null }),
  ], nextPage: null }))
  render(<MyWorkorders scope="owner" onResubmit={vi.fn()} />)
  const returned = await screen.findByRole('listitem', { name: '提报 RETURNED' })
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  expect(within(returned).getByRole('button', { name: '修改并重提' })).toBeEnabled()
  expect(within(screen.getByRole('listitem', { name: '提报 FAILED' })).getByRole('button', { name: '取消寄件' })).toBeDisabled()
})

it('rereads earlier owner pages when appending records after a carrier refresh', async () => {
  let signed = false
  let refreshCount = 0
  const first = () => order('PAGE-ZERO', { status: signed ? 'delivered' : 'waybill_created', waybill: 'SF1234567890123' })
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/tracking')) {
      refreshCount += 1
      if (refreshCount > 1) signed = true
      return response({ verified: true, waybill: 'SF1234567890123' })
    }
    return url.endsWith('page=0') ? response({ orders: [first()], nextPage: 1 })
      : response({ orders: [order('PAGE-ONE', { status: 'delivered' })], nextPage: null })
  })
  render(<MyWorkorders scope="owner" />)
  await screen.findByRole('listitem', { name: '提报 PAGE-ZERO' })
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  const card = screen.getByRole('listitem', { name: '提报 PAGE-ZERO' })
  expect(card).toHaveTextContent('已签收')
  expect(within(card).queryByRole('button', { name: '取消寄件' })).toBeNull()
})

it('keeps a replacement filtered record locked until its carrier status has been checked', async () => {
  let signed = false
  const records = () => Array.from({ length: 6 }, (_, i) => order(`FILTER-${i}`, {
    status: signed && i === 0 ? 'delivered' : 'waybill_created', waybill: `SF123456789012${i}`,
  }))
  fetcher.mockImplementation(async (url: string) => url.endsWith('/tracking')
    ? response({ error: 'temporarily unavailable' }, 503) : response({ orders: records(), nextPage: null }))
  render(<MyWorkorders scope="owner" />)
  await screen.findByRole('listitem', { name: '提报 FILTER-0' })
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/tracking')) {
      if (url.includes('FILTER-0/')) signed = true
      const index = /FILTER-(\d)\/tracking$/.exec(url)![1]
      return response({ verified: true, waybill: `SF123456789012${index}` })
    }
    return response({ orders: records(), nextPage: null })
  })
  fireEvent.click(screen.getByRole('button', { name: '待揽收' }))
  const replacement = await screen.findByRole('listitem', { name: '提报 FILTER-5' })
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  expect(within(replacement).getByRole('button', { name: '取消寄件' })).toBeDisabled()
})

it('shows the real returned reason and labels a missing reason without reusing stale data', async () => {
  fetcher.mockResolvedValue(response({ orders: [
    order('RETURNED', { status: 'returned', waybill: null, customerName: '客户甲', returnedReason: '收件地址缺少楼层' }),
    order('HISTORICAL', { status: 'returned', waybill: null, customerName: '客户乙' }),
    order('NOT_RETURNED', { customerName: '客户丙', returnedReason: '旧原因' }),
  ], nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  const current = await screen.findByRole('listitem', { name: '提报 RETURNED' })
  expect(current).toHaveTextContent('前台已退回')
  expect(current).toHaveTextContent('退回原因：收件地址缺少楼层')
  expect(current).toHaveTextContent('待审核下单后生成')
  const historical = screen.getByRole('listitem', { name: '提报 HISTORICAL' })
  expect(historical).toHaveTextContent('未记录退回原因')
  expect(screen.getByRole('listitem', { name: '提报 NOT_RETURNED' })).not.toHaveTextContent('旧原因')
})

it('shows and copies the waybill without displaying the internal order number', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  fetcher.mockResolvedValue(response({ orders: [order('S0-20261118-03566890', {
    status: 'in_transit', trackingStatus: 'out_for_delivery', customerName: '腾云天宇收件',
    recipientSummary: '王工 · 江苏省苏州市工业园区', cargo: '芯片测试样品', serviceName: '顺丰特快',
    pickupWindow: '今日 19:00-20:00', currentLocation: '上海虹桥集散中心',
  })], nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  const card = await screen.findByRole('listitem', { name: '提报 S0-20261118-03566890' })
  expect(card).toHaveTextContent('16:00')
  expect(card).toHaveTextContent('腾云天宇收件')
  expect(card).toHaveTextContent('顺丰单号')
  expect(card).toHaveTextContent('SF-S0-20261118-03566890')
  expect(card).toHaveTextContent('派送中')
  expect(card).toHaveTextContent('快件已派件出仓，取消 / 转寄 / 退回通道已关闭。')
  expect(card).not.toHaveTextContent('王工 · 江苏省苏州市工业园区')
  expect(card).not.toHaveTextContent('芯片测试样品')
  expect(card).not.toHaveTextContent('顺丰特快')
  expect(card).not.toHaveTextContent('今日 19:00-20:00')
  expect(card).not.toHaveTextContent('上海虹桥集散中心')

  expect(within(card).queryByText('S0-20261118-03566890')).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: '复制提报单号' })).not.toBeInTheDocument()
  fireEvent.click(within(card).getByRole('button', { name: '复制顺丰单号' }))
  await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('已复制顺丰单号'))
  expect(writeText).toHaveBeenCalledWith('SF-S0-20261118-03566890')
})

it('loads in-transit forwarding and return actions directly on the card', async () => {
  const endpoint = '/api/shipping/owner/orders/SHIPPED/carrier-changes'
  const shipped = order('SHIPPED', { status: 'in_transit', customerName: '在途客户' })
  const detail = {
    orderNo: 'SHIPPED', actions: ['modify_recipient', 'return_to_sender'],
    currentRecipient: { name: '客户', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '旧街1号' },
    returnDestination: { name: '提报人', phone: '13900000000', province: '广东省', city: '深圳市', county: '南山区', address: '寄件路2号' },
    latest: null,
  }
  fetcher.mockImplementation(async (url: string) => url === endpoint ? response(detail) : response({ orders: [shipped], nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  const card = await screen.findByRole('listitem', { name: '提报 SHIPPED' })
  expect(card).toHaveTextContent('运输中')
  expect(await within(card).findByRole('button', { name: '转寄 / 改派' })).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: '申请退回' })).toBeInTheDocument()
  expect(card).toHaveTextContent('已揽收且未派件出仓，可发起拦截')
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/shipping/owner/orders?page=0', endpoint])
  fireEvent.click(within(card).getByRole('button', { name: '转寄 / 改派' }))
  expect(screen.getByRole('form', { name: '转寄或改派快件收件地址' })).toBeInTheDocument()
})

it('closes every carrier-change channel once a parcel leaves for delivery', async () => {
  fetcher.mockResolvedValue(response({ orders: [order('DELIVERING', {
    status: 'in_transit', trackingStatus: 'out_for_delivery', customerName: '派送客户',
  })], nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  const card = await screen.findByRole('listitem', { name: '提报 DELIVERING' })
  expect(card).toHaveTextContent('派送中')
  expect(card).toHaveTextContent('快件已派件出仓，取消 / 转寄 / 退回通道已关闭。')
  expect(within(card).queryByRole('button', { name: '转寄 / 改派' })).toBeNull()
  expect(within(card).queryByRole('button', { name: '申请退回' })).toBeNull()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
})

it('locks other record actions while a pre-pickup cancellation waits for the carrier', async () => {
  let finish!: (value: Response) => void
  fetcher.mockResolvedValueOnce(response({ orders: [
    order('ORIGINAL', { customerName: '客户甲' }),
    order('OTHER', { customerName: '客户乙' }),
  ], nextPage: null })).mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve }))
  render(<MyWorkorders scope="owner" />)

  const original = await screen.findByRole('listitem', { name: '提报 ORIGINAL' })
  const other = screen.getByRole('listitem', { name: '提报 OTHER' })
  fireEvent.click(within(original).getByRole('button', { name: '取消寄件' }))
  fireEvent.click(within(original).getByRole('button', { name: '确认取消' }))
  expect(await within(original).findByRole('button', { name: '正在取消…' })).toBeDisabled()
  expect(within(other).getByRole('button', { name: '取消寄件' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeDisabled()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/shipping/owner/orders?page=0', '/api/shipping/owner/orders/ORIGINAL/cancel',
  ])

  finish(response({ status: 'cancelled' }))
  await waitFor(() => expect(original).toHaveTextContent('已取消'))
  expect(other).toHaveTextContent('待揽收')
  expect(within(original).queryByRole('button', { name: '取消寄件' })).toBeNull()
})

it('disables resubmission while loading the original and restores it after a read failure', async () => {
  let finish!: (value: Response) => void
  fetcher.mockResolvedValueOnce(response({ orders: [
    order('ORIGINAL', { status: 'returned', waybill: null, customerName: '客户甲', returnedReason: '资料不全' }),
  ], nextPage: null })).mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve }))
  const onResubmit = vi.fn()
  render(<MyWorkorders scope="owner" onResubmit={onResubmit} />)

  const card = await screen.findByRole('listitem', { name: '提报 ORIGINAL' })
  fireEvent.click(within(card).getByRole('button', { name: '修改并重提' }))
  expect(await within(card).findByRole('button', { name: '正在读取原单…' })).toBeDisabled()
  finish(response({ error: '工单状态已变化' }, 409))
  expect(await screen.findByRole('alert')).toHaveTextContent('工单状态已变化')
  expect(within(card).getByRole('button', { name: '修改并重提' })).toBeEnabled()
  expect(onResubmit).not.toHaveBeenCalled()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/shipping/owner/orders?page=0', '/api/shipping/owner/orders/ORIGINAL/resubmit',
  ])
})

it('does not display a private return reason or owner actions in a shared receipt', async () => {
  fetcher.mockResolvedValue(response({ orders: [order('SHARED', {
    status: 'returned', waybill: null, returnedReason: '私有备注',
  })], nextPage: null }))
  render(<MyWorkorders />)

  const card = await screen.findByRole('listitem', { name: '提报 SHARED' })
  expect(card).toHaveTextContent('前台已退回')
  expect(card).not.toHaveTextContent('私有备注')
  expect(card).not.toHaveTextContent('退回原因')
  expect(within(card).queryByRole('button', { name: '修改并重提' })).toBeNull()
  expect(within(card).queryByRole('button', { name: '取消寄件' })).toBeNull()
})

it('keeps existing records when another page fails and lets the visitor retry that page', async () => {
  fetcher.mockResolvedValueOnce(response({ orders: [order('ONE')], nextPage: 1 }))
    .mockResolvedValueOnce(response({ error: '记录暂不可用' }, 503))
    .mockResolvedValueOnce(response({ orders: [order('TWO')], nextPage: null }))
  render(<MyWorkorders />)

  await screen.findByRole('listitem', { name: '提报 ONE' })
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('记录暂不可用')
  expect(screen.getByRole('listitem', { name: '提报 ONE' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  expect(await screen.findByRole('listitem', { name: '提报 TWO' })).toBeInTheDocument()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/shipping/public/orders?page=0',
    '/api/shipping/public/orders?page=1',
    '/api/shipping/public/orders?page=1',
  ])
})

it('explains an empty list and recovers from an initial failure', async () => {
  fetcher.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce(response({ orders: [], nextPage: null }))
  render(<MyWorkorders />)

  expect(await screen.findByRole('alert')).toHaveTextContent('连接中断')
  fireEvent.click(screen.getByRole('button', { name: '刷新提报记录' }))
  expect(await screen.findByText('尚无提报记录')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('shows the latest five records and grows the visible window without a collapse mode', async () => {
  fetcher.mockResolvedValue(response({ orders: Array.from({ length: 8 }, (_, i) => order(`ORDER-${i}`)), nextPage: null }))
  render(<MyWorkorders />)

  await screen.findByRole('listitem', { name: '提报 ORDER-0' })
  expect(screen.getAllByRole('listitem')).toHaveLength(5)
  expect(screen.queryByRole('listitem', { name: '提报 ORDER-5' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(8)
  expect(screen.getByRole('listitem', { name: '提报 ORDER-7' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '显示更多记录' })).toBeNull()
  expect(screen.queryByRole('button', { name: /收起/ })).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('groups records by Shanghai calendar date and shows local submission time and customer fallback', async () => {
  fetcher.mockResolvedValue(response({ orders: [
    order('LATE', { createdAt: '2026-11-08T16:05:00Z', customerName: '星河科技' }),
    order('EARLY', { createdAt: '2026-11-08T15:55:00Z', customerName: null }),
  ], nextPage: null }))
  render(<MyWorkorders />)

  await screen.findByRole('listitem', { name: '提报 LATE' })
  const nextDay = screen.getByRole('region', { name: '2026年11月9日' })
  const priorDay = screen.getByRole('region', { name: '2026年11月8日' })
  expect(within(nextDay).getByRole('listitem', { name: '提报 LATE' })).toHaveTextContent('00:05')
  expect(within(nextDay).getByText('星河科技')).toHaveAttribute('title', '星河科技')
  expect(within(priorDay).getByRole('listitem', { name: '提报 EARLY' })).toHaveTextContent('23:55')
  expect(within(priorDay).getByText('未填客户')).toBeInTheDocument()
})

it('filters owner records by carrier stage while preserving the all-record count', async () => {
  const carrierEndpoint = '/api/shipping/owner/orders/MOVING/carrier-changes'
  const records = [
    order('WAITING', { customerName: '待揽客户' }),
    order('MOVING', { status: 'in_transit', customerName: '在途客户' }),
    order('DELIVERING', { status: 'in_transit', trackingStatus: 'out_for_delivery', customerName: '派送客户' }),
    order('SIGNED', { status: 'delivered', customerName: '签收客户' }),
    order('RETURNED', { status: 'returned', waybill: null, customerName: '退回客户', returnedReason: '资料不全' }),
  ]
  fetcher.mockImplementation(async (url: string) => url === carrierEndpoint
    ? response({ orderNo: 'MOVING', actions: ['return_to_sender'], returnDestination: { name: '寄件人', phone: '13900000000', province: '广东省', city: '深圳市', county: '南山区', address: '寄件路' }, latest: null })
    : response({ orders: records, nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  await screen.findByRole('listitem', { name: '提报 WAITING' })
  expect(screen.getByRole('button', { name: '全部 (5)' })).toBeInTheDocument()
  for (const name of ['待揽收', '运输中', '派送中', '已签收', '已退回']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  fireEvent.click(screen.getByRole('button', { name: '运输中' }))
  expect(screen.getByRole('listitem', { name: '提报 MOVING' })).toBeInTheDocument()
  expect(screen.queryByRole('listitem', { name: '提报 WAITING' })).toBeNull()
  expect(screen.queryByRole('listitem', { name: '提报 DELIVERING' })).toBeNull()
  expect(screen.queryByRole('listitem', { name: '提报 SIGNED' })).toBeNull()
  expect(screen.queryByRole('listitem', { name: '提报 RETURNED' })).toBeNull()
  expect(screen.getByRole('button', { name: '全部 (5)' })).toBeInTheDocument()
})

it('shows only a real delivery timestamp and never invents signer, receipt-download or ETA fields', async () => {
  fetcher.mockResolvedValue(response({ orders: [
    order('SIGNED', { status: 'delivered', customerName: '签收客户', deliveredAt: '2026-11-18T09:48:23Z' }),
    order('SIGNED_WITHOUT_TIME', { status: 'delivered', customerName: '无时间客户' }),
  ], nextPage: null }))
  render(<MyWorkorders scope="owner" />)

  const signed = await screen.findByRole('listitem', { name: '提报 SIGNED' })
  expect(signed).toHaveTextContent('签收时间')
  expect(signed).toHaveTextContent('17:48:23')
  expect(signed).toHaveTextContent('订单已妥投，修改 / 取消 / 转寄通道已关闭')
  expect(signed).not.toHaveTextContent('签收人')
  expect(signed).not.toHaveTextContent('电子底单')
  expect(signed).not.toHaveTextContent('预计送达')
  const withoutTime = screen.getByRole('listitem', { name: '提报 SIGNED_WITHOUT_TIME' })
  expect(withoutTime).toHaveTextContent('订单已签收')
  expect(withoutTime).not.toHaveTextContent('签收时间')
})
