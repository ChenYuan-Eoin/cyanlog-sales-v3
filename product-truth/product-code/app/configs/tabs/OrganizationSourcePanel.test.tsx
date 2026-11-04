import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  confirmAction: vi.fn(),
}))

vi.mock('@/lib/toast', () => toast)
vi.mock('./DirectoryInspectionPanel', () => ({ DirectoryInspectionPanel: () => <div>目录范围核验</div> }))
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
  id: 'source-1',
  provider: 'feishu',
  externalTenantId: 'tenant-1',
  priority: 1,
  status: 'active',
  connectionState: 'verified',
  connectionRevision: 'revision-1',
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
    contractVersion: 'f003-directory-cutover-v1',
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
      checkedAt: '2026-11-03T08:00:00.000Z', complete: true, scopeVerified: true,
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

describe('OrganizationSourcePanel', () => {
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
      : json({ data: { sources: [source], providers, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText(/目录读取可继续验收/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目录切源升级后可用' })).toBeDisabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('separates connection, directory and login concepts and removes the old direct Feishu sync action', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: null } })
      : json({ data: { sources: [source], providers, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText('tenant-1')).toBeInTheDocument()
    expect(screen.getByText('连接管理')).toBeInTheDocument()
    expect(screen.getByText('目录同步')).toBeInTheDocument()
    expect(screen.getByText('目录读取范围')).toBeInTheDocument()
    expect(screen.getAllByText('目录主来源').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/企业单点登录/).length).toBeGreaterThan(0)
    expect(screen.getByText('身份映射与寄件授权')).toBeInTheDocument()
    expect(screen.getByText(/寄件授权未验收/)).toBeInTheDocument()
    expect(screen.getAllByText('连接已验证').length).toBeGreaterThan(0)
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
      : json({ data: { sources: [source], providers: futureProviders, active_primary_source_id: source.id } }))
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
      : json({ data: { sources: [fxiaokeSource], providers, active_primary_source_id: fxiaokeSource.id } }))
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
      : json({ data: { sources: [fxiaokeSource], providers, active_primary_source_id: fxiaokeSource.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findAllByText('已启用 · 待真人验收')).toHaveLength(2)
    expect(screen.queryByText('身份权威已启用')).not.toBeInTheDocument()
  })

  it('shows structural completeness separately and blocks an unverified scope plan', async () => {
    const blocked = plan({
      applyable: false,
      conflicts: [{ kind: 'scope_unverified', externalId: null, message: '不能证明该连接可读取全公司通讯录。' }],
      snapshot: { ...plan().snapshot, complete: true, scopeVerified: false, scopeEvidence: null },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: blocked } })
      : json({ data: { sources: [source], providers, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText('仅完成授权范围内分页，尚不能证明全公司读取范围')).toBeInTheDocument()
    expect(screen.getByText(/快照结构：完整/)).toBeInTheDocument()
    expect(screen.getByText(/范围证据缺失/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认切换目录主来源' })).not.toBeInTheDocument()
  })

  it('renders the immutable plan, preservation counts and blocks conflicted plans', async () => {
    const conflicted = plan({ applyable: false, conflicts: [{ kind: 'identity_unresolved', externalId: 'u1', message: '工号、邮箱或手机号未能唯一定位成员。' }] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/directory')
      ? json({ data: { plan: conflicted } })
      : json({ data: { sources: [source], providers, active_primary_source_id: source.id } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText('差异计划被阻断')).toBeInTheDocument()
    expect(screen.getByText('工号、邮箱或手机号未能唯一定位成员。')).toBeInTheDocument()
    expect(screen.getByText(/保留手工部门 2 个/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认切换目录主来源' })).not.toBeInTheDocument()
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
      return json({ data: { sources: [source], providers, active_primary_source_id: source.id } })
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

  it('offers rollback only for an applied plan and sends the exact plan id', async () => {
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
        return json({ data: { run: {
          runId: 'run-1', planId: current.id, status: 'rolled_back', appliedAt: current.appliedAt!, rolledBackAt: '2026-11-03T08:02:00.000Z',
          sourceId: current.targetSourceId, previousPrimarySourceId: current.previousPrimarySourceId, departments: 1, identities: 1, members: 1,
        } } })
      }
      if (String(input).includes('/directory')) return json({ data: { plan: current } })
      return json({ data: { sources: [source], providers, active_primary_source_id: source.id } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)
    expect(await screen.findByText('本次映射已应用 · 寄件授权未验收')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '回滚本次目录切源' }))

    await waitFor(() => expect(toast.confirmAction).toHaveBeenCalledOnce())
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/directory') && init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ action: 'rollback', plan_id: current.id })
  })
})
