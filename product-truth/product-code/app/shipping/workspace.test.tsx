import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShippingWorkspace from './workspace'
import type { ShippingSettings } from '@/lib/shipping/types'
const contact = { name: '测试人员', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试街道1号' }
const settings: ShippingSettings = { environment: 'sandbox', ready: true, canSubmit: true, reason: '', services: [{ id: 2, name: '沙盒服务' }], monthlyTail: '0000', sender: contact }
const fetcher = vi.fn()
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); fetcher.mockImplementation(async () => new Response(JSON.stringify({ records: [] }), { status: 200 })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('one screen shipping interaction', () => {
 it('keeps pasted recipient fields when a tracking query fails', async () => {
  render(<ShippingWorkspace settings={settings} userId="test-user" />)
  fireEvent.change(screen.getByLabelText('粘贴收件信息'), { target: { value: '张三 13800000000 广东省深圳市南山区科技路1号' } })
  fireEvent.click(screen.getByRole('button', { name: '识别并填写' }))
  expect((screen.getByLabelText('收件人姓名') as HTMLInputElement).value).toBe('张三')
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: '顺丰暂时不可用' }), { status: 502 }))
  fireEvent.change(screen.getByLabelText('运单号'), { target: { value: 'SF1234567890123' } })
  fireEvent.click(screen.getByRole('button', { name: '查询' }))
  await screen.findByText('顺丰暂时不可用')
  expect((screen.getByLabelText('收件人详细地址') as HTMLInputElement).value).toBe('科技路1号')
 })
 it('uses the same request after a lost response, including after reload', async () => {
  const bodies: unknown[] = []
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => { if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); throw new Error('network lost') } return new Response(JSON.stringify({ records: [] }), { status: 200 }) })
  const view = render(<ShippingWorkspace settings={settings} userId="test-user" />)
  fireEvent.change(screen.getByLabelText('粘贴收件信息'), { target: { value: '张三 13800000000 广东省深圳市南山区科技路1号' } }); fireEvent.click(screen.getByRole('button', { name: '识别并填写' }))
  fireEvent.click(screen.getByRole('button', { name: '确认寄件' }))
  fireEvent.click(screen.getByRole('button', { name: '确认沙盒下单' }))
  await screen.findByText(/network lost/)
  await waitFor(() => expect((screen.getByRole('button', { name: '重试原请求（不会另建单）' }) as HTMLButtonElement).disabled).toBe(false))
  view.unmount(); render(<ShippingWorkspace settings={settings} userId="test-user" />)
  fireEvent.click(await screen.findByRole('button', { name: '重试原请求（不会另建单）' }))
  await waitFor(() => expect(bodies.length).toBe(2))
  expect(bodies[0]).toEqual(bodies[1])
 })
 it('returns to editing after local validation rejection and reuses the original key', async () => {
  const bodies: Array<{ key: string }> = []
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
   if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ error: '快递服务配置已变化，请重新选择', requestStage: 'validation' }), { status: 400 }) }
   return new Response(JSON.stringify({ records: [] }), { status: 200 })
  })
  render(<ShippingWorkspace settings={settings} userId="test-user" />)
  fireEvent.change(screen.getByLabelText('粘贴收件信息'), { target: { value: '张三 13800000000 广东省深圳市南山区科技路1号' } })
  fireEvent.click(screen.getByRole('button', { name: '识别并填写' }))
  fireEvent.click(screen.getByRole('button', { name: '确认寄件' }))
  fireEvent.click(screen.getByRole('button', { name: '确认沙盒下单' }))
  await screen.findByText(/快递服务配置已变化/)
  expect(screen.getByLabelText('收件人姓名').closest('fieldset')?.disabled).toBe(false)
  fireEvent.change(screen.getByLabelText('收件人姓名'), { target: { value: '李四' } })
  fireEvent.click(screen.getByRole('button', { name: '确认寄件' }))
  fireEvent.click(screen.getByRole('button', { name: '确认沙盒下单' }))
  await waitFor(() => expect(bodies.length).toBe(2))
  expect(bodies[0].key).toBe(bodies[1].key)
 })
 it('does not unlock the current uncertain request while reconciling another request', async () => {
  const input={sender:contact,recipient:contact,cargo:'文件',weight:1,serviceId:2,remark:'',source:'manual'}
  sessionStorage.setItem('shipping-request:test-user:sandbox',JSON.stringify({key:'43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0',input}))
  const current={id:'current',status:'unknown',waybill:null,created_at:'2026-09-11T01:00:00Z',environment:'sandbox'}
  const other={...current,id:'other'}
  let reconciled=false
  fetcher.mockImplementation(async (_url:string,init?:RequestInit)=>{
   if(init?.method==='POST'){reconciled=true;return new Response(JSON.stringify({...other,status:'accepted',waybill:'SF1234567890123'}),{status:200})}
   if(reconciled)return new Promise(()=>{})
   return new Response(JSON.stringify({records:[other,current],current}),{status:200})
  })
  render(<ShippingWorkspace settings={settings} userId="test-user" />)
  const buttons=await screen.findAllByRole('button',{name:'确认结果'});expect(buttons.length).toBe(2)
  fireEvent.click(buttons[0]);await waitFor(()=>expect(reconciled).toBe(true))
  expect(screen.queryByRole('button',{name:'再寄一票'})).toBeNull()
 })
 it('autofills the last successful shipment on a new visit', () => {
  const last = { sender: { ...contact, name: '上次寄件人' }, recipient: { ...contact, name: '上次收件人' }, cargo: '合同', weight: 2, serviceId: 2, remark: '上门联系', source: 'manual' as const }
  render(<ShippingWorkspace settings={{ ...settings, lastShipment: last }} userId="test-user" />)
  expect((screen.getByLabelText('寄件人姓名') as HTMLInputElement).value).toBe('上次寄件人')
  expect((screen.getByLabelText('收件人姓名') as HTMLInputElement).value).toBe('上次收件人')
  expect((screen.getByLabelText('物品名称') as HTMLInputElement).value).toBe('合同')
  expect((screen.getByLabelText('预估重量') as HTMLInputElement).value).toBe('2')
 })
 it('loads and selects a sender from the private address book', async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/contacts') ? { contacts: [{ id: 'saved', label: '深圳办公室', contact: { ...contact, name: '办公室联系人' } }] } : { records: [] }), { status: 200 }))
  render(<ShippingWorkspace settings={settings} userId="test-user" />)
  fireEvent.click(screen.getByRole('button', { name: '寄件人地址簿' }))
  fireEvent.click(await screen.findByRole('button', { name: /深圳办公室/ }))
  expect((screen.getByLabelText('寄件人姓名') as HTMLInputElement).value).toBe('办公室联系人')
  expect(screen.queryByRole('region', { name: '寄件人地址簿' })).toBeNull()
 })
 it('does not request private records or show the address book to guests', async () => {
  render(<ShippingWorkspace settings={{ ...settings, guest: true, ready: false, canSubmit: false }} userId="guest" />)
  expect(screen.queryByRole('button', { name: '寄件人地址簿' })).toBeNull()
  expect((screen.getByRole('button', { name: '确认寄件' }) as HTMLButtonElement).disabled).toBe(true)
  await waitFor(() => expect(fetcher).not.toHaveBeenCalled())
 })
 it('renders ordering before tracking in DOM and keyboard order', () => {
  render(<ShippingWorkspace settings={settings} userId="test-user" />)
  const order=screen.getByRole('region',{name:'寄件下单'}),tracking=screen.getByRole('region',{name:'运单查询'})
  expect(Boolean(order.compareDocumentPosition(tracking) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
 })
 it('cannot submit without a real connection while address parsing remains usable', async () => {
  render(<ShippingWorkspace settings={{ ...settings, ready: false, canSubmit: false, reason: '接口未接通' }} userId="test-user" />)
  expect((screen.getByRole('button', { name: '确认寄件' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('粘贴收件信息') as HTMLTextAreaElement).disabled).toBe(false)
 })
})
