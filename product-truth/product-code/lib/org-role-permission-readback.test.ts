import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadOrgRolePermissionSnapshot, saveAndReadOrgRolePermissions } from './org-role-permission-readback'

const savedPermissions = ['quote:view', 'contract:view']
const input = {
  orgId: 'org-a', roleId: 'sales-id', expectedPermissions: ['quote:view'], permissions: savedPermissions,
}
const role = { id: input.roleId, code: 'SALES', name: '销售', permissions: savedPermissions }

function receipt(orgId = input.orgId) {
  return Response.json({ success: true, data: { org_id: orgId, role } })
}

function readback(data: Record<string, unknown> = {}) {
  return Response.json({
    success: true,
    data: { org_id: input.orgId, roles: [role], permissions_editable: true, ...data },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('organization role permission save and independent readback', () => {
  it('uses the explicit system super administrator appointment flag', async () => {
    const request = vi.fn().mockResolvedValueOnce(readback({ can_appoint_system_super_admin: true }))
      .mockResolvedValueOnce(readback({ can_assign_org_super_admin: true }))
    vi.stubGlobal('fetch', request)
    expect((await loadOrgRolePermissionSnapshot({})).canAppointSystemSuperAdmin).toBe(true)
    expect((await loadOrgRolePermissionSnapshot({})).canAppointSystemSuperAdmin).toBe(false)
  })

  it('sends the organization and old permissions, then confirms the same role without cache', async () => {
    const request = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(
      readback({ roles: [{ ...role, permissions: [...savedPermissions].reverse() }] }),
    )
    vi.stubGlobal('fetch', request)

    const verified = await saveAndReadOrgRolePermissions({ Authorization: 'Bearer test-token' }, input)
    expect(verified.snapshot.orgId).toBe(input.orgId)
    expect(verified.role.permissions).toEqual([...savedPermissions].reverse())
    expect(request.mock.calls[0][0]).toBe('/api/roles/sales-id')
    expect(request.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      expected_org_id: input.orgId, expected_permissions: input.expectedPermissions, permissions: input.permissions,
    })
    expect(request).toHaveBeenLastCalledWith('/api/roles?role_id=sales-id', {
      headers: { Authorization: 'Bearer test-token' }, cache: 'no-store',
    })
  })

  it('never claims success from a PATCH response for the wrong organization', async () => {
    const request = vi.fn().mockResolvedValueOnce(receipt('org-b'))
    vi.stubGlobal('fetch', request)
    await expect(saveAndReadOrgRolePermissions({}, input)).rejects.toThrow('无法确认本次保存')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not accept a stale owner grant even if the ordinary role still matches', async () => {
    const ownerChange = { expected: ['shipping:owner_view'], permissions: [] }
    const acknowledged = { ...role, owner_shipping_permissions: [] }
    const request = vi.fn().mockResolvedValueOnce(Response.json({
      success: true, data: { org_id: input.orgId, role: acknowledged },
    })).mockResolvedValueOnce(readback({ roles: [{ ...role, owner_shipping_permissions: ownerChange.expected }] }))
    vi.stubGlobal('fetch', request)
    await expect(saveAndReadOrgRolePermissions({}, { ...input, ownerChange })).rejects.toMatchObject({ status: 409 })
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      expected_owner_shipping_permissions: ownerChange.expected,
      owner_shipping_permissions: [],
    })
  })

  it.each([
    ['stale permissions', { roles: [{ ...role, permissions: input.expectedPermissions }] }],
    ['another organization', { org_id: 'org-b' }],
    ['another role', { roles: [{ ...role, id: 'manager-id' }] }],
    ['ambiguous role', { roles: [role, role] }],
  ])('treats %s as an unconfirmed readback', async (_label, data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(readback(data)))
    await expect(saveAndReadOrgRolePermissions({}, input)).rejects.toMatchObject({ status: 409 })
  })

  it('preserves denied readback status and tells the user to check rather than claiming success', async () => {
    const denied = Response.json({ success: false, error: { message: '无权限' } }, { status: 403 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(denied))
    await expect(saveAndReadOrgRolePermissions({}, input)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('暂未核实回读结果'),
    })
  })

  it('rejects a missing organization or another incomplete roles response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(readback({ org_id: undefined })))
    await expect(loadOrgRolePermissionSnapshot({})).rejects.toThrow('角色权限响应不完整')
  })
})


it('forwards only selectable catalog actions from the server snapshot', async () => {
  const view = { key: 'tender:view', label: '查看标书项目', description: '查看本人创建的标书项目', dependencies: [], selectable: true }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(readback({
    permission_catalog: [{ id: 'tender', label: '标书中心', description: '标书项目', items: [
      view, { ...view, key: 'tender:draft', selectable: false }, { ...view, key: 'tender:malformed', dependencies: [42] },
    ] }],
  })))
  expect((await loadOrgRolePermissionSnapshot({})).modulePermissionCatalog).toMatchObject([
    { id: 'tender', items: [{ key: view.key, label: view.label, description: view.description, dependencies: [] }] },
  ])
})
