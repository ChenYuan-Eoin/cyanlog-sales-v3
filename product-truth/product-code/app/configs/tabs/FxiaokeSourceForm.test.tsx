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
  for (const [label, value] of [['AppID', 'FSAID_test'], ['APPSecret', 'test-secret'], ['永久授权码', 'test-code'], ['员工 ID', '123']]) {
    fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: '保存应用配置' }))
  await screen.findByText('配置已保存。请预览通讯录，核对企业及读取范围。')
  expect((screen.getByLabelText('APPSecret') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: '验证并预览通讯录' }))
  await screen.findByText('结果为空，不会停用任何人员。')
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'preview', revision: connection.revision })
  fireEvent.change(screen.getByLabelText('员工 ID'), { target: { value: '456' } })
  expect(screen.queryByText('结果为空，不会停用任何人员。')).toBeNull()
  expect((screen.getByRole('button', { name: '验证并预览通讯录' }) as HTMLButtonElement).disabled).toBe(true)
})
it('hides internal enterprise fields and keeps entries when connection fails', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { connection: null } }))
    .mockResolvedValueOnce(Response.json({ error: '连接失败，请重试。' }, { status: 502 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<FxiaokeSourceForm />)
  await waitFor(() => expect((screen.getByRole('button', { name: '保存应用配置' }) as HTMLButtonElement).disabled).toBe(false))
  for (const [label, value] of [['AppID', 'FSAID_test'], ['APPSecret', 'secret'], ['永久授权码', 'code'], ['员工 ID', '123']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  expect(screen.queryByText(/企业账号（ea）/)).toBeNull()
  expect(screen.queryByRole('button', { name: '从纷享获取企业账号' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存应用配置' }))
  await screen.findByText('连接失败，请重试。')
  expect((screen.getByLabelText('永久授权码') as HTMLInputElement).value).toBe('code')
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).connection).not.toHaveProperty('expectedEa')
})
it('explains where to find required values', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ data: { connection: null } })))
  render(<FxiaokeSourceForm />)
  await waitFor(() => expect((screen.getByRole('button', { name: '保存应用配置' }) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByText(/员工ID.*查看/)).toBeTruthy()
  expect(screen.getByText(/APPSecret 下方、token 上方/)).toBeTruthy()
  const diagram = screen.getByLabelText('永久授权码位置示意')
  expect(diagram.textContent).toContain('永久授权码　← 复制这一行')
  expect(diagram.textContent).toContain('此图为位置示意，不含真实凭据。')
  fireEvent.click(screen.getAllByText('如何填写？')[2])
  expect(diagram.closest('details')?.open).toBe(true)
})
