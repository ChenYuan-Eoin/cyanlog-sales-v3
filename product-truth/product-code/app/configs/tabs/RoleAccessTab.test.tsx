import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import RoleAccessTab from './RoleAccessTab'
import type { OrgSummaryPayload, OrgSummaryUser, ScopedRoleAssignment } from '../types'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
vi.mock('./PermissionRegistryPanel', () => ({ PermissionRegistryPanel: () => null }))
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

it('uses exactly the same effective, pending and scoped counts on the role list and in details', () => {
  const sales = { id: 'sales', code: 'SALES', name: '销售', description: null, permissions: ['quote:create'], sort_order: 1 }
  const manager = { ...sales, id: 'manager', code: 'SALES_MANAGER', name: '销售经理', sort_order: 2 }
  const direct: ScopedRoleAssignment = {
    roleId: sales.id, roleCode: sales.code, roleName: sales.name, scopeType: 'org', scopeId: 'org', scopeName: '组织', grantedAt: null,
  }
  const scoped: ScopedRoleAssignment = { ...direct, scopeType: 'department', scopeId: 'dept', scopeName: '销售组' }
  const member: OrgSummaryUser = {
    id: 'user', display_name: '组织级销售', email: '', title: '', primary_dept_name: '销售组', role_names: '销售',
    role_ids: [sales.id], scoped_roles: [direct, scoped], status: 'active', membership_status: 'active', employment_status: 'active', login_enabled: true,
  }
  const orgSummary: OrgSummaryPayload = {
    organization: { id: 'org', name: '当前组织' },
    roles: [sales, manager],
    users: [
      member,
      { ...member, id: 'scoped', display_name: '部门级销售', role_ids: [], scoped_roles: [scoped] },
      {
        ...member, id: 'pending', display_name: '待登录销售', role_ids: [], scoped_roles: [],
        status: 'inactive', membership_status: 'invited', login_enabled: false, can_preassign_org_roles: true, pending_org_roles: [sales],
      },
      {
        ...member, id: 'manager', display_name: '另一角色成员', role_names: manager.name, role_ids: [manager.id],
        scoped_roles: [{ ...direct, roleId: manager.id, roleCode: manager.code, roleName: manager.name }],
      },
    ],
    departments: [{ id: 'dept', name: '销售组', status: 'active', parent_name: null, member_count: 3 }],
    spaces: [{ id: 'legacy', name: '历史销售区域', department_id: 'dept', department_name: '销售组' }],
    directory_roster: { status: 'ready', asOf: '2026-11-25T00:00:00Z', members: [{ id: member.id, departmentIds: ['dept'] }] },
    role_membership_stats: { effectiveAvailable: true, pendingAvailable: true, activeSpaceIds: [] },
  }
  render(<RoleAccessTab {...defaults} roles={[sales, manager]} orgSummary={orgSummary} />)

  const listButton = screen.getByRole('button', { name: '销售 SALES，已生效 2，待生效 1，生效作用域绑定 3' })
  expect(within(listButton).getByText('已生效 2')).toBeInTheDocument()
  expect(within(listButton).getByText('生效绑定 3')).toBeInTheDocument()
  expect(screen.getByText('SALES · 已生效 2 · 待生效 1 · 生效作用域绑定 3')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '员工分配 (3)' })).toBeInTheDocument()
  expect(screen.queryByText('另一角色成员')).not.toBeInTheDocument()
  expect(screen.getAllByText('部门绑定').length).toBeGreaterThan(0)
  const summary = screen.getByRole('heading', { name: '组织作用域' }).parentElement!
  expect(within(summary).getByText('同步在职').parentElement).toHaveTextContent('1')
  expect(within(summary).queryByText('空间')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '从角色中移除 部门级销售' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '从角色中移除 组织级销售' }).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
  expect(within(screen.getByRole('dialog')).getByText('部门级销售')).toBeInTheDocument()
})

it('shows unavailable counts rather than zero while organization data is missing', () => {
  render(<RoleAccessTab {...defaults} />)
  expect(screen.getByText('SUPER_ADMIN · 已生效 待核对 · 待生效 待核对 · 生效作用域绑定 待核对')).toBeInTheDocument()
})

it('allows organization administrator member editing only with matching authority and a verified roster', () => {
  const orgAdmin = {
    id: 'org-super', code: 'ORG_SUPER_ADMIN', name: '组织超级管理员',
    description: null, permissions: ['role:manage'], sort_order: 2,
  }
  const orgSummary: OrgSummaryPayload = {
    organization: { id: 'org-1', name: '当前组织' }, roles: [orgAdmin], users: [], departments: [], spaces: [],
    role_membership_stats: {
      effectiveAvailable: true, pendingAvailable: true, activeSpaceIds: [], orgSuperAdminAssignableMemberIds: [],
    },
  }
  const props = { ...defaults, roles: [orgAdmin], orgSummary, permissionsEditable: true }
  const { rerender } = render(<RoleAccessTab {...props} />)
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()

  rerender(<RoleAccessTab {...props} orgSuperAdminAuthority={{ orgId: 'other-org' }} />)
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()

  rerender(<RoleAccessTab {...props} orgSuperAdminAuthority={{ orgId: 'org-1' }} />)
  expect(screen.getByRole('button', { name: '添加成员' })).toBeEnabled()

  rerender(<RoleAccessTab {...props} orgSuperAdminAuthority={{ orgId: 'org-1' }}
    orgSummary={{ ...orgSummary, role_membership_stats: undefined }} />)
  expect(screen.getByText('当前组织的在职成员暂无法核对，请刷新后重试。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()
})
