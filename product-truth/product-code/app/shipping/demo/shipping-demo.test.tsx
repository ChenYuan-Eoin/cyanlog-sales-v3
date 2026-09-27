import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ShippingDemo from './shipping-demo'
import { createShippingSimulation } from '@/lib/shipping/simulation'

const fetcher = vi.fn(() => { throw new Error('A demo must never make a real request') })
beforeEach(() => { fetcher.mockClear(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('React', React) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('explicit shipping simulation', () => {
  it('demonstrates parsing, correction, batch orders, tracking and cancellation without network writes', async () => {
    render(<ShippingDemo />)
    expect(await screen.findByText('模拟：快件运输中')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('不向顺丰下单、不产生费用')
    expect(within(screen.getByRole('group', { name: '地址录入方式' })).getAllByRole('button').map(button => button.textContent)).toEqual(['文本解析', '文件导入'])
    expect(screen.getByRole('button', { name: '文本解析' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '解析为寄件行' }))
    expect(screen.getByRole('button', { name: '模拟批量下单（3票）' })).toBeTruthy()
    expect(screen.getByText('手机号需为11位')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('第4行联系电话'), { target: { value: '13700000004' } })
    fireEvent.click(screen.getByRole('button', { name: '模拟批量下单（4票）' }))
    expect(await screen.findByText(/模拟完成 4 票/)).toBeTruthy()
    expect(screen.getAllByText('DEMO-000005').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: '查询轨迹' }))
    expect(await screen.findByText('模拟：已生成示例运单，等待揽收')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '模拟取消运单' }))
    expect(await screen.findByText('模拟运单已取消，没有操作真实运单。')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已取消' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '模拟取消运单' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查询轨迹' }))
    expect(await screen.findByText('模拟：取消已确认')).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('demonstrates the pending sales confirmation and resets only local example state', async () => {
    render(<ShippingDemo />)
    await screen.findByText('模拟：快件运输中')
    fireEvent.click(screen.getByText('演示客户·北京'))
    fireEvent.click(screen.getByRole('button', { name: '模拟确认下单' }))
    expect(await screen.findByText('模拟确认下单，单据状态已更新。')).toBeTruthy()
    expect(screen.getAllByText('DEMO-000005').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '重置演示' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '模拟确认下单' })).toBeTruthy())
    expect(screen.queryByText('DEMO-000005')).toBeNull()
    expect(screen.queryByLabelText('第1行收件人')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects real waybills and unknown routes instead of falling back to fetch', async () => {
    const request = createShippingSimulation()
    await expect(request('/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })).rejects.toThrow('DEMO-')
    await expect(request('/api/shipping/settings', { method: 'POST', body: '{}' })).rejects.toThrow('示例单据')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
