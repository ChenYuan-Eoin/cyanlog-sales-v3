import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SalesPortal, { SalesRequestForm } from './portal'
const employee = { id: 'employee-1', email: 'person@ones.cn', team: '大客户部', updatedAt: '2026-10-09T00:00:00.000Z', sender: { name: '李娜', phone: '13800138000', province: '广东省', city: '广州市', county: '天河区', address: '销售路88号' } }

const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); localStorage.clear(); window.location.hash = '' })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('sales shipping portal', () => {
  it('collects customer and a dedicated optional special requirement', () => {
    render(<SalesRequestForm employee={employee} />)
    expect(screen.getByText('客户与收件信息')).toBeTruthy()
    expect(screen.getByText('物品与特殊需求')).toBeTruthy()
    expect(screen.getByPlaceholderText(/周五前送达/)).toBeTruthy()
  })
  it('submits the reporter customer and special requirement then shows the request number', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ orderNo: 'SO-20260923-ABC12345', status: 'awaiting_confirmation' }), { status: 202 }))
    render(<SalesRequestForm employee={employee} />)
    for (const [placeholder, value] of [['公司或项目客户名称','星河科技']] as const) fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
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
    for (const [label, value] of [['公司或项目客户名称','星河科技']] as const) fireEvent.change(screen.getByPlaceholderText(label), { target: { value } })
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


describe('single-page anonymous intake', () => {
  const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
  it('shows the complete form before email verification and preserves the draft through verification and profile saving', async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (_url.endsWith('/options')) return reply({ services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], requireVerification: true, emailAvailable: true })
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (!body) return reply({ employee: null, orders: [] })
      if (body.action === 'request_code') return reply({ challengeId: 'challenge-1', delivery: 'accepted' })
      if (body.action === 'verify_code') return reply({ employee: { ...employee, sender: null, team: '' } })
      if (body.action === 'save_profile') return reply({ employee: { ...employee, sender: body.profile.sender, team: body.profile.team } })
      if (body.action === 'logout') return reply({ employee: null })
      throw new Error('unexpected request')
    })
    render(<SalesPortal />)
    expect(screen.getByText('客户与收件信息')).toBeTruthy()
    expect(screen.getByText('物品与特殊需求')).toBeTruthy()
    expect((screen.getByRole('button', { name: '预览工单' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('公司或项目客户名称'), { target: { value: '验证前填写的客户' } })
    for (const [label, value] of [['寄件人姓名','李娜'],['寄件人联系电话','13800138000'],['寄件省份','广东省'],['寄件城市','广州市'],['寄件区县','天河区'],['详细寄件地址','销售路88号'],['所属团队','大客户部']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.change(await screen.findByLabelText('公司邮箱'), { target: { value: 'person@ones.cn' } })
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    fireEvent.change(await screen.findByLabelText('邮箱验证码'), { target: { value: '012345' } })
    fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }))
    await screen.findByText('person@ones.cn · 已验证')
    expect((screen.getByLabelText('寄件人姓名') as HTMLInputElement).value).toBe('李娜')
    expect((screen.getByPlaceholderText('公司或项目客户名称') as HTMLInputElement).value).toBe('验证前填写的客户')
    await waitFor(() => expect((screen.getByRole('button', { name: '预览工单' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '保存寄件资料' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '预览工单' }) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByPlaceholderText('公司或项目客户名称') as HTMLInputElement).value).toBe('验证前填写的客户')
    expect(fetcher.mock.calls.some(call => call[0] === '/api/shipping/public/orders')).toBe(false)
    expect(document.querySelector('form form')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '退出 / 换人' }))
    await screen.findByLabelText('公司邮箱')
    expect((screen.getByPlaceholderText('公司或项目客户名称') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: '预览工单' }) as HTMLButtonElement).disabled).toBe(true)
  })
})


it('submits a complete anonymous workorder without asking for a code or saving a profile', async () => {
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/options')) return new Response(JSON.stringify({ services: [{ id: 6, name: '顺丰即日', preference: 'urgent' }], requireVerification: false, emailAvailable: false }))
    if (init?.method === 'POST') return new Response(JSON.stringify({ orderNo: 'SO-ANON', status: 'awaiting_confirmation', receiptToken: 'a'.repeat(43) }), { status: 202 })
    return new Response(JSON.stringify({ employee: null }))
  })
  render(<SalesPortal />)
  for (const [label, value] of [['寄件人姓名','李娜'],['寄件人联系电话','13800138000'],['寄件省份','广东省'],['寄件城市','广州市'],['寄件区县','天河区'],['详细寄件地址','销售路88号'],['所属团队','大客户部']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.change(screen.getByPlaceholderText('公司或项目客户名称'), { target: { value: '匿名客户' } })
  fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: '张三 13900139000 广东省深圳市南山区科技路1号' } })
  fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
  await screen.findByText('邮箱验证尚未启用，不影响匿名提报。')
  await waitFor(() => expect((screen.getByRole('button', { name: '预览工单' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '预览工单' })); fireEvent.click(screen.getByRole('button', { name: '确认提交工单' }))
  expect(await screen.findByText('SO-ANON')).toBeTruthy()
  const posts = fetcher.mock.calls.filter(call => call[1]?.method === 'POST')
  expect(posts).toHaveLength(1); expect(posts[0][0]).toBe('/api/shipping/public/orders')
  expect(JSON.parse(posts[0][1].body).input).toMatchObject({ serviceId: 6, sender: { name: '李娜' } })
  expect(screen.getByRole('button', { name: '复制查询链接' })).toBeTruthy()
})
