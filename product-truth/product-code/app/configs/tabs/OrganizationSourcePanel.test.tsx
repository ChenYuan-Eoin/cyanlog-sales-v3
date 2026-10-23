import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { OrganizationSourcePanel } from './OrganizationSourcePanel'

vi.mock('@/lib/toast', () => ({
  success: vi.fn(),
  error: vi.fn(),
  confirmAction: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const source = {
  id: 'source-1',
  provider: 'feishu',
  externalTenantId: 'tenant-1',
  priority: 1,
  status: 'active',
  syncMode: 'authoritative',
  lastSuccessfulSyncAt: null,
  lastError: null,
}

describe('OrganizationSourcePanel', () => {
  it('shows persisted sources and prevents enabling an unconnected provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        sources: [source],
        providers: [
          { key: 'feishu', label: '飞书', syncAvailable: true, unavailableReason: null },
          { key: 'wecom', label: '企业微信', syncAvailable: false, unavailableReason: '连接器尚未接入' },
          { key: 'dingtalk', label: '钉钉', syncAvailable: false, unavailableReason: '连接器尚未接入' },
        ],
        legacy_feishu_binding: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    render(<OrganizationSourcePanel />)

    expect(await screen.findByText('tenant-1')).toBeInTheDocument()
    expect(screen.getByText('主来源')).toBeInTheDocument()
    expect(screen.getByText('手工维护')).toBeInTheDocument()
    expect(screen.getByText('企业微信')).toBeInTheDocument()
    expect(screen.getByText('钉钉')).toBeInTheDocument()
    expect(screen.getAllByText('未接入')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /绑定来源/ }))
    fireEvent.change(screen.getByLabelText('提供方'), { target: { value: 'wecom' } })
    expect(screen.getByText('连接器尚未接入')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '已启用' })).toBeDisabled()
  })
})
