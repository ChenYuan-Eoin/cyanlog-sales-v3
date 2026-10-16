import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

async function openSection(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }))
}

describe('shipping configuration drawer', () => {
  it('references organization permissions without another editable employee list', async () => {
    fetcher.mockResolvedValue(Response.json({configuration:{connections:[],billingAccounts:[],sender:null},operatorAccess:{operators:[{id:'staff',name:'寄件同事',enabled:true,canOperate:true}],legacyImportAvailable:false}}))
    render(<ShippingConfigDrawer embedded />)
    await openSection('企业接入')
    expect(screen.getByRole('link',{name:'查看组织与权限 →'}).getAttribute('href')).toBe('/configs?tab=role-access')
    expect(screen.queryByRole('checkbox',{name:'寄件同事'})).toBeNull()
    expect(screen.queryByRole('button',{name:'保存确认人员权限'})).toBeNull()
    expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false)
  })
  it('retains a visible legacy-access notice without silently migrating grants', async () => {
    fetcher.mockResolvedValue(Response.json({configuration:{connections:[],billingAccounts:[],sender:null},operatorAccess:{operators:[],legacyImportAvailable:true}}))
    render(<ShippingConfigDrawer embedded />)
    await openSection('企业接入')
    expect(screen.getByText(/仍有历史授权待迁移/)).toBeTruthy()
    expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false)
  })

  it('distinguishes the preview site from the carrier production selector', async () => {
    fetcher.mockImplementation(async () => Response.json({ deploymentEnvironment: 'preview', configuration: { connections: [], billingAccounts: [], sender: null } }))
    render(<ShippingConfigDrawer embedded />)
    await openSection('月结账号')
    expect(screen.getByText('当前站点：预览环境')).toBeTruthy()
    expect(screen.getByLabelText('运行环境')).toHaveProperty('value', 'production')
    expect(screen.getByText(/不代表正式站账号缺失/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /前往正式站/ }).getAttribute('href')).toBe('https://sales.cyanlog.icu/configs?tab=shipping')
  })

  it('keeps the existing account and draft after a missing-key save failure', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: '寄件凭据加密密钥尚未配置。' }, { status: 503 })
      : Response.json({ deploymentEnvironment: 'production', configuration: { connections: [], sender: null, billingAccounts: [{ id: 'p', environment: 'production', displayName: '原有月结', tail: '5616', status: 'active', isDefault: true }] } }))
    render(<ShippingConfigDrawer embedded />)
    await openSection('月结账号')
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    await screen.findByText('寄件凭据加密密钥尚未配置。')
    expect(screen.getByText('原有月结')).toBeTruthy()
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '123456789')
    expect(screen.getByText(/本次保存未确认成功/)).toBeTruthy()
    expect(screen.queryByText(/尚未保存月结账号/)).toBeNull()
  })

  it('does not present an empty editable account list when configuration loading fails', async () => {
    fetcher.mockImplementation(async () => Response.json({ error: '寄件配置读取失败。' }, { status: 503 }))
    render(<ShippingConfigDrawer embedded />)
    await screen.findByRole('heading', { name: '寄件配置不可用' })
    expect(screen.queryByRole('button', { name: '保存月结账号' })).toBeNull()
    expect(screen.queryByText(/尚未保存月结账号/)).toBeNull()
  })
  it('opens on overview and keeps sender drafts when changing sections', async () => {
    render(<ShippingConfigDrawer embedded />)
    await screen.findByRole('region', { name: '接入总览内容' })
    expect(screen.queryByRole('button', { name: '保存连接' })).toBeNull()
    await openSection('默认寄件人')
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '未保存的寄件人' } })
    await openSection('企业接入')
    await openSection('默认寄件人')
    expect(screen.getByLabelText('姓名')).toHaveProperty('value', '未保存的寄件人')
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('isolates account lists and clears sensitive unsaved values on environment change', async () => {
    fetcher.mockResolvedValue(Response.json({ configuration: { connections: [], sender: null, billingAccounts: [
      { id: 'p', environment: 'production', displayName: '生产月结', tail: '0001', status: 'active', isDefault: true },
      { id: 's', environment: 'sandbox', displayName: '沙盒月结', tail: '0002', status: 'active', isDefault: true },
    ] } }))
    render(<ShippingConfigDrawer embedded />)
    await openSection('月结账号')
    expect(screen.queryByText('沙盒月结')).toBeNull()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    await openSection('顺丰与接口')
    fireEvent.change(screen.getByLabelText('应用密钥'), { target: { value: 'draft-secret' } })
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
    await openSection('月结账号')
    expect(screen.getByText('沙盒月结')).toBeTruthy()
    expect(screen.queryByText('生产月结')).toBeNull()
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '')
  })

  it('preserves unsaved service changes after a different configuration is saved', async () => {
    const configuration = { connections: [{ id: 'p', carrier: 'sf', environment: 'production', partnerIdTail: '0001', status: 'connected', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], capabilities: {} }], billingAccounts: [], sender: null }
    fetcher.mockImplementation(async () => Response.json({ configuration }))
    render(<ShippingConfigDrawer embedded />)
    await openSection('顺丰与接口')
    fireEvent.change(screen.getByLabelText('顺丰服务产品'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '添加服务' }))
    await openSection('月结账号')
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    await screen.findByText('月结账号已保存。')
    await openSection('顺丰与接口')
    expect(screen.getByRole('button', { name: '移除顺丰即日' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(screen.queryByRole('button', { name: '移除顺丰即日' })).toBeNull()
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'production' } })
    expect(screen.getByRole('button', { name: '移除顺丰即日' })).toBeTruthy()
  })

  it('retains entered account after save rejection and never reports a successful save', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: '月结账号未通过校验' }, { status: 400 })
      : Response.json({ configuration: { connections: [], billingAccounts: [], sender: null } }))
    render(<ShippingConfigDrawer embedded />)
    await openSection('月结账号')
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    expect(await screen.findByText('月结账号未通过校验')).toBeTruthy()
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '123456789')
    expect(screen.queryByText('月结账号已保存。')).toBeNull()
  })

  it('does not invent callback health when the settings endpoint has no evidence', async () => {
    render(<ShippingConfigDrawer embedded />)
    await openSection('状态同步')
    expect(screen.getByRole('heading', { name: '自动同步尚不能由本页确认' })).toBeTruthy()
    expect(screen.getByText('接收状态待接入')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /开启推送|自动同步|提交上线/ })).toBeNull()
  })
  it('shows a clear permission message instead of an editable blank form to operators', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ navigationAvailable: true }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    expect(await screen.findByText('当前账号可以办理寄件，但没有寄件配置管理权限。')).toBeTruthy()
    expect(screen.queryByLabelText('应用编号')).toBeNull()
    expect(screen.getByRole('link', { name: '返回自助收寄工作台' }).getAttribute('href')).toBe('/shipping')
  })

  it('renders inline in Config Center without opening a modal or adding a screen overlay', async () => {
    render(<ShippingConfigDrawer embedded />)
    await openSection('顺丰与接口')
    expect(await screen.findByRole('region', { name: '寄件设置' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '关闭寄件配置' })).toBeNull()
    expect(screen.getByLabelText('应用编号')).toBeTruthy()
  })



  it('migrates legacy service/account configuration server-side without returning its source values', async () => {
    const legacyConfiguration = { connections: [{ id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }], billingAccounts: [], sender: null }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
      ? { ...{ configuration: legacyConfiguration, legacyConfigurationAvailable: { sandbox: false, production: false } }, imported: ['顺丰机器连接（服务端加密）', '已授权服务产品'], needsAttention: [] }
      : { configuration: { connections: [], billingAccounts: [], sender: null }, legacyConfigurationAvailable: { sandbox: true, production: false } }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    await openSection('顺丰与接口')
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } }); fireEvent.click(await screen.findByRole('button', { name: '迁入旧沙盒配置' }))
    expect(await screen.findByText(/已迁入：顺丰机器连接（服务端加密）、已授权服务产品/)).toBeTruthy()
    const postCall = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ action: 'import_legacy_configuration', environment: 'sandbox' })
  })



  it('shows server-only credentials and masked account controls without exposing stored values', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: {
      connections: [{ id: 'conn-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }],
      billingAccounts: [{ id: 'acct-1', connectionId: 'conn-1', environment: 'sandbox', displayName: '企业月结', tail: '5616', status: 'active', isDefault: true }], sender: null
    } }), { status: 200 }))
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    await openSection('顺丰与接口')
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    await openSection('月结账号')
    expect(await screen.findByText(/沙盒 · 尾号 5616 · 可用 · 默认/)).toBeTruthy()
    await openSection('顺丰与接口')
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '')
    expect(within(screen.getByRole('region', { name: '顺丰与接口内容' })).getByText('尾号 8391')).toBeTruthy()
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
    await openSection('顺丰与接口')
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(await screen.findByRole('button', { name: '测试沙盒连接' })).toHaveProperty('disabled', false)

    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'production' } })

    expect(screen.queryByRole('button', { name: '测试沙盒连接' })).toBeNull()
    const productionProbe = screen.getByRole('button', { name: '测试生产连接（只读）' })
    expect(productionProbe).toHaveProperty('disabled', false)
    expect(screen.getByText('生产连接测试只调用只读订单查询，不创建运单，也不证明生产下单权限。首票实际寄件仍需操作员逐票核对资料与费用后确认。')).toBeTruthy()
    fireEvent.click(productionProbe)
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, request] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST') as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({ action: 'test_production_connection' })
  })

  it('updates authorized services without asking for saved machine credentials again', async () => {
    const connection = { id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'connected', services: [], capabilities: { order: 'not_tested', query: 'verified', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ configuration: { connections: [{ ...connection, services: [{ id: 2, name: '顺丰标快', preference: 'standard' }] }], billingAccounts: [], sender: null } }), { status: 200 })
      return new Response(JSON.stringify({ configuration: { connections: [connection], billingAccounts: [], sender: null } }), { status: 200 })
    })
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    await openSection('顺丰与接口')
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } })
    fireEvent.change(screen.getByLabelText('顺丰服务产品'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '添加服务' }))
    fireEvent.click(screen.getByRole('button', { name: '保存可提报服务' }))

    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, request] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST') as [string, RequestInit]
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
    await openSection('顺丰与接口')
    fireEvent.change(await screen.findByLabelText('应用编号'), { target: { value: 'partner-8391' } })
    fireEvent.change(screen.getByLabelText('应用密钥'), { target: { value: 'check-word-private' } })
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/shipping/settings', expect.objectContaining({ method: 'POST' })))
    expect(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[1].body)).toContain('check-word-private')
    await waitFor(() => expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', ''))
  })
})

it('shows connection validation in the viewport feedback before the long configuration form', async () => {
  fetcher.mockResolvedValue(Response.json({ configuration: { connections: [], billingAccounts: [], sender: null } }))
  render(<ShippingConfigDrawer embedded/>)
    await openSection('顺丰与接口')
  fireEvent.click(await screen.findByRole('button', { name: '保存连接' }))
  const status = screen.getByText('请展开“首次接入 / 更换应用凭据”，填写应用编号和应用密钥。')
  expect(status.getAttribute('role')).toBe('status')
  expect(status.className).toContain('feedback')
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
