/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/permission-registry', () => ({ loadRoleModulePermissionCatalog: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { canEditRolePermissions, loadOrgRolePermissionSettings, saveOrgRolePermissions } from './org-role-permissions'
import { SUPER_ADMIN_CORE_PERMISSIONS } from './role-permission-policy'
import { BUILTIN_PERMISSION_DEFINITIONS, buildPermissionCatalog } from './permission-catalog'
import { loadRoleModulePermissionCatalog } from './permission-registry'

const salesPermissions = ['quote:create']

// Model the DB predicates so tests fail if the implementation loses either
// exact-org scoping or the full-settings compare-and-swap condition.
function database(options: { settings?: any; code?: string; permissions?: string[] } = {}) {
  const state = {
    roles: [{ id: 'role-1', code: options.code ?? 'SALES', permissions: options.permissions ?? ['quote:create'] }],
    organizations: [
      { id: 'org-1', status: 'active', settings: options.settings === undefined ? { locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'] } } : options.settings },
      { id: 'org-2', status: 'active', settings: { isolated: true } },
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes only the selected organization settings and preserves unrelated settings, roles and organizations', async () => {
    const state = database()
    const template = structuredClone(state.roles)
    const otherOrg = structuredClone(state.organizations[1])
    expect(await saveOrgRolePermissions('org-1', 'role-1', ['quote:view'], salesPermissions))
      .toEqual({ ok: true, role: { ...template[0], permissions: ['quote:view'] } })
    expect(state.organizations[0].settings).toEqual({
      locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'], 'role-1': ['quote:view'] },
    })
    expect(state.organizations[1]).toEqual(otherOrg)
    expect(state.roles).toEqual(template)
    expect(state.operations.filter((entry) => entry.patch).map((entry) => entry.table)).toEqual(['organizations'])
    expect(state.operations.find((entry) => entry.patch).filters).toEqual([
      ['id', 'org-1'], ['status', 'active'], ['settings', JSON.stringify({ locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'] } })],
    ])
  })

  it('persists an empty override as a complete revocation', async () => {
    const state = database()
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], salesPermissions)).toMatchObject({ ok: true, role: { permissions: [] } })
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
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], salesPermissions)).toEqual({ ok: false, reason: 'conflict' })
    expect(state.organizations[0].settings).toEqual({ locale: 'en', role_permission_overrides: { 'role-other': ['config:read'] } })
  })

  it('compares null settings with IS NULL and initializes only that organization', async () => {
    const state = database({ settings: null })
    expect(await saveOrgRolePermissions('org-1', 'role-1', [], salesPermissions)).toMatchObject({ ok: true })
    expect(state.operations.find((entry) => entry.patch).filters).toEqual([['id', 'org-1'], ['status', 'active'], ['settings', null]])
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

  it('never writes an override for the fixed Fxiaoke baseline role', async () => {
    const state = database({ code: 'FXIAOKE_BASELINE' })
    const result = await saveOrgRolePermissions('org-1', 'role-1', [], ['quote:view', 'contract:view', 'customer:view'])
    expect(result).toMatchObject({ ok: false, reason: 'fixed_role' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)
  })

  it.each(['ORG_SUPER_ADMIN', 'SUPER_ADMIN'])('denies tenant admins editing protected %s', async code => {
    const state = database({ code })
    const result = await saveOrgRolePermissions('org-1', 'role-1', ['*'], [], {
      settings: state.organizations[0].settings, canEditPlatformRoot: false, actorPermissions: ['role:manage'],
    })
    expect(result).toMatchObject({ ok: false, reason: 'fixed_role' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)
  })

  it('allows organization role edits while rejecting newly delegated admin capabilities above the actor', async () => {
    const state = database()
    const actor = {
      settings: state.organizations[0].settings, canEditPlatformRoot: false, actorPermissions: ['role:manage', 'config:write'],
    }
    for (const grant of ['*', 'config:*', 'report:finance']) {
      expect(await saveOrgRolePermissions('org-1', 'role-1', [grant], salesPermissions, actor))
        .toEqual({ ok: false, reason: 'escalation_forbidden' })
    }
    expect(state.operations.some(entry => entry.patch)).toBe(false)
    expect(await saveOrgRolePermissions('org-1', 'role-1', ['quote:view', 'config:write'], salesPermissions, actor))
      .toMatchObject({ ok: true })
  })

  it.each([
    ['unknown key', ['invented:permission'], salesPermissions],
    ['duplicate key', ['quote:view', 'quote:view'], salesPermissions],
    ['missing snapshot', ['quote:view'], undefined],
    ['duplicate snapshot', ['quote:view'], [...salesPermissions, 'quote:create']],
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
    expect(canEditRolePermissions([{ ...root, roleCode: 'ORG_SUPER_ADMIN', permissions: ['role:manage'] }], 'org-1')).toBe(true)
    expect(canEditRolePermissions([{ ...root, roleCode: 'ADMIN', permissions: ['config:write', 'role:manage'] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, scopeType: 'dept' }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, scopeId: 'org-2' }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissions: [] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissionsOverridden: true, permissions: [] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissionsOverridden: true, permissions: ['role:manage'] }], 'org-1')).toBe(true)
  })
})

it('requires just the shipping action being added to have valid published registry metadata', async () => {
  const state = database()
  const code = 'shipping:operate'
  const permissions = ['quote:create', code]
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce([])
  expect(await saveOrgRolePermissions('org-1', 'role-1', permissions, salesPermissions))
    .toEqual({ ok: false, reason: 'invalid' })
  expect(state.operations.some(entry => entry.patch)).toBe(false)

  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce(buildPermissionCatalog(
    BUILTIN_PERMISSION_DEFINITIONS.filter(definition => definition.key === code),
  ))
  expect(await saveOrgRolePermissions('org-1', 'role-1', permissions, salesPermissions))
    .toMatchObject({ ok: true, role: { permissions } })

  // A disabled stored grant is still removable; the old value never becomes a selectable action.
  expect(await saveOrgRolePermissions('org-1', 'role-1', [], permissions))
    .toMatchObject({ ok: true, role: { permissions: [] } })
})

it('validates both published shipping actions when saving a new bundle and preserves an existing bundle', async () => {
  const state = database()
  const bundle = ['shipping:*']
  const operationsOnly = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS.filter(item => item.key === 'shipping:operate'))
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce(operationsOnly)
  expect(await saveOrgRolePermissions('org-1', 'role-1', bundle, salesPermissions))
    .toEqual({ ok: false, reason: 'invalid' })
  expect(state.operations.some(entry => entry.patch)).toBe(false)

  const bothActions = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS.filter(item =>
    item.key === 'shipping:operate' || item.key === 'shipping:manage_connections'))
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce(bothActions)
  expect(await saveOrgRolePermissions('org-1', 'role-1', bundle, salesPermissions))
    .toMatchObject({ ok: true, role: { permissions: bundle } })

  vi.mocked(loadRoleModulePermissionCatalog).mockClear()
  expect(await saveOrgRolePermissions('org-1', 'role-1', [...bundle, 'quote:view'], bundle))
    .toMatchObject({ ok: true, role: { permissions: [...bundle, 'quote:view'] } })
  expect(loadRoleModulePermissionCatalog).not.toHaveBeenCalled()
  expect(await saveOrgRolePermissions('org-1', 'role-1', ['quote:view'], [...bundle, 'quote:view']))
    .toMatchObject({ ok: true, role: { permissions: ['quote:view'] } })
})
