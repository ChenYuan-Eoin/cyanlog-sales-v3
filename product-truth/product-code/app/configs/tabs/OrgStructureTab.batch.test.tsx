import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { OrgSummaryPayload, OrgSummaryUser } from '../types'
import OrgStructureTab from './OrgStructureTab'

const orgId = '10000000-0000-4000-8000-000000000001'
const roleId = '10000000-0000-4000-8000-000000000002'
const batchPath = '/api/admin/users/batch'
const permissions = {
  edit: false, assignRoles: true, invite: false, manageLogin: true, manageEmployment: true,
  removeMembership: false, manageDepartments: false, bindExternalIdentity: false,
}

function member(number: number, department = 'sales', displayName = `销售员工 ${number}`): OrgSummaryUser {
  return {
    id: `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`, email: `member${number}@example.test`,
    display_name: displayName, title: '', role_names: '', primary_dept_name: '', primary_dept_id: department,
    department_ids: [department], status: 'active', membership_status: 'active', employment_status: 'active',
    login_enabled: true,
  }
}

function payload(members: OrgSummaryUser[], memberActions = permissions): OrgSummaryPayload {
  return {
    organization: { id: orgId, name: '演示组织' },
    member_actions: memberActions,
    users: members, spaces: [],
    roles: [
      { id: roleId, code: 'SALES', name: '销售' },
      { id: 'protected-role', code: 'SUPER_ADMIN', name: '系统超级管理员' },
      { id: 'retired-role', code: 'FXIAOKE_BASELINE', name: '纷享基础查看' },
    ],
    departments: [
      { id: 'sales', name: '销售部门', status: 'active', parent_name: null },
      { id: 'branch', name: '销售下级', status: 'active', parent_id: 'sales', parent_name: '销售部门' },
      { id: 'finance', name: '财务部门', status: 'active', parent_name: null },
    ],
    directory_roster: {
      status: 'ready', asOf: '2026-11-26T09:00:00Z',
      members: members.map(user => ({ id: user.id, departmentIds: user.department_ids ?? [] })),
    },
  }
}

function selectCurrentDepartment() {
  fireEvent.click(screen.getByRole('button', { name: /^销售部门/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /^全选当前名单/ }))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('selects all pages of the current department and reapplies selection only after scope changes', () => {
  const users = Array.from({ length: 11 }, (_, index) => ({
    ...member(index + 1), title: index === 10 ? '联络岗位' : '',
  }))
  render(<OrgStructureTab
    orgSummary={payload([...users, member(12, 'branch', '下级成员'), member(13, 'finance', '财务成员')])}
    currentUserId="actor"
  />)
  selectCurrentDepartment()
  expect(screen.getByText('已选 12 人')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('部门成员范围'), { target: { value: 'direct' } })
  expect(screen.queryByText('已选 12 人')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: /全选当前名单（11 人/ }))
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('checkbox', { name: '选择销售员工 11' })).toBeChecked()
  expect(screen.getByText('已选 11 人')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择销售员工 11' }))
  expect(screen.getByText('已选 10 人')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /^财务部门/ }))
  expect(screen.queryByText('已选 10 人')).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择财务成员' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: /^销售部门/ }))
  expect(screen.getByRole('checkbox', { name: /全选当前名单（11 人/ })).not.toBeChecked()
  const search = screen.getByPlaceholderText('搜索姓名、邮箱、职位...')
  fireEvent.change(search, { target: { value: '联络岗位' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /^全选当前名单/ }))
  expect(screen.getByText('已选 1 人')).toBeInTheDocument()
  fireEvent.change(search, { target: { value: '' } })
  expect(screen.queryByText('已选 1 人')).not.toBeInTheDocument()
})

it('sends only the selected role addition, reports partial results, and keeps the failed member selected', async () => {
  const [first, denied] = [member(1), member(2)]
  const onRefresh = vi.fn()
  const write = vi.fn().mockResolvedValue(Response.json({
    results: [{ user_id: first.id, ok: true, pending: true }, { user_id: denied.id, ok: false, error: '成员暂不可分配角色' }],
    succeeded: 1, failed: 1,
  }))
  vi.mocked(fetch).mockImplementation(async (url, init) => url === batchPath
    ? write(init) : new Response(null, { status: 403 }))

  render(<OrgStructureTab orgSummary={payload([first, denied])} currentUserId="actor" onRefresh={onRefresh} />)
  selectCurrentDepartment()
  fireEvent.click(screen.getByRole('button', { name: '批量分配角色' }))
  const dialog = await screen.findByRole('dialog', { name: '批量分配角色' })
  expect(within(dialog).queryByRole('checkbox', { name: '系统超级管理员' })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('checkbox', { name: '纷享基础查看' })).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '确认执行' })).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '销售' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '确认执行' }))

  expect(await screen.findByText('批量分配角色 · 成功 1 人，失败 1 人，1 人待首次登录生效')).toBeInTheDocument()
  expect(screen.getByText('销售员工 2 · 成员暂不可分配角色')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择销售员工 1' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '选择销售员工 2' })).toBeChecked()
  expect(write).toHaveBeenCalledTimes(1)
  expect(JSON.parse(write.mock.calls[0][0].body)).toEqual({
    expected_org_id: orgId, action: 'assign_roles', user_ids: [first.id, denied.id], role_ids: [roleId],
  })
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('suspends accounts in batches across all pages and refreshes the member list once', async () => {
  const users = Array.from({ length: 201 }, (_, index) => member(index + 1))
  const onRefresh = vi.fn()
  const write = vi.fn((body: { user_ids: string[] }) => Response.json({
    results: body.user_ids.map(userId => ({ user_id: userId, ok: true })),
    succeeded: body.user_ids.length, failed: 0,
  }))
  vi.mocked(fetch).mockImplementation(async (url, init) => url === batchPath
    ? write(JSON.parse(init?.body as string)) : new Response(null, { status: 403 }))
  render(<OrgStructureTab
    orgSummary={payload(users, { ...permissions, manageEmployment: false, assignRoles: false })}
    currentUserId="actor"
    onRefresh={onRefresh}
  />)
  selectCurrentDepartment()
  expect(screen.queryByRole('button', { name: '批量办理离职' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '批量分配角色' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '批量停用账号' }))
  const dialog = await screen.findByRole('dialog', { name: '批量停用账号' })
  fireEvent.click(within(dialog).getByRole('button', { name: '确认执行' }))

  expect(await screen.findByText('批量停用账号 · 成功 201 人，失败 0 人')).toBeInTheDocument()
  expect(write.mock.calls.map(([body]) => body.user_ids.length)).toEqual([200, 1])
  expect(write).toHaveBeenLastCalledWith({ expected_org_id: orgId, action: 'suspend', user_ids: [users[200].id] })
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('asks for confirmation before offboarding a linked employee and retains a rejected selection', async () => {
  const linked = { ...member(1), directory_source: 'fxiaoke', directory_identity_id: 'linked', directory_status: 'active' }
  const onRefresh = vi.fn()
  const write = vi.fn().mockResolvedValue(Response.json({
    results: [{ user_id: linked.id, ok: false, error: '请先取消该成员的系统超管身份' }],
    succeeded: 0, failed: 1,
  }))
  vi.mocked(fetch).mockImplementation(async (url, init) => url === batchPath
    ? write(init) : new Response(null, { status: 403 }))
  render(<OrgStructureTab orgSummary={payload([linked])} currentUserId="actor" onRefresh={onRefresh} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '选择销售员工 1' }))
  fireEvent.click(screen.getByRole('button', { name: '批量办理离职' }))
  let dialog = await screen.findByRole('dialog', { name: '批量办理离职' })
  expect(within(dialog).getByText(/外部人事记录由来源系统维护/)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(write).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '批量办理离职' }))
  dialog = await screen.findByRole('dialog', { name: '批量办理离职' })
  fireEvent.click(within(dialog).getByRole('button', { name: '确认执行' }))
  expect(await screen.findByText('销售员工 1 · 请先取消该成员的系统超管身份')).toBeInTheDocument()
  expect(JSON.parse(write.mock.calls[0][0].body)).toEqual({ expected_org_id: orgId, action: 'offboard', user_ids: [linked.id] })
  expect(screen.getByRole('checkbox', { name: '选择销售员工 1' })).toBeChecked()
  expect(onRefresh).not.toHaveBeenCalled()
})

it('keeps an unconfirmed entry selected and re-reads the roster without retrying the write', async () => {
  const onRefresh = vi.fn()
  const write = vi.fn().mockRejectedValue(new TypeError('network interrupted'))
  vi.mocked(fetch).mockImplementation(async (url, init) => url === batchPath
    ? write(init) : new Response(null, { status: 403 }))
  render(<OrgStructureTab orgSummary={payload([member(1)])} currentUserId="actor" onRefresh={onRefresh} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '选择销售员工 1' }))
  fireEvent.click(screen.getByRole('button', { name: '批量停用账号' }))
  const dialog = await screen.findByRole('dialog', { name: '批量停用账号' })
  fireEvent.click(within(dialog).getByRole('button', { name: '确认执行' }))
  expect(await screen.findByText(/未能确认本批处理结果/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择销售员工 1' })).toBeChecked()
  expect(write).toHaveBeenCalledTimes(1)
  expect(onRefresh).toHaveBeenCalledTimes(1)
})

it('keeps scoped read-only access out of bulk operations', () => {
  render(<OrgStructureTab
    orgSummary={payload([member(1)], { ...permissions, manageLogin: false, manageEmployment: false, assignRoles: false })}
    currentUserId="actor"
  />)
  fireEvent.click(screen.getByRole('button', { name: /^销售部门/ }))
  expect(screen.getByText('销售员工 1')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: '选择销售员工 1' })).not.toBeInTheDocument()
})

it('offers bulk removal with only removal permission and reports each skipped member', async () => {
  const local = member(1)
  const external = { ...member(2), directory_source: 'feishu', directory_identity_id: 'linked', directory_status: 'active' }
  const onRefresh = vi.fn()
  const write = vi.fn().mockResolvedValue(Response.json({
    results: [
      { user_id: local.id, ok: true },
      { user_id: external.id, ok: false, error: '该成员由外部通讯录管理，可在 ICU 办理离职' },
    ],
    succeeded: 1, failed: 1,
  }))
  vi.mocked(fetch).mockImplementation(async (url, init) => url === batchPath
    ? write(init) : new Response(null, { status: 403 }))

  render(<OrgStructureTab
    orgSummary={payload([local, external], { ...permissions, removeMembership: true, manageEmployment: false, manageLogin: false, assignRoles: false })}
    currentUserId="actor"
    onRefresh={onRefresh}
  />)
  selectCurrentDepartment()
  fireEvent.click(screen.getByRole('button', { name: '批量移出当前组织' }))
  const dialog = await screen.findByRole('dialog', { name: '批量移出当前组织' })
  expect(write).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '确认执行' }))

  expect(await screen.findByText('批量移出当前组织 · 成功 1 人，失败 1 人')).toBeInTheDocument()
  expect(screen.getByText('销售员工 2 · 该成员由外部通讯录管理，可在 ICU 办理离职')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择销售员工 1' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '选择销售员工 2' })).toBeChecked()
  expect(JSON.parse(write.mock.calls[0][0].body)).toEqual({
    expected_org_id: orgId, action: 'remove_membership', user_ids: [local.id, external.id],
  })
  expect(onRefresh).toHaveBeenCalledTimes(1)
})
