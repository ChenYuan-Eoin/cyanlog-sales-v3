import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { EmployeePermissionOverrides } from './EmployeePermissionOverrides'
import type { EmployeePermissionOverride } from './PermissionSettingTable'

const ledger = 'shipping:ledger_view'
const owner = 'shipping:owner_view'
const scopeA = { type: 'department' as const, departments: [{ department_id: 'east', include_subdepartments: true }] }
const scopeB = { type: 'department' as const, departments: [{ department_id: 'south', include_subdepartments: false }] }
const endpoint = '/api/admin/users/employee/permission-overrides?orgId=org'
const transferReviewEndpoint = '/api/admin/users/employee/department-transfer-review'
const selectors = { effect: '查看收寄台账 个人设置', save: '保存查看收寄台账' }

function payload(override: EmployeePermissionOverride, baseScope = scopeA) {
  return {
    org_id: 'org',
    user_id: 'employee',
    permissions: [{
      key: ledger, base: true, effective: override?.effect !== 'DENY',
      base_scope: baseScope, effective_scope: override === null ? baseScope : override.scope, override,
      sources: [{ kind: 'role', name: '寄件专员' }, { kind: 'department', name: '华东销售' }], can_edit: true,
    }, {
      key: owner, base: false, effective: false, base_scope: null, effective_scope: null, override: null,
      sources: [], can_edit: true,
    }],
    departments: [
      { id: 'east', name: '华东销售', parent_id: null },
      { id: 'south', name: '华南销售', parent_id: null },
    ],
    shipping_permission_publication: { registered: [ledger, owner], published: [ledger, owner] },
    permission_catalog: [{
      id: 'shipping', label: '自助收寄', description: '', items: [{
        key: ledger, label: '查看收寄台账', description: '来自权限字典的台账说明。',
        moduleKey: 'shipping', capabilityLevel: 'L3', grantSubjectTypes: ['role', 'department'],
        scopeTypes: ['org', 'department'], dependencies: [], selectable: true,
      }],
    }],
  }
}

function open(reviewFetch: typeof fetch = async () => new Response(null, { status: 404 })) {
  const permissionsFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) => String(url).startsWith(transferReviewEndpoint)
    ? reviewFetch(url, init) : permissionsFetch(url, init))
  render(<EmployeePermissionOverrides orgId="org" userId="employee" userName="张三" onClose={() => undefined} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each([undefined, 'verified-directory-identity'])('replaces the entire action scope and verifies the fresh result (revision: %s)', async revision => {
  const override = { effect: 'ALLOW' as const, scope: scopeB }
  const snapshot = (value: EmployeePermissionOverride) => Response.json({ ...payload(value), target_revision: revision })
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(snapshot(null))
    .mockResolvedValueOnce(snapshot(override))
    .mockResolvedValueOnce(snapshot(override))
  vi.stubGlobal('fetch', fetchMock)
  open()
  const row = (await screen.findByRole('combobox', { name: selectors.effect })).closest('li')!
  expect(within(row).getByText('L3')).toBeInTheDocument()
  expect(within(row).getByText('来自权限字典的台账说明。')).toBeInTheDocument()
  expect(within(row).getByText('基础来源 角色 寄件专员、部门 华东销售')).toBeInTheDocument()
  expect(within(row).getByText('基础范围 华东销售（含下级）')).toBeInTheDocument()
  expect(within(row).getByText('最终范围 华东销售（含下级）')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: '确认并下单 个人设置' })).not.toBeInTheDocument()

  fireEvent.change(within(row).getByRole('combobox', { name: selectors.effect }), { target: { value: 'ALLOW' } })
  fireEvent.click(within(row).getByRole('button', { name: '移除数据部门 华东销售' }))
  expect(within(row).getByRole('button', { name: selectors.save })).toBeDisabled()
  fireEvent.change(within(row).getByRole('combobox', { name: '查看收寄台账 加入数据部门' }), { target: { value: 'south' } })
  fireEvent.click(within(row).getByRole('button', { name: selectors.save }))

  expect(await screen.findByText('已保存该权限点的个人设置。')).toBeInTheDocument()
  expect(within(row).getByText('基础范围 华东销售（含下级）')).toBeInTheDocument()
  expect(within(row).getByText('最终范围 华南销售')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ permission_code: ledger, expected_override: null, override, target_revision: revision }),
  }))
  expect(fetchMock).toHaveBeenNthCalledWith(3, endpoint, expect.objectContaining({ cache: 'no-store' }))
})

it('restores inherited access with a null override and uses the current base scope from the server', async () => {
  const denied = { effect: 'DENY' as const, scope: null }
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(payload(denied)))
    .mockResolvedValueOnce(Response.json(payload(null, scopeB)))
    .mockResolvedValueOnce(Response.json(payload(null, scopeB)))
  vi.stubGlobal('fetch', fetchMock)
  open()
  const effect = await screen.findByRole('combobox', { name: selectors.effect })
  expect(effect).toHaveValue('DENY')
  fireEvent.change(effect, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: selectors.save }))
  expect(await screen.findByText('已恢复为当前部门和角色授权。')).toBeInTheDocument()
  expect(screen.getByText('最终范围 华南销售')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ permission_code: ledger, expected_override: denied, override: null }),
  }))
})

it('edits an organization point in the same employee permission table using its fixed organization scope', async () => {
  const key = 'user:view'
  const noGrant = { key, base: false, effective: false, base_scope: null, effective_scope: null,
    can_edit: true, override: null, scope_types: ['org'], sources: [] }
  const override = { effect: 'ALLOW' as const, scope: { type: 'org' as const } }
  const current = payload(null)
  const before = { ...current, permissions: [...current.permissions, noGrant], organization_permission_publication: [key] }
  const after = { ...before, permissions: [...current.permissions, {
    ...noGrant, effective: true, effective_scope: override.scope, override,
  }] }
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(before))
    .mockResolvedValueOnce(Response.json(after))
    .mockResolvedValueOnce(Response.json(after))
  vi.stubGlobal('fetch', fetchMock)
  open()
  const select = await screen.findByRole('combobox', { name: '查看成员 个人设置' })
  const row = select.closest('li')!
  expect(within(row).getByText('最终关闭')).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'ALLOW' } })
  expect(within(row).getByText('数据范围 全组织')).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: '保存查看成员' }))
  expect(await within(row).findByText('最终开启')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ permission_code: key, expected_override: null, override }),
  }))
})

it.each([
  { key: 'shipping:owner_submit', label: '提交本人寄件', scopeType: 'self' as const, scopeLabel: '本人' },
  { key: 'shipping:connection_write', label: '维护顺丰连接', scopeType: 'org' as const, scopeLabel: '全组织' },
])('saves only the fixed $scopeLabel scope for $label', async ({ key, label, scopeType, scopeLabel }) => {
  const before = payload(null)
  const permission = { ...before.permissions[1], key }
  before.permissions.push(permission)
  before.shipping_permission_publication.registered.push(key)
  before.shipping_permission_publication.published.push(key)
  const override = { effect: 'ALLOW' as const, scope: { type: scopeType } }
  const after = {
    ...before,
    permissions: before.permissions.map(point => point.key === key
      ? { ...point, override, effective: true, effective_scope: override.scope }
      : point),
  }
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(before))
    .mockResolvedValueOnce(Response.json(after))
    .mockResolvedValueOnce(Response.json(after))
  vi.stubGlobal('fetch', fetchMock)
  open()

  const select = await screen.findByRole('combobox', { name: label + ' 个人设置' })
  const row = select.closest('li')!
  fireEvent.change(select, { target: { value: 'ALLOW' } })
  expect(within(row).getByText('数据范围 ' + scopeLabel)).toBeInTheDocument()
  expect(within(row).queryByRole('combobox', { name: label + ' 数据范围' })).not.toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: '保存' + label }))
  expect(await screen.findByText('已保存该权限点的个人设置。')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ permission_code: key, expected_override: null, override }),
  }))
})

it('disables further writes on a stale permission and requires a fresh read', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(payload(null)))
    .mockResolvedValueOnce(Response.json({}, { status: 409 }))
    .mockResolvedValueOnce(Response.json(payload({ effect: 'DENY', scope: null })))
  vi.stubGlobal('fetch', fetchMock)
  open()
  const effect = await screen.findByRole('combobox', { name: selectors.effect })
  fireEvent.change(effect, { target: { value: 'DENY' } })
  fireEvent.click(screen.getByRole('button', { name: selectors.save }))
  expect(await screen.findByRole('alert')).toHaveTextContent('重新读取')
  expect(screen.getByRole('button', { name: selectors.save })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重新读取员工权限' }))
  expect(await screen.findByRole('combobox', { name: selectors.effect })).toHaveValue('DENY')
  expect(screen.getByRole('button', { name: selectors.save })).toBeDisabled()
})

it('shows transfer reviews with the current editor, then acknowledges an item without restoring any prior entitlement', async () => {
  const permissionsFetch = vi.fn().mockResolvedValueOnce(Response.json(payload({ effect: 'DENY', scope: null })))
  const reviewFetch = vi.fn().mockResolvedValueOnce(Response.json({
    items: [{
      review_id: 'review-permission', kind: 'personal_override', permission_code: ledger, effect: 'ALLOW',
      scope: scopeA, effective_at: '2026-11-27T06:30:00Z',
    }, {
      review_id: 'review-role', kind: 'retained_role', role_name: '销售管理', scope_type: 'org',
      effective_at: '2026-11-27T06:30:00Z',
    }],
    has_more: false,
  })).mockResolvedValueOnce(Response.json({ success: true, review_id: 'review-permission' }))
  vi.stubGlobal('fetch', permissionsFetch)
  open(reviewFetch)

  expect(reviewFetch).not.toHaveBeenCalled()
  const reviews = await screen.findByRole('region', { name: '调部门待复核' })
  expect(reviewFetch).toHaveBeenCalledWith(transferReviewEndpoint + '?expected_org_id=org', expect.objectContaining({ cache: 'no-store' }))
  expect(within(reviews).getByText('销售管理')).toBeInTheDocument()
  expect(within(reviews).getByText(/^调岗时保留/)).toBeInTheDocument()
  expect(within(reviews).getByText(/^调岗时暂停授权 · 当前关闭/)).toBeInTheDocument()
  fireEvent.click(within(reviews).getByRole('link', { name: '打开当前权限表' }))
  expect(screen.getByRole('region', { name: '当前权限表' })).toHaveFocus()
  const markReviewed = () => fireEvent.click(within(reviews).getByRole('button', { name: '查看收寄台账 标为已复核' }))
  markReviewed()
  const confirmation = () => within(reviews).getByRole('group', { name: '确认复核 查看收寄台账' })
  expect(reviewFetch).toHaveBeenCalledTimes(1)
  fireEvent.click(within(confirmation()).getByRole('button', { name: '取消' }))
  expect(reviewFetch).toHaveBeenCalledTimes(1)

  markReviewed()
  fireEvent.click(within(confirmation()).getByRole('button', { name: '确认已复核' }))
  expect(await screen.findByText('已记录复核结果。')).toBeInTheDocument()
  expect(within(reviews).queryByText('查看收寄台账')).not.toBeInTheDocument()
  expect(within(reviews).getByText('销售管理')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: selectors.effect })).toHaveValue('DENY')
  expect(permissionsFetch).toHaveBeenCalledTimes(1)
  expect(reviewFetch).toHaveBeenLastCalledWith(transferReviewEndpoint, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ expected_org_id: 'org', review_id: 'review-permission' }),
  }))
})

it('keeps the current permission editor available when the review list cannot be read', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(payload(null))))
  open(vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })))
  expect(await screen.findByText('暂时无法读取调部门复核事项。')).toHaveAttribute('role', 'status')
  expect(screen.queryByRole('region', { name: '调部门待复核' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: selectors.effect })).not.toBeDisabled()
})
