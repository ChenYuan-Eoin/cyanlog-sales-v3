import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DepartmentPermissions } from './DepartmentPermissions'
import { DepartmentRoleRules } from './DepartmentRoleRules'

const orgId = '267550ba-359e-4259-873d-844538fa52a1'
const departmentId = 'd3e767ac-0fb4-4f20-947f-a5ad0870b23d'
const endpoint = `/api/admin/departments/${departmentId}/role-rules`
const readUrl = `${endpoint}?expected_org_id=${orgId}`
const ledger = { role_id: 'ledger-role', role_name: '收寄台账角色', permissions: ['shipping:ledger_view'] }
const dashboard = { role_id: 'dashboard-role', role_name: '经营统计角色', permissions: ['report:dept'] }
const existing = { role_id: dashboard.role_id, role_name: dashboard.role_name, include_subdepartments: false }
const newRule = { role_id: ledger.role_id, role_name: ledger.role_name, include_subdepartments: true }
const snapshot = { org_id: orgId, department_id: departmentId, rules: [existing], available_roles: [ledger, dashboard] }
const preview = { preview_id: 'rule-change-1', expires_at: '2026-11-27T11:00:00Z', added_sources: 4, removed_sources: 0, affected_members: 3 }

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function openEditor() {
  const onSaved = vi.fn()
  render(<DepartmentRoleRules orgId={orgId} departmentId={departmentId} onSaved={onSaved}
    authHeaders={includeJson => includeJson ? { 'Content-Type': 'application/json' } : {} as HeadersInit} />)
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('部门自动角色'))
  return onSaved
}

async function addLedger() {
  const choices = await screen.findByLabelText('选择角色')
  fireEvent.change(choices, { target: { value: ledger.role_id } })
  fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '收寄台账角色 匹配下级部门成员' }))
  fireEvent.click(screen.getByRole('button', { name: '查看规则变更' }))
}

async function continueConfirmation() {
  const first = await screen.findByRole('dialog', { name: '预览部门自动角色变更' })
  fireEvent.click(within(first).getByRole('button', { name: '继续确认' }))
  return screen.getByRole('dialog', { name: '再次确认部门自动角色变更' })
}

it('binds rule settings and preview to the selected department before confirming and reloading member results', async () => {
  const fetcher = vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(Response.json(preview))
    .mockResolvedValueOnce(Response.json({ ...snapshot, rules: [newRule, existing] }))
  const onSaved = openEditor()
  await addLedger()

  const first = await screen.findByRole('dialog', { name: '预览部门自动角色变更' })
  expect(within(first).getByText(/涉及 3 名成员/)).toBeInTheDocument()
  expect(within(first).getByText(/查看收寄台账/)).toBeInTheDocument()
  expect(within(first).getByText(/无规则.*本部门及下级部门成员/)).toBeInTheDocument()
  expect(within(first).queryByRole('button', { name: '确认变更' })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenNthCalledWith(1, readUrl, expect.objectContaining({ cache: 'no-store' }))
  expect(fetcher).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ action: 'preview', expected_org_id: orgId,
      rules: [{ role_id: dashboard.role_id, include_subdepartments: false }, { role_id: ledger.role_id, include_subdepartments: true }] }),
  }))
  const final = await continueConfirmation()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(onSaved).not.toHaveBeenCalled()

  fireEvent.click(within(final).getByRole('button', { name: '确认变更' }))
  expect(await screen.findByText('部门自动角色已保存。')).toBeInTheDocument()
  expect(onSaved).toHaveBeenCalledExactlyOnceWith()
  expect(fetcher).toHaveBeenNthCalledWith(3, endpoint, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ action: 'confirm', expected_org_id: orgId, preview_id: preview.preview_id }),
  }))
  expect(screen.getByRole('checkbox', { name: '收寄台账角色 匹配下级部门成员' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '经营统计角色 匹配下级部门成员' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: '查看规则变更' })).toBeDisabled()
})

it('retains the draft and sends no confirmation when the reviewer cancels', async () => {
  const fetcher = vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(Response.json(preview))
  const onSaved = openEditor()
  await addLedger()
  const final = await continueConfirmation()
  fireEvent.click(within(final).getByRole('button', { name: '取消' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(onSaved).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: '收寄台账角色 匹配下级部门成员' })).toBeChecked()
})

it('does not report success for a response containing a different department', async () => {
  const fetcher = vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(Response.json(preview))
    .mockResolvedValueOnce(Response.json({ ...snapshot, department_id: 'another-department', rules: [existing, newRule] }))
    .mockResolvedValueOnce(Response.json(snapshot))
  const onSaved = openEditor()
  await addLedger()
  const final = await continueConfirmation()
  fireEvent.click(within(final).getByRole('button', { name: '确认变更' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('回读的规则与本次确认不一致')
  await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(readUrl, expect.anything()))
  expect(onSaved).not.toHaveBeenCalled()
  expect(screen.queryByText('部门自动角色已保存。')).not.toBeInTheDocument()
})

it('discards an expired preview on conflict and allows a fresh removal of unavailable rules', async () => {
  const unavailable = { role_id: 'retired-role', role_name: '已停用角色', include_subdepartments: true }
  const saved = { ...snapshot, rules: [unavailable] }
  const fetcher = vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(saved))
    .mockResolvedValueOnce(Response.json(preview))
    .mockResolvedValueOnce(Response.json({ error: '需要重新预览' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(saved))
  const onSaved = openEditor()
  expect(await screen.findByRole('checkbox', { name: '已停用角色 匹配下级部门成员' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '移除 已停用角色 规则' }))
  fireEvent.click(screen.getByRole('button', { name: '查看规则变更' }))
  const final = await continueConfirmation()
  fireEvent.click(within(final).getByRole('button', { name: '确认变更' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('请核对后重新预览')
  await waitFor(() => expect(screen.getByRole('button', { name: '移除 已停用角色 规则' })).toBeEnabled())
  expect(fetcher).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
    body: JSON.stringify({ action: 'preview', expected_org_id: orgId, rules: [] }),
  }))
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(screen.queryByRole('button', { name: '确认变更' })).not.toBeInTheDocument()
  expect(onSaved).not.toHaveBeenCalled()
})

it('shows an independent retry when the role rules endpoint is unavailable', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(snapshot))
  openEditor()
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取部门自动角色')
  expect(screen.queryByRole('button', { name: '查看规则变更' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取角色规则' }))
  expect(await screen.findByRole('checkbox', { name: '经营统计角色 匹配下级部门成员' })).not.toBeChecked()
})

it('keeps direct department grants editable when automatic rules cannot load', async () => {
  const fetcher = vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({
      org_id: orgId,
      department_id: departmentId,
      permissions: [],
      include_subdepartments: false,
      available_permissions: ['shipping:ledger_view'],
      permissions_editable: true,
      permission_catalog: [],
    }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
  render(<DepartmentPermissions orgId={orgId} departmentId={departmentId} authHeaders={() => ({})} />)
  fireEvent.click(await screen.findByText('部门权限设置'))
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('部门自动角色'))

  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取部门自动角色')
  expect(fetcher).toHaveBeenLastCalledWith(readUrl, expect.anything())
  const direct = screen.getByRole('checkbox', { name: '查看收寄台账' })
  expect(direct).toBeEnabled()
  fireEvent.click(direct)
  expect(screen.getByRole('button', { name: '保存部门授权' })).toBeEnabled()
})
