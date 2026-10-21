/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'user-1' })) }))
const scopedAccessMocks = vi.hoisted(() => ({
  getDefaultOrgId: vi.fn(), getFreshDefaultOrgId: vi.fn(), getFreshUserScopedRoleAssignments: vi.fn(),
}))
vi.mock('@/lib/scoped-access', () => scopedAccessMocks)

import { supabaseAdmin } from '@/lib/supabase'
import { SUPER_ADMIN_CORE_PERMISSIONS } from '@/lib/role-permission-policy'
import { PATCH } from './route'

function jsonRequest(body: unknown): any {
  return { json: vi.fn(async () => body), method: 'PATCH', headers: new Headers({ 'content-type': 'application/json' }) }
}
const routeContext: any = { params: Promise.resolve({ id: 'role-1' }) }
const root = { scopeType: 'org', scopeId: 'org-fresh', roleCode: 'SUPER_ADMIN', permissions: ['*'] }

function database(options: { code?: string; permissions?: string[]; settings?: any; conflict?: boolean; readError?: boolean } = {}) {
  const role = { id: 'role-1', code: options.code ?? 'SALES', name: '角色', permissions: options.permissions ?? ['quote:create'] }
  const operations: any[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const operation = { table, patch: undefined as any, filters: [] as any[] }
    operations.push(operation)
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((...filter: any[]) => { operation.filters.push(filter); return query }),
      is: vi.fn((...filter: any[]) => { operation.filters.push(filter); return query }),
      update: vi.fn((patch: any) => { operation.patch = patch; return query }),
      maybeSingle: vi.fn(async () => {
        if (table === 'roles') return { data: role, error: null }
        if (table !== 'organizations') throw new Error(`Unexpected table ${table}`)
        if (operation.patch) return { data: options.conflict ? null : { id: 'org-fresh' }, error: null }
        return { data: options.readError ? null : { settings: options.settings ?? {} }, error: options.readError ? new Error('settings unavailable') : null }
      }),
    }
    return query
  }) as any)
  return { role, operations }
}

describe('PATCH /api/roles/[id] organization role permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scopedAccessMocks.getDefaultOrgId.mockResolvedValue('org-cached')
    scopedAccessMocks.getFreshDefaultOrgId.mockResolvedValue('org-fresh')
    scopedAccessMocks.getFreshUserScopedRoleAssignments.mockResolvedValue([root])
  })

  it.each([
    ['config writer without root identity', { ...root, roleCode: 'ADMIN', permissions: ['config:write', 'role:manage'] }],
    ['department root', { ...root, scopeType: 'dept' }],
    ['another organization root', { ...root, scopeId: 'org-other' }],
    ['revoked root', { ...root, permissions: [], permissionsOverridden: true }],
  ])('rejects %s with 403', async (_label, assignment) => {
    scopedAccessMocks.getFreshUserScopedRoleAssignments.mockResolvedValue([assignment])
    const req = jsonRequest({ permissions: [], expected_permissions: ['quote:create'] })
    const res = await PATCH(req, routeContext)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('A002')
    expect(req.json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('uses the fresh organization, ignores client org_id, and returns data.role while preserving templates', async () => {
    const { role, operations } = database({ settings: { theme: 'dark', role_permission_overrides: { 'role-other': ['config:read'] } } })
    const res = await PATCH(jsonRequest({ org_id: 'org-attacker', permissions: [], expected_permissions: ['quote:create'] }), routeContext)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { role: { ...role, permissions: [] } } })
    expect(scopedAccessMocks.getFreshDefaultOrgId).toHaveBeenCalledWith('user-1')
    expect(scopedAccessMocks.getFreshUserScopedRoleAssignments).toHaveBeenCalledWith('user-1')
    expect(operations.filter((operation) => operation.table === 'organizations').every((operation) => operation.filters.some(([key, value]: any[]) => key === 'id' && value === 'org-fresh'))).toBe(true)
    expect(operations.filter((operation) => operation.patch)).toEqual([expect.objectContaining({ table: 'organizations', patch: {
      settings: { theme: 'dark', role_permission_overrides: { 'role-other': ['config:read'], 'role-1': [] } },
    } })])
    expect(role.permissions).toEqual(['quote:create'])
  })

  it.each([
    ['stale permission snapshot', { settings: { role_permission_overrides: { 'role-1': ['quote:view'] } } }],
    ['full settings CAS conflict', { conflict: true }],
  ])('returns 409 for %s', async (_label, options) => {
    database(options)
    const res = await PATCH(jsonRequest({ permissions: [], expected_permissions: ['quote:create'] }), routeContext)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('R003')
  })

  it.each(SUPER_ADMIN_CORE_PERMISSIONS)('returns 400 if SUPER_ADMIN loses %s', async (removed) => {
    database({ code: 'SUPER_ADMIN', permissions: ['*'] })
    const res = await PATCH(jsonRequest({ permissions: SUPER_ADMIN_CORE_PERMISSIONS.filter((key) => key !== removed), expected_permissions: ['*'] }), routeContext)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('B001')
  })

  it('allows SUPER_ADMIN non-core revocation', async () => {
    database({ code: 'SUPER_ADMIN', permissions: ['*'] })
    const res = await PATCH(jsonRequest({ permissions: [...SUPER_ADMIN_CORE_PERMISSIONS], expected_permissions: ['*'] }), routeContext)
    expect(res.status).toBe(200)
    expect((await res.json()).data.role.permissions).toEqual(SUPER_ADMIN_CORE_PERMISSIONS)
  })

  it.each([
    ['unknown permission', { permissions: ['invalid:key'], expected_permissions: ['quote:create'] }],
    ['duplicate permission', { permissions: ['quote:view', 'quote:view'], expected_permissions: ['quote:create'] }],
    ['missing expected snapshot', { permissions: ['quote:view'] }],
  ])('returns 400 for %s', async (_label, input) => {
    const { operations } = database()
    const res = await PATCH(jsonRequest(input), routeContext)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('V001')
    expect(operations.some((operation) => operation.patch)).toBe(false)
  })

  it('returns 500 when organization settings fail without writing a template fallback', async () => {
    const { operations } = database({ readError: true })
    const res = await PATCH(jsonRequest({ permissions: [], expected_permissions: ['quote:create'] }), routeContext)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('S002')
    expect(operations.some((operation) => operation.patch)).toBe(false)
  })
})
