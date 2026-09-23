import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SalesPortal from './portal'

const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('React', React); vi.stubGlobal('fetch', fetcher); fetcher.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('sales shipping portal', () => {
  it('collects customer and a dedicated optional special requirement', () => {
    render(<SalesPortal services={[{ id: 2, name: '顺丰标快' }]}/>)
    expect(screen.getByText('客户与收件信息')).toBeTruthy()
    expect(screen.getByText('物品与特殊需求')).toBeTruthy()
    expect(screen.getByPlaceholderText(/周五前送达/)).toBeTruthy()
  })
  it('submits the reporter customer and special requirement then shows the request number', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ orderNo: 'SO-20260923-ABC12345', status: 'awaiting_confirmation' }), { status: 202 }))
    render(<SalesPortal services={[{ id: 2, name: '顺丰标快' }]}/>)
    for (const [placeholder, value] of [['你的姓名','李娜'],['11位手机号','13800138000'],['如：华南销售部','大客户部'],['公司或项目客户名称','星河科技']] as const) fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
    fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: '张三 13900139000 广东省深圳市南山区科技路1号' } }); fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
    fireEvent.change(screen.getByPlaceholderText(/周五前送达/), { target: { value: '样品易碎' } })
    fireEvent.click(screen.getByRole('button', { name: /提交寄件需求/ }))
    expect(await screen.findByText('SO-20260923-ABC12345')).toBeTruthy()
    const payload = JSON.parse(String(fetcher.mock.calls[0][1].body)); expect(payload.input).toMatchObject({ customerName: '星河科技', specialRequirements: '样品易碎', submittedBy: { name: '李娜', team: '大客户部' } })
    expect(payload.input.sender).toBeUndefined()
  })
})
