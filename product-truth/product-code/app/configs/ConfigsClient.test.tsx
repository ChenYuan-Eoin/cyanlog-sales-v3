// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConfigRoleRecord } from '@/lib/org-role-permission-readback'
import type { ConfigTabId, OrgSummaryPayload } from './types'
import type { RoleMetadataChange } from './tabs/role-metadata'
import ConfigsClient from './ConfigsClient'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./tabs/TabsContent', async () => {
  const { useState } = await import('react')
  const { RoleDetailPanel } = await import('./tabs/RoleDetailPanel')
  return {
    default: function MockTabsContent({ activeTab, roles, orgSummary, savingRoleId, permissionsEditable, onSaveRole, onMaintainRole, onRefreshOrg }: {
      activeTab: ConfigTabId
      roles: ConfigRoleRecord[]
      orgSummary: OrgSummaryPayload | null
      savingRoleId: string | null
      permissionsEditable: boolean
      onSaveRole: (roleId: string, permissions: string[]) => void
      onMaintainRole: (change: RoleMetadataChange) => Promise<string>
      onRefreshOrg: () => void | Promise<void>
    }) {
      const [editingMember, setEditingMember] = useState(false)
      if (activeTab === 'org-structure') return orgSummary && <>
        <output aria-label="组织成员">{orgSummary.users.map(user => user.display_name).join(',')}</output>
        <button type="button" onClick={() => setEditingMember(true)}>编辑成员</button>
        {editingMember && <input aria-label="成员编辑草稿" />}
        <button type="button" onClick={() => void onRefreshOrg()}>回读组织成员</button>
      </>
      if (activeTab !== 'role-access') return null
      const role = roles[0]
      if (!role) return null
      return <>
        {permissionsEditable && orgSummary && (
          <button type="button" onClick={() => void onMaintainRole({ type: 'create', name: '测试新角色', description: '' })}>提交角色维护</button>
        )}
        <output aria-label="组织角色清单">{orgSummary?.roles.map(role => role.name).join(',')}</output>
        <output aria-label="成员角色标签">{orgSummary?.users.flatMap(user => user.scoped_roles?.map(role => role.roleName) ?? []).join(',')}</output>
        <RoleDetailPanel key={orgSummary?.organization?.id} role={role} currentUserId="actor"
          saving={savingRoleId === role.id} permissionsEditable={permissionsEditable}
          departments={[]} users={[]} onSave={permissions => onSaveRole(role.id, permissions)} />
      </>
    },
  }
})

const roleId = 'sales-role'
const organization = 'org-a'
const existingPermissions = ['config:read', 'quote:view']
const publishPermission = 'config:publish'
const roleList = '/api/roles'
const roleDetail = `/api/roles?role_id=${roleId}`
const roleWrite = `/api/roles/${roleId}`
const fetcher = vi.fn<typeof fetch>()

function role(permissions: string[]) {
  return { id: roleId, code: 'SALES', name: '销售', description: null, permissions, sort_order: 1 }
}

function rolesResponse(permissions = existingPermissions, orgId = organization, editable = true) {
  return Response.json({ success: true, data: {
    org_id: orgId, roles: [role(permissions)], permissions_editable: editable, permission_catalog: [],
  } })
}

function organizationResponse(id = organization) {
  return Response.json({ organization: { id }, users: [], roles: [], departments: [], spaces: [] })
}

function organizationRoster(label: string, id = organization) {
  return Response.json({ organization: { id }, users: [{ id: 'employee', display_name: label }], roles: [], departments: [], spaces: [] })
}

const roleDirectoryOnly = { general: false, organization: false, integrations: false, roles: true, shipping: false }

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>(settle => { resolve = settle })
  return { promise, resolve }
}

async function openEditor() {
  render(<ConfigsClient />)
  fireEvent.click(await screen.findByRole('tab', { name: '权限设置' }))
  return screen.getByRole('checkbox', { name: /配置发布/ })
}

it('reflects verified role maintenance in the same-session organization read and refreshes binding labels', async () => {
  const created = { id: 'created', code: 'CUSTOM_CREATED', name: '测试新角色', description: null, permissions: [], metadata_revision: 1 }
  const directory = deferredResponse()
  const readDirectory = vi.fn().mockResolvedValueOnce(organizationResponse()).mockReturnValueOnce(directory.promise)
  const sendRoles = (roles: unknown[]) => Response.json({ success: true, data: {
    org_id: organization, roles, permissions_editable: true, can_appoint_system_super_admin: true,
  } })
  fetcher.mockImplementation(async (input, init) => {
    if (input === '/api/admin/org') return readDirectory()
    if (input === roleList && init?.method === 'POST') return Response.json({ success: true, data: { org_id: organization, role: created } })
    if (input === roleList) return sendRoles([role(existingPermissions)])
    if (input === '/api/roles?role_id=created') return sendRoles([created])
    throw new Error('Unexpected fetch')
  })
  await openEditor()
  fireEvent.click(screen.getByRole('button', { name: '提交角色维护' }))
  await waitFor(() => expect(screen.getByLabelText('组织角色清单')).toHaveTextContent('测试新角色'))
  expect(screen.getByRole('tab', { name: '权限设置' })).toHaveAttribute('aria-selected', 'true')
  expect(readDirectory).toHaveBeenCalledTimes(2)
  await act(async () => directory.resolve(Response.json({
    organization: { id: organization }, roles: [created], departments: [], spaces: [],
    users: [{ id: 'member', scoped_roles: [{ roleId: created.id, roleName: created.name }] }],
  })))
  expect(screen.getByLabelText('成员角色标签')).toHaveTextContent('测试新角色')
  expect(screen.getByRole('tab', { name: '权限设置' })).toHaveAttribute('aria-selected', 'true')
})

beforeEach(() => {
  window.history.replaceState({}, '', '/configs?tab=role-access')
  localStorage.setItem('token', 'current-session')
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('preserves unsaved permission changes when a focus read verifies the same permission set', async () => {
  const focusRead = deferredResponse()
  const readRoles = vi.fn().mockResolvedValueOnce(rolesResponse()).mockReturnValueOnce(focusRead.promise)
  fetcher.mockImplementation(async input => {
    if (input === roleList) return readRoles()
    if (input === '/api/admin/org') return organizationResponse()
    throw new Error('Unexpected fetch')
  })
  const publish = await openEditor()
  fireEvent.click(publish)
  expect(publish).toBeChecked()

  fireEvent.focus(window)
  await waitFor(() => expect(readRoles).toHaveBeenCalledTimes(2))
  await act(async () => focusRead.resolve(rolesResponse([...existingPermissions].reverse())))

  expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeChecked()
  expect(screen.getByRole('button', { name: '保存授权' })).toBeEnabled()
})

it('keeps a pending save and renders the verified permission readback after focus', async () => {
  const write = deferredResponse()
  const persisted = [...existingPermissions, publishPermission]
  fetcher.mockImplementation(async input => {
    if (input === roleList) return rolesResponse()
    if (input === '/api/admin/org') return organizationResponse()
    if (input === roleWrite) return write.promise
    if (input === roleDetail) return rolesResponse(persisted)
    throw new Error('Unexpected fetch')
  })
  const publish = await openEditor()
  fireEvent.click(publish)
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))
  expect(screen.getByRole('button', { name: '正在保存授权…' })).toBeDisabled()

  await act(async () => fireEvent.focus(window))
  await act(async () => write.resolve(Response.json({ success: true, data: { org_id: organization, role: role(persisted) } })))
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === roleDetail)).toBe(true))
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))

  expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeChecked()
  expect(screen.getByRole('button', { name: '授权已保存' })).toBeDisabled()
  expect(fetcher.mock.calls.filter(([url]) => url === roleList)).toHaveLength(1)
  const saveRequest = fetcher.mock.calls.find(([url]) => url === roleWrite)?.[1]
  expect(saveRequest?.method).toBe('PATCH')
  expect(JSON.parse(String(saveRequest?.body))).toEqual({
    expected_org_id: organization, expected_permissions: existingPermissions, permissions: persisted,
  })
})

it('clears a draft when the same-session role refresh verifies that editing was revoked', async () => {
  const revoked = deferredResponse()
  const readRoles = vi.fn().mockResolvedValueOnce(rolesResponse()).mockReturnValueOnce(revoked.promise)
  fetcher.mockImplementation(async input => {
    if (input === roleList) return readRoles()
    if (input === '/api/admin/org') return organizationResponse()
    throw new Error('Unexpected fetch')
  })
  const publish = await openEditor()
  fireEvent.click(publish)
  expect(publish).toBeChecked()

  fireEvent.focus(window)
  await waitFor(() => expect(readRoles).toHaveBeenCalledTimes(2))
  await act(async () => revoked.resolve(rolesResponse(existingPermissions, organization, false)))

  expect(screen.getByRole('checkbox', { name: /配置发布/ })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /配置发布/ })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: '保存授权' })).not.toBeInTheDocument()
})

it('clears the previous editor if fresh role and directory reads disagree on the current organization', async () => {
  const readRoles = vi.fn().mockResolvedValueOnce(rolesResponse())
    .mockResolvedValueOnce(rolesResponse(existingPermissions, 'org-b'))
  fetcher.mockImplementation(async input => {
    if (input === roleList) return readRoles()
    if (input === '/api/admin/org') return organizationResponse()
    throw new Error('Unexpected fetch')
  })
  fireEvent.click(await openEditor())
  fireEvent.focus(window)

  expect(await screen.findByText('当前组织已切换，请刷新后重试。')).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([url]) => url === roleWrite)).toBe(false)
})

it('discards a pending focus read if the token changed before the storage event was delivered', async () => {
  const focusRead = deferredResponse()
  const readRoles = vi.fn().mockResolvedValueOnce(rolesResponse()).mockReturnValueOnce(focusRead.promise)
  fetcher.mockImplementation(async input => {
    if (input === roleList) return readRoles()
    if (input === '/api/admin/org') return organizationResponse()
    throw new Error('Unexpected fetch')
  })
  fireEvent.click(await openEditor())
  fireEvent.focus(window)
  await waitFor(() => expect(readRoles).toHaveBeenCalledTimes(2))
  localStorage.setItem('token', 'next-session')
  await act(async () => focusRead.resolve(rolesResponse()))

  expect(screen.getByText('当前登录会话已变化，请重新载入角色权限。')).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()
})

it('reloads after a token change during save without applying the previous session readback', async () => {
  const write = deferredResponse()
  const nextSession = deferredResponse()
  const persisted = [...existingPermissions, publishPermission]
  fetcher.mockImplementation(async (input, init) => {
    const token = new Headers(init?.headers).get('Authorization')
    if (input === '/api/admin/org') return organizationResponse()
    if (input === roleList) return token === 'Bearer next-session' ? nextSession.promise : rolesResponse()
    if (input === roleWrite) return write.promise
    if (input === roleDetail) return rolesResponse(persisted)
    throw new Error('Unexpected fetch')
  })
  fireEvent.click(await openEditor())
  fireEvent.click(screen.getByRole('button', { name: '保存授权' }))

  localStorage.setItem('token', 'next-session')
  fireEvent(window, new StorageEvent('storage', { key: 'token' }))
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()
  await act(async () => nextSession.resolve(rolesResponse()))
  fireEvent.click(await screen.findByRole('tab', { name: '权限设置' }))
  expect(screen.getByRole('checkbox', { name: /配置发布/ })).not.toBeChecked()

  await act(async () => write.resolve(Response.json({ success: true, data: { org_id: organization, role: role(persisted) } })))
  expect(fetcher.mock.calls.some(([url, init]) => url === roleDetail
    && new Headers(init?.headers).get('Authorization') === 'Bearer current-session')).toBe(true)
  expect(screen.getByRole('checkbox', { name: /配置发布/ })).not.toBeChecked()
  expect(screen.getByRole('button', { name: '授权已保存' })).toBeDisabled()
})

it('opens the organization directory when member-only access requests the role tab', async () => {
  fetcher.mockImplementation(async input => {
    if (input === '/api/admin/org') return organizationResponse()
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={{ general: false, organization: true, integrations: false, roles: false, shipping: false }} />)

  expect(await screen.findByRole('heading', { name: '组织架构' })).toBeVisible()
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/admin/org', expect.anything()))
  expect(fetcher.mock.calls.some(([url]) => url === roleList)).toBe(false)
  expect(screen.queryByRole('button', { name: /外部系统接入|角色权限|定价与审批/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^组织架构/ })).toHaveAttribute('aria-current', 'page')
  expect(window.location.search).toBe('?tab=org-structure')
})

it('keeps the organization roster and member draft mounted through focus and explicit readback', async () => {
  window.history.replaceState({}, '', '/configs?tab=org-structure')
  const focusResponse = deferredResponse()
  const explicitResponse = deferredResponse()
  const readOrg = vi.fn().mockResolvedValueOnce(organizationRoster('已核验成员'))
    .mockReturnValueOnce(focusResponse.promise).mockReturnValueOnce(explicitResponse.promise)
  fetcher.mockImplementation(async input => {
    if (input === '/api/admin/org') return readOrg()
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={{ ...roleDirectoryOnly, organization: true }} />)

  fireEvent.click(await screen.findByRole('button', { name: '编辑成员' }))
  const draft = screen.getByRole('textbox', { name: '成员编辑草稿' })
  fireEvent.change(draft, { target: { value: '当前草稿' } })
  const roleTab = screen.getByRole('button', { name: /^角色权限/ })
  fireEvent.mouseEnter(roleTab)
  fireEvent.focus(roleTab)
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/admin/org'])
  expect(screen.getByLabelText('组织成员')).toHaveTextContent('已核验成员')

  fireEvent.focus(window)
  await waitFor(() => expect(readOrg).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('组织成员')).toHaveTextContent('已核验成员')
  expect(screen.getByRole('textbox', { name: '成员编辑草稿' })).toBe(draft)
  await act(async () => focusResponse.resolve(organizationRoster('同组织成员')))
  expect(screen.getByLabelText('组织成员')).toHaveTextContent('同组织成员')
  expect(draft).toHaveValue('当前草稿')

  fireEvent.click(screen.getByRole('button', { name: '回读组织成员' }))
  await waitFor(() => expect(readOrg).toHaveBeenCalledTimes(3))
  expect(fetcher.mock.calls.every(([url]) => url === '/api/admin/org')).toBe(true)
  expect(screen.getByRole('textbox', { name: '成员编辑草稿' })).toBe(draft)
  await act(async () => explicitResponse.resolve(organizationRoster('保存回读成员')))
  expect(screen.getByLabelText('组织成员')).toHaveTextContent('保存回读成员')
  expect(draft).toHaveValue('当前草稿')
  expect(window.location.search).toBe('?tab=org-structure')
})

it.each(['token', 'organization', 'forbidden'] as const)('clears the organization roster after a %s change during readback', async unsafeChange => {
  window.history.replaceState({}, '', '/configs?tab=org-structure')
  const pending = deferredResponse()
  const currentOrg = unsafeChange === 'organization' ? 'org-b' : organization
  const readOrg = vi.fn().mockResolvedValueOnce(organizationRoster('已核验成员')).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(organizationRoster('重新核验的成员', currentOrg))
  fetcher.mockImplementation(async input => {
    if (input === '/api/admin/org') return readOrg()
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={{ ...roleDirectoryOnly, organization: true }} />)
  expect(await screen.findByLabelText('组织成员')).toHaveTextContent('已核验成员')
  fireEvent.click(screen.getByRole('button', { name: '编辑成员' }))

  fireEvent.focus(window)
  await waitFor(() => expect(readOrg).toHaveBeenCalledTimes(2))
  if (unsafeChange === 'token') localStorage.setItem('token', 'other-session')
  await act(async () => pending.resolve(unsafeChange === 'forbidden'
    ? Response.json({ error: '组织架构访问已撤销' }, { status: 403 })
    : organizationRoster('不应显示的成员', currentOrg)))
  expect(screen.queryByLabelText('组织成员')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '成员编辑草稿' })).not.toBeInTheDocument()
  fireEvent.focus(window)
  expect(await screen.findByLabelText('组织成员')).toHaveTextContent('重新核验的成员')
  expect(screen.queryByRole('textbox', { name: '成员编辑草稿' })).not.toBeInTheDocument()
})

it('opens only the standalone role directory without requesting the organization roster', async () => {
  fetcher.mockImplementation(async input => {
    if (input === roleList) return rolesResponse(existingPermissions, organization, false)
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={roleDirectoryOnly} />)

  expect(await screen.findByRole('tab', { name: '权限设置' })).toBeVisible()
  expect(screen.getByRole('button', { name: /^角色权限/ })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('button', { name: /^组织架构|^外部系统接入/ })).not.toBeInTheDocument()
  expect(screen.getByLabelText('成员角色标签')).toBeEmptyDOMElement()
  expect(screen.queryByRole('button', { name: '提交角色维护' })).not.toBeInTheDocument()
  expect(screen.queryByText('组织架构加载失败')).not.toBeInTheDocument()

  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([roleList, roleList])
})

it('excludes retired roles from the navigation and header counts', async () => {
  const roles = [
    role(existingPermissions),
    { ...role(['*']), id: 'system-root', code: 'SUPER_ADMIN', name: '超级管理员' },
    { ...role([]), id: 'legacy-root', code: 'ORG_SUPER_ADMIN', name: '旧组织超管' },
    { ...role([]), id: 'legacy-baseline', code: 'FXIAOKE_BASELINE', name: '纷享基础查看' },
  ]
  fetcher.mockResolvedValue(Response.json({ success: true, data: {
    org_id: organization, roles, permissions_editable: false, permission_catalog: [],
  } }))
  render(<ConfigsClient tabAccess={roleDirectoryOnly} />)

  const roleTab = await screen.findByRole('button', { name: /^角色权限/ })
  expect(roleTab).toHaveAttribute('aria-current', 'page')
  expect(await within(roleTab).findByText('2 项')).toBeInTheDocument()
  expect(within(screen.getByText('角色总数').parentElement!).getByText('2')).toBeInTheDocument()
})

it('clears the roster when organization access is removed and ignores its in-flight response', async () => {
  const pendingDirectory = deferredResponse()
  const summary = (label: string) => Response.json({
    organization: { id: organization }, roles: [], departments: [], spaces: [],
    users: [{ id: 'member', scoped_roles: [{ roleId, roleName: label }] }],
  })
  const readDirectory = vi.fn().mockResolvedValueOnce(summary('旧成员授权')).mockReturnValueOnce(pendingDirectory.promise)
  let editable = true
  fetcher.mockImplementation(async input => {
    if (input === '/api/admin/org') return readDirectory()
    if (input === roleList) return rolesResponse(existingPermissions, organization, editable)
    throw new Error('Unexpected fetch')
  })
  const view = render(<ConfigsClient tabAccess={{ ...roleDirectoryOnly, organization: true }} />)
  expect(await screen.findByLabelText('成员角色标签')).toHaveTextContent('旧成员授权')
  expect(screen.getByRole('button', { name: '提交角色维护' })).toBeVisible()

  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(2))
  editable = false
  view.rerender(<ConfigsClient tabAccess={roleDirectoryOnly} />)
  expect(await screen.findByLabelText('成员角色标签')).toBeEmptyDOMElement()
  expect(screen.queryByRole('button', { name: '提交角色维护' })).not.toBeInTheDocument()
  await act(async () => pendingDirectory.resolve(summary('迟到的成员授权')))
  expect(screen.getByLabelText('成员角色标签')).toBeEmptyDOMElement()
  expect(readDirectory).toHaveBeenCalledTimes(2)
})

it('opens organization, integrations and roles from three separate buttons in section order', async () => {
  window.history.replaceState({}, '', '/configs?tab=org-structure')
  const pendingRoleList = deferredResponse()
  fetcher.mockImplementation(async input => {
    if (input === '/api/admin/org') return organizationResponse()
    if (input === roleList) return pendingRoleList.promise
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={{ general: false, organization: true, integrations: true, roles: true, shipping: false }} />)

  const organizationTab = await screen.findByRole('button', { name: /^组织架构/ })
  const integrationsTab = screen.getByRole('button', { name: /^外部系统接入/ })
  const roleTab = screen.getByRole('button', { name: /^角色权限/ })
  expect(within(organizationTab.parentElement!).getAllByRole('button')).toEqual([organizationTab, integrationsTab, roleTab])
  expect(organizationTab).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('combobox', { name: '组织与权限视图' })).not.toBeInTheDocument()
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/admin/org', expect.anything()))
  expect(fetcher.mock.calls.some(([url]) => url === roleList)).toBe(false)
  fireEvent.click(roleTab)
  expect(roleTab).toHaveAttribute('aria-current', 'page')
  expect(organizationTab).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('heading', { name: '角色权限' })).toBeVisible()
  expect(window.location.search).toBe('?tab=role-access')
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()
  await act(async () => pendingRoleList.resolve(rolesResponse()))
  expect(await screen.findByRole('tab', { name: '权限设置' })).toBeInTheDocument()

  fireEvent.click(integrationsTab)
  expect(integrationsTab).toHaveAttribute('aria-current', 'page')
  expect(roleTab).not.toHaveAttribute('aria-current')
  expect(screen.getByRole('heading', { name: '外部系统接入' })).toBeVisible()
  expect(window.location.search).toBe('?tab=integrations')
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()

  fireEvent.click(organizationTab)
  expect(screen.getByRole('heading', { name: '组织架构' })).toBeVisible()
  expect(window.location.search).toBe('?tab=org-structure')
})

it('keeps the legacy config route confined to the shipping settings tab for its reader', async () => {
  render(<ConfigsClient tabAccess={{ general: false, organization: false, integrations: false, roles: false, shipping: true }} />)

  await waitFor(() => expect(window.location.search).toBe('?tab=shipping'))
  expect(screen.queryByRole('button', { name: /组织与权限|定价与审批/ })).not.toBeInTheDocument()
  expect(fetcher).not.toHaveBeenCalled()
})

it('opens the external connections tab with only integration access', async () => {
  render(<ConfigsClient tabAccess={{ general: false, organization: false, integrations: true, roles: false, shipping: false }} />)

  expect(await screen.findByRole('heading', { name: '外部系统接入' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /组织架构|角色权限|定价与审批/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^外部系统接入/ })).toHaveAttribute('aria-current', 'page')
  expect(window.location.search).toBe('?tab=integrations')
})
