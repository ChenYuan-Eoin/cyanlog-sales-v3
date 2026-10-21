/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { canEditRolePermissions, loadOrgRolePermissionSettings, saveOrgRolePermissions } from './org-role-permissions'
import { SUPER_ADMIN_CORE_PERMISSIONS } from './role-permission-policy'

// Model the DB predicates so tests fail if the implementation loses either
// exact-org scoping or the full-settings compare-and-swap condition.
function database(options: { settings?: any; code?: string; permissions?: string[] } = {}) {
  const state = {
    roles: [{ id: 'role-1', code: options.code ?? 'SALES', permissions: options.permissions ?? ['quote:create'] }],
    organizations: [
      { id: 'org-1', settings: options.settings === undefined ? { locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'] } } : options.settings },
      { id: 'org-2', settings: { isolated: true } },
    ],
    operations: [] as any[],
    readError: null as Error | null,
    beforeUpdate: null as (() => void) | null,
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: 'roles' | 'organizations') => {
    const filters: Array<[string, unknown]> = []
    const operation = { table, filters, patch: undefined as any }
    state.operations.push(operation)
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query }),
      is: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query }),
      update: vi.fn((patch: any) => { operation.patch = patch; return query }),
      maybeSingle: vi.fn(async () => {
        if (table === 'organizations' && !operation.patch && state.readError) return { data: null, error: state.readError }
        if (operation.patch) state.beforeUpdate?.()
        const row = state[table].find((entry: any) => filters.every(([column, value]) => column === 'settings' && value !== null
          ? JSON.stringify(entry[column]) === value : entry[column] === value))
        if (row && operation.patch) Object.assign(row, structuredClone(operation.patch))
        return { data: row ? structuredClone(row) : null, error: null }
      }),
    }
    return query
  }) as any)
  return state
}

describe('organization role permission storage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes only the selected organization settings and preserves unrelated settings, roles and organizations', async () => {
    const state = database()
    const template = structuredClone(state.roles)
    const otherOrg = structuredClone(state.organizations[1])
    expect(await saveOrgRolePermissions('org-1', 'role-1', ['quote:view'], ['quote:create']))
      .toEqual({ ok: true, role: { ...template[0], permissions: ['quote:view'] } })
    expect(state.organizations[0].settings).toEqual({
      locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'], 'role-1': ['quote:view'] },
    })
    expect(state.organizations[1]).toEqual(otherOrg)
    expect(state.roles).toEqual(template)
    expect(state.operations.filter((entry) => entry.patch).map((entry) => entry.table)).toEqual(['organizations'])
    expect(state.operations.find((entry) => entry.patch).filters).toEqual([
      ['id', 'org-1'], ['settings', JSON.stringify({ locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'] } })],
    ])
  })

  it('persists an empty override as a complete revocation', async () => {
    const state = database()
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], ['quote:create'])).toMatchObject({ ok: true, role: { permissions: [] } })
    expect(state.organizations[0].settings.role_permission_overrides['role-1']).toEqual([])
    expect(await saveOrgRolePermissions('org-1', 'role-1', ['quote:view'], [])).toMatchObject({ ok: true })
  })

  it('rejects an outdated expected permissions snapshot before any write', async () => {
    const state = database({ settings: { role_permission_overrides: { 'role-1': ['quote:view'] } } })
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], ['quote:create'])).toEqual({ ok: false, reason: 'conflict' })
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('rejects a full-settings CAS conflict without clobbering concurrent unrelated settings', async () => {
    const state = database()
    state.beforeUpdate = () => { state.organizations[0].settings.locale = 'en' }
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], ['quote:create'])).toEqual({ ok: false, reason: 'conflict' })
    expect(state.organizations[0].settings).toEqual({ locale: 'en', role_permission_overrides: { 'role-other': ['config:read'] } })
  })

  it('compares null settings with IS NULL and initializes only that organization', async () => {
    const state = database({ settings: null })
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], ['quote:create'])).toMatchObject({ ok: true })
    expect(state.operations.find((entry) => entry.patch).filters).toEqual([['id', 'org-1'], ['settings', null]])
    expect(state.organizations[0].settings).toEqual({ role_permission_overrides: { 'role-1': [] } })
  })

  it.each(SUPER_ADMIN_CORE_PERMISSIONS)('requires superadmin core permission %s', async (removed) => {
    const state = database({ code: 'SUPER_ADMIN', permissions: ['*'] })
    expect(await saveOrgRolePermissions('org-1', 'role-1', SUPER_ADMIN_CORE_PERMISSIONS.filter((key) => key !== removed), ['*']))
      .toEqual({ ok: false, reason: 'core_required' })
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('allows revoking all non-core superadmin permissions', async () => {
    database({ code: 'SUPER_ADMIN', permissions: ['*'] })
    expect(await saveOrgRolePermissions('org-1', 'role-1', [...SUPER_ADMIN_CORE_PERMISSIONS], ['*']))
      .toMatchObject({ ok: true, role: { permissions: [...SUPER_ADMIN_CORE_PERMISSIONS] } })
  })

  it.each([
    ['unknown key', ['invented:permission'], ['quote:create']],
    ['duplicate key', ['quote:view', 'quote:view'], ['quote:create']],
    ['missing snapshot', ['quote:view'], undefined],
    ['duplicate snapshot', ['quote:view'], ['quote:create', 'quote:create']],
  ])('rejects %s', async (_label, permissions, expected) => {
    const state = database()
    expect(await saveOrgRolePermissions('org-1', 'role-1', permissions, expected)).toEqual({ ok: false, reason: 'invalid' })
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('does not fall back to the global role if organization settings cannot be read', async () => {
    const state = database()
    state.readError = new Error('settings unavailable')
    await expect(loadOrgRolePermissionSettings('org-1')).rejects.toThrow('settings unavailable')
    await expect(saveOrgRolePermissions('org-1', 'role-1', [], ['quote:create'])).rejects.toThrow('settings unavailable')
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('requires a root assignment in this exact organization, including effective role:manage when overridden', () => {
    const root: any = { roleCode: 'SUPER_ADMIN', scopeType: 'org', scopeId: 'org-1', permissions: ['*'] }
    expect(canEditRolePermissions([root], 'org-1')).toBe(true)
    expect(canEditRolePermissions([{ ...root, roleCode: 'ADMIN', permissions: ['config:write', 'role:manage'] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, scopeType: 'dept' }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, scopeId: 'org-2' }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissionsOverridden: true, permissions: [] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissionsOverridden: true, permissions: ['role:manage'] }], 'org-1')).toBe(true)
  })
})
