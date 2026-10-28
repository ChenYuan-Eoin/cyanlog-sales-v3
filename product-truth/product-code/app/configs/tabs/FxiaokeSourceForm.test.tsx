import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FxiaokeSourceForm } from './FxiaokeSourceForm'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }))
it('saves masked credentials, previews saved revision, and invalidates preview after edits', async () => {
  const connection = { appId: 'FSAID_test', expectedEa: 'example', apiUserId: '123', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', configured: true, lastCheckStatus: 'not_checked', lastCheckedAt: null, lastError: null }
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { connection: null } }))
    .mockResolvedValueOnce(Response.json({ data: { connection } }))
    .mockResolvedValueOnce(Response.json({ data: { preview: { ea: 'example', departments: [], employees: [], checkedAt: '2026-10-27T00:00:00Z', warnings: ['结果为空，不会停用任何人员。'] } } }))
  vi.stubGlobal('fetch', fetchMock)
  render(<FxiaokeSourceForm />)
  await waitFor(() => expect((screen.getByRole('button', { name: '保存应用配置' }) as HTMLButtonElement).disabled).toBe(false))
  for (const [label, value] of [['AppID', 'FSAID_test'], ['APPSecret', 'test-secret'], ['永久授权码', 'test-code'], ['企业账号（ea）', 'example'], ['同步执行员工 ID', '123']]) {
    fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: '保存应用配置' }))
  await screen.findByText('配置已保存。请预览通讯录，核对企业及读取范围。')
  expect((screen.getByLabelText('APPSecret') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: '验证并预览通讯录' }))
  await screen.findByText('结果为空，不会停用任何人员。')
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'preview', revision: connection.revision })
  fireEvent.change(screen.getByLabelText('企业账号（ea）', { exact: false }), { target: { value: 'other' } })
  expect(screen.queryByText('结果为空，不会停用任何人员。')).toBeNull()
  expect((screen.getByRole('button', { name: '验证并预览通讯录' }) as HTMLButtonElement).disabled).toBe(true)
})
it('retrieves the enterprise account and clears it if application credentials change', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { connection: null } }))
    .mockResolvedValueOnce(Response.json({ data: { enterprise: { ea: 'ones001' } } }))
  vi.stubGlobal('fetch', fetchMock)
  render(<FxiaokeSourceForm />)
  await waitFor(() => expect((screen.getByRole('button', { name: '保存应用配置' }) as HTMLButtonElement).disabled).toBe(false))
  for (const [label, value] of [['AppID', 'FSAID_test'], ['APPSecret', 'secret'], ['永久授权码', 'code']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: '从纷享获取企业账号' }))
  await screen.findByText('已从纷享获取企业账号，请核对是否为目标企业，再保存配置。')
  expect((screen.getByLabelText('企业账号（ea）') as HTMLInputElement).value).toBe('ones001')
  fireEvent.change(screen.getByLabelText('AppID'), { target: { value: 'another' } })
  expect((screen.getByLabelText('企业账号（ea）') as HTMLInputElement).value).toBe('')
})
