// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConfigRoleRecord } from '@/lib/org-role-permission-readback'
import type { ConfigTabId, OrgSummaryPayload } from './types'
import type { RoleMetadataChange } from './tabs/role-metadata'
import ConfigsClient from './ConfigsClient'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./tabs/TabsContent', async () => {
  const { RoleDetailPanel } = await import('./tabs/RoleDetailPanel')
  return {
    default: ({ activeTab, roles, orgSummary, savingRoleId, permissionsEditable, onSaveRole, onMaintainRole }: {
      activeTab: ConfigTabId
      roles: ConfigRoleRecord[]
      orgSummary: OrgSummaryPayload | null
      savingRoleId: string | null
      permissionsEditable: boolean
      onSaveRole: (roleId: string, permissions: string[]) => void
      onMaintainRole: (change: RoleMetadataChange) => Promise<string>
    }) => {
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
  expect(screen.getByRole('combobox', { name: '组织与权限视图' })).toHaveValue('org-structure')
  expect(screen.queryByRole('option', { name: '角色' })).not.toBeInTheDocument()
  expect(window.location.search).toBe('?tab=org-structure')
})

it('opens only the standalone role directory without requesting the organization roster', async () => {
  fetcher.mockImplementation(async input => {
    if (input === roleList) return rolesResponse(existingPermissions, organization, false)
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={roleDirectoryOnly} />)

  expect(await screen.findByRole('tab', { name: '权限设置' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: '组织与权限视图' })).toHaveValue('role-access')
  expect(screen.queryByRole('option', { name: '组织架构' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('成员角色标签')).toBeEmptyDOMElement()
  expect(screen.queryByRole('button', { name: '提交角色维护' })).not.toBeInTheDocument()
  expect(screen.queryByText('组织架构加载失败')).not.toBeInTheDocument()

  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([roleList, roleList])
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

it('switches organization and roles through a single selector and keeps integrations separate', async () => {
  window.history.replaceState({}, '', '/configs?tab=org-structure')
  const pendingRoleList = deferredResponse()
  fetcher.mockImplementation(async input => {
    if (input === '/api/admin/org') return organizationResponse()
    if (input === roleList) return pendingRoleList.promise
    throw new Error('Unexpected fetch')
  })
  render(<ConfigsClient tabAccess={{ general: false, organization: true, integrations: true, roles: true, shipping: false }} />)

  const selector = await screen.findByRole('combobox', { name: '组织与权限视图' })
  expect(selector).toHaveValue('org-structure')
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['组织架构', '角色'])
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/admin/org', expect.anything()))
  expect(fetcher.mock.calls.some(([url]) => url === roleList)).toBe(false)
  expect(screen.queryByRole('button', { name: /^组织架构|^角色权限/ })).not.toBeInTheDocument()

  fireEvent.change(selector, { target: { value: 'role-access' } })
  expect(screen.getByRole('heading', { name: '角色权限' })).toBeVisible()
  expect(window.location.search).toBe('?tab=role-access')
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()
  await act(async () => pendingRoleList.resolve(rolesResponse()))
  expect(await screen.findByRole('tab', { name: '权限设置' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /^外部系统接入/ }))
  expect(screen.getByRole('heading', { name: '外部系统接入' })).toBeVisible()
  expect(window.location.search).toBe('?tab=integrations')
  expect(selector).toHaveValue('')
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()

  fireEvent.change(selector, { target: { value: 'org-structure' } })
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
  expect(screen.queryByRole('combobox', { name: '组织与权限视图' })).not.toBeInTheDocument()
  expect(window.location.search).toBe('?tab=integrations')
})
