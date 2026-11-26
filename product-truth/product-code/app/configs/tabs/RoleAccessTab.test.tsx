import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import RoleAccessTab from './RoleAccessTab'
import type { OrgSummaryPayload, OrgSummaryUser, ScopedRoleAssignment } from '../types'
import type { RoleMetadataChange } from './role-metadata'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
afterEach(cleanup)

const roles = [{ id: 'root', code: 'SUPER_ADMIN', name: '超级管理员', description: null, permissions: ['*'], sort_order: 1 }]
const defaults = { roles, currentUserId: 'actor', savingRoleId: null, orgSummary: null, onSaveRole: vi.fn(), onRefresh: vi.fn() }

it('opens the functional permission matrix on demand and leaves placeholders out of role settings', () => {
  render(<RoleAccessTab {...defaults} modulePermissionCatalog={[{
    id: 'shipping', label: '寄件', description: '', items: [{
      key: 'shipping:owner_view',
      label: '查看本人寄件记录',
      description: '查看本人寄件。',
      dependencies: [],
      moduleKey: 'shipping',
      capabilityLevel: 'L2',
      grantSubjectTypes: ['role'],
      scopeTypes: ['self'],
    }],
  }]} />)
  expect(screen.queryByText('平台权限定义')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '权限矩阵' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
  expect(screen.queryByText('沿用现有规则')).not.toBeInTheDocument()
  expect(screen.queryByText('查看报价、创建报价、编辑本人报价')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '权限矩阵' }))
  const matrix = within(screen.getByRole('dialog', { name: '权限矩阵' }))
  expect(matrix.getByRole('columnheader', { name: 'L2 个人操作' })).toBeVisible()
  expect(matrix.getByRole('row', { name: /自助收寄/ })).toHaveTextContent('查看本人寄件记录')
  expect(matrix.queryByText('提交本人寄件')).not.toBeInTheDocument()
  expect(matrix.queryByRole('checkbox')).not.toBeInTheDocument()
})

describe('RoleAccessTab capability propagation', () => {
  it('forwards server editing capability and revokes editing when it changes', () => {
    const props = { ...defaults, roles: [{ ...roles[0], id: 'business', code: 'ADMIN', name: '管理员' }] }
    const { rerender } = render(<RoleAccessTab {...props} permissionsEditable />)
    fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeEnabled()
    rerender(<RoleAccessTab {...props} permissionsEditable={false} permissionsEditBlockReason="当前账号只可查看角色。" />)
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeDisabled()
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
    member_actions: {
      edit: false, assignRoles: true, invite: false, manageLogin: false, manageEmployment: false,
      removeMembership: false, manageDepartments: false, bindExternalIdentity: false,
    },
  }
  const view = render(<RoleAccessTab {...defaults} roles={[sales, manager]} orgSummary={orgSummary} />)

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
  expect(within(screen.getByRole('table')).getByRole('button', { name: '从角色中移除 部门级销售' })).toBeEnabled()
  expect(screen.getAllByRole('button', { name: '从角色中移除 组织级销售' }).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
  expect(within(screen.getByRole('dialog')).getByText('部门级销售')).toBeInTheDocument()

  view.rerender(<RoleAccessTab {...defaults} roles={[sales, manager]} orgSummary={{
    ...orgSummary, member_actions: { ...orgSummary.member_actions!, assignRoles: false },
  }} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '从角色中移除 组织级销售' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '从角色中移除 部门级销售' })).not.toBeInTheDocument()
})

it('shows unavailable counts rather than zero while organization data is missing', () => {
  render(<RoleAccessTab {...defaults} />)
  expect(screen.getByText('SUPER_ADMIN · 已生效 待核对 · 待生效 待核对 · 生效作用域绑定 待核对')).toBeInTheDocument()
})

it('only lets verified system super administrators appoint the canonical role', () => {
  const legacyRole = {
    id: 'org-super', code: 'ORG_SUPER_ADMIN', name: '组织超级管理员',
    description: null, permissions: ['role:manage'], sort_order: 2,
  }
  const baselineRole = { ...legacyRole, id: 'baseline', code: 'FXIAOKE_BASELINE', name: '纷享基础查看' }
  const allRoles = [...roles, legacyRole, baselineRole]
  const member: OrgSummaryUser = {
    id: 'historical-member', display_name: '已有绑定员工', email: '', title: '', primary_dept_name: '',
    role_names: '组织超级管理员,纷享基础查看', role_ids: [legacyRole.id, baselineRole.id],
    status: 'active', membership_status: 'active', employment_status: 'active', login_enabled: true,
  }
  const orgSummary: OrgSummaryPayload = {
    organization: { id: 'org-1', name: '当前组织' }, roles: allRoles, users: [member], departments: [], spaces: [],
    role_membership_stats: {
      effectiveAvailable: true, pendingAvailable: true, activeSpaceIds: [], systemSuperAdminAssignableMemberIds: [],
    },
  }
  const props = { ...defaults, roles: allRoles, orgSummary, permissionsEditable: true }
  const { rerender } = render(<RoleAccessTab {...props} />)
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()

  rerender(<RoleAccessTab {...props} systemSuperAdminAuthority={{ orgId: 'other-org' }} />)
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()

  rerender(<RoleAccessTab {...props} systemSuperAdminAuthority={{ orgId: 'org-1' }} />)
  expect(screen.getByRole('button', { name: '添加成员' })).toBeEnabled()
  expect(screen.getByRole('button', { name: /^超级管理员 SUPER_ADMIN/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: /ORG_SUPER_ADMIN|FXIAOKE_BASELINE/ })).not.toBeInTheDocument()
  expect(screen.queryByText('历史角色')).not.toBeInTheDocument()
  for (const code of [legacyRole.code, baselineRole.code]) {
    fireEvent.change(screen.getByPlaceholderText('搜索角色...'), { target: { value: code } })
    expect(screen.getByText('未找到匹配的角色')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(code) })).not.toBeInTheDocument()
  }

  rerender(<RoleAccessTab {...props} systemSuperAdminAuthority={{ orgId: 'org-1' }}
    orgSummary={{ ...orgSummary, role_membership_stats: undefined }} />)
  expect(screen.getByText('在职名单暂不可用')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()
})

const metadataRole = { id: 'sales', code: 'SALES', name: '销售', description: '保留说明', permissions: [], sort_order: 2, metadata_revision: 4 }
const metadataOrg: OrgSummaryPayload = {
  organization: { id: 'org-1', name: '当前组织' }, roles: [metadataRole], users: [], departments: [], spaces: [],
}
const metadataAuthority = { orgId: 'org-1' }

it('only offers metadata controls to an exact-organization system administrator and locks special roles', () => {
  const retired = { ...metadataRole, id: 'retired', code: 'FXIAOKE_BASELINE', name: '历史角色', metadata_editable: true }
  const props = { ...defaults, roles: [...roles, retired, metadataRole], orgSummary: metadataOrg, onMaintainRole: vi.fn() }
  const view = render(<RoleAccessTab {...props} systemSuperAdminAuthority={{ orgId: 'other' }} />)
  expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
  view.rerender(<RoleAccessTab {...props} systemSuperAdminAuthority={metadataAuthority} />)
  expect(screen.getByRole('button', { name: '新建角色' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /FXIAOKE_BASELINE/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '归档' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /销售 SALES/ }))
  expect(screen.getByRole('button', { name: '改名' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '归档' })).toBeEnabled()
})

it('selects a created role and keeps the same selection when its metadata changes', async () => {
  const calls = vi.fn()
  function EditableRoles() {
    const [records, update] = useState([metadataRole])
    async function maintain(change: RoleMetadataChange) {
      calls(change)
      if (change.type === 'create') {
        update(current => [...current, { ...metadataRole, id: 'new', code: 'CUSTOM_CREATED', name: change.name, description: change.description, metadata_revision: 0 }])
        return 'new'
      }
      if (change.type === 'rename') {
        update(current => current.map(role => role.id === change.roleId ? { ...role, name: change.name } : role))
      }
      return change.roleId
    }
    return <RoleAccessTab {...defaults} roles={records} orgSummary={metadataOrg} systemSuperAdminAuthority={metadataAuthority} onMaintainRole={maintain} />
  }
  render(<EditableRoles />)
  fireEvent.click(screen.getByRole('button', { name: '新建角色' }))
  const create = within(screen.getByRole('dialog', { name: '新建角色' }))
  fireEvent.change(create.getByRole('textbox', { name: '角色名称' }), { target: { value: '  收寄审核  ' } })
  fireEvent.change(create.getByRole('textbox', { name: '角色说明' }), { target: { value: '审核预提报' } })
  fireEvent.click(create.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /收寄审核 CUSTOM_CREATED/ })).toHaveAttribute('aria-pressed', 'true'))
  expect(calls).toHaveBeenCalledWith({ type: 'create', name: '收寄审核', description: '审核预提报' })

  fireEvent.click(screen.getByRole('button', { name: '改名' }))
  const rename = within(screen.getByRole('dialog', { name: '修改角色资料' }))
  expect(rename.getByRole('textbox', { name: '角色说明' })).toHaveValue('审核预提报')
  fireEvent.change(rename.getByRole('textbox', { name: '角色名称' }), { target: { value: '收寄核对' } })
  fireEvent.click(rename.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /收寄核对 CUSTOM_CREATED/ })).toHaveAttribute('aria-pressed', 'true'))
  expect(calls).toHaveBeenLastCalledWith({ type: 'rename', roleId: 'new', expectedRevision: 0, name: '收寄核对', description: '审核预提报' })
})

it('confirms archive and keeps the role visible on a binding conflict', async () => {
  const maintain = vi.fn().mockRejectedValue(new Error('此角色仍有成员或待生效绑定，请解除绑定后再归档。'))
  render(<RoleAccessTab {...defaults} roles={[metadataRole]} orgSummary={metadataOrg} systemSuperAdminAuthority={metadataAuthority} onMaintainRole={maintain} />)
  fireEvent.click(screen.getByRole('button', { name: '归档' }))
  const dialog = within(screen.getByRole('dialog', { name: '归档角色' }))
  expect(maintain).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: '确认归档' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('此角色仍有成员或待生效绑定')
  expect(maintain).toHaveBeenCalledExactlyOnceWith({ type: 'archive', roleId: 'sales', expectedRevision: 4 })
  fireEvent.click(dialog.getByRole('button', { name: '取消' }))
  expect(screen.getByRole('button', { name: /销售 SALES/ })).toHaveAttribute('aria-pressed', 'true')
})

it('keeps metadata actions disabled while the current permission draft is unsaved', async () => {
  render(<RoleAccessTab {...defaults} roles={[metadataRole]} orgSummary={metadataOrg} permissionsEditable
    systemSuperAdminAuthority={metadataAuthority} onMaintainRole={vi.fn()} />)
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '配置发布' }))
  expect(await screen.findByText('请先保存当前角色的权限改动。')).toBeVisible()
  expect(screen.getByRole('button', { name: '新建角色' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '改名' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '归档' })).toBeDisabled()
})
