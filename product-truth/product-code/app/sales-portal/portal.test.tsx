import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SalesPortal, { FxiaokeShippingProposal, SalesRequestForm } from './portal'
import { ownerOrderSchema } from '@/lib/shipping/validation'
vi.mock('./my-workorders', () => ({default: () => <p>全部快递记录</p>}))
const employee = { id: 'employee-1', email: 'person@ones.cn', team: '大客户部', updatedAt: '2026-10-09T00:00:00.000Z', sender: { name: '李娜', phone: '13800138000', province: '广东省', city: '广州市', county: '天河区', address: '销售路88号' } }

const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); localStorage.clear(); window.location.hash = '' })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('sales shipping portal', () => {
  it('submits a Fxiaoke proposal as an owned pending order, not an anonymous order', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ orderNo: 'SO-FX-001', status: 'awaiting_confirmation', waybill: null }), { status: 202 }))
    render(<FxiaokeShippingProposal sender={employee.sender} name="李娜" phone="13800138000" rules={{companyName:{enabled:true,required:true,minLength:4},team:{enabled:true,required:true,minLength:1},teamOptions:[]}} services={[{id:2,name:'顺丰标快',preference:'standard'}]}/>)
    expect(screen.getByText('纷享身份已验证')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('所属团队'), { target: { value: '大客户部' } })
    fireEvent.change(screen.getByLabelText('客户公司名称'), { target: { value: '星河科技' } })
    fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: '张三 13900139000 广东省深圳市南山区科技路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
    fireEvent.click(screen.getByRole('button', { name: '预览工单' }))
    fireEvent.click(screen.getByRole('button', { name: '确认提交工单' }))
    expect(await screen.findByText('SO-FX-001')).toBeTruthy()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/shipping/owner/orders')
    expect(init.credentials).toBe('same-origin')
    const body = JSON.parse(init.body)
    expect(ownerOrderSchema.safeParse(body).success).toBe(true)
    expect(body).not.toHaveProperty('rawInput')
    expect(body).not.toHaveProperty('contextToken')
    expect(screen.queryByText('全部快递记录')).toBeNull()
  })
  it('collects customer and a dedicated optional special requirement', () => {
    render(<SalesRequestForm employee={employee} />)
    expect(screen.getByText('客户与收件信息')).toBeTruthy()
    expect(screen.getByText('物品与特殊需求')).toBeTruthy()
    expect(screen.getByPlaceholderText(/周五前送达/)).toBeTruthy()
  })
  it('submits the reporter customer and special requirement then shows the request number', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ orderNo: 'SO-20260923-ABC12345', status: 'awaiting_confirmation' }), { status: 202 }))
    render(<SalesRequestForm employee={employee} />)
    for (const [placeholder, value] of [['请填写公司名称，至少4个字符','星河科技']] as const) fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
    fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: '张三 13900139000 广东省深圳市南山区科技路1号' } }); fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
    fireEvent.change(screen.getByPlaceholderText(/周五前送达/), { target: { value: '样品易碎' } })
    fireEvent.click(screen.getByRole('button', { name: '预览工单' }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '寄出预览' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认提交工单' }))
    expect(await screen.findByText('SO-20260923-ABC12345')).toBeTruthy()
    const payload = JSON.parse(String(fetcher.mock.calls[0][1].body)); expect(payload.input).toMatchObject({ customerName: '星河科技', specialRequirements: '样品易碎', submittedBy: { name: '李娜', team: '大客户部' } })
    expect(payload.input.sender).toMatchObject({ name: '李娜', phone: '13800138000', province: '广东省', city: '广州市', county: '天河区', address: '销售路88号' })
    expect(payload.input).not.toHaveProperty('serviceId')
    expect(payload.input.servicePreference).toBe('standard')
    fireEvent.click(screen.getByRole('button', { name: '继续提报一票' }))
  })
  it('reuses the original workorder request after a lost response', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orderNo: 'SO-RECOVERED', status: 'awaiting_confirmation' }), { status: 202 }))
    render(<SalesRequestForm employee={employee} />)
    for (const [label, value] of [['请填写公司名称，至少4个字符','星河科技']] as const) fireEvent.change(screen.getByPlaceholderText(label), { target: { value } })
    fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: '张三 13900139000 广东省深圳市南山区科技路1号' } })
    fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
    fireEvent.click(screen.getByRole('button', { name: '预览工单' }))
    fireEvent.click(screen.getByRole('button', { name: '确认提交工单' }))
    fireEvent.click(await screen.findByRole('button', { name: '重取工单回执' }))
    expect(await screen.findByText('SO-RECOVERED')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body)
    expect(fetcher.mock.calls.every(call => call[0] === '/api/shipping/public/orders')).toBe(true)
  })

})


it('does not render a shipment form for an unidentified whitelist visitor', async () => {
 fetcher.mockImplementation(async (url:string)=>new Response(JSON.stringify(url.endsWith('/options')?{services:[],requireVerification:true,emailAvailable:false}:{employee:null})))
 render(<SalesPortal initialOptions={{services:[],requireVerification:true,emailAvailable:false}}/>)
 expect(screen.queryByText('客户与收件信息')).toBeNull()
 expect(await screen.findByRole('link',{name:'使用企业微信验证身份'})).toBeTruthy()
 expect(screen.queryByLabelText('公司邮箱')).toBeNull()
})

it('submits a complete anonymous workorder without asking for a code or saving a profile', async () => {
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/options')) return new Response(JSON.stringify({ services: [{ id: 6, name: '顺丰即日', preference: 'urgent' }], requireVerification: false, emailAvailable: false }))
    if (init?.method === 'POST') return new Response(JSON.stringify({ orderNo: 'SO-ANON', status: 'awaiting_confirmation', receiptToken: 'a'.repeat(43) }), { status: 202 })
    return new Response(JSON.stringify({ employee: null }))
  })
  render(<SalesPortal initialOptions={{services:[{id:6,name:'顺丰即日',preference:'urgent'}],requireVerification:false,emailAvailable:false}} />)
  await screen.findByLabelText('寄件人姓名')
  for (const [label, value] of [['寄件人姓名','李娜'],['寄件人联系电话','13800138000'],['寄件省份','广东省'],['寄件城市','广州市'],['寄件区县','天河区'],['详细寄件地址','销售路88号'],['所属团队','大客户部']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', {name:'使用此地址'}))
  fireEvent.change(screen.getByPlaceholderText('请填写公司名称，至少4个字符'), { target: { value: '匿名客户' } })
  fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: '张三 13900139000 广东省深圳市南山区科技路1号' } })
  fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
  await screen.findByText('开放提报')
  await waitFor(() => expect((screen.getByRole('button', { name: '预览工单' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '预览工单' })); fireEvent.click(screen.getByRole('button', { name: '确认提交工单' }))
  expect(await screen.findByText('SO-ANON')).toBeTruthy()
  const posts = fetcher.mock.calls.filter(call => call[1]?.method === 'POST')
  expect(posts).toHaveLength(1); expect(posts[0][0]).toBe('/api/shipping/public/orders')
  expect(JSON.parse(posts[0][1].body).input).toMatchObject({ serviceId: 6, sender: { name: '李娜' } })
  expect(posts[0][1].credentials).toBe('omit')
  expect(fetcher.mock.calls.some(([url])=>url==='/api/shipping/public/employee')).toBe(false)
  expect(screen.getByRole('button', { name: '复制查询链接' })).toBeTruthy()
})

 it('keeps customer editable and empty for a verified employee, separate from identity company', () => {
  render(<SalesRequestForm employee={{...employee,wecom:true,companyName:'员工所属企业'}}/>)
  expect(screen.getByLabelText('客户公司名称')).toHaveProperty('value','')
  expect(screen.getByLabelText('客户公司名称')).toHaveProperty('disabled',false)
  expect(screen.getByRole('complementary',{name:'提报记录'})).toBeTruthy()
 })

it('shows validation only after trying to preview, then focuses the first invalid field',()=>{
 render(<SalesRequestForm employee={employee}/>)
 expect(screen.queryByText(/收件电话：请填写/)).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'预览工单'}))
 expect(screen.getByRole('status').textContent).toContain('收件人')
 expect(document.activeElement).toBe(screen.getByRole('textbox',{name:/^收件人/}))
 expect(fetcher).not.toHaveBeenCalled()
})
it('requires another preview after the chosen pickup address changes',()=>{
 const {rerender}=render(<SalesRequestForm employee={employee}/>)
 fireEvent.change(screen.getByPlaceholderText('请填写公司名称，至少4个字符'),{target:{value:'星河科技'}})
 fireEvent.change(screen.getByLabelText('智能地址一键粘贴'),{target:{value:'张三 13900139000 广东省深圳市南山区科技路1号'}});fireEvent.click(screen.getByRole('button',{name:'识别并填充'}))
 fireEvent.click(screen.getByRole('button',{name:'预览工单'}))
 rerender(<SalesRequestForm employee={employee} draftSender={{...employee.sender,address:'新揽收地址66号'}}/>)
 expect(screen.queryByRole('region',{name:'寄出预览'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'预览工单'}))
 expect(screen.getByRole('region',{name:'寄出预览'}).textContent).toContain('新揽收地址66号')
 expect(fetcher).not.toHaveBeenCalled()
})

it('keeps the current shipment summary and records navigation for anonymous visitors',()=>{
 render(<SalesRequestForm employee={null} draftSender={employee.sender}/>)
 expect(screen.getByRole('region',{name:'本次寄件摘要'}).textContent).toContain(employee.sender.address)
 expect(screen.getByRole('complementary',{name:'提报记录'})).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'提报记录'}))
 expect(screen.getByRole('button',{name:'提报记录'}).getAttribute('aria-pressed')).toBe('true')
 fireEvent.change(screen.getByLabelText('收件人'),{target:{value:'摘要收件人'}})
 expect(screen.getByRole('region',{name:'本次寄件摘要'}).textContent).toContain('摘要收件人')
 expect(screen.queryByText('使用企业微信验证身份')).toBeNull()
})

it('keeps configured company requirements visible after typing and reports trimmed-length errors',()=>{
 render(<SalesRequestForm employee={employee} rules={{companyName:{enabled:true,required:true,minLength:4},team:{enabled:false,required:false,minLength:0},teamOptions:[]}}/>)
 const company=screen.getByLabelText('客户公司名称')
 expect(screen.getByText('必填 · 至少4个字符，最多120个字符（不计首尾空格）')).toBeTruthy()
 fireEvent.change(company,{target:{value:'  短名  '}});fireEvent.blur(company)
 expect(company.getAttribute('aria-invalid')).toBe('true');expect(screen.getByText('公司名称至少填写4个字符')).toBeTruthy()
 fireEvent.change(company,{target:{value:'有效客户名称'}})
 expect(company.getAttribute('aria-invalid')).toBe('false');expect(screen.queryByText('公司名称至少填写4个字符')).toBeNull()
 expect(screen.getByText('必填 · 至少4个字符，最多120个字符（不计首尾空格）')).toBeTruthy()
})

it('passes public company defaults into the anonymous form and retains visible company rules',async()=>{
 const options={services:[{id:2,name:'顺丰标快',preference:'standard' as const}],requireVerification:false,emailAvailable:false,companySender:employee.sender,rules:{companyName:{enabled:true,required:true,minLength:2},team:{enabled:false,required:false,minLength:0},teamOptions:[]}}
 fetcher.mockImplementation(async()=>new Response(JSON.stringify(options)))
 render(<SalesPortal initialOptions={options}/>)
 expect(screen.getByRole('radio',{name:/公司默认/})).toHaveProperty('checked',true)
 expect(screen.getByRole('region',{name:'本次寄件摘要'}).textContent).toContain(employee.sender.address)
 expect(screen.getByText('必填 · 至少2个字符，最多120个字符（不计首尾空格）')).toBeTruthy()
 await waitFor(()=>expect(fetcher).toHaveBeenCalled())
 expect(fetcher.mock.calls.every(([url])=>url==='/api/shipping/public/options')).toBe(true)
})
