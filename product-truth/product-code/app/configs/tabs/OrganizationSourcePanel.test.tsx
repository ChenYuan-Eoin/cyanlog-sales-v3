import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  confirmAction: vi.fn(),
}))

vi.mock('@/lib/toast', () => toast)
vi.mock('./DirectoryInspectionPanel', () => ({ DirectoryInspectionPanel: () => <div>同步核验入口</div> }))
vi.mock('./OrganizationConnectionForm', () => ({
  OrganizationConnectionForm: ({ provider }: { provider: { label: string } }) => (
    <div>{provider.label}共享连接表单</div>
  ),
}))

import { OrganizationSourcePanel } from './OrganizationSourcePanel'
import type { DirectoryCutoverClientPlan } from '@/lib/organization-connections/directory-cutover'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.clearAllMocks()
  toast.confirmAction.mockResolvedValue(true)
})

const unavailableCapabilities = {
  credentialVerification: false,
  directoryPreview: false,
  directoryScopeProof: false,
  enterpriseLogin: false,
}
const providers = [
  {
    key: 'feishu', label: '飞书', configurable: true, previewAvailable: true, syncAvailable: true, ssoAvailable: false,
    capabilities: { ...unavailableCapabilities, credentialVerification: true, directoryPreview: true },
    fields: [], unavailableReason: null,
  },
  {
    key: 'fxiaoke', label: '纷享销客', configurable: true, previewAvailable: true, syncAvailable: true, ssoAvailable: true,
    capabilities: { ...unavailableCapabilities, credentialVerification: true, directoryPreview: true, enterpriseLogin: true },
    fields: [], unavailableReason: null,
  },
  { key: 'wecom', label: '企业微信', configurable: false, previewAvailable: false, syncAvailable: false, ssoAvailable: false, capabilities: unavailableCapabilities, fields: [], unavailableReason: '连接器尚未接入' },
  { key: 'dingtalk', label: '钉钉', configurable: false, previewAvailable: false, syncAvailable: false, ssoAvailable: false, capabilities: unavailableCapabilities, fields: [], unavailableReason: '连接器尚未接入' },
]

const source = {
  id: 'source-2',
  provider: 'feishu',
  externalTenantId: 'tenant-1',
  priority: 1,
  status: 'active',
  connectionState: 'verified',
  connectionRevision: '00000000-0000-4000-8000-000000000002',
  effectiveConnectionRevision: '00000000-0000-4000-8000-000000000002',
  connectionConfigured: true,
  draftCheckStatus: 'preview_ready',
  authorityScope: { identity: 'authoritative', organization: 'authoritative', directory: 'authoritative' },
  syncMode: 'authoritative',
  lastSuccessfulSyncAt: null,
  lastError: null,
}

function plan(overrides: Partial<DirectoryCutoverClientPlan> = {}): DirectoryCutoverClientPlan {
  return {
    id: 'plan-1',
    planHash: 'a'.repeat(64),
    contractVersion: 'f003-directory-cutover-v2',
    provider: 'feishu',
    targetSourceId: 'source-2',
    targetExternalTenantId: 'tenant-target',
    connectionRevision: '00000000-0000-4000-8000-000000000002',
    previousPrimarySourceId: 'source-1',
    sourceRevisions: [{
      id: 'source-2', provider: 'feishu', priority: 2, status: 'draft', syncMode: 'read_only',
      configurationRevision: '00000000-0000-4000-8000-000000000002', updatedAt: '2026-11-03T08:00:00.000Z',
    }],
    createdAt: '2026-11-03T08:00:00.000Z',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    status: 'planned',
    applyable: true,
    snapshot: {
      checkedAt: '2026-11-03T08:00:00.000Z', complete: true, connectionVerified: true, scopeVerified: true,
      scopeEvidence: 'provider-admin-scope-proof', directoryHash: 'b'.repeat(64),
      departmentCount: 2, employeeCount: 1, warnings: [],
    },
    summary: { departmentsAdded: 1, departmentsUpdated: 0, departmentsUnchanged: 1, departmentsToDeactivate: 0, identitiesAdded: 1, identitiesUpdated: 0, identitiesUnchanged: 0, conflicts: 0 },
    conflicts: [],
    notices: ['手工维护数据和旧来源目录不会被删除。'],
    departmentChanges: [],
    identityChanges: [],
    preserved: { manualDepartmentCount: 2, otherSourceDepartmentCount: 3, otherSourceIdentityCount: 4, previousPrimaryDepartmentsRetained: 3, previousPrimaryIdentitiesRetained: 4 },
    appliedAt: null,
    rolledBackAt: null,
    run: null,
    ...overrides,
  }
}

const permissions = { view: true, connect: true, preview: true, apply: true, enterpriseLogin: true }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

describe('OrganizationSourcePanel', () => {
  it('submits a scope manifest for the current effective source and refreshes the directory preview', async () => {
    const current = { ...source, provider: 'fxiaoke' }
    const manifest = {
      tenant: { ea: 'enterprise', corpId: 'FSCID_test' },
      principal: { appId: 'FSAID_test', apiUserId: 'employee-reader' },
      capturedAt: new Date().toISOString(),
      scope: { rootDepartmentId: 'root', wholeCompany: true, includesStopped: true, unfiltered: true },
      evidence: { departmentExportSha256: '1'.repeat(64), employeeExportSha256: '2'.repeat(64) },
      departments: [{ id: 'root', parentId: null, status: 'active' }],
      employees: [{ id: 'employee-1', status: 'active', primaryDepartmentId: 'root', secondaryDepartmentIds: [] }],
    }
    const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/scope-proof')) return json({ data: { proof: {
        departmentCount: 1, employeeCount: 1, expiresAt: new Date(Date.now() + 60000).toISOString(),
      } } })
      if (String(input).includes('/directory')) {
        const value = plan({ provider: 'fxiaoke' })
        if (init?.method !== 'POST') {
          value.snapshot.scopeVerified = false
          value.snapshot.scopeEvidence = null
          value.applyable = false
        }
        return json({ data: { plan: value, directory_cutover: { available: true, reason: null } } })
      }
      return json({ data: { sources: [current], providers, permissions } })
    })
    vi.stubGlobal('fetch', calls)
    render(<OrganizationSourcePanel />)
    fireEvent.click(await screen.findByText('核对全公司读取范围'))
    const attachment = screen.getByLabelText('目录核对清单')
    fireEvent.change(attachment, { target: { files: [new File([JSON.stringify(manifest)], 'scope.json', { type: 'application/json' })] } })
    fireEvent.click(screen.getByRole('button', { name: '核对读取范围' }))
    expect(await screen.findByText(/已核实 1 个部门及 1 位人员/)).toBeVisible()
    await waitFor(() => expect(calls.mock.calls.some(([, options]) => options?.body === JSON.stringify({ action: 'preview', provider: 'fxiaoke' }))).toBe(true))
    const submission = calls.mock.calls.find(([url]) => String(url).endsWith('/scope-proof'))
    expect(JSON.parse(String(submission?.[1]?.body))).toEqual({
      sourceId: current.id, connectionRevision: current.effectiveConnectionRevision, ...manifest,
    })
    expect(toast.confirmAction).not.toHaveBeenCalled()
  })

  it('stages distinct review choices and refreshes the stored plan before any directory apply', async () => {
    const previous = plan({ provider: 'fxiaoke', previousPrimarySourceId: source.id, permissionReviews: [{
      userId: 'employee-2', displayName: '员工乙', revision: 'impact-1',
      permissions: [{ permissionCode: 'test:retained', retainable: true }, { permissionCode: 'test:new', retainable: false }],
    }] })
    const refreshed = { ...previous, permissionReviews: [] }
    const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/directory')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
        if (body?.action === 'review_permissions') return json({ data: { decision: { userId: 'employee-2' } } })
        return json({ data: { plan: body?.action === 'preview' ? refreshed : previous, directory_cutover: { available: true, reason: null } } })
      }
      return json({ data: { sources: [{ ...source, provider: 'fxiaoke' }], providers, permissions } })
    })
    vi.stubGlobal('fetch', calls)
    render(<OrganizationSourcePanel />)

    const eligible = await screen.findByRole('combobox', { name: '员工乙 · test:retained' })
    const limited = screen.getByRole('combobox', { name: '员工乙 · test:new' })
    const save = screen.getByRole('button', { name: '保存权限核对' })
    expect(save).toBeDisabled()
    expect(limited).not.toHaveTextContent('保留仍适用的个人例外')
    fireEvent.change(eligible, { target: { value: 'retain_eligible' } })
    fireEvent.change(limited, { target: { value: 'new_baseline' } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByRole('region', { name: '个人权限待核对' })).not.toBeInTheDocument())
    const writes = calls.mock.calls.flatMap(([, init]) => typeof init?.body === 'string' ? [JSON.parse(init.body)] : [])
    expect(writes).toEqual([
      { action: 'review_permissions', plan_id: previous.id, plan_hash: previous.planHash, user_id: 'employee-2',
        choices: [{ permissionCode: 'test:retained', choice: 'retain_eligible' }, { permissionCode: 'test:new', choice: 'new_baseline' }] },
      { action: 'preview', provider: 'fxiaoke' },
    ])
  })

  it('waits for the selected employee to verify the draft before offering deliberate credential activation', async () => {
    const revision = '00000000-0000-4000-8000-000000000003'
    const memberId = 'employee-1'
    const trialId = 'trial-1'
    const trialPath = '/api/auth/fxiaoke/start?trial=' + 'a'.repeat(48)
    let verified = false
    let issued = false
    let enabled = false
    const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input)
      if (target.includes('/connection?')) {
        return json({ data: {
          employees: [{ id: memberId, name: '测试员工甲' }],
          trial: issued ? { id: trialId, memberId, expiresAt: new Date(Date.now() + 60_000).toISOString(),
            verifiedAt: verified ? new Date().toISOString() : null } : null,
        } })
      }
      if (target.endsWith('/connection') && typeof init?.body === 'string') {
        const { action } = JSON.parse(init.body)
        if (action === 'prepare_employee_verification') {
          issued = true
          return json({ data: { trialPath } })
        }
        enabled = true
        return json({ data: {} })
      }
      if (target.includes('/directory')) {
        return json({ data: { plan: null, directory_cutover: { available: true, reason: null } } })
      }
      return json({ data: { providers, permissions, sources: [{
        ...source, provider: 'fxiaoke', connectionRevision: revision,
        effectiveConnectionRevision: enabled ? revision : source.effectiveConnectionRevision,
      }] } })
    })
    vi.stubGlobal('fetch', calls)

    render(<OrganizationSourcePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '开始员工验证' }))
    const employee = await screen.findByRole('combobox', { name: '测试员工' })
    fireEvent.change(employee, { target: { value: memberId } })
    fireEvent.click(screen.getByRole('button', { name: '生成验证链接' }))
    expect(await screen.findByRole('textbox', { name: '员工验证链接' }))
      .toHaveValue(new URL(trialPath, window.location.origin).href)
    expect(screen.queryByRole('button', { name: '启用新凭证' })).not.toBeInTheDocument()

    verified = true
    fireEvent.click(screen.getByRole('button', { name: '刷新验证结果' }))
    fireEvent.click(await screen.findByRole('button', { name: '启用新凭证' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已启用通过员工验证的新凭证。'))
    expect(toast.confirmAction).toHaveBeenCalled()
    expect(calls).toHaveBeenCalledWith('/api/admin/organization-sources/connection', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('activate_verified_credentials'),
    }))
  })


  it('shows source status without exposing mutation controls or a directory plan for view-only access', async () => {
    const readOnly = { view: true, connect: false, preview: false, apply: false, enterpriseLogin: false }
    const fxiaokeSource = { ...source, provider: 'fxiaoke' }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: plan(), directory_cutover: { available: true, reason: null } } })
      : json({ data: { sources: [fxiaokeSource], providers, permissions: readOnly } })))

    render(<OrganizationSourcePanel />)
    expect(await screen.findByText('tenant-1')).toBeVisible()
    expect(screen.queryByText('同步核验入口')).not.toBeInTheDocument()
    expect(screen.queryByTestId('directory-cutover-plan')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '读取组织目录并生成差异' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /纷享登录/ })).not.toBeInTheDocument()
  })

  it('ignores a late directory response from a provider that is no longer selected', async () => {
    let finishOldRead: (response: Response) => void = () => {}
    const oldRead = new Promise<Response>(resolve => { finishOldRead = resolve })
    let feishuReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/directory?provider=fxiaoke')) return oldRead
      if (url.includes('/directory?provider=feishu')) {
        feishuReads++
        return json({ data: { plan: null } })
      }
      return json({ data: { sources: [source], providers, permissions } })
    }))
    render(<OrganizationSourcePanel />)
    await screen.findByText('tenant-1')
    fireEvent.click(screen.getByRole('button', { name: /^纷享销客/ }))
    fireEvent.click(screen.getByRole('button', { name: /^飞书/ }))
    await waitFor(() => expect(feishuReads).toBe(2))
    await act(async () => { finishOldRead(json({ data: { plan: plan({ provider: 'fxiaoke' }) } })); await oldRead })
    expect(screen.getByRole('button', { name: /^飞书/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('directory-cutover-plan')).not.toBeInTheDocument()
  })

  it('shows a checked legacy source as not enabled without claiming that its applied directory disappeared', async () => {
    const disabled = { ...source, status: 'disabled', connectionState: 'disabled', effectiveConnectionRevision: null,
      lastSuccessfulSyncAt: '2026-11-05T05:49:31Z' }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } }) : json({ data: { sources: [disabled], providers, permissions } })))
    render(<OrganizationSourcePanel />)
    expect(await screen.findByText('配置检查通过', { exact: true })).toBeInTheDocument()
    expect(screen.getAllByText('目录连接未启用', { exact: true }).length).toBeGreaterThan(0)
    expect(screen.queryByText('已停用', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText(/最近应用/)).toBeInTheDocument()
    expect(screen.getByText(/已同步的部门、员工和归属仍保留/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '飞书启用目录连接后可用' })).toBeDisabled()
  })

  it('requires a new draft to become effective before reading or applying another directory plan', async () => {
    const changed = { ...source, connectionRevision: 'new-revision' }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: plan() } }) : json({ data: { sources: [changed], providers, permissions } })))
    render(<OrganizationSourcePanel />)
    await screen.findByText('配置已改变 · 需重新生成差异')
    expect(screen.queryByRole('button', { name: '确认切换目录主来源' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '读取组织目录并生成差异' })).not.toBeInTheDocument()
    expect(screen.getByText('沿用上一份配置', { exact: true })).toBeInTheDocument()
  })

  it('does not label an expired plan executable and keeps regeneration available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: plan({ expiresAt: '2020-01-01T00:00:00Z' }) } })
      : json({ data: { sources: [source], providers, permissions } })))
    render(<OrganizationSourcePanel />)
    await screen.findByText('差异计划已过期')
    expect(screen.queryByText('差异计划可执行')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认切换目录主来源' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取组织目录并生成差异' })).toBeEnabled()
  })

  it('keeps directory read failures unknown and retries without losing saved connection state', async () => {
    let directoryReads = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/directory')) {
        directoryReads++
        return directoryReads === 1 ? json({ error: '同步记录暂不可用' }, 503) : json({ data: { plan: null } })
      }
      return json({ data: { sources: [source], providers, permissions } })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<OrganizationSourcePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('当前同步记录未知')
    expect(screen.getByText('配置检查通过', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新读取同步记录后可用' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取同步记录' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '读取组织目录并生成差异' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(directoryReads).toBe(2)
  })

  it('cancels confirmation without posting or hiding the current plan', async () => {
    toast.confirmAction.mockResolvedValue(false)
    const fetcher = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => String(input).includes('/directory')
      ? json({ data: { plan: plan() } }) : json({ data: { sources: [source], providers, permissions } }))
    vi.stubGlobal('fetch', fetcher)
    render(<OrganizationSourcePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '确认切换目录主来源' }))
    await waitFor(() => expect(toast.confirmAction).toHaveBeenCalledOnce())
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect(screen.getByText('差异计划可执行')).toBeInTheDocument()
  })

  it('keeps a failed source read unknown, renders structured API errors and retries only on request', async () => {
    const message = '组织来源操作失败。'
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL) => json({ success: false, error: { code: 'INTERNAL_ERROR', message } }, 500))
    vi.stubGlobal('fetch', fetchMock)
    render(<OrganizationSourcePanel />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(alert).toHaveTextContent('读取失败不表示尚未配置连接')
    expect(alert).not.toHaveTextContent('[object Object]')
    expect(screen.queryByText('尚未配置外部组织连接。选择上方提供方开始配置。')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('接入能力状态')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /确认切换|生成差异|回滚本次/ })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockImplementation(async (input?: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } }))
    fireEvent.click(screen.getByRole('button', { name: '重新读取组织接入状态' }))
    expect(await screen.findByText('tenant-1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([{}, { data: {} }, { data: { sources: [] } }, { data: { sources: null, providers } }])('does not turn malformed success payload into an empty connection ledger', async payload => {
    vi.stubGlobal('fetch', vi.fn(async () => json(payload)))
    render(<OrganizationSourcePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('组织来源读取结果不完整')
    expect(screen.queryByLabelText('接入能力状态')).not.toBeInTheDocument()
  })

  it('keeps the connection page usable when directory cutover storage is awaiting migration', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({
          data: {
            plan: null,
            directory_cutover: {
              available: false,
              reason: '当前数据库尚未完成目录切源升级；目录读取可继续验收，差异应用与回滚暂不可用。',
            },
          },
        })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText(/目录读取可继续验收/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目录切源升级后可用' })).toBeDisabled()
    const inspection = await screen.findByText('同步核验入口')
    expect(inspection.closest('section')).toHaveAttribute('aria-labelledby', 'directory-authority-title')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('separates connection, directory and login concepts and removes the old direct Feishu sync action', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText('tenant-1')).toBeInTheDocument()
    expect(screen.getByText('连接管理')).toBeInTheDocument()
    expect(screen.getByText('目录同步')).toBeInTheDocument()
    expect(screen.getByText('组织目录读取')).toBeInTheDocument()
    expect(screen.getAllByText('目录主来源').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/企业单点登录/).length).toBeGreaterThan(0)
    expect(screen.getByText('身份映射与寄件授权')).toBeInTheDocument()
    expect(screen.getByText(/寄件授权未验收/)).toBeInTheDocument()
    expect(screen.getAllByText('配置检查通过').length).toBeGreaterThan(0)
    expect(screen.queryByText('已验证并启用')).not.toBeInTheDocument()
    expect(screen.getByText(/待目录差异计划 · 寄件授权未验收/)).toBeInTheDocument()
    expect(screen.getByText('手工维护')).toBeInTheDocument()
    expect(screen.getByText('企业微信')).toBeInTheDocument()
    expect(screen.getByText('钉钉')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '同步飞书组织' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /解绑/ })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/directory?provider=feishu'))).toBe(true)
  })

  it('enables a provider from backend capability declarations without hardcoding its name in the UI', async () => {
    const futureProviders = providers.map(provider => provider.key === 'wecom'
      ? {
          ...provider,
          configurable: true,
          previewAvailable: true,
          syncAvailable: true,
          capabilities: { ...provider.capabilities, credentialVerification: true, directoryPreview: true },
          unavailableReason: null,
        }
      : provider)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } })
      : json({ data: { sources: [source], providers: futureProviders, permissions, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    const wecom = await screen.findByRole('button', { name: /企业微信/ })
    expect(wecom).toBeEnabled()
    fireEvent.click(wecom)
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes('/directory?provider=wecom')
    ))).toBe(true))
  })

  it('does not turn directory authority into enterprise SSO authority', async () => {
    const fxiaokeSource = {
      ...source,
      id: 'source-fxiaoke',
      provider: 'fxiaoke',
      externalTenantId: 'FSCID_target',
      authorityScope: { identity: 'evidence', organization: 'authoritative', directory: 'authoritative' },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } })
      : json({ data: { sources: [fxiaokeSource], providers, permissions, active_primary_source_id: fxiaokeSource.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findAllByText('身份权威未启用')).toHaveLength(2)
    expect(screen.queryByText('身份权威已启用')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/directory?provider=fxiaoke'))).toBe(true)
  })

  it('labels enabled enterprise login as awaiting real-player acceptance', async () => {
    const fxiaokeSource = {
      ...source,
      id: 'source-fxiaoke',
      provider: 'fxiaoke',
      externalTenantId: 'FSCID_target',
      authorityScope: { identity: 'authoritative', organization: 'authoritative', directory: 'authoritative' },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } })
      : json({ data: { sources: [fxiaokeSource], providers, permissions, active_primary_source_id: fxiaokeSource.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findAllByText('已启用 · 待真人验收')).toHaveLength(2)
    expect(screen.queryByText('身份权威已启用')).not.toBeInTheDocument()
  })

  it('allows a verified complete directory without requiring a separate roster proof', async () => {
    const blocked = plan({
      applyable: true,
      conflicts: [],
      snapshot: { ...plan().snapshot, complete: true, connectionVerified: true, scopeVerified: false, scopeEvidence: null },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: blocked } })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText(/部门与人员关系：校验通过/)).toBeInTheDocument()
    expect(screen.queryByText(/范围证据缺失/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认切换目录主来源' })).toBeEnabled()
  })

  it('keeps a fully paginated Fxiaoke read with unproven scope read-only and preserves it after a failed check', async () => {
    const readonly = plan({ provider: 'fxiaoke', snapshot: { ...plan().snapshot, scopeVerified: false, scopeEvidence: null } })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/directory')) {
        return init?.method === 'POST' ? json({ error: '通讯录暂时无法读取' }, 502) : json({ data: { plan: readonly } })
      }
      return json({ data: { sources: [{ ...source, provider: 'fxiaoke', lastSuccessfulSyncAt: '2026-11-03T00:00:00Z' }], providers, permissions } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OrganizationSourcePanel />)
    expect(await screen.findByText('读取范围待核实，只可预览')).toBeVisible()
    expect(screen.getByText('本次检查保留已生效的人员状态和部门关系。')).toBeVisible()
    expect(screen.queryByRole('button', { name: '应用变更' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成差异确认单' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('保留上次检查结果')
    expect(screen.getByText('读取范围待核实，只可预览')).toBeVisible()
    expect(screen.getByText(/上次生效/)).toBeVisible()
  })

  it('applies independent Fxiaoke changes while keeping review items visible', async () => {
    const current = plan({
      provider: 'fxiaoke', previousPrimarySourceId: 'source-2',
      summary: { ...plan().summary, departmentsAdded: 0, conflicts: 1, membersAdded: 0, membersLinked: 1, membersMoved: 1 },
      conflicts: [{ kind: 'identity_requires_review', externalId: 'private-subject', message: '员工丙的手机号待核对。' }],
    })
    const run: NonNullable<DirectoryCutoverClientPlan['run']> = {
      runId: 'run-1', planId: current.id, status: 'applied', appliedAt: '2026-11-03T08:01:00.000Z', rolledBackAt: null,
      sourceId: current.targetSourceId, previousPrimarySourceId: current.previousPrimarySourceId, departments: 1, identities: 1, members: 1,
    }
    let applied = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/directory')) {
        if (init?.method === 'POST') {
          applied = true
          return json({ data: { run } })
        }
        return json({ data: { plan: applied ? { ...current, status: 'applied', run } : current } })
      }
      return json({ data: { sources: [{ ...source, provider: 'fxiaoke' }], providers, permissions } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OrganizationSourcePanel />)
    expect(await screen.findByText('可应用独立变更')).toBeVisible()
    expect(screen.getByText('关联 1')).toBeVisible()
    expect(screen.getByText('调岗 1')).toBeVisible()
    expect(screen.getByRole('region', { name: '待核对' })).toHaveTextContent('员工丙的手机号待核对。')
    expect(screen.queryByText(/provider-admin-scope-proof|private-subject/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '应用变更' }))
    expect(await screen.findByText('已应用')).toBeVisible()
    expect(toast.confirmAction).toHaveBeenCalledWith(expect.stringContaining('1 项待核对内容会保留'), expect.anything())
    expect(screen.getByText('员工丙的手机号待核对。')).toBeVisible()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('renders the immutable plan, preservation counts and blocks conflicted plans', async () => {
    const conflicted = plan({ applyable: false, conflicts: [{ kind: 'identity_unresolved', externalId: 'u1', message: '工号、邮箱或手机号未能唯一定位成员。' }] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: conflicted } })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText('差异计划被阻断')).toBeInTheDocument()
    expect(screen.getByText('工号、邮箱或手机号未能唯一定位成员。')).toBeInTheDocument()
    expect(screen.getByText(/保留手工部门 2 个/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认切换目录主来源' })).not.toBeInTheDocument()
  })

  it('shows automatic role source changes even when employee affiliations are unchanged', async () => {
    const current = plan({ authorityReview: {
      members: 0, baselineChanges: 0, rolesForReview: 0, scopesForReview: 0, personalExceptions: 0,
      automaticRoleSourcesAdded: 2, automaticRoleSourcesRemoved: 1,
    } })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: current } })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } })))
    render(<OrganizationSourcePanel />)
    expect(await screen.findByText(/新增部门角色来源 2 项，结束 1 项/)).toBeVisible()
  })

  it('shows scope changes under retained role sources in the directory plan and confirmation', async () => {
    const current = plan({ authorityReview: {
      members: 0, baselineChanges: 0, rolesForReview: 0, scopesForReview: 0, personalExceptions: 0,
      automaticRoleScopeWidenedMembers: 2, automaticRoleScopeNarrowedMembers: 1,
    } })
    vi.mocked(toast.confirmAction).mockResolvedValueOnce(false)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: current } })
      : json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } })))
    render(<OrganizationSourcePanel />)
    const caption = '已有部门角色的数据范围扩大 2 人，收缩 1 人。'
    expect(await screen.findByText(new RegExp(caption))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认切换目录主来源' }))
    await waitFor(() => expect(toast.confirmAction).toHaveBeenCalledWith(expect.stringContaining(caption), expect.anything()))
  })

  it('requires explicit confirmation and sends the frozen plan revision to apply', async () => {
    const current = plan()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/directory') && init?.method === 'POST') {
        return json({ data: { run: {
          runId: 'run-1', planId: current.id, status: 'applied', appliedAt: '2026-11-03T08:01:00.000Z', rolledBackAt: null,
          sourceId: current.targetSourceId, previousPrimarySourceId: current.previousPrimarySourceId, departments: 1, identities: 1, members: 1,
        } } })
      }
      if (String(input).includes('/directory')) return json({ data: { plan: current } })
      return json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)
    fireEvent.click(await screen.findByRole('button', { name: '确认切换目录主来源' }))

    await waitFor(() => expect(toast.confirmAction).toHaveBeenCalledOnce())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/directory') && init?.method === 'POST')
    expect(post).toBeTruthy()
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      action: 'apply', plan_id: current.id, plan_hash: current.planHash,
      connection_revision: current.connectionRevision, source_revisions: current.sourceRevisions,
    })
  })

  it('previews permission impact before confirming rollback of the exact applied plan', async () => {
    const current = plan({
      status: 'applied', appliedAt: '2026-11-03T08:01:00.000Z',
      run: {
        runId: 'run-1', planId: 'plan-1', status: 'applied', appliedAt: '2026-11-03T08:01:00.000Z',
        rolledBackAt: null, sourceId: 'source-2', previousPrimarySourceId: 'source-1',
        departments: 1, identities: 1, members: 1,
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/directory') && init?.method === 'POST') {
        if (JSON.parse(String(init.body)).action === 'rollback_preview') {
          return json({ data: { preview: { previewId: 'preview-1', summary: {
            members: 1, baselineChanges: 1, rolesForReview: 2, scopesForReview: 1, personalExceptions: 1,
            automaticRoleScopeWidenedMembers: 0, automaticRoleScopeNarrowedMembers: 2,
          } } } })
        }
        return json({ data: { run: {
          runId: 'run-1', planId: current.id, status: 'rolled_back', appliedAt: current.appliedAt!, rolledBackAt: '2026-11-03T08:02:00.000Z',
          sourceId: current.targetSourceId, previousPrimarySourceId: current.previousPrimarySourceId, departments: 1, identities: 1, members: 1,
        } } })
      }
      if (String(input).includes('/directory')) return json({ data: { plan: current } })
      return json({ data: { sources: [source], providers, permissions, active_primary_source_id: source.id } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)
    expect(await screen.findByText('本次映射已应用 · 寄件授权未验收')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '回滚本次目录切源' }))

    await waitFor(() => expect(toast.confirmAction).toHaveBeenCalledOnce())
    expect(toast.confirmAction).toHaveBeenCalledWith(expect.stringContaining('待复核角色 2 项'), expect.anything())
    expect(toast.confirmAction).toHaveBeenCalledWith(expect.stringContaining('已有部门角色的数据范围扩大 0 人，收缩 2 人。'), expect.anything())
    const posts = fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/directory') && init?.method === 'POST')
    expect(posts.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { action: 'rollback_preview', plan_id: current.id },
      { action: 'rollback', plan_id: current.id, preview_id: 'preview-1' },
    ])
  })

  it('lets an administrator explicitly open Fxiaoke login after role assignment without an invitation step', async () => {
    let enabled = false
    const fxiaokeSource = {
      ...source, provider: 'fxiaoke', externalTenantId: 'FSCID_test',
      authorityScope: { directory: 'authoritative', identity: 'evidence' },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/fxiaoke/sso') && init?.method === 'PATCH') {
        enabled = true
        return json({ enabled: true })
      }
      if (String(input).includes('/directory')) return json({ data: { plan: null, directory_cutover: { available: true, reason: null } } })
      return json({ data: { sources: [{ ...fxiaokeSource, authorityScope: {
        ...fxiaokeSource.authorityScope, identity: enabled ? 'authoritative' : 'evidence',
      } }], providers, permissions } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<OrganizationSourcePanel />)

    const enable = await screen.findByRole('button', { name: '启用纷享登录' })
    expect(screen.getByText(/无需邀请码或本地密码/)).toBeInTheDocument()
    fireEvent.click(enable)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url).endsWith('/fxiaoke/sso') && init?.method === 'PATCH'
    ))).toBe(true))
    expect(await screen.findByRole('button', { name: '停用纷享登录' })).toBeInTheDocument()
  })
})
