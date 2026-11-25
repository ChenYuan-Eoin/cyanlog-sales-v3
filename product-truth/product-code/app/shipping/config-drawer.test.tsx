import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ShippingConfigDrawer from './config-drawer'
import { DEFAULT_INTAKE_RULES } from '@/lib/shipping/intake-rules'

const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  fetcher.mockResolvedValue(new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 }))
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function waitForConfiguration() {
  await screen.findByRole('region', { name: '顺丰接入内容' })
}

describe('shipping configuration drawer', () => {
  it('shows a settings viewer the saved sections without any save controls', async () => {
    fetcher.mockImplementation(async (url: string) => url.includes('intake-settings')
      ? Response.json({ rules: DEFAULT_INTAKE_RULES, departments: [] })
      : Response.json({ permissions: ['shipping:settings_view'], configuration: { connections: [], billingAccounts: [], sender: null } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.getByRole('heading', { name: '公司默认寄件人' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /保存连接|保存月结账号|保存可提报服务|保存寄件人信息/ })).toBeNull()
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })


  it('delegates operator assignment to the existing role center without a member picker', async () => {
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    fireEvent.click(screen.getByText('审核与下单权限'))
    expect(screen.queryByRole('group', { name: '操作员名单' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存操作员授权' })).toBeNull()
    expect(screen.getByRole('link', { name: '前往组织与权限配置角色' }).getAttribute('href')).toBe('/configs?tab=role-access')
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })
  it('keeps department authorization inside permissions and company rules separate', async () => {
    fetcher.mockImplementation(async (url: string) => url.includes('intake-settings')
      ? Response.json({ rules: DEFAULT_INTAKE_RULES, departments: [{id:'root',name:'总部',path:'总部',parentId:null}] })
      : Response.json({ configuration:{connections:[],billingAccounts:[],sender:null},operatorAccess:{operators:[],legacyImportAvailable:false} }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    const permissions=screen.getByText('审核与下单权限').closest('details')!
    const rules=screen.getByText('寄件提报规则').closest('details')!
    expect(await within(permissions).findByRole('radio',{name:'全部有效部门'})).toBeTruthy()
    expect(within(rules).queryByRole('radio',{name:'全部有效部门'})).toBeNull()
    expect(within(rules).getByLabelText('公司名称最少字数')).toBeTruthy()
  })
  it('distinguishes the preview site from the carrier production selector', async () => {
    fetcher.mockImplementation(async () => Response.json({ deploymentEnvironment: 'preview', configuration: { connections: [], billingAccounts: [], sender: null } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.getByText('当前站点：预览环境')).toBeTruthy()
    expect(screen.getByLabelText('运行环境')).toHaveProperty('value', 'production')
    expect(screen.getByText(/不代表正式站账号缺失/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /前往正式站/ }).getAttribute('href')).toBe('https://sales.cyanlog.icu/configs?tab=shipping')
  })

  it('uses dedicated settings and a reachable home for a standalone manager', async () => {
    render(<ShippingConfigDrawer embedded standaloneReturn="/" />)
    await waitForConfiguration()
    expect(screen.getByRole('link', { name: /前往正式站/ }).getAttribute('href')).toBe('https://sales.cyanlog.icu/shipping/settings')
    expect(screen.getByRole('link', { name: /返回工作台/ }).getAttribute('href')).toBe('/')
    fireEvent.click(screen.getByText('审核与下单权限'))
    expect(screen.getByText(/由组织管理员在“组织与权限”中/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: '前往组织与权限配置角色' })).toBeNull()
  })

  it('discards visible configuration and form drafts when the live write gate denies access', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: '需要寄件连接管理权限。' }, { status: 403 })
      : Response.json({ configuration: { connections: [], sender: null, billingAccounts: [{ id: 'p', environment: 'production', displayName: '原有月结', tail: '5616', status: 'active', isDefault: true }] } }))
    render(<ShippingConfigDrawer embedded standaloneReturn="/" />)
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    await screen.findByText('需要寄件连接管理权限。')
    expect(screen.queryByText('原有月结')).toBeNull()
    expect(screen.queryByLabelText('月结卡号')).toBeNull()
    expect(screen.getByRole('link', { name: '返回工作台' }).getAttribute('href')).toBe('/')
  })

  it('keeps the existing account and draft after a missing-key save failure', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: '寄件凭据加密密钥尚未配置。' }, { status: 503 })
      : Response.json({ deploymentEnvironment: 'production', configuration: { connections: [], sender: null, billingAccounts: [{ id: 'p', environment: 'production', displayName: '原有月结', tail: '5616', status: 'active', isDefault: true }] } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    await screen.findByText('寄件凭据加密密钥尚未配置。')
    expect(screen.getByText('原有月结')).toBeTruthy()
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '123456789')
    expect(screen.getByText(/本次保存未确认成功/)).toBeTruthy()
    expect(screen.queryByText(/尚未保存月结账号/)).toBeNull()
  })

  it('disables encrypted saves when storage is unavailable while retaining saved accounts', async () => {
    fetcher.mockResolvedValue(Response.json({ credentialStorageReady: false, configuration: { connections: [], sender: null, billingAccounts: [{ id: 'p', environment: 'production', displayName: '总部月结', tail: '5616', status: 'active', isDefault: true }] } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.getByText('总部月结')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存连接' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '保存月结账号' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('alert').textContent).toContain('暂时无法保存')
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('loads a saved account remark again after the configuration view is remounted', async () => {
    let accounts: object[] = []
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body)
        accounts = [{ id: 'saved', environment: body.environment, displayName: body.displayName, tail: body.accountNumber.slice(-4), status: 'active', isDefault: true }]
      }
      return Response.json({ credentialStorageReady: true, configuration: { connections: [], sender: null, billingAccounts: accounts } })
    })
    const view = render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '1234565616' } })
    fireEvent.change(screen.getByLabelText('备注说明（选填）'), { target: { value: '总部月结' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    await screen.findByText('总部月结')
    view.unmount()
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.getByText('总部月结')).toBeTruthy()
    expect(screen.getByText(/5616/)).toBeTruthy()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('does not present an empty editable account list when configuration loading fails', async () => {
    fetcher.mockImplementation(async () => Response.json({ error: '寄件配置读取失败。' }, { status: 503 }))
    render(<ShippingConfigDrawer embedded />)
    await screen.findByRole('heading', { name: '寄件配置不可用' })
    expect(screen.queryByRole('button', { name: '保存月结账号' })).toBeNull()
    expect(screen.queryByText(/尚未保存月结账号/)).toBeNull()
  })
  it('shows carrier, sender, rules and permissions together without legacy enterprise controls or requests', async () => {
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.queryByRole('navigation', { name: '寄件设置分区' })).toBeNull()
    expect(screen.getByRole('region', { name: '顺丰应用连接' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '月结与服务' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '默认寄件人内容' })).toBeTruthy()
    expect(screen.getByText('寄件提报规则')).toBeTruthy()
    expect(screen.getByText('审核与下单权限')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '企业接入' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '企微自建应用' })).toBeNull()
    expect(screen.queryByRole('region', { name: '企微机器人配置' })).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/wecom'))).toBe(false)
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('loads the saved sender without contacting legacy enterprise services', async () => {
    const sender = { displayName: '公司寄件人', name: '张三', phone: '13800138000', province: '广东省', city: '深圳市', county: '南山区', address: '科技路1号' }
    fetcher.mockImplementation(async (url: string) => {
      if (url.includes('/wecom')) throw new Error('Retired enterprise service is unavailable')
      return Response.json(url === '/api/shipping/intake-settings'
        ? { rules: DEFAULT_INTAKE_RULES }
        : { configuration: { connections: [], billingAccounts: [], sender } })
    })
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.getByLabelText('姓名')).toHaveProperty('value', '张三')
    expect(screen.getByLabelText('电话')).toHaveProperty('value', '13800138000')
    expect(screen.getByRole('button', { name: '保存寄件人信息' })).toHaveProperty('disabled', false)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/wecom'))).toBe(false)
  })

  it('retains sender and intake-rule drafts when carrier environment changes', async () => {
    fetcher.mockImplementation(async (url: string) => Response.json(url === '/api/shipping/intake-settings'
      ? { rules: DEFAULT_INTAKE_RULES }
      : { configuration: { connections: [], billingAccounts: [], sender: null } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '未保存的寄件人' } })
    fireEvent.click(screen.getByText('寄件提报规则'))
    fireEvent.change(await screen.findByLabelText('公司名称最少字数'), { target: { value: '8' } })
    const callsBeforeSwitch = fetcher.mock.calls.length
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(screen.getByLabelText('姓名')).toHaveProperty('value', '未保存的寄件人')
    expect(screen.getByLabelText('公司名称最少字数')).toHaveProperty('value', '8')
    expect(fetcher.mock.calls).toHaveLength(callsBeforeSwitch)
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('preserves every sender field and reports no filled values when pasted text cannot be parsed', async () => {
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    const parse = screen.getByRole('button', { name: '解析默认寄方信息' })
    expect(parse).toHaveProperty('disabled', true)
    const senderFields = { 姓名: '原寄件人', 电话: '13800138000', 省: '广东省', 市: '深圳市', 区县: '南山区', 详细地址: '科技路1号' }
    for (const [label, value] of Object.entries(senderFields)) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.change(screen.getByLabelText('默认寄方地址文本'), { target: { value: '无效地址' } })
    fireEvent.click(parse)
    for (const [label, value] of Object.entries(senderFields)) {
      expect(screen.getByLabelText(label)).toHaveProperty('value', value)
    }
    expect(screen.queryByText(/已识别内容已填入/)).toBeNull()
    expect(screen.getByText('未识别出完整寄方，原资料已保留。请补齐姓名、电话和完整地址后重试。')).toBeTruthy()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('isolates account lists and clears sensitive unsaved values on environment change', async () => {
    fetcher.mockResolvedValue(Response.json({ configuration: { connections: [], sender: null, billingAccounts: [
      { id: 'p', environment: 'production', displayName: '生产月结', tail: '0001', status: 'active', isDefault: true },
      { id: 's', environment: 'sandbox', displayName: '沙盒月结', tail: '0002', status: 'active', isDefault: true },
    ] } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(screen.queryByText('沙盒月结')).toBeNull()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('应用密钥'), { target: { value: 'draft-secret' } })
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
    await waitForConfiguration()
    expect(screen.getByText('沙盒月结')).toBeTruthy()
    expect(screen.queryByText('生产月结')).toBeNull()
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '')
  })

  it('preserves unsaved service changes after a different configuration is saved', async () => {
    const configuration = { connections: [{ id: 'p', carrier: 'sf', environment: 'production', partnerIdTail: '0001', status: 'connected', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], capabilities: {} }], billingAccounts: [], sender: null }
    fetcher.mockImplementation(async () => Response.json({ configuration }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('顺丰服务产品'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '添加服务' }))
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    await screen.findByText('月结账号已保存。')
    await waitForConfiguration()
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
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('月结卡号'), { target: { value: '123456789' } })
    fireEvent.click(screen.getByRole('button', { name: '保存月结账号' }))
    expect(await screen.findByText('月结账号未通过校验')).toBeTruthy()
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '123456789')
    expect(screen.queryByText('月结账号已保存。')).toBeNull()
  })

  it('does not invent callback health when the settings endpoint has no evidence', async () => {
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    const records = screen.getByText('接口验证记录').closest('details')!
    expect(records.open).toBe(false)
    fireEvent.click(screen.getByText('接口验证记录'))
    expect(screen.getByText('接收状态未提供')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /开启推送|自动同步|提交上线/ })).toBeNull()
  })

  it('requires an explicit SF-console attestation before enabling in-transit forwarding and return', async () => {
    const connection = {
      id: 'production-1', carrier: 'sf', environment: 'production', partnerIdTail: '0001', status: 'connected',
      services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], interceptAccess: 'disabled', lastTestedAt: null,
      capabilities: { order: 'verified', query: 'verified', tracking: 'verified', cancel: 'verified' },
    }
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST'
      ? Response.json({ configuration: { connections: [{ ...connection, interceptAccess: 'live' }], billingAccounts: [], sender: null } })
      : Response.json({ configuration: { connections: [connection], billingAccounts: [], sender: null } }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    fireEvent.click(screen.getByText('接口验证记录'))
    expect(screen.getByText('在途转寄与退回')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '启用在途转寄与退回' }))
    const confirmation = screen.getByRole('group', { name: '启用在途转寄与退回确认' })
    expect(within(confirmation).getByText(/EXP_RECE_WANTED_INTERCEPT/)).toBeTruthy()
    const submit = within(confirmation).getByRole('button', { name: '确认启用' })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.click(within(confirmation).getByRole('checkbox', { name: /已确认顺丰开放平台已为当前应用关联/ }))
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(submit)
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => {
      if (init?.method !== 'POST') return false
      return String(init.body) === JSON.stringify({
        action: 'enable_sf_intercept_access',
        environment: 'production',
        confirmation: 'EXP_RECE_WANTED_INTERCEPT',
      })
    })).toBe(true))
    expect(await screen.findByText('在途转寄与退回已启用。')).toBeTruthy()
    expect(screen.getByText('生产已启用')).toBeTruthy()
  })
  it('shows a clear permission message instead of an editable blank form to operators', async () => {
    fetcher.mockResolvedValue(Response.json({ error: '需要寄件连接管理权限。' }, { status: 403 }))
    render(<ShippingConfigDrawer embedded />)
    expect(await screen.findByText('需要寄件连接管理权限。')).toBeTruthy()
    expect(screen.queryByLabelText('PartnerID')).toBeNull()
    expect(screen.getByRole('link', { name: '返回自助收寄工作台' }).getAttribute('href')).toBe('/shipping')
  })

  it('renders inline in Config Center without opening a modal or adding a screen overlay', async () => {
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
    expect(await screen.findByRole('region', { name: '寄件设置' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '关闭寄件配置' })).toBeNull()
    expect(screen.getByLabelText('PartnerID')).toBeTruthy()
  })



  it('migrates legacy service/account configuration server-side without returning its source values', async () => {
    const legacyConfiguration = { connections: [{ id: 'sandbox-1', carrier: 'sf', environment: 'sandbox', partnerIdTail: '8391', status: 'configured', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }], capabilities: { order: 'not_tested', query: 'not_tested', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }], billingAccounts: [], sender: null }
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST'
      ? { ...{ configuration: legacyConfiguration, legacyConfigurationAvailable: { sandbox: false, production: false } }, imported: ['顺丰机器连接（服务端加密）', '已授权服务产品'], needsAttention: [] }
      : { configuration: { connections: [], billingAccounts: [], sender: null }, legacyConfigurationAvailable: { sandbox: true, production: false } }), { status: 200 }))
    render(<ShippingConfigDrawer embedded />)
    await waitForConfiguration()
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
    await waitForConfiguration()
    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'sandbox' } })
    await waitForConfiguration()
    expect(await screen.findByText(/沙盒 · 尾号 5616 · 已启用 · 默认/)).toBeTruthy()
    await waitForConfiguration()
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
    expect(screen.getByLabelText('月结卡号')).toHaveProperty('value', '')
    expect(within(screen.getByRole('region', { name: '顺丰接入内容' })).getByText('PartnerID 尾号 8391')).toBeTruthy()
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
    await waitForConfiguration()
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } })
    expect(await screen.findByRole('button', { name: '测试沙盒连接' })).toHaveProperty('disabled', false)

    fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'production' } })

    expect(screen.queryByRole('button', { name: '测试沙盒连接' })).toBeNull()
    const productionProbe = screen.getByRole('button', { name: '测试生产连接（只读）' })
    expect(productionProbe).toHaveProperty('disabled', false)
    expect(screen.getByText('仅查询订单，不会创建或取消运单。')).toBeTruthy()
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
    await waitForConfiguration()
    fireEvent.change(await screen.findByLabelText('运行环境'), { target: { value: 'sandbox' } })
    fireEvent.change(screen.getByLabelText('顺丰服务产品'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '添加服务' }))
    fireEvent.click(screen.getByRole('button', { name: '保存可提报服务' }))

    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, request] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST') as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({ action: 'save_authorized_services', environment: 'sandbox', services: [{ id: 2, name: '顺丰标快', preference: 'standard' }, { id: 1, name: '顺丰特快', preference: 'urgent' }, { id: 6, name: '顺丰即日', preference: 'urgent' }] })
    expect(screen.getByLabelText('PartnerID')).toHaveProperty('value', '')
    expect(screen.getByLabelText('应用密钥')).toHaveProperty('value', '')
  })

  it('saves connection credentials only through the server route and clears the secret field', async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 })
      return new Response(JSON.stringify({ configuration: { connections: [], billingAccounts: [], sender: null } }), { status: 200 })
    })
    render(<ShippingConfigDrawer open onClose={() => undefined}/>)
    await waitForConfiguration()
    fireEvent.change(await screen.findByLabelText('PartnerID'), { target: { value: 'partner-8391' } })
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
    await waitForConfiguration()
  fireEvent.click(await screen.findByRole('button', { name: '保存连接' }))
  const status = screen.getByText('请填写 PartnerID 和应用密钥。')
  expect(status.getAttribute('role')).toBe('status')
  expect(status.className).toContain('feedback')
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
