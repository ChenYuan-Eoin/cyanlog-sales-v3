import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShippingConfigDrawer from './config-drawer'

vi.mock('./email-configuration', () => ({ default: () => <section aria-label="员工邮箱验证配置">员工提报与邮箱验证</section> }))
const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 }))
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('shipping configuration drawer', () => {
  it('shows a clear permission message instead of an editable blank form to operators', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ navigationAvailable: true }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    expect(await screen.findByText('当前账号可以办理寄件，但没有寄件配置管理权限。')).toBeTruthy()
    expect(screen.queryByLabelText('应用编号')).toBeNull()
    expect(screen.getByRole('link', { name: '返回自助收寄工作台' }).getAttribute('href')).toBe('/shipping')
  })

  it('renders inline in Config Center without opening a modal or adding a screen overlay', async () => {
    render(<ShippingConfigDrawer embedded />)
    expect(await screen.findByRole('region', { name: '寄件设置' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '关闭寄件配置' })).toBeNull()
    expect(screen.getByLabelText('应用编号')).toBeTruthy()
  })

  it('migrates the existing operator list into org-scoped permissions without exposing IDs', async () => {
    const operatorId = '11111111-1111-4111-8111-111111111111'
    const legacyAccess = { operators: [{ id: operatorId, name: '寄件同事', enabled: true, canOperate: true, grantSource: 'legacy' as const }], legacyImportAvailable: true, legacyImportCompleted: false }
    const migratedAccess = { operators: [{ ...legacyAccess.operators[0], grantSource: 'database' as const }], legacyImportAvailable: false, legacyImportCompleted: true }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { importedCount: 1, operatorAccess: migratedAccess } : { configuration: { connections: [], billingAccounts: [], sender: null }, operatorAccess: legacyAccess }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    fireEvent.click(await screen.findByRole('button', { name: '迁移当前寄件名单' }))
    expect(await screen.findByText(/已将当前环境中原有的 1 个寄件授权迁入组织权限/)).toBeTruthy()
    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ action: 'import_legacy_operator_access' })
    expect(screen.getByRole('checkbox', { name: '寄件同事' })).toHaveProperty('checked', true)
  })

  it('saves operator access as organization-scoped permission assignments', async () => {
    const operatorId = '11111111-1111-4111-8111-111111111111'
    const operatorAccess = { operators: [{ id: operatorId, name: '寄件同事', enabled: true, canOperate: false, grantSource: 'none' as const }], legacyImportAvailable: false, legacyImportCompleted: true }
    const savedAccess = { ...operatorAccess, operators: [{ ...operatorAccess.operators[0], canOperate: true, grantSource: 'database' as const }] }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { operatorAccess: savedAccess } : { configuration: { connections: [], billingAccounts: [], sender: null }, operatorAccess }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '寄件同事' }))
    fireEvent.click(screen.getByRole('button', { name: '保存确认人员权限' }))
    expect(await screen.findByText('寄件操作权限已保存。')).toBeTruthy()
    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ action: 'save_operator_access', userIds: [operatorId] })
  })

  it('migrates legacy service/account configuration server-side without returning its source values', async () => {
    const legacyConfiguration = { connections: [{ id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }], billingAccounts: [], sender: null }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
      ? { ...{ configuration: legacyConfiguration, legacyConfigurationAvailable: { sandbox: false, production: false } }, imported: ['顺丰机器连接（服务端加密）', '已授权服务产品'], needsAttention: [] }
      : { configuration: { connections: [], billingAccounts: [], sender: null }, legacyConfigurationAvailable: { sandbox: true, production: false } }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } }); fireEvent.click(await screen.findByRole('button', { name: '迁入旧沙盒配置' }))
    expect(await screen.findByText(/已迁入：顺丰机器连接（服务端加密）、已授权服务产品/)).toBeTruthy()
    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ action: 'import_legacy_configuration', environment: 'sandbox' })
  })

  it('migrates the existing operator list into org-scoped database permissions without exposing IDs', async () => {
    const legacyAccess = { operators: [{ id: '11111111-1111-4111-8111-111111111111', name: '寄件同事', enabled: true, canOperate: true, grantSource: 'legacy' as const }], legacyImportAvailable: true, legacyImportCompleted: false }
    const migratedAccess = { operators: [{ ...legacyAccess.operators[0], grantSource: 'database' as const }], legacyImportAvailable: false, legacyImportCompleted: true }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { importedCount: 1, operatorAccess: migratedAccess } : { configuration: { connections: [], billingAccounts: [], sender: null }, operatorAccess: legacyAccess }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    fireEvent.click(await screen.findByRole('button', { name: '迁移当前寄件名单' }))
    expect(await screen.findByText(/已将当前环境中原有的 1 个寄件授权迁入组织权限/)).toBeTruthy()
    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ action: 'import_legacy_operator_access' })
    expect(screen.getByRole('checkbox', { name: '寄件同事' })).toHaveProperty('checked', true)
  })

  it('saves authorized members only to the current organization permission endpoint', async () => {
    const access = { operators: [{ id: '11111111-1111-4111-8111-111111111111', name: '寄件同事', enabled: true, canOperate: false, grantSource: 'none' as const }], legacyImportAvailable: false, legacyImportCompleted: true }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { operatorAccess: { ...access, operators: [{ ...access.operators[0], canOperate: true, grantSource: 'database' }] } } : { configuration: { connections: [], billingAccounts: [], sender: null }, operatorAccess: access }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '寄件同事' }))
    fireEvent.click(screen.getByRole('button', { name: '保存确认人员权限' }))
    expect(await screen.findByText('寄件操作权限已保存。')).toBeTruthy()
    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ action: 'save_operator_access', userIds: ['11111111-1111-4111-8111-111111111111'] })
  })

  it('shows server-only credentials and masked account controls without exposing stored values', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: {
      connections: [{ id: 'conn-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }],
      billingAccounts: [{ id: 'acct-1', connectionId: 'conn-1', environment: 'sandbox', displayName: '企业月结', tail: '5616', status: 'active', isDefault: true }], sender: null
    } }), { status: 200 }))
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    expect(await screen.findByText(/沙盒 · 尾号 5616 · 可用 · 默认/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
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
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } })
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
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } })
    fireEvent.change(screen.getByLabelText('顺丰服务产品'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '添加服务' }))
    fireEvent.click(screen.getByRole('button', { name: '保存可提报服务' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const [, request] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({ action: 'save_authorized_services', environment: 'sandbox', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }, { id: 1, name: '顺丰特快', preference: 'urgent' }, { id: 6, name: '顺丰即日', preference: 'urgent' }] })
    expect(screen.getByLabelText('应用编号')).toHaveProperty('value', '')
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
  })

  it('saves connection credentials only through the server route and clears the secret field', async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 })
      return new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 })
    })
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    fireEvent.change(await screen.findByLabelText('应用编号'), { target: { value: 'partner-8391' } })
    fireEvent.change(screen.getByLabelText('应用密钥'), { target: { value: 'check-word-private' } })
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/shipping/settings', expect.objectContaining({ method: 'POST' })))
    expect(String(fetcher.mock.calls[1][1].body)).toContain('check-word-private')
    await waitFor(() => expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', ''))
  })
})

it('shows connection validation in the viewport feedback before the long configuration form', async () => {
  fetcher.mockResolvedValue(Response.json({ configuration: { connections: [], billingAccounts: [], sender: null } }))
  render(<ShippingConfigDrawer embedded/>)
  fireEvent.click(await screen.findByRole('button', { name: '保存连接' }))
  const status = screen.getByText('请展开“首次接入 / 更换应用凭据”，填写应用编号和应用密钥。')
  expect(status.getAttribute('role')).toBe('status')
  expect(status.className).toContain('feedback')
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
