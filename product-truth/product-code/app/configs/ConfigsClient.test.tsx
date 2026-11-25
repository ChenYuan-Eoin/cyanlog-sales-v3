// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ConfigRoleRecord } from '@/lib/org-role-permission-readback'
import type { OrgSummaryPayload } from './types'
import ConfigsClient from './ConfigsClient'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./tabs/TabsContent', async () => {
  const { RoleDetailPanel } = await import('./tabs/RoleDetailPanel')
  return {
    default: ({ roles, orgSummary, savingRoleId, permissionsEditable, onSaveRole }: {
      roles: ConfigRoleRecord[]
      orgSummary: OrgSummaryPayload | null
      savingRoleId: string | null
      permissionsEditable: boolean
      onSaveRole: (roleId: string, permissions: string[]) => void
    }) => {
      const role = roles[0]
      if (!role) return null
      return <RoleDetailPanel key={orgSummary?.organization?.id} role={role} currentUserId="actor"
        saving={savingRoleId === role.id} permissionsEditable={permissionsEditable}
        departments={[]} users={[]} onSave={permissions => onSaveRole(role.id, permissions)} />
    },
  }
})

const roleId = 'sales-role'
const organization = 'org-a'
const existingPermissions = ['config:read', 'quote:view']
const financialPermission = 'report:finance'
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

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>(settle => { resolve = settle })
  return { promise, resolve }
}

async function openEditor() {
  render(<ConfigsClient />)
  fireEvent.click(await screen.findByRole('tab', { name: '权限设置' }))
  return screen.getByRole('checkbox', { name: /财务报表访问/ })
}

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
  const financial = await openEditor()
  fireEvent.click(financial)
  expect(financial).toBeChecked()

  fireEvent.focus(window)
  await waitFor(() => expect(readRoles).toHaveBeenCalledTimes(2))
  await act(async () => focusRead.resolve(rolesResponse([...existingPermissions].reverse())))

  expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeChecked()
  expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
})

it('keeps a pending save and renders the verified permission readback after focus', async () => {
  const write = deferredResponse()
  const persisted = [...existingPermissions, financialPermission]
  fetcher.mockImplementation(async input => {
    if (input === roleList) return rolesResponse()
    if (input === '/api/admin/org') return organizationResponse()
    if (input === roleWrite) return write.promise
    if (input === roleDetail) return rolesResponse(persisted)
    throw new Error('Unexpected fetch')
  })
  const financial = await openEditor()
  fireEvent.click(financial)
  fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
  expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled()

  await act(async () => fireEvent.focus(window))
  await act(async () => write.resolve(Response.json({ success: true, data: { org_id: organization, role: role(persisted) } })))
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === roleDetail)).toBe(true))
  fireEvent.click(screen.getByRole('tab', { name: '权限设置' }))

  expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeChecked()
  expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
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
  const financial = await openEditor()
  fireEvent.click(financial)
  expect(financial).toBeChecked()

  fireEvent.focus(window)
  await waitFor(() => expect(readRoles).toHaveBeenCalledTimes(2))
  await act(async () => revoked.resolve(rolesResponse(existingPermissions, organization, false)))

  expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: '保存更改' })).not.toBeInTheDocument()
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
  const persisted = [...existingPermissions, financialPermission]
  fetcher.mockImplementation(async (input, init) => {
    const token = new Headers(init?.headers).get('Authorization')
    if (input === '/api/admin/org') return organizationResponse()
    if (input === roleList) return token === 'Bearer next-session' ? nextSession.promise : rolesResponse()
    if (input === roleWrite) return write.promise
    if (input === roleDetail) return rolesResponse(persisted)
    throw new Error('Unexpected fetch')
  })
  fireEvent.click(await openEditor())
  fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

  localStorage.setItem('token', 'next-session')
  fireEvent(window, new StorageEvent('storage', { key: 'token' }))
  expect(screen.queryByRole('tab', { name: '权限设置' })).not.toBeInTheDocument()
  await act(async () => nextSession.resolve(rolesResponse()))
  fireEvent.click(await screen.findByRole('tab', { name: '权限设置' }))
  expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).not.toBeChecked()

  await act(async () => write.resolve(Response.json({ success: true, data: { org_id: organization, role: role(persisted) } })))
  expect(fetcher.mock.calls.some(([url, init]) => url === roleDetail
    && new Headers(init?.headers).get('Authorization') === 'Bearer current-session')).toBe(true)
  expect(screen.getByRole('checkbox', { name: /财务报表访问/ })).not.toBeChecked()
  expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled()
})
