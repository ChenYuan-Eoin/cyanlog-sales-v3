import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DepartmentTransferDialog } from './DepartmentTransferDialog'

const previous = { id: 'd-old', name: '华北组', parent_name: null, source: 'fxiaoke' }
const next = { id: 'd-new', name: '华东组', parent_name: null, status: 'active', source: 'manual' }
const secondary = { id: 'd-secondary', name: '项目支持组', parent_name: null, source: 'fxiaoke' }
const inactive = { id: 'd-inactive', name: '停用部门', parent_name: null, status: 'inactive' }
const member = {
  id: 'employee', email: '', display_name: '员工甲', title: '', role_names: '',
  primary_dept_id: previous.id, primary_dept_name: previous.name, status: 'active',
  department_ids: [previous.id, secondary.id],
}
const applied = {
  status: 'applied', department_id: next.id, secondary_department_ids: [secondary.id],
  effective_at: '2026-11-27T08:57:00Z',
}
const choiceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const choice = {
  status: 'override_choice_required',
  choice_id: choiceId,
  impact: { affected_count: 3, retainable_count: 1, blocked_count: 2 },
}
const requestIdMatcher = expect.stringMatching(/^[a-f0-9-]{36}$/)
const primaryEndpoint = '/api/admin/users/employee/department-transfer'
const secondaryEndpoint = '/api/admin/users/employee/departments'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(detail = member) {
  const onClose = vi.fn()
  const onTransferred = vi.fn()
  render(<DepartmentTransferDialog orgId="org-1" member={detail} departments={[previous, next, secondary, inactive]}
    authHeaders={() => ({ 'Content-Type': 'application/json' })} onClose={onClose} onTransferred={onTransferred} />)
  return { onClose, onTransferred }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

function selectPrimary() {
  fireEvent.change(screen.getByLabelText('新主部门'), { target: { value: next.id } })
}

function requestBody(index: number) {
  return JSON.parse(String(vi.mocked(fetch).mock.calls[index][1]?.body))
}

it('saves a routine main department change once after choosing the destination', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(applied))
  const { onTransferred } = setup()

  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: '停用部门' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: previous.name })).not.toBeInTheDocument()
  selectPrimary()
  fireEvent.click(screen.getByRole('checkbox', { name: '保留原主部门为兼岗' }))
  submit()

  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(screen.queryByRole('group', { name: '调整后的个人权限' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(primaryEndpoint)
  expect(requestBody(0)).toEqual({
    action: 'save', expected_org_id: 'org-1', department_id: next.id, request_id: requestIdMatcher, keep_previous: true,
  })
})

it.each([
  ['add', '新兼岗部门', next.id],
  ['remove', '要移除的兼岗部门', secondary.id],
])('saves a routine secondary %s in one request', async (operation, label, departmentId) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    status: 'applied', action: operation, affected_department_ids: [departmentId], effective_at: applied.effective_at,
  }))
  const { onTransferred } = setup()

  fireEvent.change(screen.getByLabelText('调整内容'), { target: { value: operation } })
  fireEvent.change(screen.getByLabelText(label), { target: { value: departmentId } })
  submit()

  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(secondaryEndpoint, expect.objectContaining({ method: 'POST' }))
  expect(requestBody(0)).toEqual({
    action: 'save', expected_org_id: 'org-1', department_id: departmentId, request_id: requestIdMatcher, operation,
  })
})

it.each([
  ['按调整后的部门权限生效', 'new_baseline'],
  ['保留符合条件的个人权限', 'retain_eligible'],
])('asks once in the same dialog when affected personal permissions require %s', async (label, decision) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(choice)).mockResolvedValueOnce(Response.json(applied))
  const { onTransferred } = setup()
  selectPrimary()
  submit()

  expect(await screen.findByRole('group', { name: '调整后的个人权限' })).toHaveTextContent('有 3 项个人部门权限受影响，1 项可保留。')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('新主部门')).toBeDisabled()
  expect(onTransferred).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: label }))
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  expect(requestBody(1)).toEqual({ ...requestBody(0), choice_id: choiceId, override_choice: decision })
})

it('handles affected secondary permissions and blocks retaining a scope that can no longer be kept', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    ...choice, impact: { affected_count: 1, retainable_count: 0, blocked_count: 1 },
  })).mockResolvedValueOnce(Response.json({
    status: 'applied', action: 'remove', affected_department_ids: [secondary.id], effective_at: applied.effective_at,
  }))
  const { onTransferred } = setup()
  fireEvent.change(screen.getByLabelText('调整内容'), { target: { value: 'remove' } })
  fireEvent.change(screen.getByLabelText('要移除的兼岗部门'), { target: { value: secondary.id } })
  submit()
  expect(await screen.findByRole('group', { name: '调整后的个人权限' })).toHaveTextContent('原权限的数据范围已无法沿用。')
  expect(screen.queryByRole('button', { name: '保留符合条件的个人权限' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '返回修改' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '按调整后的部门权限生效' }))
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(requestBody(1)).toEqual({
    ...requestBody(0), operation: 'remove', department_id: secondary.id, choice_id: choiceId, override_choice: 'new_baseline',
  })
})

it('lets a stale personal choice be recalculated without losing the selected department', async () => {
  const fetcher = vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(choice))
    .mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_TRANSFER_STALE', error: '部门关系已变更，请重新保存。' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(applied))
  const { onTransferred } = setup()
  selectPrimary()
  submit()
  fireEvent.click(await screen.findByRole('button', { name: '按调整后的部门权限生效' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('请重新保存')
  expect(screen.queryByRole('group', { name: '调整后的个人权限' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('新主部门')).toHaveValue(next.id)
  expect(onTransferred).not.toHaveBeenCalled()

  submit()
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(requestBody(2)).not.toHaveProperty('choice_id')
  expect(requestBody(2).request_id).not.toBe(requestBody(0).request_id)
})

it('retries the same transaction when the save receipt could not be read', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json(applied))
  const { onTransferred } = setup()
  selectPrimary()
  submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('无法确认保存结果')
  expect(screen.getByLabelText('新主部门')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重新核对' }))
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(requestBody(1)).toEqual(requestBody(0))
})

it('retries the exact personal permission choice if the result could not be verified', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(choice))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json(applied))
  const { onTransferred } = setup()
  selectPrimary()
  submit()
  fireEvent.click(await screen.findByRole('button', { name: '保留符合条件的个人权限' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('无法确认保存结果')
  expect(screen.getByRole('button', { name: '按调整后的部门权限生效' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '返回修改' })).toBeDisabled()
  expect(onTransferred).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '重新核对' }))
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce())
  expect(requestBody(2)).toEqual({ ...requestBody(0), choice_id: choiceId, override_choice: 'retain_eligible' })
  expect(requestBody(2)).toEqual(requestBody(1))
})

it('limits a synced member to manual secondary changes and does not treat a concurrent no-op as a change', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'unchanged', action: 'add', affected_department_ids: [] }))
  const linked = { ...member, directory_identity_id: 'directory-id' }
  const { onTransferred } = setup(linked)
  expect(screen.queryByRole('option', { name: '调整主部门' })).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: '移除兼岗' })).toBeDisabled()
  expect(screen.queryByRole('option', { name: '项目支持组' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('新兼岗部门'), { target: { value: next.id } })
  submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('部门关系无需变更')
  expect(onTransferred).not.toHaveBeenCalled()
})
