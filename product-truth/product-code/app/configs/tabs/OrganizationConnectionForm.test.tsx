import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { OrganizationConnectionForm } from './OrganizationConnectionForm'
import type { ConnectionSummary, ProviderCapability } from '@/lib/organization-connections/types'

const provider: ProviderCapability & { key: 'fxiaoke' } = {
  key: 'fxiaoke', label: '纷享销客', configurable: true, previewAvailable: true, syncAvailable: true, ssoAvailable: true,
  fields: [], unavailableReason: null,
  capabilities: { credentialVerification: true, directoryPreview: true, directoryScopeProof: false, enterpriseLogin: true },
}
const draft: ConnectionSummary = {
  sourceId: 'source', provider: 'fxiaoke', externalTenantId: 'tenant', revision: 'revision', state: 'disabled',
  draftCheckStatus: 'preview_ready', configured: true, effectiveVerified: false, effectiveRevision: null,
  metadata: {}, lastCheckedAt: '2026-11-05T00:00:00Z', lastVerifiedAt: null, lastError: null,
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps connection write and activation controls separate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { connection: draft } })))
  const view = render(<OrganizationConnectionForm provider={provider} canConnect canApply={false} />)
  await screen.findByText('配置检查通过')
  expect(screen.getByRole('button', { name: '检查连接与读取范围' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '启用目录连接' })).not.toBeInTheDocument()

  view.rerender(<OrganizationConnectionForm provider={provider} canConnect={false} canApply />)
  expect(screen.getByRole('button', { name: '启用目录连接' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '检查连接与读取范围' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存配置草稿' })).not.toBeInTheDocument()
})

it('explicitly activates a verified draft and retains the effective state when reopened', async () => {
  let persisted = draft
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      expect(JSON.parse(String(options.body))).toEqual({ action: 'activate_directory', provider: 'fxiaoke', revision: 'revision' })
      persisted = { ...draft, state: 'verified', effectiveVerified: true, effectiveRevision: 'revision' }
    }
    return Response.json({ data: { connection: persisted } })
  })
  vi.stubGlobal('fetch', fetcher)
  const onChanged = vi.fn()
  const view = render(<OrganizationConnectionForm provider={provider} canConnect canApply onChanged={onChanged} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '启用目录连接' })).toBeEnabled())
  expect(screen.getByText('配置检查通过')).toBeInTheDocument()
  expect(screen.getByText('目录连接未启用')).toBeInTheDocument()
  expect(screen.queryByText('已停用', { exact: true })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '启用目录连接' }))
  await screen.findByText('目录连接已启用', { exact: true })
  expect(onChanged).toHaveBeenCalledOnce()
  view.unmount()
  render(<OrganizationConnectionForm provider={provider} canConnect canApply />)
  await screen.findByText('目录连接已启用', { exact: true })
  expect(screen.queryByRole('button', { name: '启用目录连接' })).not.toBeInTheDocument()
})

it('requires a successful draft check and shows activation failures without claiming success', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
    ? Response.json({ error: '连接在启用前已改变' }, { status: 409 }) : Response.json({ data: { connection: draft } })))
  render(<OrganizationConnectionForm provider={provider} canConnect canApply />)
  await waitFor(() => expect(screen.getByRole('button', { name: '启用目录连接' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '启用目录连接' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('连接在启用前已改变')
  expect(screen.queryByText('目录连接已启用', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新读取连接配置' })).toBeEnabled()
})

it('keeps failed configuration reads unknown and offers a read-only retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: '读取暂不可用' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ data: { connection: draft } }))
  vi.stubGlobal('fetch', fetcher)
  render(<OrganizationConnectionForm provider={provider} canConnect canApply />)
  await screen.findByText('配置状态未知')
  expect(screen.getByRole('button', { name: '检查连接与读取范围' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '启用目录连接' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重新读取连接配置' }))
  await screen.findByText('配置检查通过')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(true)
})

it('preserves a verification error across the automatic readback and allows another check', async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
    ? Response.json({ error: '供应商读取超时，请重试' }, { status: 503 })
    : Response.json({ data: { connection: draft } }))
  vi.stubGlobal('fetch', fetcher)
  render(<OrganizationConnectionForm provider={provider} canConnect canApply />)
  await screen.findByText('配置检查通过')
  fireEvent.click(screen.getByRole('button', { name: '检查连接与读取范围' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  expect(screen.getByRole('alert')).toHaveTextContent('供应商读取超时，请重试')
  expect(screen.getByRole('button', { name: '检查连接与读取范围' })).toBeEnabled()
  expect(screen.queryByText(/本次检查没有写入组织/)).not.toBeInTheDocument()
})

it('separates a failed new draft from the preserved effective configuration', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { connection: {
    ...draft, state: 'verified', effectiveVerified: true, effectiveRevision: 'previous-revision', draftCheckStatus: 'failed',
  } } })))
  render(<OrganizationConnectionForm provider={provider} canConnect canApply />)
  await screen.findByText('配置检查失败')
  expect(screen.getByText('沿用上一份配置')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '应用已验证的新配置' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '检查连接与读取范围' })).toBeEnabled()
})
