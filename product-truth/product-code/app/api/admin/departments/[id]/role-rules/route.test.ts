import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const { auth, context, rpc } = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth, AuthError: class extends Error {} }))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: context }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const orgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const deptId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const roleId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const previewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const url = `https://example.test/api/admin/departments/${deptId}/role-rules`
const params = { params: Promise.resolve({ id: deptId }) }
const rules = [{ role_id: roleId, include_subdepartments: true }]
const draft = { action: 'preview', expected_org_id: orgId, rules }
const final = { action: 'confirm', expected_org_id: orgId, preview_id: previewId }
const preview = { preview_id: previewId, expires_at: '2026-11-27T15:00:00Z', added_sources: 2, removed_sources: 0, affected_members: 1 }
const state = { org_id: orgId, department_id: deptId, rules: [{ ...rules[0], role_name: '部门台账' }], available_roles: [] }

function post(body: object, headers?: HeadersInit) {
  return POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers }), params)
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ id: actorId })
  context.mockReset().mockResolvedValue({ orgId, canEditPlatformRoot: true })
  rpc.mockReset()
})

it('separates preview, token confirmation and readback for the authorized department', async () => {
  rpc.mockResolvedValueOnce({ data: preview }).mockResolvedValueOnce({ data: state }).mockResolvedValueOnce({ data: state })
  const scope = { p_actor_id: actorId, p_org_id: orgId, p_department_id: deptId }
  const viewed = await post(draft)
  expect(viewed.headers.get('cache-control')).toBe('private, no-store')
  expect(await viewed.json()).toEqual(preview)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_preview_department_role_rules_v1', { ...scope, p_rules: rules })
  expect(await (await post(final)).json()).toEqual(state)
  expect(rpc).toHaveBeenLastCalledWith('admin_confirm_department_role_rules_v1', { ...scope, p_preview_id: previewId })
  const read = await GET(new NextRequest(`${url}?expected_org_id=${orgId}`), params)
  expect(await read.json()).toEqual(state)
  expect(rpc).toHaveBeenLastCalledWith('admin_get_department_role_rules_v1', scope)
})

it('rejects bypassed confirmation, other origins and another organization before reading or writing rules', async () => {
  expect((await post({ ...final, rules })).status).toBe(400)
  expect((await post({ action: 'confirm', expected_org_id: orgId })).status).toBe(400)
  expect((await post(final, { origin: 'https://different.example.test' })).status).toBe(403)
  expect((await post({ ...draft, expected_org_id: actorId })).status).toBe(409)
  context.mockResolvedValue({ orgId, canEditPlatformRoot: false })
  expect((await post(final)).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()
})

it('requires a fresh preview for conflicts and never retries the write', async () => {
  rpc.mockResolvedValue({ error: { code: '40001' } })
  const response = await post(final)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'ROLE_RULES_PREVIEW_STALE' })
  expect(rpc).toHaveBeenCalledTimes(1)
})
