/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RoleAssignmentDialog } from './RoleAssignmentDialog'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'test-session') })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    success: true,
    data: { roles: [{ id: 'role-1', code: 'SALES', name: '销售' }] },
  })))
})

describe('RoleAssignmentDialog scoped assignment', () => {
  it('assigns one role at an explicit department scope', async () => {
    const onSubmit = vi.fn(async () => undefined)
    const onSubmitScoped = vi.fn(async () => undefined)
    render(
      <RoleAssignmentDialog
        userId="user-1"
        userName="测试成员"
        currentRoles={[]}
        departments={[{ id: 'dept-1', name: '销售部', status: 'active' } as any]}
        onSubmit={onSubmit}
        onSubmitScoped={onSubmitScoped}
        open
        onOpenChange={vi.fn()}
      />,
    )
    await screen.findByText('销售')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/roles?view=assignable', expect.objectContaining({
      cache: 'no-store',
      headers: { Authorization: 'Bearer test-session' },
    }))
    fireEvent.change(screen.getByLabelText('角色作用域类型'), { target: { value: 'department' } })
    fireEvent.change(screen.getByLabelText('选择部门角色作用域'), { target: { value: 'dept-1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /销售/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSubmitScoped).toHaveBeenCalledWith('role-1', 'dept-1'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows an existing scoped role and revokes it explicitly', async () => {
    const onRevokeScoped = vi.fn(async () => undefined)
    render(
      <RoleAssignmentDialog
        userId="user-1"
        userName="测试成员"
        currentRoles={[]}
        departments={[{ id: 'dept-1', name: '销售部' } as any]}
        scopedRoles={[{
          roleId: 'role-1',
          roleName: '销售',
          roleCode: 'SALES',
          scopeType: 'department',
          scopeId: 'dept-1',
          scopeName: '销售部',
          grantedAt: null,
        }]}
        onSubmit={vi.fn(async () => undefined)}
        onSubmitScoped={vi.fn(async () => undefined)}
        onRevokeScoped={onRevokeScoped}
        open
        onOpenChange={vi.fn()}
      />,
    )
    await screen.findByRole('button', { name: '撤销 销售（销售部）' })
    fireEvent.click(screen.getByRole('button', { name: '撤销 销售（销售部）' }))
    await waitFor(() => expect(onRevokeScoped).toHaveBeenCalledWith('role-1', 'department', 'dept-1'))
  })

  it('shows historical space assignments for revocation while offering only organization and department grants', async () => {
    const onRevokeScoped = vi.fn(async () => undefined)
    render(<RoleAssignmentDialog userId="user-1" userName="测试成员" currentRoles={[]} departments={[]}
      scopedRoles={[{
        roleId: 'role-1', roleName: '销售', roleCode: 'SALES', scopeType: 'space',
        scopeId: 'old-space', scopeName: '历史销售区域', grantedAt: null,
      }]}
      onSubmit={vi.fn(async () => undefined)}
      onRevokeScoped={onRevokeScoped}
      open onOpenChange={vi.fn()} />)

    const scope = await screen.findByRole('combobox', { name: '角色作用域类型' }) as HTMLSelectElement
    expect(Array.from(scope.options, option => option.value)).toEqual(['org', 'department'])
    expect(screen.getByText('历史范围 · 历史销售区域')).toBeInTheDocument()
    expect(screen.getByText('历史绑定 · 仅可撤销')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销 销售（历史销售区域）' }))
    await waitFor(() => expect(onRevokeScoped).toHaveBeenCalledWith('role-1', 'space', 'old-space'))
  })

  it('offers only active departments for new roles and still revokes a disabled department binding', async () => {
    const active = { id: 'active', name: '启用部门', parent_id: null, parent_name: null, member_count: 0, status: 'active' as const }
    const inactive = { ...active, id: 'inactive', name: '已停用部门', status: 'inactive' as const }
    const onSubmitScoped = vi.fn(async () => undefined)
    const onRevokeScoped = vi.fn(async () => undefined)
    const props = {
      userId: 'member', userName: '测试成员', currentRoles: [], open: true, onOpenChange: vi.fn(),
      scopedRoles: [{
        roleId: 'role-1', roleCode: 'SALES', roleName: '销售', scopeType: 'department' as const,
        scopeId: inactive.id, scopeName: inactive.name, grantedAt: null,
      }],
      onSubmit: vi.fn(async () => undefined), onSubmitScoped, onRevokeScoped,
    }
    const { rerender } = render(<RoleAssignmentDialog {...props} departments={[active, inactive]} />)
    await screen.findByRole('checkbox', { name: /销售/ })
    fireEvent.change(screen.getByLabelText('角色作用域类型'), { target: { value: 'department' } })

    expect(screen.getByRole('option', { name: active.name })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: inactive.name })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('选择部门角色作用域'), { target: { value: active.id } })
    fireEvent.click(screen.getByRole('checkbox', { name: /销售/ }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()

    rerender(<RoleAssignmentDialog {...props} departments={[{ ...active, status: 'inactive' }, inactive]} />)
    expect(screen.getByLabelText('选择部门角色作用域')).toHaveValue('')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(onSubmitScoped).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /撤销 销售（已停用部门）/ }))
    await waitFor(() => expect(onRevokeScoped).toHaveBeenCalledWith('role-1', 'department', inactive.id))
  })

  it('limits the shipping operator to organization assignments and keeps its old scope binding revocable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      success: true,
      data: { roles: [
        { id: 'shipping-role', code: 'SHIPPING_OPERATOR', name: '顺丰寄件操作员' },
        { id: 'mixed-role', code: 'FIELD_TEAM', name: '现场团队', permissions: ['shipping:operate', 'contract:view'] },
      ] },
    })))
    const onSubmit = vi.fn(async () => undefined)
    const onSubmitScoped = vi.fn(async () => undefined)
    const onRevokeScoped = vi.fn(async () => undefined)
    render(<RoleAssignmentDialog userId="test-user" userName="测试成员" currentRoles={['shipping-role']}
      departments={[{ id: 'department', name: '部门甲', status: 'active' } as any]}
      scopedRoles={[{
        roleId: 'shipping-role', roleCode: 'SHIPPING_OPERATOR', roleName: '顺丰寄件操作员',
        scopeType: 'department', scopeId: 'department', scopeName: '部门甲', grantedAt: null,
      }]}
      onSubmit={onSubmit} onSubmitScoped={onSubmitScoped} onRevokeScoped={onRevokeScoped}
      open onOpenChange={vi.fn()} />)

    expect(await screen.findByRole('checkbox', { name: /顺丰寄件操作员/ })).toBeChecked()
    expect(screen.getByText('仅整个组织')).toBeInTheDocument()
    const scope = screen.getByRole('combobox', { name: '角色作用域类型' })
    fireEvent.change(scope, { target: { value: 'department' } })
    expect(screen.queryByRole('checkbox', { name: /顺丰寄件操作员/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /现场团队/ })).toBeInTheDocument()
    expect(screen.getByText('历史绑定 · 仅可撤销')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销 顺丰寄件操作员（部门甲）' }))
    await waitFor(() => expect(onRevokeScoped).toHaveBeenCalledWith('shipping-role', 'department', 'department'))

    fireEvent.change(scope, { target: { value: 'org' } })
    expect(screen.getByRole('checkbox', { name: /顺丰寄件操作员/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(['shipping-role']))
    expect(onSubmitScoped).not.toHaveBeenCalled()
  })
})

it('does not reuse a role list after the assignment projection is denied', async () => {
  const props = {
    userId: 'test-user', userName: '测试成员', currentRoles: [], departments: [],
    onSubmit: vi.fn(async () => undefined), onOpenChange: vi.fn(),
  }
  const view = render(<RoleAssignmentDialog {...props} open />)
  await screen.findByRole('checkbox', { name: /销售/ })
  view.rerender(<RoleAssignmentDialog {...props} open={false} />)
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 403 }))
  view.rerender(<RoleAssignmentDialog {...props} open />)

  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取可分配角色')
  expect(screen.queryByRole('checkbox', { name: /销售/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
})

it('keeps a preassigned role selected and allows its removal at organization scope before login', async () => {
  const onSubmit = vi.fn(async () => undefined)
  render(<RoleAssignmentDialog userId="employee" userName="待登录员工" currentRoles={['role-1']}
    pendingRoles={[{ id: 'role-1' }]} organizationOnly open onOpenChange={vi.fn()}
    departments={[]} onSubmit={onSubmit} />)
  const role = await screen.findByRole('checkbox')
  expect(role).toBeChecked()
  expect(screen.getByText('待首次登录生效')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '角色作用域类型' })).toBeDisabled()
  fireEvent.click(role)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([]))
})
