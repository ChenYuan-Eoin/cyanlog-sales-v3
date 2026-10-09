import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SalesRequestForm } from './portal'
const employee = { id: 'employee-1', email: 'person@ones.cn', team: '大客户部', updatedAt: '2026-10-09T00:00:00.000Z', sender: { name: '李娜', phone: '13800138000', province: '广东省', city: '广州市', county: '天河区', address: '销售路88号' } }

const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset() })
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
