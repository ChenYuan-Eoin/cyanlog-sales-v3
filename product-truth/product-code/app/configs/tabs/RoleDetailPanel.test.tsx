import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RoleDetailPanel } from './RoleDetailPanel'
import { confirmAction, error } from '@/lib/toast'
import { hasPermission } from '@/lib/permissions'

vi.mock('@/lib/toast', () => ({ success: vi.fn(), error: vi.fn(), confirmAction: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const role = { id: 'root', code: 'SUPER_ADMIN', name: '超级管理员', description: null, permissions: ['*'] }
const defaults = { role, currentUserId: 'actor', saving: false, users: [], departments: [] }
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
    expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '保存更改' })).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

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
    fireEvent.click(screen.getByRole('button', { name: '选择配置中心全部权限' }))
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '清除配置中心全部权限' }))
    expect(screen.getByRole('checkbox', { name: /配置中心查看/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /配置中心修改/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    const saved = onSave.mock.calls[0][0] as string[]
    expect(saved.some((key) => key.startsWith('config:'))).toBe(false)
    expect(saved).not.toContain('role:manage')
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

describe('organization super administrator membership', () => {
  const org = 'org-1'
  const orgAdmin = {
    id: 'org-super',
    code: 'ORG_SUPER_ADMIN',
    name: '组织超级管理员',
    description: null,
    permissions: ['role:manage'],
  }
  const member = {
    id: 'active-member', display_name: '在职成员', email: '', title: '', primary_dept_name: '销售',
    role_names: '', status: 'active', employment_status: 'active' as const, membership_status: 'active' as const, login_enabled: true,
  }
  const assigned = { ...member, role_ids: [orgAdmin.id] }
  const invited = { ...member, id: 'invitee', display_name: '待登录成员', membership_status: 'invited' as const, login_enabled: false }
  const otherOrgMember = { ...member, id: 'non-default', display_name: '兼职组织成员' }
  const root = { ...member, id: 'platform-root', display_name: '平台根管理员', role_codes: ['SUPER_ADMIN'] }
  const actor = { ...member, id: defaults.currentUserId, display_name: '我的账号' }
  const getResponse = (enabled: boolean, orgId = org) => ({
    ok: true, status: 200, json: async () => ({ success: true, org_id: orgId, enabled }),
  })
  const authority = { orgId: org, memberIds: [member.id, root.id, actor.id] }
  const endpoint = '/api/admin/users/active-member/org-super-admin'

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
    render(<RoleDetailPanel {...defaults} role={orgAdmin} users={[member, invited, otherOrgMember, root, actor]}
      orgSuperAdminAuthority={authority} onSave={vi.fn()} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('在职成员')).toBeInTheDocument()
    expect(dialog.queryByText('待登录成员')).not.toBeInTheDocument()
    expect(dialog.queryByText('兼职组织成员')).not.toBeInTheDocument()
    expect(dialog.queryByText('平台根管理员')).not.toBeInTheDocument()
    expect(dialog.queryByText('我的账号')).not.toBeInTheDocument()

    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(dialog.getByRole('button', { name: '授予权限' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已确认「在职成员」获得组织超级管理员权限。')
    expect(send.mock.calls.map(([url]) => url)).toEqual([endpoint, endpoint, endpoint])
    expect(send.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
    expect(send.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ enabled: true, expected_enabled: false, expected_org_id: org })
    expect(send.mock.calls[2][1]).toMatchObject({ cache: 'no-store' })
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('requires a confirmation and verifies the revoked role with a fresh read', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(getResponse(true))
      .mockResolvedValueOnce(getResponse(false))
      .mockResolvedValueOnce(getResponse(false))
    vi.stubGlobal('fetch', send)
    vi.mocked(confirmAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<RoleDetailPanel {...defaults} role={orgAdmin} users={[assigned]}
      orgSuperAdminAuthority={authority} onSave={vi.fn()} />)
    const revoke = screen.getAllByRole('button', { name: '撤销组织超级管理员权限 在职成员' })[0]
    fireEvent.click(revoke)
    await waitFor(() => expect(revoke).toBeEnabled())
    expect(send).not.toHaveBeenCalled()

    fireEvent.click(revoke)
    expect(await screen.findByRole('status')).toHaveTextContent('已确认撤销「在职成员」的组织超级管理员权限。')
    expect(confirmAction).toHaveBeenLastCalledWith('确定要撤销「在职成员」的组织超级管理员角色？', { confirmText: '撤销权限', danger: true })
    expect(JSON.parse(send.mock.calls[1][1].body)).toEqual({ enabled: false, expected_enabled: true, expected_org_id: org })
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('blocks the write when the fresh state belongs to another organization', async () => {
    const send = vi.fn().mockResolvedValueOnce(getResponse(false, 'other-org'))
    vi.stubGlobal('fetch', send)
    render(<RoleDetailPanel {...defaults} role={orgAdmin} users={[member]}
      orgSuperAdminAuthority={authority} onSave={vi.fn()} />)
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
    render(<RoleDetailPanel {...defaults} role={orgAdmin} users={[member]}
      orgSuperAdminAuthority={authority} onSave={vi.fn()} onRefresh={onRefresh} />)
    startGrant()
    expect(await screen.findByRole('alert')).toHaveTextContent('未能确认变更结果')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(send).toHaveBeenCalledTimes(3)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('keeps the permission settings fixed even for an authorized role editor', () => {
    render(<RoleDetailPanel {...defaults} role={orgAdmin} users={[member]} permissionsEditable
      orgSuperAdminAuthority={authority} onSave={vi.fn()} />)
    openPermissions()
    expect(screen.getByText('组织超级管理员的治理权限由系统固定。')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /角色权限管理/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '已保存' })).not.toBeInTheDocument()
  })
})


it('makes only published shipping actions assignable while preserving saved and unrecognized grants', () => {
  const onSave = vi.fn()
  render(<RoleDetailPanel {...defaults} role={{
    id: 'sales', code: 'SALES', name: '销售', description: null,
    permissions: ['shipping:manage_connections', 'tenant-unregistered:approve'],
  }} permissionsEditable onSave={onSave} modulePermissionCatalog={[{
    id: 'shipping', label: '寄件操作', description: '自助收寄',
    items: [{ key: 'shipping:operate', label: '寄件操作', description: '进入寄件工作台并操作订单。', dependencies: [] }],
  }]} />)
  openPermissions()
  const operation = screen.getByRole('checkbox', { name: '寄件操作' })
  const connection = screen.getByRole('checkbox', { name: '寄件连接管理' })
  expect(operation).toBeEnabled()
  expect(connection).toBeEnabled()
  expect(connection).toBeChecked()
  expect(within(connection.closest('label')!).getByText('已保存')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '寄件全部权限' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'tenant-unregistered:approve' })).toBeDisabled()
  fireEvent.click(operation)
  fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
  expect(onSave).toHaveBeenCalledWith(['shipping:manage_connections', 'tenant-unregistered:approve', 'shipping:operate'])
})

it('allows a saved shipping bundle to be removed when granting it is unavailable', () => {
  const onSave = vi.fn()
  render(<RoleDetailPanel {...defaults} role={{
    id: 'sales', code: 'SALES', name: '销售', description: null,
    permissions: ['shipping:*', 'quote:view'],
  }} permissionsEditable onSave={onSave} />)
  openPermissions()
  const bundle = screen.getByRole('checkbox', { name: '寄件全部权限' })
  expect(bundle).toBeChecked()
  fireEvent.click(bundle)
  expect(bundle).not.toBeChecked()
  expect(bundle).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
  expect(onSave).toHaveBeenCalledWith(['quote:view'])
})
