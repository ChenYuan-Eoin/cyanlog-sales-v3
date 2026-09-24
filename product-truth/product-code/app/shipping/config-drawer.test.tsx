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

  it('does not offer a sandbox probe while editing production credentials', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: {
      connections: [
        { id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null },
        { id: 'production-1', carrier: 'sf', environment: 'production', partnerIdTail: '2468', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }
      ], billingAccounts: [], sender: null
    } }), { status: 200 }))
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    const probe = await screen.findByRole('button', { name: '测试沙盒连接' })
    expect(probe).toHaveProperty('disabled', false)

    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'production' } })

    expect(probe).toHaveProperty('disabled', true)
    expect(screen.getByText('当前编辑的是生产凭据；连接测试只验证已保存的沙盒凭据，切换到沙盒环境后可测试。')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
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
