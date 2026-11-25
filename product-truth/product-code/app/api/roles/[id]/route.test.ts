/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'user-1' })) }))
import { supabaseAdmin } from '@/lib/supabase'
import { SUPER_ADMIN_CORE_PERMISSIONS } from '@/lib/role-permission-policy'
import { PATCH } from './route'

function jsonRequest(body: Record<string, unknown>): any {
  return {
    json: vi.fn(async () => ({ expected_org_id: 'org-fresh', ...body })),
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}
const routeContext: any = { params: Promise.resolve({ id: 'role-1' }) }
const salesPermissions = ['quote:create']
const root = {
  org_id: 'org-fresh', user_id: 'user-1', scope_type: 'org', scope_id: 'org-fresh', granted_at: null,
  role: { id: 'root-role', code: 'SUPER_ADMIN', name: '超管', permissions: ['*'] },
}
const currentMember = { org_id: 'org-fresh', status: 'active', employment_status: 'active', is_default: true, left_at: null }
function database(options: {
  code?: string; permissions?: string[]; settings?: any; conflict?: boolean; readError?: boolean;
  assignments?: unknown[]; members?: unknown[]; permissionRows?: unknown[];
} = {}) {
  const role = { id: 'role-1', code: options.code ?? 'SALES', name: '角色', permissions: options.permissions ?? ['quote:create'] }
  const operations: any[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const operation = { table, patch: undefined as any, filters: [] as any[] }
    operations.push(operation)
    const query: any = {
      select: vi.fn(() => query),
      in: vi.fn(async () => ({ data: options.permissionRows ?? [], error: null })),
      eq: vi.fn((...filter: any[]) => { operation.filters.push(filter); return query }),
      is: vi.fn((...filter: any[]) => { operation.filters.push(filter); return query }),
      update: vi.fn((patch: any) => { operation.patch = patch; return query }),
      limit: vi.fn(async () => ({ data: options.members ?? [currentMember], error: null })),
      then(resolve: (data: object) => void) { return Promise.resolve({ data: options.assignments ?? [root], error: null }).then(resolve) },
      maybeSingle: vi.fn(async () => {
        if (table === 'roles') return { data: role, error: null }
        if (table !== 'organizations') throw new Error(`Unexpected table ${table}`)
        if (operation.patch) return { data: options.conflict ? null : { id: 'org-fresh' }, error: null }
        return {
          data: options.readError ? null : { id: 'org-fresh', status: 'active', settings: options.settings ?? {} },
          error: options.readError ? new Error('settings unavailable') : null,
        }
      }),
    }
    return query
  }) as any)
  return { role, operations }
}

describe('PATCH /api/roles/[id] organization role permissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['config writer without root identity', { ...root, role: { ...root.role, code: 'ADMIN', permissions: ['config:write', 'role:manage'] } }, {}],
    ['department root', { ...root, scope_type: 'department' }, {}],
    ['another organization root', { ...root, org_id: 'org-other' }, {}],
    ['revoked root', root, { role_permission_overrides: { 'root-role': [] } }],
  ])('rejects %s with 403', async (_label, assignment, settings) => {
    const { operations } = database({ assignments: [assignment], settings })
    const req = jsonRequest({ permissions: [], expected_permissions: salesPermissions })
    const res = await PATCH(req, routeContext)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('A002')
    expect(req.json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
    expect(operations.some(operation => operation.patch)).toBe(false)
  })

  it('uses the fresh organization, ignores client org_id, and returns data.role while preserving templates', async () => {
    const { role, operations } = database({ settings: { theme: 'dark', role_permission_overrides: { 'role-other': ['config:read'] } } })
    const res = await PATCH(jsonRequest({ org_id: 'org-attacker', permissions: [], expected_permissions: salesPermissions }), routeContext)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { org_id: 'org-fresh', role: { ...role, permissions: [] } } })
    expect(operations.find(operation => operation.table === 'user_organizations').filters).toEqual([['user_id', 'user-1'], ['is_default', true]])
    expect(operations.find(operation => operation.table === 'user_roles').filters).toEqual([
      ['org_id', 'org-fresh'], ['user_id', 'user-1'], ['scope_type', 'org'], ['scope_id', 'org-fresh'],
    ])
    expect(operations.filter((operation) => operation.table === 'organizations').every((operation) => operation.filters.some(([key, value]: any[]) => key === 'id' && value === 'org-fresh'))).toBe(true)
    expect(operations.filter((operation) => operation.patch)).toEqual([expect.objectContaining({ table: 'organizations', patch: {
      settings: { theme: 'dark', role_permission_overrides: { 'role-other': ['config:read'], 'role-1': [] } },
    } })])
    expect(role.permissions).toEqual(['quote:create'])
  })

  it('rejects a save opened in a different organization even when the current actor is an eligible root', async () => {
    const { operations } = database()
    const res = await PATCH(jsonRequest({
      expected_org_id: 'org-from-stale-tab', permissions: [], expected_permissions: salesPermissions,
    }), routeContext)
    expect(res.status).toBe(409)
    expect(operations.some(operation => operation.patch)).toBe(false)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('roles')
  })

  it('rejects an actor whose organization membership has ended, even with a root role row', async () => {
    const { operations } = database({ members: [{ ...currentMember, status: 'ended' }] })
    expect((await PATCH(jsonRequest({ permissions: [], expected_permissions: salesPermissions }), routeContext)).status).toBe(403)
    expect(operations.map(operation => operation.table)).toEqual(['user_organizations'])
  })

  it('rejects a false-success override for the fixed baseline role before writing settings', async () => {
    const { operations } = database({ code: 'FXIAOKE_BASELINE' })
    const res = await PATCH(jsonRequest({
      permissions: [], expected_permissions: ['quote:view', 'contract:view', 'customer:view'],
    }), routeContext)
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('只读')
    expect(operations.some(operation => operation.patch)).toBe(false)
  })

  it.each([
    ['stale permission snapshot', { settings: { role_permission_overrides: { 'role-1': ['quote:view'] } } }],
    ['full settings CAS conflict', { conflict: true }],
  ])('returns 409 for %s', async (_label, options) => {
    database(options)
    const res = await PATCH(jsonRequest({ permissions: [], expected_permissions: salesPermissions }), routeContext)
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
    ['unknown permission', { permissions: ['invalid:key'], expected_permissions: salesPermissions }],
    ['duplicate permission', { permissions: ['quote:view', 'quote:view'], expected_permissions: salesPermissions }],
    ['missing expected snapshot', { permissions: ['quote:view'] }],
    ['missing expected organization', { expected_org_id: undefined, permissions: [], expected_permissions: salesPermissions }],
  ])('returns 400 for %s', async (_label, input) => {
    const { operations } = database()
    const res = await PATCH(jsonRequest(input), routeContext)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('V001')
    expect(operations.some((operation) => operation.patch)).toBe(false)
  })

  it('returns 500 when organization settings fail without writing a template fallback', async () => {
    const { operations } = database({ readError: true })
    const res = await PATCH(jsonRequest({ permissions: [], expected_permissions: salesPermissions }), routeContext)
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('S002')
    expect(operations.some((operation) => operation.patch)).toBe(false)
  })
})

it('preserves exact platform-root wildcard recovery while shipping definitions are unavailable', async () => {
  const core = [...SUPER_ADMIN_CORE_PERMISSIONS]
  const { operations } = database({
    code: 'SUPER_ADMIN', permissions: ['*'],
    assignments: [{ ...root, role: { ...root.role, id: 'role-1' } }],
    settings: { role_permission_overrides: { 'role-1': core } },
  })
  const response = await PATCH(jsonRequest({ permissions: ['*'], expected_permissions: core }), routeContext)
  expect(response.status).toBe(200)
  expect(operations.some(operation => operation.table === 'permission_points')).toBe(false)
})
