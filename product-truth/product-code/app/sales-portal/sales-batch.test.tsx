import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SalesBatchProposal from './sales-batch'

vi.mock('./my-workorders', () => ({ default: () => <p>仅本人记录</p> }))
const fetcher = vi.fn()
const sender = { name: '示例前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '公司路8号' }
const rules = { companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: true, minLength: 1 }, teamOptions: [] }
const addresses = '林示例 13800000001 广东省深圳市南山区科苑路8号\n\n唐演示 13800000002 浙江省杭州市西湖区文三路90号'
const mount = () => render(<SalesBatchProposal sender={sender} team="销售部" rules={rules} accessReady/>)
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('reuses the operator multi-address parser, previews and creates two owner pending orders only', async () => {
  let sequence = 0
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ orderNo: `SO-MINE-${++sequence}`, status: 'awaiting_confirmation', waybill: null }), { status: 202 }))
  mount()
  fireEvent.change(screen.getByLabelText('收件地址文本'), { target: { value: addresses } })
  fireEvent.click(screen.getByRole('button', { name: '识别收件信息' }))
  expect(screen.getByLabelText('第1票收件人')).toHaveProperty('value', '林示例')
  expect(screen.getByLabelText('第2票收件人')).toHaveProperty('value', '唐演示')
  fireEvent.change(screen.getByLabelText('第1票客户公司'), { target: { value: '星河科技' } })
  fireEvent.change(screen.getByLabelText('第2票客户公司'), { target: { value: '蓝海科技' } })
  fireEvent.click(screen.getByRole('button', { name: '预览 2 票' }))
  expect(screen.getByRole('region', { name: '寄件提报预览' })).toHaveProperty('textContent', expect.stringContaining('林示例'))
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认提交 2 票' }))
  await screen.findByText(/SO-MINE-2/)
  const posts = fetcher.mock.calls.filter(([,init]) => init?.method === 'POST')
  expect(posts).toHaveLength(2)
  expect(posts.map(([url]) => url)).toEqual(['/api/shipping/owner/orders', '/api/shipping/owner/orders'])
  expect(posts.every(([,init]) => init.credentials === 'same-origin')).toBe(true)
  const payloads = posts.map(([,init]) => JSON.parse(init.body))
  expect(new Set(payloads.map(item => item.key)).size).toBe(2)
  expect(payloads.map(item => item.input.recipient.name)).toEqual(['林示例', '唐演示'])
  expect(payloads.every(item => item.input.payment === 'sender_monthly' && item.input.weight === 1)).toBe(true)
  expect(screen.queryByText('全部快递记录')).toBeNull()
})

it('keeps the exact original request after an uncertain response and does not create a second ticket', async () => {
  fetcher.mockRejectedValueOnce(new TypeError('network lost'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ orderNo: 'SO-RECOVERED', status: 'awaiting_confirmation' }), { status: 202 }))
  mount()
  fireEvent.change(screen.getByLabelText('收件地址文本'), { target: { value: addresses.split('\n\n')[0] } })
  fireEvent.click(screen.getByRole('button', { name: '识别收件信息' }))
  fireEvent.change(screen.getByLabelText('第1票客户公司'), { target: { value: '星河科技' } })
  fireEvent.click(screen.getByRole('button', { name: '预览 1 票' }))
  fireEvent.click(screen.getByRole('button', { name: '确认提交 1 票' }))
  const retry = await screen.findByRole('button', { name: '重取第 1 票工单回执' })
  expect(screen.getByLabelText('第1票收件人').closest('fieldset')).toHaveProperty('disabled', true)
  fireEvent.click(retry)
  await screen.findByText(/SO-RECOVERED/)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
})

it('blocks incomplete rows, allows per-ticket correction and disables submission without a sender', async () => {
  mount()
  fireEvent.change(screen.getByLabelText('收件地址文本'), { target: { value: '林示例 13800000001 深圳市南山区科苑路8号' } })
  fireEvent.click(screen.getByRole('button', { name: '识别收件信息' }))
  expect(screen.getByRole('button', { name: '预览 0 票' })).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('第1票收件地址'), { target: { value: '广东省深圳市南山区科苑路8号' } })
  fireEvent.change(screen.getByLabelText('第1票客户公司'), { target: { value: '星河科技' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '预览 1 票' })).toHaveProperty('disabled', false))
  expect(fetcher).not.toHaveBeenCalled()
})

it('requires another preview after the selected pickup address changes', async () => {
  const view = mount()
  fireEvent.change(screen.getByLabelText('收件地址文本'), { target: { value: addresses.split('\n\n')[0] } })
  fireEvent.click(screen.getByRole('button', { name: '识别收件信息' }))
  fireEvent.change(screen.getByLabelText('第1票客户公司'), { target: { value: '星河科技' } })
  fireEvent.click(screen.getByRole('button', { name: '预览 1 票' }))
  expect(screen.getByRole('button', { name: '确认提交 1 票' })).toHaveProperty('disabled', false)
  view.rerender(<SalesBatchProposal sender={{...sender, address:'另一公司路9号'}} team="销售部" rules={rules} accessReady/>)
  expect(screen.getByRole('button', { name: '确认提交 1 票' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('region', { name: '寄件提报预览' })).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})


it('invalidates batch preview when inherited cargo changes before submission', () => {
  const defaults={customerName:'星河科技',cargo:'合同',weight:'1',serviceId:'2',specialRequirements:''}
  const view=render(<SalesBatchProposal embedded initialText={addresses} sender={sender} team="销售部" rules={rules} services={[{id:2,name:'顺丰标快',preference:'standard'}]} accessReady defaults={defaults}/>)
  fireEvent.click(screen.getByRole('button',{name:'预览 2 票'}))
  expect(screen.getByRole('button',{name:'确认提交 2 票'})).toHaveProperty('disabled',false)
  view.rerender(<SalesBatchProposal embedded initialText={addresses} sender={sender} team="销售部" rules={rules} services={[{id:2,name:'顺丰标快',preference:'standard'}]} accessReady defaults={{...defaults,cargo:'样品'}}/>)
  expect(screen.getByRole('button',{name:'确认提交 2 票'})).toHaveProperty('disabled',true)
  expect(fetcher).not.toHaveBeenCalled()
})


it('keeps inherited customer and cargo visible after success and an unknown response', async () => {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({orderNo:'SO-ONE',status:'awaiting_confirmation'}),{status:202})).mockRejectedValueOnce(new TypeError('lost'))
  render(<SalesBatchProposal embedded initialText={addresses} sender={sender} team="销售部" rules={rules} services={[{id:2,name:'顺丰标快',preference:'standard'}]} accessReady defaults={{customerName:'星河科技',cargo:'样品',weight:'2',serviceId:'2',specialRequirements:'易碎'}}/>)
  fireEvent.click(screen.getByRole('button',{name:'预览 2 票'}))
  fireEvent.click(screen.getByRole('button',{name:'确认提交 2 票'}))
  await screen.findByRole('button',{name:'重取第 2 票工单回执'})
  expect(screen.getByLabelText('第1票客户公司')).toHaveProperty('value','星河科技')
  expect(screen.getByLabelText('第2票客户公司')).toHaveProperty('value','星河科技')
  expect(screen.getByLabelText('第1票托寄物')).toHaveProperty('value','样品')
  expect(screen.getByLabelText('第2票托寄物')).toHaveProperty('value','样品')
  expect(screen.queryAllByRole('alert')).toHaveLength(1)
})


it('offers an explicit finish action for a checked conflict while keeping unknown requests protected', async () => {
  fetcher.mockImplementation(async ()=>new Response(JSON.stringify({error:'原请求冲突'}),{status:409}))
  const finish=vi.fn()
  render(<SalesBatchProposal embedded onClear={finish} initialText={addresses} sender={sender} team="销售部" rules={rules} services={[{id:2,name:'顺丰标快',preference:'standard'}]} accessReady defaults={{customerName:'星河科技',cargo:'样品',weight:'2',serviceId:'2',specialRequirements:'易碎'}}/>)
  fireEvent.click(screen.getByRole('button',{name:'预览 2 票'}))
  fireEvent.click(screen.getByRole('button',{name:'确认提交 2 票'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'已核对原工单，结束本批'})).toHaveProperty('disabled',false))
  fireEvent.click(screen.getByRole('button',{name:'已核对原工单，结束本批'}))
  expect(finish).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
