/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/permission-registry', () => ({ loadRoleModulePermissionCatalog: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { canEditRolePermissions, loadOrgRolePermissionSettings, saveOrgRolePermissions } from './org-role-permissions'
import { BUILTIN_PERMISSION_DEFINITIONS, buildPermissionCatalog } from './permission-catalog'
import { loadRoleModulePermissionCatalog } from './permission-registry'
import { SHIPPING_OWNER_ACTION_KEYS, SHIPPING_OWNER_VIEW } from './shipping/owner-permission-keys'

const salesPermissions = ['quote:create']

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
    denied: false,
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: 'roles' | 'organizations') => {
    const filters: Array<[string, unknown]> = []
    const operation = { table, filters, patch: undefined as any }
    state.operations.push(operation)
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query }),
      maybeSingle: vi.fn(async () => {
        if (table === 'organizations' && state.readError) return { data: null, error: state.readError }
        const row = state[table].find((entry: any) => filters.every(([column, value]) => entry[column] === value))
        return { data: row ? structuredClone(row) : null, error: null }
      }),
    }
    return query
  }) as any)
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((name: string, input: any) => {
    if (name === 'admin_list_org_roles_v1') {
      return { eq: (_column: string, roleId: string) => ({
        maybeSingle: async () => ({ data: structuredClone(state.roles.find(role => role.id === roleId) ?? null), error: null }),
      }) }
    }
    return saveRolePermissions(name, input)
  }) as never)
  async function saveRolePermissions(name: string, input: any) {
    expect(name).toBe('admin_save_org_role_permissions_v1')
    expect(input.p_actor_id).toBe('actor-1')
    state.beforeUpdate?.()
    if (state.denied) return { data: null, error: { code: '42501' } }
    const org = state.organizations.find(org => org.id === input.p_org_id && org.status === 'active')
    const role = state.roles.find(role => role.id === input.p_role_id)
    if (!role) return { data: 'not_found', error: null }
    if (!org || JSON.stringify(org.settings) !== JSON.stringify(input.p_expected_settings)
      || role.code !== input.p_expected_role_code || JSON.stringify(role.permissions) !== JSON.stringify(input.p_expected_role_template)) {
      return { data: 'conflict', error: null }
    }
    const next = { ...(org.settings ?? {}) }
    if (input.p_permissions !== null) next.role_permission_overrides = { ...next.role_permission_overrides, [role.id]: input.p_permissions }
    if (input.p_owner_permissions !== null) next.shipping_owner_permission_overrides = { ...next.shipping_owner_permission_overrides, [role.id]: input.p_owner_permissions }
    if (input.p_permissions !== null || input.p_owner_permissions !== null) {
      state.operations.push({ table: 'organizations', patch: { settings: next } })
      org.settings = next
    }
    return { data: 'saved', error: null }
  }
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
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['quote:view'], salesPermissions))
      .toEqual({ ok: true, role: { ...template[0], permissions: ['quote:view'], owner_shipping_permissions: [] } })
    expect(state.organizations[0].settings).toEqual({
      locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'], 'role-1': ['quote:view'] },
    })
    expect(state.organizations[1]).toEqual(otherOrg)
    expect(state.roles).toEqual(template)
    expect(state.operations.filter((entry) => entry.patch).map((entry) => entry.table)).toEqual(['organizations'])
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_save_org_role_permissions_v1', {
      p_actor_id: 'actor-1', p_org_id: 'org-1', p_role_id: 'role-1',
      p_expected_settings: { locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'] } },
      p_expected_role_code: 'SALES', p_expected_role_template: ['quote:create'],
      p_permissions: ['quote:view'], p_owner_permissions: null,
    })
  })

  it('persists an empty override as a complete revocation', async () => {
    const state = database()
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], salesPermissions)).toMatchObject({ ok: true, role: { permissions: [] } })
    expect(state.organizations[0].settings.role_permission_overrides['role-1']).toEqual([])
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['quote:view'], [])).toMatchObject({ ok: true })
  })

  it('rejects an outdated expected permissions snapshot before any write', async () => {
    const state = database({ settings: { role_permission_overrides: { 'role-1': ['quote:view'] } } })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], ['quote:create'])).toEqual({ ok: false, reason: 'conflict' })
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('rejects a full-settings CAS conflict without clobbering concurrent unrelated settings', async () => {
    const state = database()
    state.beforeUpdate = () => { state.organizations[0].settings.locale = 'en' }
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], salesPermissions)).toEqual({ ok: false, reason: 'conflict' })
    expect(state.organizations[0].settings).toEqual({ locale: 'en', role_permission_overrides: { 'role-other': ['config:read'] } })
  })

  it('carries a null settings snapshot into the atomic save and initializes only that organization', async () => {
    const state = database({ settings: null })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], salesPermissions)).toMatchObject({ ok: true })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_save_org_role_permissions_v1', expect.objectContaining({
      p_org_id: 'org-1', p_expected_settings: null,
    }))
    expect(state.organizations[0].settings).toEqual({ role_permission_overrides: { 'role-1': [] } })
  })

  it('rejects any change to the system super administrator definition', async () => {
    const state = database({ code: 'SUPER_ADMIN', permissions: ['*'] })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['role:manage', 'config:read'], ['*']))
      .toMatchObject({ ok: false, reason: 'fixed_role' })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['*'], ['*'], undefined, {
      permissions: [], expected: SHIPPING_OWNER_ACTION_KEYS,
    })).toMatchObject({ ok: false, reason: 'fixed_role' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)
  })

  it('never writes an override for the fixed Fxiaoke baseline role', async () => {
    const state = database({ code: 'FXIAOKE_BASELINE' })
    const result = await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], ['quote:view', 'contract:view', 'customer:view'])
    expect(result).toMatchObject({ ok: false, reason: 'fixed_role' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)
  })

  it('prevents rewriting the deprecated baseline even if historical owner grants are stored', async () => {
    const state = database({
      code: 'FXIAOKE_BASELINE',
      settings: {
        locale: 'zh', role_permission_overrides: { 'role-other': ['config:read'] },
        shipping_owner_permission_overrides: { 'role-1': SHIPPING_OWNER_ACTION_KEYS },
      },
    })
    const before = structuredClone(state.organizations[0].settings)
    for (const permissions of [[], [SHIPPING_OWNER_VIEW]]) {
      expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], [], undefined, {
        permissions, expected: [],
      })).toMatchObject({ ok: false, reason: 'fixed_role' })
    }
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('admin_save_org_role_permissions_v1', expect.anything())
    expect(state.organizations[0].settings).toEqual(before)
  })

  it('rejects owner actions without their view or when sent as organization permissions', async () => {
    const state = database()
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', salesPermissions, salesPermissions, undefined, {
      permissions: ['shipping:owner_submit'], expected: [],
    })).toEqual({ ok: false, reason: 'invalid' })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [SHIPPING_OWNER_VIEW], salesPermissions))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)
  })

  it.each(['ORG_SUPER_ADMIN', 'SUPER_ADMIN'])('rejects edits to protected %s before the write', async code => {
    const state = database({ code })
    const result = await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['*'], [], {
      settings: state.organizations[0].settings,
    })
    expect(result).toMatchObject({ ok: false, reason: 'fixed_role' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)
  })

  it('honors a live authority denial even after valid input and snapshot checks', async () => {
    const state = database()
    const snapshot = { settings: state.organizations[0].settings }
    state.denied = true
    for (const grants of [salesPermissions, ['quote:view', 'config:write']]) {
      expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', grants, salesPermissions, snapshot))
        .toEqual({ ok: false, reason: 'forbidden' })
    }
    expect(state.operations.some(entry => entry.patch)).toBe(false)
    state.denied = false
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['quote:view', 'config:write'], salesPermissions, snapshot))
      .toMatchObject({ ok: true })
  })

  it.each([
    ['unknown key', ['invented:permission'], salesPermissions],
    ['duplicate key', ['quote:view', 'quote:view'], salesPermissions],
    ['missing snapshot', ['quote:view'], undefined],
    ['duplicate snapshot', ['quote:view'], [...salesPermissions, 'quote:create']],
  ])('rejects %s', async (_label, permissions, expected) => {
    const state = database()
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', permissions, expected)).toEqual({ ok: false, reason: 'invalid' })
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('does not fall back to the global role if organization settings cannot be read', async () => {
    const state = database()
    state.readError = new Error('settings unavailable')
    await expect(loadOrgRolePermissionSettings('org-1')).rejects.toThrow('settings unavailable')
    await expect(saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], ['quote:create'])).rejects.toThrow('settings unavailable')
    expect(state.operations.some((entry) => entry.patch)).toBe(false)
  })

  it('requires a root assignment in this exact organization, including effective role:manage when overridden', () => {
    const root: any = { roleCode: 'SUPER_ADMIN', scopeType: 'org', scopeId: 'org-1', permissions: ['*'] }
    expect(canEditRolePermissions([root], 'org-1')).toBe(true)
    expect(canEditRolePermissions([{ ...root, roleCode: 'ORG_SUPER_ADMIN', permissions: ['role:manage'] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, roleCode: 'ADMIN', permissions: ['config:write', 'role:manage'] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, scopeType: 'dept' }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, scopeId: 'org-2' }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissions: [] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissionsOverridden: true, permissions: [] }], 'org-1')).toBe(false)
    expect(canEditRolePermissions([{ ...root, permissionsOverridden: true, permissions: ['role:manage'] }], 'org-1')).toBe(true)
  })

  it('prevents new full-platform wildcard grants and allows previously stored ones to be removed', async () => {
    database({ permissions: [] })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['*'], []))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('admin_save_org_role_permissions_v1', expect.anything())

    database({ permissions: ['*'] })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], ['*']))
      .toMatchObject({ ok: true, role: { permissions: [] } })
  })

  it('does not add role assignment to an ordinary role, but can remove a stored legacy key', async () => {
    const assignmentKey = 'user:assign_roles'
    const state = database({ settings: { role_permission_overrides: { 'role-1': ['user:view'] } } })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['user:view', assignmentKey], ['user:view']))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(state.operations.some(entry => entry.patch)).toBe(false)

    database({ settings: { role_permission_overrides: { 'role-1': ['user:view', assignmentKey] } } })
    expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['user:view'], ['user:view', assignmentKey]))
      .toMatchObject({ ok: true, role: { permissions: ['user:view'] } })
  })
})

it('requires just the shipping action being added to have valid published registry metadata', async () => {
  const state = database()
  const code = 'shipping:operate'
  const permissions = ['quote:create', code]
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce([])
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', permissions, salesPermissions))
    .toEqual({ ok: false, reason: 'invalid' })
  expect(state.operations.some(entry => entry.patch)).toBe(false)

  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce(buildPermissionCatalog(
    BUILTIN_PERMISSION_DEFINITIONS.filter(definition => definition.key === code),
  ))
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', permissions, salesPermissions))
    .toMatchObject({ ok: true, role: { permissions } })

  // A disabled stored grant is still removable; the old value never becomes a selectable action.
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [], permissions))
    .toMatchObject({ ok: true, role: { permissions: [] } })
})

it('saves a separate shipping action only with its published view and can withdraw it independently', async () => {
  const state = database()
  const view = 'shipping:ledger_view'
  const confirm = 'shipping:order_confirm'
  const granted = [...salesPermissions, view, confirm]
  const catalog = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS.filter(item => [view, confirm].includes(item.key)))
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValue(catalog)

  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [...salesPermissions, confirm], salesPermissions))
    .toEqual({ ok: false, reason: 'invalid' })
  expect(state.operations.some(entry => entry.patch)).toBe(false)

  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', granted, salesPermissions))
    .toMatchObject({ ok: true, role: { permissions: granted } })
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [...salesPermissions, confirm], granted))
    .toEqual({ ok: false, reason: 'invalid' })
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [...salesPermissions, view], granted))
    .toMatchObject({ ok: true, role: { permissions: [...salesPermissions, view] } })
  expect(state.organizations[1].settings).toEqual({ isolated: true })
})

it('validates both published shipping actions when saving a new bundle and preserves an existing bundle', async () => {
  const state = database()
  const bundle = ['shipping:*']
  const operationsOnly = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS.filter(item => item.key === 'shipping:operate'))
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce(operationsOnly)
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', bundle, salesPermissions))
    .toEqual({ ok: false, reason: 'invalid' })
  expect(state.operations.some(entry => entry.patch)).toBe(false)

  const bothActions = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS.filter(item =>
    item.key === 'shipping:operate' || item.key === 'shipping:manage_connections'))
  vi.mocked(loadRoleModulePermissionCatalog).mockResolvedValueOnce(bothActions)
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', bundle, salesPermissions))
    .toMatchObject({ ok: true, role: { permissions: bundle } })

  vi.mocked(loadRoleModulePermissionCatalog).mockClear()
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', [...bundle, 'quote:view'], bundle))
    .toMatchObject({ ok: true, role: { permissions: [...bundle, 'quote:view'] } })
  expect(loadRoleModulePermissionCatalog).not.toHaveBeenCalled()
  expect(await saveOrgRolePermissions('actor-1', 'org-1', 'role-1', ['quote:view'], [...bundle, 'quote:view']))
    .toMatchObject({ ok: true, role: { permissions: ['quote:view'] } })
})
