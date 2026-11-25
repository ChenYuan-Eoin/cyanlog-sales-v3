import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { OrgSummaryPayload } from '../types'

vi.mock('./components/DepartmentFormDialog', () => ({ DepartmentFormDialog: () => null }))
vi.mock('./components/UserFormDialog', () => ({
  UserFormDialog: ({ onSubmit, editingUser }: { onSubmit: (values: object) => Promise<void>; editingUser?: object }) =>
    editingUser ? null : <button onClick={() => void onSubmit({ display_name: '已新增的邀请成员' })}>提交新增成员</button>,
}))
vi.mock('./components/RoleAssignmentDialog', () => ({
  RoleAssignmentDialog: ({ onSubmit }: { onSubmit: (ids: string[]) => Promise<void> }) =>
    <button onClick={() => onSubmit([])}>保存组织角色</button>,
}))
vi.mock('./components/IdentityBindingDialog', () => ({ IdentityBindingDialog: () => null }))
import OrgStructureTab from './OrgStructureTab'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const appliedAt = '2026-11-09T07:54:14Z'

it('shows the refreshed manually invited member without counting them in the default synced directory', async () => {
  const orgSummary: OrgSummaryPayload = {
    departments: [], roles: [], spaces: [], users: [],
    directory_roster: { status: 'ready', asOf: appliedAt, members: [] },
  }
  const updated: OrgSummaryPayload = {
    ...orgSummary,
    users: [{
      id: 'invited-user', display_name: '已新增的邀请成员', email: 'member@example.test', title: '', role_names: '',
      status: 'inactive', membership_status: 'invited', login_enabled: false,
      primary_dept_id: null, primary_dept_name: '',
    }],
  }
  const fetchMock = vi.mocked(fetch)
  fetchMock.mockResolvedValueOnce(Response.json({ success: true, data: { id: 'invited-user' } }, { status: 201 }))
  const onRefresh = vi.fn(() => view.rerender(<OrgStructureTab orgSummary={updated} currentUserId="actor" onRefresh={onRefresh} />))
  const view = render(<OrgStructureTab orgSummary={orgSummary} currentUserId="actor" onRefresh={onRefresh} />)
  expect(screen.getByLabelText('成员状态')).toHaveValue('synced')
  fireEvent.click(screen.getByRole('button', { name: '提交新增成员' }))
  expect(await screen.findByText('已新增的邀请成员')).toBeInTheDocument()
  expect(screen.getByLabelText('成员状态')).toHaveValue('all')
  expect(onRefresh).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('成员状态'), { target: { value: 'synced' } })
  expect(screen.queryByText('已新增的邀请成员')).not.toBeInTheDocument()
})

it('cascades department selection through primary and secondary memberships and keeps unlinked employees visible', () => {
  const payload: OrgSummaryPayload = {
    roles: [], spaces: [],
    directory_roster: { status: 'ready', asOf: appliedAt, members: [{ id: 'person-1', departmentIds: ['d1', 'd2'] }] },
    departments: [
      { id: 'd1', name: '销售部', parent_name: null, parent_id: null, member_count: 1 },
      { id: 'd2', name: '咨询部', parent_name: null, parent_id: null, member_count: 1 },
      { id: 'd3', name: '财务部', parent_name: null, parent_id: null, member_count: 1 },
    ],
    users: [
      { id: 'person-1', display_name: '待关联员工甲', email: '', title: '', role_names: '', status: 'inactive', login_enabled: false, membership_status: 'invited',
        primary_dept_id: 'd2', primary_dept_name: '咨询部', department_ids: ['d1', 'd2'], secondary_dept_names: ['销售部'],
        directory_identity_id: 'i1', directory_pending_account: true, directory_status: 'active' },
      { id: 'u2', display_name: '财务员工乙', email: '', title: '', role_names: '', status: 'active', primary_dept_id: 'd3', primary_dept_name: '财务部', department_ids: [] },
    ],
  }
  render(<OrgStructureTab orgSummary={payload} currentUserId="actor" />)
  fireEvent.click(screen.getByRole('button', { name: /^销售部/ }))
  expect(screen.getByText('待关联员工甲')).toBeInTheDocument()
  expect(screen.queryByText('财务员工乙')).not.toBeInTheDocument()
  expect(screen.getByText('待首次登录')).toBeInTheDocument()
  const row = screen.getByText('待关联员工甲').closest('tr')!
  expect(within(row).getByText('咨询部')).toBeInTheDocument()
  expect(within(row).getByText('附属：销售部')).toBeInTheDocument()
  expect(within(row).getByRole('button')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('成员状态'), { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: /^财务部/ }))
  expect(screen.queryByText('待关联员工甲')).not.toBeInTheDocument()
  expect(screen.getByText('财务员工乙')).toBeInTheDocument()
})

const statusPayload: OrgSummaryPayload = {
  directory_roster: { status: 'ready', asOf: appliedAt, members: [{ id: 'active-pending', departmentIds: ['sales', 'child'] }] },
  roles: [], spaces: [], departments: [
    { id: 'sales', name: '销售父部门', parent_name: null, parent_id: null, member_count: 99 },
    { id: 'child', name: '销售子部门', parent_name: '销售父部门', parent_id: 'sales', member_count: 88 },
  ], users: [
    { id: 'active-pending', display_name: '在职待登录甲', email: '', title: '', role_names: '', status: 'inactive', login_enabled: false, membership_status: 'invited', directory_identity_id: 'i-active', directory_source: 'fxiaoke', directory_status: 'active', directory_pending_account: true, primary_dept_id: 'child', primary_dept_name: '销售子部门', department_ids: ['sales', 'child'] },
    { id: 'departed', display_name: '纷享离职乙', email: '', title: '', role_names: '', status: 'active', login_enabled: true, membership_status: 'active', directory_identity_id: 'i-left', directory_source: 'fxiaoke', directory_status: 'suspended', directory_pending_account: true, primary_dept_id: 'sales', primary_dept_name: '销售父部门', department_ids: ['sales'] },
    { id: 'manual-disabled', display_name: '本地停用丙', email: '', title: '', role_names: '', status: 'suspended', login_enabled: false, primary_dept_id: 'sales', primary_dept_name: '销售父部门' },
    { id: 'manual-active', display_name: '本地在职戊', email: '', title: '', role_names: '', status: 'active', login_enabled: true, primary_dept_id: 'sales', primary_dept_name: '销售父部门' },
    { id: 'unknown', display_name: '目录待核对丁', email: '', title: '', role_names: '', status: 'active', login_enabled: true, directory_identity_id: 'i-unknown', directory_source: 'fxiaoke', directory_status: 'unknown', primary_dept_id: 'sales', primary_dept_name: '销售父部门' },
  ],
}

it('defaults to employed members, preserves active directory newcomers and counts department members once', () => {
  render(<OrgStructureTab orgSummary={statusPayload} currentUserId="actor" />)
  expect(screen.getByText('在职待登录甲')).toBeInTheDocument()
  expect(screen.getByText('待首次登录')).toBeInTheDocument()
  expect(screen.queryByText('纷享离职乙')).not.toBeInTheDocument()
  expect(screen.queryByText('本地停用丙')).not.toBeInTheDocument()
  expect(screen.queryByText('本地在职戊')).not.toBeInTheDocument()
  expect(screen.queryByText('目录待核对丁')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^销售父部门/ })).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: /^销售父部门/ }))
  expect(screen.getByText('在职待登录甲')).toBeInTheDocument()
  expect(screen.getByText('共 1 人（含子部门）')).toBeInTheDocument()
})

it('shows an unconfirmed directory count as unknown and still lets administrators see all local records', () => {
  render(<OrgStructureTab orgSummary={{ ...statusPayload, directory_roster: {
    status: 'unavailable', reason: 'DIRECTORY_UNCONFIRMED',
  } }} currentUserId="actor" />)
  expect(screen.getByText('同步在职人数待核对')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^销售父部门/ })).toHaveTextContent('—')
  expect(screen.queryByText('本地在职戊')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('成员状态'), { target: { value: 'all' } })
  expect(screen.getByText('本地在职戊')).toBeInTheDocument()
})

it('lets an organization administrator view a department on its own and drill into a child separately', () => {
  const childOnly = { ...statusPayload.users[0], id: 'child-only', display_name: '仅在子部门', department_ids: ['child'] }
  render(<OrgStructureTab orgSummary={{
    ...statusPayload,
    users: [...statusPayload.users, childOnly],
    directory_roster: { status: 'ready', asOf: appliedAt, members: [
      { id: 'active-pending', departmentIds: ['sales', 'child'] },
      { id: 'child-only', departmentIds: ['child'] },
    ] },
    spaces: [{ id: 'historical-space', name: '历史销售区域', department_id: 'child', department_name: '销售子部门' }],
  }} currentUserId="actor" />)

  fireEvent.click(screen.getByRole('button', { name: /^销售父部门/ }))
  expect(screen.getByRole('button', { name: /^销售父部门/ })).toHaveTextContent('2')
  expect(screen.getByText('共 2 人（含子部门）')).toBeInTheDocument()
  expect(screen.queryByText('销售空间')).not.toBeInTheDocument()
  expect(screen.queryByText('部门空间')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('部门成员范围'), { target: { value: 'direct' } })
  expect(screen.getByText('共 1 人（仅本部门）')).toBeInTheDocument()
  expect(screen.queryByText('仅在子部门')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /^销售子部门/ }))
  expect(screen.getByText('仅在子部门')).toBeInTheDocument()
  expect(screen.getByText('共 2 人（仅本部门）')).toBeInTheDocument()
  expect(screen.queryByText('历史销售区域')).not.toBeInTheDocument()
})

it('uses server authority to let an organization super admin confirm the current department leader and verify the saved grant', async () => {
  const actor = { ...statusPayload.users[0], id: 'actor', role_codes: ['ORG_SUPER_ADMIN'] }
  const send = vi.fn()
    .mockResolvedValueOnce(Response.json({ success: true, userId: null, leaderId: 'team-lead' }))
    .mockResolvedValueOnce(Response.json({ success: true, userId: 'team-lead', status: 'saved' }))
    .mockResolvedValueOnce(Response.json({ success: true, userId: 'team-lead', leaderId: 'team-lead' }))
  vi.stubGlobal('fetch', send)
  render(<OrgStructureTab orgSummary={{
    ...statusPayload,
    users: [actor],
    departments: statusPayload.departments.map(dept =>
      dept.id === 'sales' ? { ...dept, leader_id: 'team-lead' } : dept),
  }} currentUserId="actor" />)

  fireEvent.click(screen.getByRole('button', { name: /^销售父部门/ }))
  fireEvent.click(await screen.findByRole('button', { name: '确认负责人权限' }))
  expect(send).toHaveBeenCalledTimes(1)
  fireEvent.click(await screen.findByRole('button', { name: '确认授权' }))
  expect(await screen.findByRole('button', { name: '撤销负责人权限' })).toBeEnabled()
  expect(send.mock.calls.map(([url]) => url)).toEqual([
    '/api/admin/departments/leader-access?departmentId=sales',
    '/api/admin/departments/leader-access',
    '/api/admin/departments/leader-access?departmentId=sales',
  ])
  const writeRequest = send.mock.calls[1][1]
  expect(writeRequest.method).toBe('PUT')
  expect(JSON.parse(writeRequest.body)).toEqual({ departmentId: 'sales', userId: 'team-lead', expectedUserId: null })
})

it('hides confirmation controls when the server denies current authority despite the roster role label', async () => {
  const actor = { ...statusPayload.users[0], id: 'actor', role_codes: ['SUPER_ADMIN'] }
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
  vi.stubGlobal('fetch', send)
  render(<OrgStructureTab orgSummary={{ ...statusPayload, users: [actor] }} currentUserId="actor" />)
  fireEvent.click(screen.getByRole('button', { name: /^销售父部门/ }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('/api/admin/departments/leader-access?departmentId=sales',
    expect.objectContaining({ cache: 'no-store' })))
  expect(screen.queryByRole('heading', { name: '负责人数据权限' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '确认负责人权限' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '撤销负责人权限' })).not.toBeInTheDocument()
})

it('prevents confirming a leader changed since the department tree was loaded', async () => {
  const actor = { ...statusPayload.users[0], id: 'actor', role_codes: ['SUPER_ADMIN'] }
  const send = vi.fn().mockResolvedValue(Response.json({ success: true, userId: null, leaderId: 'new-lead' }))
  vi.stubGlobal('fetch', send)
  render(<OrgStructureTab orgSummary={{
    ...statusPayload,
    users: [actor],
    departments: statusPayload.departments.map(dept =>
      dept.id === 'sales' ? { ...dept, leader_id: 'old-lead', leader_name: '原负责人' } : dept),
  }} currentUserId="actor" />)
  fireEvent.click(screen.getByRole('button', { name: /^销售父部门/ }))
  expect(await screen.findByText('部门负责人已更新，请刷新组织架构后再确认。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '确认负责人权限' })).not.toBeInTheDocument()
  expect(send).toHaveBeenCalledTimes(1)
})

it('shows stopped Fxiaoke employees as departed and unable to log in without inviting first login', async () => {
  render(<OrgStructureTab orgSummary={statusPayload} currentUserId="actor" />)
  fireEvent.change(screen.getByLabelText('成员状态'), { target: { value: 'departed' } })
  const row = screen.getByText('纷享离职乙').closest('tr')!
  expect(within(row).getByText('已离职')).toBeInTheDocument()
  expect(within(row).getByText('不可登录')).toBeInTheDocument()
  expect(within(row).queryByText('待首次登录')).not.toBeInTheDocument()
  expect(screen.queryByText('在职待登录甲')).not.toBeInTheDocument()
  fireEvent.keyDown(within(row).getByRole('button', { name: '管理纷享离职乙' }), { key: 'ArrowDown' })
  expect(await screen.findByRole('menuitem', { name: /在职状态由纷享销客管理/ })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByRole('menuitem', { name: /启用用户|允许登录|恢复在职|办理离职/ })).not.toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: '编辑' })).toHaveAttribute('aria-disabled', 'true')
})

it('distinguishes manual suspension and unknown directory status and provides an employee login link', () => {
  render(<OrgStructureTab orgSummary={statusPayload} currentUserId="actor" />)
  expect(screen.getByRole('link', { name: '打开员工登录页' })).toHaveAttribute('href', '/login')
  expect(screen.getByText(/在职员工使用自己的纷享销客账号登录/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('成员状态'), { target: { value: 'all' } })
  expect(within(screen.getByText('本地停用丙').closest('tr')!).getByText('已停用')).toBeInTheDocument()
  expect(within(screen.getByText('目录待核对丁').closest('tr')!).getByText('待核对')).toBeInTheDocument()
  expect(within(screen.getByText('目录待核对丁').closest('tr')!).queryByText('在职')).not.toBeInTheDocument()
})

it('keeps an unlinked manual member manageable when the organization aggregate names its directory source', async () => {
  const manual = { ...statusPayload.users[2], directory_source: 'fxiaoke', directory_status: 'active' }
  render(<OrgStructureTab orgSummary={{ ...statusPayload, users: [manual] }} currentUserId="actor" />)
  fireEvent.change(screen.getByLabelText('成员状态'), { target: { value: 'all' } })
  const row = screen.getByText('本地停用丙').closest('tr')!
  expect(within(row).getByText('系统成员')).toBeInTheDocument()
  expect(within(row).getByText('已停用')).toBeInTheDocument()
  fireEvent.keyDown(within(row).getByRole('button', { name: '管理本地停用丙' }), { key: 'ArrowDown' })
  expect(await screen.findByRole('menuitem', { name: '编辑' })).not.toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: '启用用户' })).toBeInTheDocument()
})

it('does not call a previously active directory account a first-login account after local login is disabled', () => {
  const user = { ...statusPayload.users[0], id: 'previously-active', display_name: '已登录后禁用戊', status: 'active', membership_status: 'active' as const }
  render(<OrgStructureTab orgSummary={{ ...statusPayload, users: [user], directory_roster: {
    status: 'ready', asOf: appliedAt, members: [{ id: user.id, departmentIds: ['child'] }],
  } }} currentUserId="actor" />)
  const row = screen.getByText('已登录后禁用戊').closest('tr')!
  expect(within(row).getByText('登录已禁用')).toBeInTheDocument()
  expect(within(row).queryByText('待首次登录')).not.toBeInTheDocument()
  expect(within(row).getByText('在职')).toBeInTheDocument()
})

it('renders pending role separately on the organization member row', () => {
  const user = { ...statusPayload.users[0], can_preassign_org_roles: true, pending_org_roles: [{ id: 'ship', code: 'SHIP', name: '寄件' }] }
  render(<OrgStructureTab orgSummary={{ ...statusPayload, users: [user] }} currentUserId="actor" />)
  const row = screen.getByText(user.display_name).closest('tr')!
  expect(within(row).getByText('寄件 · 待首次登录生效')).toBeInTheDocument()
})

it('checks the original roles when the directory refreshes while a member is being edited', async () => {
  const user = { ...statusPayload.users[0], can_preassign_org_roles: true, pending_org_roles: [{ id: 'ship', code: 'SHIP', name: '寄件' }] }
  const latest = { ...user, pending_org_roles: [] }
  const send = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: 'ROLE_ASSIGNMENT_CHANGED', error: '请重新选择' }) })
  vi.stubGlobal('fetch', send)
  const props = { currentUserId: 'actor', onRefresh: vi.fn() }
  const view = render(<OrgStructureTab {...props} orgSummary={{ ...statusPayload, users: [user] }} />)
  fireEvent.keyDown(screen.getByRole('button', { name: `管理${user.display_name}` }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /分配角色/ }))
  view.rerender(<OrgStructureTab {...props} orgSummary={{ ...statusPayload, users: [latest] }} />)
  fireEvent.click(screen.getByRole('button', { name: '保存组织角色' }))
  await waitFor(() => expect(props.onRefresh).toHaveBeenCalledTimes(1))
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ role_ids: [], expected_role_ids: ['ship'], scope_type: 'org' })
  expect(screen.queryByRole('button', { name: '保存组织角色' })).not.toBeInTheDocument()
  expect(send).toHaveBeenCalledTimes(1)
})
