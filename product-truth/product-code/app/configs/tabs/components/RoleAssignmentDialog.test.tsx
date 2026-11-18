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
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    success: true,
    data: { roles: [{ id: 'role-1', code: 'SALES', name: '销售', description: '销售角色' }] },
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
        departments={[{ id: 'dept-1', name: '销售部' } as any]}
        spaces={[]}
        onSubmit={onSubmit}
        onSubmitScoped={onSubmitScoped}
        open
        onOpenChange={vi.fn()}
      />,
    )
    await screen.findByText('销售')
    fireEvent.change(screen.getByLabelText('角色作用域类型'), { target: { value: 'department' } })
    fireEvent.change(screen.getByLabelText('选择部门角色作用域'), { target: { value: 'dept-1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /销售/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSubmitScoped).toHaveBeenCalledWith('role-1', 'department', 'dept-1'))
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
        spaces={[]}
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
})

it('keeps a preassigned role selected and allows its removal at organization scope before login', async () => {
  const onSubmit = vi.fn(async () => undefined)
  render(<RoleAssignmentDialog userId="employee" userName="待登录员工" currentRoles={['role-1']}
    pendingRoles={[{ id: 'role-1' }]} organizationOnly open onOpenChange={vi.fn()}
    departments={[]} spaces={[]} onSubmit={onSubmit} />)
  const role = await screen.findByRole('checkbox')
  expect(role).toBeChecked()
  expect(screen.getByText('待首次登录生效')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '角色作用域类型' })).toBeDisabled()
  fireEvent.click(role)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([]))
})
