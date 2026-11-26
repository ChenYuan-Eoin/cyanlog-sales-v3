import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RoleDetailPanel } from './RoleDetailPanel'
import { confirmAction, error } from '@/lib/toast'
import { hasPermission } from '@/lib/permissions'
import { SHIPPING_ACTION_DEFINITIONS, SHIPPING_WORKBENCH_ACTION_KEYS, shippingActionViewDependency, type ShippingActionKey } from '@/lib/module-access'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const role = { id: 'root', code: 'SUPER_ADMIN', name: '超级管理员', description: null, permissions: ['*'] }
const defaults = { role, currentUserId: 'actor', saving: false, users: [], departments: [], canAssignBusinessRoles: true }
function openPermissions() {
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))
}

describe('RoleDetailPanel explicit permission editing', () => {
  it('honors the server read-only policy for a fixed role even for an editor', () => {
    const onSave = vi.fn()
    render(<RoleDetailPanel {...defaults} permissionsEditable onSave={onSave} role={{
      id: 'fixed', code: 'FXIAOKE_BASELINE', name: '纷享基础', description: null, permissions: ['contract:view'],
      permissions_edit_block_reason: '纷享基础角色由系统管理，权限固定为只读。',
    }} />)
    openPermissions()
    expect(screen.getByText('纷享基础角色由系统管理，权限固定为只读。')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '保存授权' })).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders wildcard-derived access as effective without checking its explicit grant', () => {
    const onSave = vi.fn()
    render(<RoleDetailPanel {...defaults} role={{ ...role, id: 'admin', code: 'ADMIN', name: '管理员' }} permissionsEditable onSave={onSave} />)
    openPermissions()
    const publish = screen.getByRole('checkbox', { name: /配置发布/ })
    expect(publish).toBeEnabled()
    expect(publish).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /管理后台/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('当前有效').length).toBeGreaterThan(0)
    fireEvent.click(publish)
    expect(publish).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
    const saved = onSave.mock.calls[0][0] as string[]
    expect(saved).toContain('config:publish')
    expect(hasPermission(saved, 'config:publish')).toBe(true)
    expect(hasPermission(saved, 'report:dept')).toBe(true)
    expect(hasPermission(saved, 'config:write')).toBe(true)
  })

  it('shows dependency-derived access without presenting it as an explicit grant', () => {
    render(
      <RoleDetailPanel
        {...defaults}
        role={{ id: 'admin', code: 'ADMIN', name: '管理员', description: null, permissions: ['config:write'] }}
        permissionsEditable
        onSave={vi.fn()}
      />
    )
    openPermissions()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).not.toBeChecked()
    expect(screen.getAllByText('由 配置中心修改 依赖生效').length).toBeGreaterThan(0)
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
    fireEvent.click(screen.getByRole('button', { name: '选择配置中心直接权限' }))
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '清除配置中心直接权限' }))
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
    const saved = onSave.mock.calls[0][0] as string[]
    expect(saved.some((key) => key.startsWith('config:'))).toBe(false)
    expect(saved).not.toContain('role:manage')
  })

  it('preserves an explicit draft through a failed save', () => {
    const onSave = vi.fn()
    const draftRole = { id: 'sales', code: 'SALES', name: '销售', description: null, permissions: ['config:publish'] }
    const { rerender } = render(
      <RoleDetailPanel {...defaults} role={draftRole} permissionsEditable onSave={onSave} />
    )
    openPermissions()
    fireEvent.click(screen.getByRole('checkbox', { name: /配置发布/ }))
    rerender(<RoleDetailPanel {...defaults} role={draftRole} permissionsEditable saving onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeDisabled()
    rerender(<RoleDetailPanel {...defaults} role={draftRole} permissionsEditable onSave={onSave} />)
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存授权' })).toBeEnabled()
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
  render(<RoleDetailPanel {...defaults} role={shipping} users={[user]} onSave={vi.fn()} onRefresh={onRefresh}
    systemSuperAdminAuthority={{ orgId: 'org-a' }} />)
  expect(screen.getByRole('tab', { name: '员工分配 (1)' })).toBeInTheDocument()
  expect(screen.getAllByText('待首次登录生效').length).toBeGreaterThan(0)
  fireEvent.click(screen.getAllByRole('button', { name: '从角色中移除 待登录成员' })[0])
  await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ role_ids: ['another'], expected_role_ids: ['ship', 'another'] })
})

it('opens the same tenant-scoped employee permission table from a role member', async () => {
  const shipping = { id: 'ship', code: 'SHIP', name: '寄件', description: null, permissions: [] }
  const member = {
    id: 'employee', display_name: '收寄成员', email: '', title: '', primary_dept_name: '华南',
    role_names: '寄件', role_ids: [shipping.id], status: 'active', login_enabled: true,
    membership_status: 'active' as const, employment_status: 'active' as const,
  }
  const path = '/api/admin/users/employee/permission-overrides?orgId=org-a'
  const fetchEmployeePermissions = vi.fn().mockResolvedValue(Response.json({
    org_id: 'org-a', user_id: member.id, permissions: [], departments: [],
    shipping_permission_publication: { registered: [], published: [] },
  }))
  vi.stubGlobal('fetch', fetchEmployeePermissions)
  const props = { ...defaults, role: shipping, users: [member], onSave: vi.fn() }
  const { rerender } = render(<RoleDetailPanel {...props} />)
  expect(screen.queryByRole('button', { name: '员工权限设置 收寄成员' })).not.toBeInTheDocument()
  rerender(<RoleDetailPanel {...props} systemSuperAdminAuthority={{ orgId: 'org-a' }} />)
  fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: '员工权限设置 收寄成员' }))
  expect(await screen.findByRole('dialog', { name: '员工权限设置 · 收寄成员' })).toBeInTheDocument()
  await waitFor(() => expect(fetchEmployeePermissions).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({
    cache: 'no-store',
  })))
})

it('removes an appointed administrator’s selected business role while retaining the administrator and other roles', async () => {
  const sales = { id: 'sales-role', code: 'SALES', name: '销售', description: null, permissions: [] }
  const support = { id: 'support-role', code: 'SUPPORT', name: '支持' }
  const orgId = 'active-organization'
  const member = {
    id: 'appointed-admin', display_name: '已任命的超管', email: '', title: '', primary_dept_name: '华南',
    role_names: '超级管理员、销售、支持', role_codes: [role.code, sales.code, support.code], role_ids: [role.id, sales.id, support.id],
    scoped_roles: [role, sales, support].map(record => ({
      roleId: record.id, roleCode: record.code, roleName: record.name,
      scopeType: 'org' as const, scopeId: orgId, scopeName: '组织', grantedAt: null,
    })),
    status: 'active', login_enabled: true, membership_status: 'active' as const, employment_status: 'active' as const,
  }
  const send = vi.fn()
    .mockResolvedValueOnce(Response.json({
      org_id: orgId, user_id: member.id, permissions: [], departments: [],
      shipping_permission_publication: { registered: [], published: [] },
    }))
    .mockResolvedValueOnce(Response.json({ success: true }))
  vi.stubGlobal('fetch', send)
  vi.mocked(confirmAction).mockResolvedValueOnce(true)
  const onRefresh = vi.fn()
  render(<RoleDetailPanel {...defaults} role={sales} users={[member]} systemSuperAdminAuthority={{ orgId }} onRefresh={onRefresh} onSave={vi.fn()} />)

  const row = within(screen.getByRole('row', { name: /已任命的超管/ }))
  expect(row.getByRole('button', { name: '员工权限设置 已任命的超管' })).toBeEnabled()
  expect(row.queryByText('平台根管理员只读')).not.toBeInTheDocument()
  fireEvent.click(row.getByRole('button', { name: '从角色中移除 已任命的超管' }))

  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
  expect(send).toHaveBeenLastCalledWith(`/api/admin/users/${member.id}/roles`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({
      role_ids: [support.id], expected_role_ids: [sales.id, support.id],
      expected_org_id: orgId, expected_system_admin: true, system_admin: true,
    }),
  }))
})

it('revokes only the selected department binding when a member has multiple role bindings', async () => {
  const sales = { id: 'sales-role', code: 'SALES', name: '销售', description: null, permissions: [] }
  const member = {
    id: 'sales-member', display_name: '销售员工', email: '', title: '', primary_dept_name: '华南',
    role_names: '销售', role_ids: [sales.id], status: 'active',
    scoped_roles: [
      { scopeType: 'org' as const, scopeId: 'org-a', scopeName: '组织' },
      { scopeType: 'department' as const, scopeId: 'south', scopeName: '华南' },
      { scopeType: 'department' as const, scopeId: 'east', scopeName: '华东' },
    ].map(binding => ({ ...binding, roleId: sales.id, roleCode: sales.code, roleName: sales.name, grantedAt: null })),
  }
  const send = vi.fn().mockResolvedValueOnce(Response.json({ success: true }))
  vi.stubGlobal('fetch', send)
  vi.mocked(confirmAction).mockResolvedValueOnce(true)
  const onRefresh = vi.fn()
  render(<RoleDetailPanel {...defaults} role={sales} users={[member]} onRefresh={onRefresh} onSave={vi.fn()} />)

  const action = within(screen.getByRole('table')).getByRole('button', { name: '从角色中移除 销售员工' })
  fireEvent.pointerDown(action, { button: 0, ctrlKey: false })
  expect(await screen.findByRole('menuitem', { name: '撤销 全组织' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: '撤销 华东' })).toBeInTheDocument()
  expect(send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitem', { name: '撤销 华南' }))

  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
  expect(confirmAction).toHaveBeenLastCalledWith(expect.stringContaining('「华南」'), { confirmText: '移除', danger: true })
  expect(send).toHaveBeenCalledExactlyOnceWith(`/api/admin/users/${member.id}/role-scopes`, expect.objectContaining({
    method: 'DELETE', body: JSON.stringify({ role_id: sales.id, scope_type: 'department', scope_id: 'south' }),
  }))
})

describe('personal shipping review when adjusting a role member', () => {
  const shippingRole = { id: 'ship', code: 'SHIP', name: '寄件', description: null, permissions: [] }
  const member = {
    id: 'eligible', display_name: '在职收寄员工', email: '', title: '', primary_dept_name: '华南',
    role_names: '', role_ids: [], status: 'active', login_enabled: true,
    membership_status: 'active' as const, employment_status: 'active' as const,
  }
  const authority = { orgId: 'org-a' }
  const endpoint = '/api/admin/users/eligible/permission-overrides?orgId=org-a'
  const roleEndpoint = '/api/admin/users/eligible/roles'

  function permissionResponse() {
    return Response.json({
      org_id: authority.orgId, user_id: member.id, departments: [],
      shipping_permission_publication: { registered: ['shipping:ledger_view'], published: ['shipping:ledger_view'] },
      permissions: [{
        key: 'shipping:ledger_view', base: true, effective: false,
        base_scope: { type: 'org' }, effective_scope: null,
        override: { effect: 'DENY', scope: null }, sources: [], can_edit: true,
      }],
    })
  }

  it('checks personal shipping settings only after selecting the eligible employee', async () => {
    const send = vi.fn().mockImplementation(async (url: string) => url === endpoint ? permissionResponse() : Response.json({}))
    vi.stubGlobal('fetch', send)
    const onRefresh = vi.fn()
    render(<RoleDetailPanel {...defaults} role={shippingRole} users={[member]} onSave={vi.fn()}
      onRefresh={onRefresh} systemSuperAdminAuthority={authority} />)

    expect(send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    expect(send).not.toHaveBeenCalled()
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('checkbox'))
    expect(await dialog.findByRole('status')).toHaveTextContent('此员工有 1 项寄件个人设置')
    expect(send).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({ cache: 'no-store' }))

    fireEvent.click(dialog.getByRole('button', { name: '添加成员到角色' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(send).toHaveBeenLastCalledWith(roleEndpoint, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ role_ids: [shippingRole.id], expected_role_ids: [] }),
    }))
  })

  it.each([
    { fail: false, message: '此员工有 1 项寄件个人设置' },
    { fail: true, message: '暂时无法核对该员工的寄件个人设置' },
  ])('includes only verified information in the removal confirmation and allows the same role write', async ({ fail, message }) => {
    const assigned = { ...member, role_names: shippingRole.name, role_ids: [shippingRole.id, 'other'] }
    const send = vi.fn().mockImplementation(async (url: string) => {
      if (url === endpoint) return fail ? Response.json({ error: 'Unavailable' }, { status: 503 }) : permissionResponse()
      return Response.json({})
    })
    vi.stubGlobal('fetch', send)
    vi.mocked(confirmAction).mockResolvedValueOnce(true)
    const onRefresh = vi.fn()
    render(<RoleDetailPanel {...defaults} role={shippingRole} users={[assigned]} onSave={vi.fn()}
      onRefresh={onRefresh} systemSuperAdminAuthority={authority} />)

    expect(send).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: '从角色中移除 在职收寄员工' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(confirmAction).toHaveBeenLastCalledWith(expect.stringContaining(message), { confirmText: '移除', danger: true })
    expect(send.mock.calls.map(([url]) => url)).toEqual([endpoint, roleEndpoint])
    expect(send).toHaveBeenLastCalledWith(roleEndpoint, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ role_ids: ['other'], expected_role_ids: [shippingRole.id, 'other'] }),
    }))
  })
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

describe('system super administrator membership', () => {
  const org = 'org-1'
  const member = {
    id: 'active-member', display_name: '在职成员', email: '', title: '', primary_dept_name: '销售',
    role_names: '', status: 'active', employment_status: 'active' as const, membership_status: 'active' as const, login_enabled: true,
  }
  const binding = { roleId: role.id, roleCode: role.code, roleName: role.name, scopeType: 'org' as const, scopeId: org, scopeName: '组织', grantedAt: null }
  const assigned = { ...member, role_ids: [role.id], role_codes: [role.code], scoped_roles: [binding] }
  const suspended = { ...assigned, status: 'inactive', login_enabled: false, employment_status: 'suspended' as const }
  const invited = { ...member, id: 'invitee', display_name: '待登录成员', membership_status: 'invited' as const, login_enabled: false }
  const otherOrgMember = { ...member, id: 'non-default', display_name: '兼职组织成员' }
  const existingAdmin = { ...assigned, id: 'existing-admin', display_name: '已分配的超管' }
  const actor = { ...member, id: defaults.currentUserId, display_name: '我的账号' }
  const getResponse = (enabled: boolean, orgId = org) => ({
    ok: true, status: 200, json: async () => ({ success: true, org_id: orgId, enabled }),
  })
  const authority = { orgId: org, memberIds: [member.id, existingAdmin.id, actor.id] }
  const endpoint = '/api/admin/users/active-member/system-super-admin'

  function startGrant() {
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '授予权限' }))
  }

  it('uses the dedicated endpoint and verifies the resulting grant in the same organization', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(getResponse(false))
      .mockResolvedValueOnce(getResponse(true))
      .mockResolvedValueOnce(getResponse(true))
    vi.stubGlobal('fetch', send)
    const onRefresh = vi.fn()
    render(<RoleDetailPanel {...defaults} role={role} users={[member, invited, otherOrgMember, existingAdmin, actor]}
      systemSuperAdminAuthority={authority} onSave={vi.fn()} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('在职成员')).toBeInTheDocument()
    expect(dialog.queryByText('待登录成员')).not.toBeInTheDocument()
    expect(dialog.queryByText('兼职组织成员')).not.toBeInTheDocument()
    expect(dialog.queryByText('已分配的超管')).not.toBeInTheDocument()
    expect(dialog.queryByText('我的账号')).not.toBeInTheDocument()

    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(dialog.getByRole('button', { name: '授予权限' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已确认「在职成员」获得超级管理员权限。')
    expect(send.mock.calls.map(([url]) => url)).toEqual([endpoint, endpoint, endpoint])
    expect(send.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
    expect(send.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ enabled: true, expected_enabled: false, expected_org_id: org })
    expect(send.mock.calls[2][1]).toMatchObject({ cache: 'no-store' })
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('can revoke an inactive member with a current binding after confirmation and readback', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(getResponse(true))
      .mockResolvedValueOnce(getResponse(false))
      .mockResolvedValueOnce(getResponse(false))
    vi.stubGlobal('fetch', send)
    vi.mocked(confirmAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const currentAdmin = { ...assigned, id: defaults.currentUserId, display_name: '当前超管' }
    const otherOrgAdmin = { ...assigned, id: 'other-org-admin', display_name: '其他组织超管',
      scoped_roles: [{ ...binding, scopeId: 'other-org' }] }
    render(<RoleDetailPanel {...defaults} role={role} users={[suspended, currentAdmin, otherOrgAdmin]}
      systemSuperAdminAuthority={{ orgId: org, memberIds: [] }} onSave={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '撤销超级管理员权限 当前超管' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销超级管理员权限 其他组织超管' })).not.toBeInTheDocument()
    const revoke = screen.getAllByRole('button', { name: '撤销超级管理员权限 在职成员' })[0]
    fireEvent.click(revoke)
    await waitFor(() => expect(revoke).toBeEnabled())
    expect(send).not.toHaveBeenCalled()

    fireEvent.click(revoke)
    expect(await screen.findByRole('status')).toHaveTextContent('已确认撤销「在职成员」的超级管理员权限。')
    expect(confirmAction).toHaveBeenLastCalledWith('确定要撤销「在职成员」的超级管理员角色？', { confirmText: '撤销权限', danger: true })
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ enabled: false, expected_enabled: true, expected_org_id: org })
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('shows the server last-super-admin rejection without reporting success', async () => {
    const message = '必须至少保留一名有效的超级管理员。'
    const send = vi.fn().mockResolvedValueOnce(getResponse(true))
      .mockResolvedValueOnce(Response.json({ error: message }, { status: 409 }))
    vi.stubGlobal('fetch', send)
    vi.mocked(confirmAction).mockResolvedValueOnce(true)
    const onRefresh = vi.fn()
    render(<RoleDetailPanel {...defaults} role={role} users={[assigned]}
      systemSuperAdminAuthority={authority} onSave={vi.fn()} onRefresh={onRefresh} />)
    fireEvent.click(screen.getAllByRole('button', { name: '撤销超级管理员权限 在职成员' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(send).toHaveBeenCalledTimes(2)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('verifies revoking historical authorization without offering legacy appointment or edits', async () => {
    const legacyRole = { id: 'legacy', code: 'ORG_SUPER_ADMIN', name: '组织超级管理员', description: null, permissions: ['role:manage'] }
    const formerAdmin = { ...suspended, role_ids: [legacyRole.id], role_codes: [legacyRole.code], scoped_roles: [{
      ...binding, roleId: legacyRole.id, roleCode: legacyRole.code, roleName: legacyRole.name,
    }] }
    const send = vi.fn().mockResolvedValueOnce(getResponse(true))
      .mockResolvedValueOnce(getResponse(false)).mockResolvedValueOnce(getResponse(false))
    vi.stubGlobal('fetch', send)
    vi.mocked(confirmAction).mockResolvedValueOnce(true)
    render(<RoleDetailPanel {...defaults} role={legacyRole} users={[formerAdmin, member]}
      systemSuperAdminAuthority={{ orgId: org }} permissionsEditable onSave={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()
    expect(screen.getByText('旧授权仅可撤销')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '撤销旧授权 在职成员' })[0])
    expect(await screen.findByRole('status')).toHaveTextContent('已确认撤销「在职成员」的旧组织超管授权。')
    expect(send.mock.calls.map(([url]) => url)).toEqual(Array(3).fill('/api/admin/users/active-member/org-super-admin'))
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ enabled: false, expected_enabled: true, expected_org_id: org })
    openPermissions()
    expect(screen.queryByRole('button', { name: '保存授权' })).not.toBeInTheDocument()
  })

  it('blocks the write when the fresh state belongs to another organization', async () => {
    const send = vi.fn().mockResolvedValueOnce(getResponse(false, 'other-org'))
    vi.stubGlobal('fetch', send)
    render(<RoleDetailPanel {...defaults} role={role} users={[member]}
      systemSuperAdminAuthority={authority} onSave={vi.fn()} />)
    startGrant()
    expect(await screen.findByRole('alert')).toHaveTextContent('接口返回的组织或角色状态无法核对')
    expect(send).toHaveBeenCalledOnce()
  })

  it('shows a failed verification without claiming the grant is active', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(getResponse(false))
      .mockResolvedValueOnce(getResponse(true))
      .mockResolvedValueOnce(getResponse(false))
    vi.stubGlobal('fetch', send)
    const onRefresh = vi.fn()
    render(<RoleDetailPanel {...defaults} role={role} users={[member]}
      systemSuperAdminAuthority={authority} onSave={vi.fn()} onRefresh={onRefresh} />)
    startGrant()
    expect(await screen.findByRole('alert')).toHaveTextContent('未能确认变更结果')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(send).toHaveBeenCalledTimes(3)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('keeps the permission settings fixed even for an authorized role editor', () => {
    render(<RoleDetailPanel {...defaults} role={role} users={[member]} permissionsEditable
      systemSuperAdminAuthority={authority} onSave={vi.fn()} />)
    openPermissions()
    expect(screen.getByText('超级管理员的权限由系统固定。')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeChecked()
    expect(screen.getByText('保存角色授权')).toBeVisible()
    expect(screen.queryByRole('checkbox', { name: /角色权限管理/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '授权已保存' })).not.toBeInTheDocument()
  })
})


it('places real actions under navigation paths and keeps unconnected points out of the editor', () => {
  render(<RoleDetailPanel {...defaults} permissionsEditable onSave={vi.fn()} modulePermissionCatalog={[{
    id: 'shipping', label: '寄件', description: '自助收寄',
    items: [
      { key: 'shipping:ledger_view', label: '查看收寄台账', description: '查阅工作台。', dependencies: [] },
      { key: 'shipping:settings_view', label: '查看寄件设置', description: '读取设置。', dependencies: [] },
    ],
  }]} />)
  openPermissions()
  const config = within(screen.getByRole('region', { name: '配置中心' }))
  const organization = within(config.getByRole('region', { name: '组织与权限' }))
  const role = within(organization.getByRole('region', { name: '角色权限' }))
  expect(screen.getByText('此处设置角色可以执行的操作。业务参数由各功能的设置页维护。')).toBeVisible()
  expect(role.getByText('保存角色授权')).toBeVisible()
  expect(role.queryByRole('checkbox', { name: '保存角色授权' })).not.toBeInTheDocument()
  expect(role.getByText('任免超级管理员')).toBeVisible()
  expect(role.queryByRole('checkbox', { name: '任免超级管理员' })).not.toBeInTheDocument()
  const shipping = within(screen.getByRole('region', { name: '自助收寄' }))
  expect(shipping.getByRole('checkbox', { name: '查看收寄台账' })).toBeChecked()
  expect(shipping.getByRole('checkbox', { name: '查看收寄台账' })).toBeDisabled()
  expect(shipping.queryByRole('checkbox', { name: '确认并下单' })).not.toBeInTheDocument()
  const settings = within(screen.getByRole('region', { name: '寄件设置' }))
  expect(settings.getByRole('checkbox', { name: '查看寄件设置' })).toBeChecked()
  expect(config.queryByRole('checkbox', { name: '查看寄件设置' })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: /全部权限|财务报表访问|报价审批/ })).not.toBeInTheDocument()
  expect(within(shipping.getByRole('region', { name: '收寄工作台' })).getByText('全部生效')).toBeInTheDocument()
})

it('makes only published shipping actions assignable while preserving saved and unrecognized grants', () => {
  const onSave = vi.fn()
  render(<RoleDetailPanel {...defaults} role={{
    id: 'sales', code: 'SALES', name: '销售', description: null,
    permissions: ['shipping:manage_connections', 'tenant-unregistered:approve'],
  }} permissionsEditable onSave={onSave} modulePermissionCatalog={[{
    id: 'shipping', label: '寄件', description: '自助收寄',
    items: [{ key: 'shipping:ledger_view', label: '查看收寄台账', description: '查看寄件工作台。', dependencies: [] }],
  }]} />)
  openPermissions()
  const operation = screen.getByRole('checkbox', { name: '查看收寄台账' })
  expect(operation).toBeEnabled()
  expect(screen.queryByRole('checkbox', { name: '维护顺丰连接' })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'tenant-unregistered:approve' })).not.toBeInTheDocument()
  expect(screen.getByText('已有兼容授权')).toBeVisible()
  fireEvent.click(operation)
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['shipping:manage_connections', 'tenant-unregistered:approve', 'shipping:ledger_view'])
})

it('allows explicit removal of a stored shipping bundle without a bundle checkbox', () => {
  const onSave = vi.fn()
  render(<RoleDetailPanel {...defaults} role={{
    id: 'sales', code: 'SALES', name: '销售', description: null,
    permissions: ['shipping:*', 'quote:view'],
  }} permissionsEditable onSave={onSave} />)
  openPermissions()
  fireEvent.click(screen.getByText('已有兼容授权'))
  const remove = screen.getByRole('button', { name: '移除寄件旧组合授权' })
  fireEvent.click(remove)
  expect(screen.queryByRole('button', { name: '移除寄件旧组合授权' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['quote:view'])
})

it('revokes a published inherited shipping action while preserving other effective actions', () => {
  const onSave = vi.fn()
  const role = { id: 'shipping', code: 'SHIPPING_OPERATOR', name: '寄件操作员', description: null, permissions: ['shipping:operate', 'quote:view'] }
  const catalog = [{
    id: 'shipping', label: '寄件', description: '',
    items: [
      { key: 'shipping:operate', label: '寄件操作旧授权', description: '', dependencies: [] },
      ...SHIPPING_WORKBENCH_ACTION_KEYS.map(key => {
        const [label, description] = SHIPPING_ACTION_DEFINITIONS[key]
        const dependency = shippingActionViewDependency(key)
        return { key, label, description, dependencies: dependency ? [dependency] : [] }
      }),
    ],
  }]
  render(<RoleDetailPanel {...defaults} role={role} permissionsEditable onSave={onSave} modulePermissionCatalog={catalog} />)
  openPermissions()
  const create = screen.getByRole('checkbox', { name: '录入寄件工单' })
  expect(create).toBeChecked()
  expect(create).toBeEnabled()
  fireEvent.click(create)
  expect(create).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '查看收寄台账' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith([
    'quote:view', ...SHIPPING_WORKBENCH_ACTION_KEYS.filter(key => key !== 'shipping:record_create'),
  ])
})

it('shows role assignment as system-controlled and preserves stored grants while editing member read access', () => {
  const onSave = vi.fn()
  const role = { id: 'admin', code: 'ADMIN', name: '管理员', description: null, permissions: ['quote:view', 'user:assign_roles'] }
  render(<RoleDetailPanel {...defaults} role={role} permissionsEditable onSave={onSave} />)
  openPermissions()
  expect(screen.getByText('分配或撤销业务角色')).toBeVisible()
  expect(screen.queryByRole('checkbox', { name: '分配或撤销业务角色' })).not.toBeInTheDocument()
  const view = screen.getByRole('checkbox', { name: '查看成员' })
  fireEvent.click(view)
  expect(view).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '编辑成员' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['quote:view', 'user:assign_roles', 'user:view'])
})

it('keeps department maintenance separate from deletion and supplies directory read', () => {
  const onSave = vi.fn()
  const role = { id: 'departments', code: 'DEPARTMENTS', name: '部门', description: null, permissions: ['quote:view'] }
  render(<RoleDetailPanel {...defaults} role={role} permissionsEditable onSave={onSave} />)
  openPermissions()
  const group = within(screen.getByRole('region', { name: '部门' }))
  fireEvent.click(group.getByRole('checkbox', { name: '维护部门' }))

  expect(group.getByRole('checkbox', { name: '查看部门树' })).toBeChecked()
  expect(group.getByRole('checkbox', { name: '查看部门树' })).toBeDisabled()
  expect(group.getByRole('checkbox', { name: '删除部门' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['quote:view', 'dept:edit_structure', 'dept:directory_view'])
})

it('retains a legacy department grant when saving an unrelated action', () => {
  const onSave = vi.fn()
  const role = { id: 'dept-legacy', code: 'DEPARTMENTS', name: '部门', description: null, permissions: ['dept:write'] }
  render(<RoleDetailPanel {...defaults} role={role} permissionsEditable onSave={onSave} />)
  openPermissions()
  const group = within(screen.getByRole('region', { name: '部门' }))
  for (const action of ['查看部门树', '维护部门', '删除部门']) {
    const checkbox = group.getByRole('checkbox', { name: action })
    expect(checkbox).toBeChecked()
    expect(checkbox).toBeDisabled()
  }
  expect(group.getByRole('button', { name: '清除部门直接权限' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '配置发布' }))
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['dept:write', 'config:publish'])
})

it('keeps retired baseline grants read-only and prevents new assignments', () => {
  const onSave = vi.fn()
  const role = {
    id: 'baseline', code: 'FXIAOKE_BASELINE', name: '纷享基础查看', description: null,
    permissions: [], owner_shipping_permissions: [],
    permissions_edit_block_reason: '纷享基础角色的普通权限由系统固定。',
  }
  const catalog = [{
    id: 'shipping', label: '寄件', description: '',
    items: [
      { key: 'shipping:owner_view', label: '查看本人寄件记录', description: '', dependencies: [] },
      { key: 'shipping:owner_resubmit', label: '修改并重提本人退回工单', description: '', dependencies: ['shipping:owner_view'] },
    ],
  }]
  render(<RoleDetailPanel {...defaults} role={role} permissionsEditable modulePermissionCatalog={catalog} onSave={onSave} />)
  expect(screen.queryByRole('button', { name: '添加成员' })).not.toBeInTheDocument()
  expect(screen.getByText('旧授权仅可撤销')).toBeVisible()
  openPermissions()
  const owner = within(screen.getByRole('region', { name: '本人寄件' }))
  expect(screen.getByRole('checkbox', { name: '配置发布' })).toBeDisabled()
  expect(owner.queryByRole('checkbox', { name: '提交本人寄件' })).not.toBeInTheDocument()
  const resubmit = owner.getByRole('checkbox', { name: '修改并重提本人退回工单' })
  expect(resubmit).toBeDisabled()
  expect(resubmit).not.toBeChecked()
  expect(owner.getByRole('checkbox', { name: '查看本人寄件记录' })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: '保存授权' })).not.toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
})

it('keeps organization and owner shipping permission drafts separate', () => {
  const onSave = vi.fn()
  const catalog = [{
    id: 'shipping', label: '寄件', description: '',
    items: [{ key: 'shipping:owner_view', label: '查看本人寄件记录', description: '', dependencies: [] }],
  }]
  render(<RoleDetailPanel {...defaults} role={{ ...role, id: 'admin', code: 'ADMIN', name: '管理员', owner_shipping_permissions: [] }}
    permissionsEditable modulePermissionCatalog={catalog} onSave={onSave} />)
  openPermissions()
  expect(screen.getByRole('checkbox', { name: '查看本人寄件记录' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '配置发布' }))
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledExactlyOnceWith(['*', 'config:publish'])
})

function shippingCatalog(...keys: ShippingActionKey[]) {
  return [{ id: 'shipping', label: '寄件', description: '', items: keys.map(key => {
    const [label, description] = SHIPPING_ACTION_DEFINITIONS[key]
    const dependency = shippingActionViewDependency(key)
    return { key, label, description, dependencies: dependency ? [dependency] : [] }
  }) }]
}

it('opens a shipping entry by selecting a real action and its published view dependency', () => {
  const onSave = vi.fn()
  const sales = { ...role, id: 'sales', code: 'SALES', permissions: [], owner_shipping_permissions: [] }
  render(<RoleDetailPanel {...defaults} role={sales} permissionsEditable onSave={onSave}
    modulePermissionCatalog={shippingCatalog('shipping:ledger_view', 'shipping:record_create', 'shipping:intake_write')} />)
  openPermissions()
  const entry = screen.getByRole('switch', { name: '自助收寄入口' })
  expect(entry).not.toBeChecked()
  expect(entry).toBeDisabled()
  expect(screen.queryByRole('checkbox', { name: '维护默认寄方与提报规则' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '录入寄件工单' }))
  expect(entry).toBeChecked()
  expect(entry).toBeEnabled()
  expect(screen.getByRole('checkbox', { name: '查看收寄台账' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['shipping:record_create', 'shipping:ledger_view'])
})

it('clears personal and workbench grants while retaining real legacy settings access', () => {
  const onSave = vi.fn()
  const sales = { ...role, id: 'sales', code: 'SALES', permissions: ['shipping:*', 'shipping:record_create', 'quote:view'],
    owner_shipping_permissions: ['shipping:owner_view', 'shipping:owner_submit'] }
  const catalog = shippingCatalog('shipping:ledger_view', 'shipping:owner_view', 'shipping:owner_submit')
  const published = [...catalog[0].items.map(item => item.key), 'shipping:manage_connections']
  render(<RoleDetailPanel {...defaults} role={sales} permissionsEditable onSave={onSave} modulePermissionCatalog={catalog}
    shippingPermissionPublication={{ registered: published, published }} />)
  openPermissions()
  const shipping = screen.getByRole('switch', { name: '自助收寄入口' })
  const settings = screen.getByRole('switch', { name: '寄件设置入口' })
  expect(shipping).toBeChecked()
  expect(settings).toBeChecked()
  expect(within(screen.getByRole('region', { name: '配置中心' })).getByText('入口已开放')).toBeVisible()
  fireEvent.click(shipping)
  expect(shipping).not.toBeChecked()
  expect(settings).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '查看本人寄件记录' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['quote:view', 'shipping:manage_connections'], [])
})

it('clears only settings and preserves workbench and personal access', () => {
  const onSave = vi.fn()
  const sales = { ...role, id: 'sales', code: 'SALES', permissions: ['shipping:ledger_view', 'shipping:settings_view', 'shipping:intake_write'],
    owner_shipping_permissions: ['shipping:owner_view'] }
  render(<RoleDetailPanel {...defaults} role={sales} permissionsEditable onSave={onSave}
    modulePermissionCatalog={shippingCatalog('shipping:ledger_view', 'shipping:owner_view', 'shipping:settings_view', 'shipping:intake_write')} />)
  openPermissions()
  const settings = screen.getByRole('switch', { name: '寄件设置入口' })
  fireEvent.click(settings)
  expect(settings).not.toBeChecked()
  expect(screen.getByRole('switch', { name: '自助收寄入口' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '查看本人寄件记录' })).toBeChecked()
  expect(within(screen.getByRole('region', { name: '配置中心' })).getByText('入口未开放')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(onSave).toHaveBeenCalledWith(['shipping:ledger_view'])
})

it('reports derived configuration admission for a real department action without a standalone control', () => {
  const sales = { ...role, id: 'sales', code: 'SALES', permissions: ['dept:directory_view'] }
  render(<RoleDetailPanel {...defaults} role={sales} permissionsEditable onSave={vi.fn()} />)
  openPermissions()
  const config = within(screen.getByRole('region', { name: '配置中心' }))
  expect(config.getByText('入口已开放')).toBeVisible()
  expect(config.queryByRole('switch')).not.toBeInTheDocument()
})

it('keeps a registered but unpublished entry closed even when its old alias is granted', () => {
  const sales = { ...role, id: 'sales', code: 'SALES', permissions: ['shipping:operate'] }
  render(<RoleDetailPanel {...defaults} role={sales} permissionsEditable onSave={vi.fn()}
    shippingPermissionPublication={{ registered: ['shipping:operate', 'shipping:ledger_view'], published: ['shipping:operate'] }} />)
  openPermissions()
  const shipping = screen.getByRole('switch', { name: '自助收寄入口' })
  expect(shipping).not.toBeChecked()
  expect(shipping).toBeDisabled()
})
