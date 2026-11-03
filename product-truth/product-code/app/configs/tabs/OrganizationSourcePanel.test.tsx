import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { OrganizationSourcePanel } from './OrganizationSourcePanel'

vi.mock('@/lib/toast', () => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./OrganizationConnectionForm', () => ({
  OrganizationConnectionForm: ({ provider }: { provider: { label: string } }) => (
    <div>{provider.label}共享连接表单</div>
  ),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const providers = [
  {
    key: 'feishu',
    label: '飞书',
    configurable: true,
    previewAvailable: true,
    syncAvailable: true,
    fields: [],
    unavailableReason: null,
  },
  {
    key: 'fxiaoke',
    label: '纷享销客',
    configurable: true,
    previewAvailable: true,
    syncAvailable: false,
    fields: [],
    unavailableReason: null,
  },
  {
    key: 'wecom',
    label: '企业微信',
    configurable: false,
    previewAvailable: false,
    syncAvailable: false,
    fields: [],
    unavailableReason: '连接器尚未接入',
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    configurable: false,
    previewAvailable: false,
    syncAvailable: false,
    fields: [],
    unavailableReason: '连接器尚未接入',
  },
]

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source-1',
    provider: 'feishu',
    externalTenantId: 'tenant-1',
    priority: 1,
    status: 'active',
    connectionState: 'verified',
    connectionRevision: 'revision-1',
    draftCheckStatus: 'preview_ready',
    syncMode: 'authoritative',
    lastSuccessfulSyncAt: null,
    lastError: null,
    ...overrides,
  }
}

function mockSources(sources = [source()], legacy: unknown = null) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    data: {
      sources,
      providers,
      active_primary_source_id: sources[0]?.id || null,
      legacy_feishu_binding: legacy,
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('OrganizationSourcePanel', () => {
  it('shows true provider states and exposes sync only for the active verified Feishu source', async () => {
    const onFeishuSync = vi.fn()
    mockSources()

    render(<OrganizationSourcePanel onFeishuSync={onFeishuSync} />)

    expect(await screen.findByText('tenant-1')).toBeInTheDocument()
    expect(screen.getByText('主来源')).toBeInTheDocument()
    expect(screen.getAllByText('已验证并启用')).toHaveLength(2)
    expect(screen.getByText('手工维护')).toBeInTheDocument()
    expect(screen.getByText('企业微信')).toBeInTheDocument()
    expect(screen.getByText('钉钉')).toBeInTheDocument()
    expect(screen.getAllByText('未接入')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /绑定来源/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /解绑/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '同步飞书组织' }))
    expect(onFeishuSync).toHaveBeenCalledOnce()
  })

  it('does not show a sync action without an active verified authoritative Feishu source', async () => {
    mockSources([
      source({
        status: 'draft',
        connectionState: 'configured',
        draftCheckStatus: 'not_checked',
        syncMode: 'read_only',
      }),
    ])

    render(<OrganizationSourcePanel onFeishuSync={vi.fn()} />)

    expect(await screen.findAllByText('已保存 · 待验证')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '同步飞书组织' })).not.toBeInTheDocument()
  })

  it('opens the same shared form for Feishu and Fxiaoke while disabling unimplemented providers', async () => {
    mockSources([])

    render(<OrganizationSourcePanel />)

    await screen.findByText('飞书')
    const feishuButton = screen.getByText('飞书').closest('button') as HTMLButtonElement
    const fxiaokeButton = screen.getByText('纷享销客').closest('button') as HTMLButtonElement
    const wecomButton = screen.getByText('企业微信').closest('button') as HTMLButtonElement

    expect(feishuButton).toBeEnabled()
    expect(fxiaokeButton).toBeEnabled()
    expect(wecomButton).toBeDisabled()

    fireEvent.click(feishuButton)
    expect(screen.getByText('飞书共享连接表单')).toBeInTheDocument()

    fireEvent.click(fxiaokeButton)
    expect(screen.getByText('纷享销客共享连接表单')).toBeInTheDocument()
  })

  it('offers legacy Feishu configuration only as an explicit draft import', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          sources: [],
          providers,
          active_primary_source_id: null,
          legacy_feishu_binding: {
            provider: 'feishu',
            external_tenant_id: 'legacy-tenant',
            migration_available: true,
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { connection: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { sources: [], providers, active_primary_source_id: null, legacy_feishu_binding: null },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText(/legacy-tenant/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入为飞书草稿' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/organization-sources/connection')
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      action: 'import_legacy_feishu',
    })
    expect(await screen.findByText('飞书共享连接表单')).toBeInTheDocument()
  })
})
