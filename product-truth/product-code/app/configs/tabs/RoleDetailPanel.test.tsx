import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RoleDetailPanel } from './RoleDetailPanel'
import { hasPermission } from '@/lib/permissions'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
afterEach(cleanup)

const role = { id: 'root', code: 'SUPER_ADMIN', name: '超级管理员', description: null, permissions: ['*'] }
const defaults = { role, currentUserId: 'actor', saving: false, users: [], departments: [], _spaces: [] }

function openPermissions() {
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
}

describe('RoleDetailPanel effective permission editing', () => {
  it('lets authorized root edit business permissions and save an effective revocation', () => {
    const onSave = vi.fn()
    render(<RoleDetailPanel {...defaults} permissionsEditable onSave={onSave} />)
    openPermissions()
    const financial = screen.getByRole('checkbox', { name: /财务报表访问/ })
    expect(financial).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: /管理后台访问/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /角色权限管理/ })).toBeDisabled()
    fireEvent.click(financial)
    expect(financial).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    const saved = onSave.mock.calls[0][0] as string[]
    expect(hasPermission(saved, 'report:finance')).toBe(false)
    expect(hasPermission(saved, 'report:dept')).toBe(true)
    expect(hasPermission(saved, 'config:write')).toBe(true)
    expect(hasPermission(saved, 'role:manage')).toBe(true)
  })

  it('does not assume editing authorization from the selected role name', () => {
    render(<RoleDetailPanel {...defaults} onSave={vi.fn()} permissionsEditBlockReason="仅当前组织的超级管理员可以修改角色权限。" />)
    openPermissions()
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /保存更改|已保存/ })).not.toBeInTheDocument()
    expect(screen.getByText('仅当前组织的超级管理员可以修改角色权限。')).toBeInTheDocument()
  })

  it('preserves the draft through a failed save and resets only to new server permissions', () => {
    const onSave = vi.fn()
    const { rerender } = render(<RoleDetailPanel {...defaults} permissionsEditable onSave={onSave} />)
    openPermissions()
    fireEvent.click(screen.getByRole('checkbox', { name: /财务报表访问/ }))
    rerender(<RoleDetailPanel {...defaults} permissionsEditable saving onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeDisabled()
    rerender(<RoleDetailPanel {...defaults} permissionsEditable onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
    rerender(<RoleDetailPanel {...defaults} role={{ ...role, permissions: ['report:finance'] }} permissionsEditable onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeChecked()
    expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
  })
})
