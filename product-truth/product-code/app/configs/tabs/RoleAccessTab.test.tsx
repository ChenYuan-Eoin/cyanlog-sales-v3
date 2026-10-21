import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import RoleAccessTab from './RoleAccessTab'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
afterEach(cleanup)

const roles = [{ id: 'root', code: 'SUPER_ADMIN', name: '超级管理员', description: null, permissions: ['*'], sort_order: 1 }]
const defaults = { roles, currentUserId: 'actor', savingRoleId: null, orgSummary: null, onSaveRole: vi.fn(), onRefresh: vi.fn() }

describe('RoleAccessTab capability propagation', () => {
  it('forwards server editing capability and revokes editing when it changes', () => {
    const { rerender } = render(<RoleAccessTab {...defaults} permissionsEditable />)
    fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeEnabled()
    rerender(<RoleAccessTab {...defaults} permissionsEditable={false} permissionsEditBlockReason="当前账号只可查看角色。" />)
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeDisabled()
    expect(screen.getByText('当前账号只可查看角色。')).toBeInTheDocument()
  })
})
