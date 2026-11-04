import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DirectoryInspectionPanel } from './DirectoryInspectionPanel'
import { buildDirectoryInspection } from '@/lib/organization-connections/directory-inspection'
import type { ConnectionSummary, ProviderCapability } from '@/lib/organization-connections/types'

const provider: ProviderCapability = {
  key: 'fxiaoke', label: '纷享销客', configurable: true, previewAvailable: true, syncAvailable: true, ssoAvailable: true,
  capabilities: { credentialVerification: true, directoryPreview: true, directoryScopeProof: false, enterpriseLogin: true }, fields: [], unavailableReason: null,
}
const connection: ConnectionSummary = {
  sourceId: '00000000-0000-4000-8000-000000000001', revision: '00000000-0000-4000-8000-000000000002',
  provider: 'fxiaoke', externalTenantId: 'tenant-1', state: 'disabled', draftCheckStatus: 'preview_ready', configured: true,
  effectiveVerified: false, metadata: {}, lastCheckedAt: null, lastVerifiedAt: null, lastError: null,
}
const report = buildDirectoryInspection({ organizationId: 'org-1', sourceId: connection.sourceId, provider: 'fxiaoke', externalTenantId: 'tenant-1', connectionRevision: connection.revision, sourceState: 'disabled' }, {
  checkedAt: '2026-11-04T10:00:00Z', complete: true, scopeVerified: false, scopeEvidence: null, warnings: [],
  departments: [{ id: 'dept-1', name: '销售部', parentId: null, status: 'active' }],
  employees: [{ id: 'employee-1', name: '员工甲', departmentIds: ['dept-1'], primaryDepartmentId: 'dept-1', status: 'active', loginDisabled: false }],
})
const fetchMock = vi.fn()
const response = (value: unknown, ok = true) => ({ ok, json: async () => value })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (url: string) => url.includes('/inspection') ? response({ data: { report } }) : response({ data: { connection } }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('directory inspection operator flow', () => {
  it('reads a disabled saved connection explicitly and separates structure from company scope', async () => {
    render(<DirectoryInspectionPanel provider={provider} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '只读核验目录' })).toBeEnabled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('directory-inspection-report')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '只读核验目录' }))
    expect(await screen.findByText('全公司范围未证明')).toBeInTheDocument()
    expect(screen.getByText('本次读取：1 个部门、1 位员工')).toBeInTheDocument()
    expect(screen.getByText(/此来源已停用/)).toBeInTheDocument()
    expect(screen.getByText(/本次返回的目录结构检查通过/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '核验员工明细', hidden: true })).toHaveTextContent('员工甲')
    const writes = fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toBe('/api/admin/organization-sources/inspection')
    expect(JSON.parse(writes[0][1].body)).toEqual({ provider: 'fxiaoke', sourceId: connection.sourceId, revision: connection.revision })
    expect(screen.queryByRole('button', { name: /同步|切源|启用|范围通过/ })).not.toBeInTheDocument()
  })

  it('clears a previous observation immediately and does not retain it after a failed reread', async () => {
    render(<DirectoryInspectionPanel provider={provider} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '只读核验目录' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '只读核验目录' }))
    await screen.findByTestId('directory-inspection-report')
    await waitFor(() => expect(screen.getByRole('button', { name: '只读核验目录' })).toBeEnabled())
    fetchMock.mockResolvedValue(response({ error: '连接配置已改变' }, false))
    fireEvent.click(screen.getByRole('button', { name: '只读核验目录' }))
    expect(screen.queryByTestId('directory-inspection-report')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('连接配置已改变')
    expect(screen.queryByText('全公司范围未证明')).not.toBeInTheDocument()
  })

  it('refuses a response for a different connection revision', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/inspection')
      ? response({ data: { report: { ...report, binding: { ...report.binding, connectionRevision: 'stale' } } } })
      : response({ data: { connection } }))
    render(<DirectoryInspectionPanel provider={provider} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '只读核验目录' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '只读核验目录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('目录结果与当前连接不一致')
    expect(screen.queryByTestId('directory-inspection-report')).not.toBeInTheDocument()
  })

  it('aborts an in-flight inspection when the connection panel is replaced', async () => {
    let inspectionSignal: AbortSignal | undefined
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (!url.includes('/inspection')) return response({ data: { connection } })
      inspectionSignal = options.signal as AbortSignal
      return new Promise(() => {})
    })
    const view = render(<DirectoryInspectionPanel provider={provider} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '只读核验目录' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '只读核验目录' }))
    await waitFor(() => expect(inspectionSignal).toBeDefined())
    view.unmount()
    expect(inspectionSignal?.aborted).toBe(true)
  })
})
