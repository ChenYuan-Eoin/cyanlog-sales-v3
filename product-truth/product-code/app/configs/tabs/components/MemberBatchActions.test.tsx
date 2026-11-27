import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { OrgSummaryUser } from '../../types'
import { MemberBatchActions } from './MemberBatchActions'

const orgId = '10000000-0000-4000-8000-000000000001'
const roleId = '10000000-0000-4000-8000-000000000002'
const firstReview = '10000000-0000-4000-8000-000000000003'
const latestReview = '10000000-0000-4000-8000-000000000004'

function member(id: string, display_name: string): OrgSummaryUser {
  return { id, display_name, role_names: '', email: '', title: '', primary_dept_name: '', status: 'active' }
}

const regular = member('regular', '正常成员')
const affected = member('affected', '需核对成员')
const denied = member('denied', '不可操作成员')

function review(revision: string, retainable: boolean) {
  return {
    user_id: affected.id, ok: false, code: 'ROLE_PERMISSION_REVIEW_REQUIRED', error: '请选择个人权限处理方式',
    review_revision: revision, affected_permissions: [{ permission_code: 'user:view', retainable }],
  }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('saves regular recipients once and keeps only impacted recipients in the same dialog through a stale choice', async () => {
  const requests = vi.fn().mockResolvedValueOnce(Response.json({
    results: [
      { user_id: regular.id, ok: true },
      review(firstReview, true),
      { user_id: denied.id, ok: false, code: 'MEMBER_NOT_ELIGIBLE', error: '成员暂不可分配角色' },
    ],
  })).mockResolvedValueOnce(Response.json({
    results: [{ user_id: affected.id, ok: false, code: 'ROLE_OVERRIDE_REVIEW_CHANGED', error: '时间已过' }],
  })).mockResolvedValueOnce(Response.json({
    results: [review(latestReview, false)],
  })).mockResolvedValueOnce(Response.json({
    results: [{ user_id: affected.id, ok: true, pending: true }],
  }))
  vi.stubGlobal('fetch', requests)
  const onRefresh = vi.fn()
  const onSucceeded = vi.fn()
  const props = {
    orgId, members: [regular, affected, denied], roles: [{ id: roleId, code: 'CUSTOM', name: '销售' }],
    canSuspend: false, canOffboard: false, canRemoveMembership: false, canAssignRoles: true,
    authHeaders: () => ({ 'Content-Type': 'application/json' }),
    onClearSelection: vi.fn(), onSucceeded, onRefresh,
  }
  const view = render(<MemberBatchActions {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '批量分配角色' }))
  const dialog = within(await screen.findByRole('dialog', { name: '批量分配角色' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: '销售' }))
  fireEvent.click(dialog.getByRole('button', { name: '确认执行' }))

  const affectedChoice = within(await dialog.findByRole('group', { name: affected.display_name }))
  expect(dialog.queryByRole('group', { name: regular.display_name })).not.toBeInTheDocument()
  expect(dialog.queryByRole('group', { name: denied.display_name })).not.toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '保存个人权限选择' })).toBeDisabled()
  expect(onSucceeded).toHaveBeenCalledExactlyOnceWith([regular.id])
  view.rerender(<MemberBatchActions {...props} members={[affected, denied]} />)
  fireEvent.click(affectedChoice.getByRole('radio', { name: '保留符合条件的个人权限' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存个人权限选择' }))

  fireEvent.click(await dialog.findByRole('button', { name: '重新核对' }))
  expect(await dialog.findByRole('radio', { name: '保留符合条件的个人权限' })).toBeDisabled()
  expect(dialog.getByRole('radio', { name: '按调整后的角色权限生效' })).not.toBeChecked()
  fireEvent.click(dialog.getByRole('radio', { name: '按调整后的角色权限生效' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存个人权限选择' }))
  expect(await screen.findByText('批量分配角色 · 成功 2 人，失败 1 人，1 人待首次登录生效')).toBeInTheDocument()
  expect(screen.getByText('不可操作成员 · 成员暂不可分配角色')).toBeInTheDocument()
  expect(onSucceeded.mock.calls).toEqual([[[regular.id]], [[affected.id]]])
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2))
  const base = { expected_org_id: orgId, action: 'assign_roles', role_ids: [roleId] }
  expect(requests.mock.calls.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
    { ...base, user_ids: [regular.id, affected.id, denied.id] },
    { ...base, user_ids: [affected.id], personal_permissions: [
      { user_id: affected.id, review_revision: firstReview, choice: 'retain_eligible' },
    ] },
    { ...base, user_ids: [affected.id] },
    { ...base, user_ids: [affected.id], personal_permissions: [
      { user_id: affected.id, review_revision: latestReview, choice: 'new_baseline' },
    ] },
  ])
})
