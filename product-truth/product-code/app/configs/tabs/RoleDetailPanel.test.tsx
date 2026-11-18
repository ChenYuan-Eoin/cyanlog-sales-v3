import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RoleDetailPanel } from './RoleDetailPanel'
import { confirmAction, error } from '@/lib/toast'
import { hasPermission } from '@/lib/permissions'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const role = { id: 'root', code: 'SUPER_ADMIN', name: '超级管理员', description: null, permissions: ['*'] }
const defaults = { role, currentUserId: 'actor', saving: false, users: [], departments: [], _spaces: [] }

function openPermissions() {
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
}

describe('RoleDetailPanel explicit permission editing', () => {
  it('renders wildcard-derived access as effective without checking its explicit grant', () => {
    const onSave = vi.fn()
    render(<RoleDetailPanel {...defaults} permissionsEditable onSave={onSave} />)
    openPermissions()
    const financial = screen.getByRole('checkbox', { name: /财务报表访问/ })
    expect(financial).toBeEnabled()
    expect(financial).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /管理后台访问/ })).toBeDisabled()
    expect(screen.getAllByText('当前有效').length).toBeGreaterThan(0)
    fireEvent.click(financial)
    expect(financial).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    const saved = onSave.mock.calls[0][0] as string[]
    expect(saved).toContain('report:finance')
    expect(hasPermission(saved, 'report:finance')).toBe(true)
    expect(hasPermission(saved, 'report:dept')).toBe(true)
    expect(hasPermission(saved, 'config:write')).toBe(true)
  })

  it('shows dependency-derived access without presenting it as an explicit grant', () => {
    render(
      <RoleDetailPanel
        {...defaults}
        role={{ id: 'legal', code: 'LEGAL', name: '法务', description: null, permissions: ['contract:write'] }}
        permissionsEditable
        onSave={vi.fn()}
      />
    )
    openPermissions()
    expect(screen.getByRole('checkbox', { name: /合同编辑/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /合同审核执行/ })).not.toBeChecked()
    expect(screen.getAllByText('由 合同编辑 依赖生效').length).toBeGreaterThan(0)
  })

  it('changes only the clicked explicit checkbox when dependencies become effective', () => {
    render(
      <RoleDetailPanel
        {...defaults}
        role={{ id: 'sales', code: 'SALES', name: '销售', description: null, permissions: [] }}
        permissionsEditable
        onSave={vi.fn()}
      />
    )
    openPermissions()
    const configWrite = screen.getByRole('checkbox', { name: /配置中心修改/ })
    const configPublish = screen.getByRole('checkbox', { name: /配置发布/ })
    const configRead = screen.getByRole('checkbox', { name: /配置中心查看/ })
    fireEvent.click(configWrite)
    expect(configWrite).toBeChecked()
    expect(configPublish).not.toBeChecked()
    expect(configRead).not.toBeChecked()
    expect(screen.getAllByText('由 配置中心修改 依赖生效').length).toBeGreaterThan(0)
  })

  it('keeps group select and clear as explicit bulk actions', () => {
    const onSave = vi.fn()
    render(
      <RoleDetailPanel
        {...defaults}
        role={{ id: 'sales', code: 'SALES', name: '销售', description: null, permissions: ['config:*'] }}
        permissionsEditable
        onSave={onSave}
      />
    )
    openPermissions()
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '选择后台访问全部权限' }))
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '清除后台访问全部权限' }))
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    const saved = onSave.mock.calls[0][0] as string[]
    expect(saved.some((key) => key.startsWith('config:'))).toBe(false)
  })

  it('preserves an explicit draft through a failed save', () => {
    const onSave = vi.fn()
    const draftRole = { id: 'sales', code: 'SALES', name: '销售', description: null, permissions: ['report:finance'] }
    const { rerender } = render(
      <RoleDetailPanel {...defaults} role={draftRole} permissionsEditable onSave={onSave} />
    )
    openPermissions()
    fireEvent.click(screen.getByRole('checkbox', { name: /财务报表访问/ }))
    rerender(<RoleDetailPanel {...defaults} role={draftRole} permissionsEditable saving onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeDisabled()
    rerender(<RoleDetailPanel {...defaults} role={draftRole} permissionsEditable onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
  })
})

it('lists a pending member and revokes only this role before first login', async () => {
  const shipping = { id: 'ship', code: 'SHIPPING', name: '寄件', description: null, permissions: [] }
  const user = {
    id: 'employee', display_name: '待登录成员', email: '', title: '', primary_dept_name: '行政组',
    role_names: '', role_ids: [], role_codes: [], status: 'inactive', membership_status: 'invited' as const,
    can_preassign_org_roles: true, pending_org_roles: [shipping, { id: 'another', code: 'OTHER', name: '其他' }],
  }
  const send = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', send)
  vi.mocked(confirmAction).mockResolvedValue(true)
  const onRefresh = vi.fn()
  render(<RoleDetailPanel {...defaults} role={shipping} users={[user]} onSave={vi.fn()} onRefresh={onRefresh} />)
  expect(screen.getByRole('tab', { name: '员工分配 (1)' })).toBeInTheDocument()
  expect(screen.getAllByText('待首次登录生效').length).toBeGreaterThan(0)
  fireEvent.click(screen.getAllByRole('button', { name: '从角色中移除 待登录成员' })[0])
  await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ role_ids: ['another'], expected_role_ids: ['ship', 'another'] })
})

it('retains the selected member snapshot across a directory refresh and clears selection on conflict', async () => {
  const shipping = { id: 'ship', code: 'SHIP', name: '寄件', description: null, permissions: [] }
  const member = {
    id: 'member', display_name: '员工甲', email: '', title: '', primary_dept_name: '行政组',
    role_names: '', status: 'inactive', membership_status: 'invited' as const, can_preassign_org_roles: true,
    pending_org_roles: [{ id: 'other', name: '其他', code: 'OTHER' }],
  }
  const changed = { ...member, pending_org_roles: [] }
  const message = '该成员的角色已变更，请核对最新角色后重新选择。'
  const send = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: 'ROLE_ASSIGNMENT_CHANGED', error: message }) })
  vi.stubGlobal('fetch', send)
  const props = { ...defaults, role: shipping, onSave: vi.fn(), onRefresh: vi.fn() }
  const view = render(<RoleDetailPanel {...props} users={[member]} />)
  fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
  view.rerender(<RoleDetailPanel {...props} users={[changed]} />)
  fireEvent.click(screen.getByRole('button', { name: '添加成员到角色' }))
  await waitFor(() => expect(error).toHaveBeenCalledWith(message))
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ role_ids: ['other', 'ship'], expected_role_ids: ['other'] })
  expect(props.onRefresh).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
