import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShippingConfigDrawer from './config-drawer'

const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 }))
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('shipping configuration drawer', () => {
  it('shows server-only credentials and masked account controls without exposing stored values', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: {
      connections: [{ id: 'conn-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }],
      billingAccounts: [{ id: 'acct-1', connectionId: 'conn-1', environment: 'sandbox', displayName: '企业月结', tail: '5616', status: 'active', isDefault: true }], sender: null
    } }), { status: 200 }))
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    expect(await screen.findByText(/沙盒 · 尾号 5616 · 可用 · 默认/)).toBeTruthy()
    expect(screen.getByLabelText('CheckWord')).toHaveProperty('value', '')
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '')
    expect(screen.getByText(/尾号 8391/)).toBeTruthy()
  })

  it('runs a read-only test for the selected environment and keeps Production order capability separate', async () => {
    const configuration = {
      connections: [
        { id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null },
        { id: 'production-1', carrier: 'sf', environment: 'production', partnerIdTail: '2468', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }
      ], billingAccounts: [], sender: null
    }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ configuration, probe: { connected: true, queryVerified: true, message: '顺丰生产OAuth2认证及只读API连通通过；未创建运单。生产下单能力仍需由操作员核对每票收寄资料与费用后实测。' } }), { status: 200 })
      return new Response(JSON.stringify({ configuration }), { status: 200 })
    })
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    expect(await screen.findByRole('button', { name: '测试沙盒连接' })).toHaveProperty('disabled', false)

    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'production' } })

    expect(screen.queryByRole('button', { name: '测试沙盒连接' })).toBeNull()
    const productionProbe = screen.getByRole('button', { name: '测试生产连接（只读）' })
    expect(productionProbe).toHaveProperty('disabled', false)
    expect(screen.getByText('生产连接测试只调用只读订单查询，不创建运单，也不证明生产下单权限。首票实际寄件仍需操作员逐票核对资料与费用后确认。')).toBeTruthy()
    fireEvent.click(productionProbe)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const [, request] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({ action: 'test_production_connection' })
  })

  it('updates authorized services without asking for saved machine credentials again', async () => {
    const connection = { id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'connected', services: [], capabilities: { order: 'not_tested', query: 'verified', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ configuration: { connections: [{ ...connection, services: [{ id: 2, name: '顺丰标快', preference: 'standard' }] }], billingAccounts: [], sender: null } }), { status: 200 })
      return new Response(JSON.stringify({ configuration: { connections: [connection], billingAccounts: [], sender: null } }), { status: 200 })
    })
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    fireEvent.change(await screen.findByLabelText('服务编号'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: '顺丰标快' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('button', { name: '保存授权服务' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const [, request] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({ action: 'save_authorized_services', environment: 'sandbox', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }] })
    expect(screen.getByLabelText('PartnerID')).toHaveProperty('value', '')
    expect(screen.getByLabelText('CheckWord')).toHaveProperty('value', '')
  })

  it('saves connection credentials only through the server route and clears the secret field', async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 })
      return new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 })
    })
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    fireEvent.change(await screen.findByLabelText('PartnerID'), { target: { value: 'partner-8391' } })
    fireEvent.change(screen.getByLabelText('CheckWord'), { target: { value: 'check-word-private' } })
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/shipping/settings', expect.objectContaining({ method: 'POST' })))
    expect(String(fetcher.mock.calls[1][1].body)).toContain('check-word-private')
    await waitFor(() => expect(screen.getByLabelText('CheckWord')).toHaveProperty('value', ''))
  })
})
