import { afterEach, expect, it, vi } from 'vitest'
import { saveAndReadRoleMetadata } from './role-metadata'

const role = { id: 'role-1', code: 'CUSTOM', name: '改名后', description: '原说明', permissions: [], metadata_revision: 3 }
const receipt = () => Response.json({ success: true, data: { org_id: 'org-1', role } })
const snapshot = (roles: unknown[]) => Response.json({ success: true, data: { org_id: 'org-1', roles, permissions_editable: true } })
afterEach(() => vi.unstubAllGlobals())

it('sends the exact organization and metadata version, then verifies the role readback', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(snapshot([role]))
  vi.stubGlobal('fetch', fetch)
  await expect(saveAndReadRoleMetadata({}, 'org-1', {
    type: 'rename', roleId: role.id, expectedRevision: 2, name: role.name, description: role.description,
  })).resolves.toMatchObject({ roleId: role.id, role: { name: role.name } })
  expect(fetch.mock.calls[0][0]).toBe('/api/roles/role-1/metadata')
  expect(fetch.mock.calls[0][1].method).toBe('PATCH')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    expected_org_id: 'org-1', expected_metadata_revision: 2, name: role.name, description: role.description,
  })
  expect(fetch).toHaveBeenLastCalledWith('/api/roles?role_id=role-1', { headers: {}, cache: 'no-store' })
})

it('requires archive readback absence and identifies linked-member conflicts', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { details: { reason: 'ROLE_HAS_BINDINGS' } } }, { status: 409 }))
    .mockResolvedValueOnce(receipt()).mockResolvedValueOnce(snapshot([role]))
    .mockResolvedValueOnce(receipt()).mockResolvedValueOnce(snapshot([]))
  vi.stubGlobal('fetch', fetch)
  const change = { type: 'archive', roleId: role.id, expectedRevision: 3 } as const
  await expect(saveAndReadRoleMetadata({}, 'org-1', change)).rejects.toThrow('此角色仍有成员或待生效绑定')
  await expect(saveAndReadRoleMetadata({}, 'org-1', change)).rejects.toMatchObject({ requiresRefresh: true, status: 409 })
  await expect(saveAndReadRoleMetadata({}, 'org-1', change)).resolves.toMatchObject({ roleId: role.id, role: null })
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ expected_org_id: 'org-1', expected_metadata_revision: 3 })
  expect(fetch.mock.calls[0][1].method).toBe('DELETE')
})
