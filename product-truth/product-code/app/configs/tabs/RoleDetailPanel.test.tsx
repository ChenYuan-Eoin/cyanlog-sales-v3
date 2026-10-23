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
