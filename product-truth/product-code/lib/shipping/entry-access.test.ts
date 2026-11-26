import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEmployeePermissionTable, loadPublishedShippingAccess, loadShippingLedgerAccess, resolveShippingEntry } from './entry-access'
import { resolveOwnerShippingPermissions } from '@/lib/role-permission-resolution'
import { SHIPPING_OPERATE, SHIPPING_OWNER_ACTION_KEYS, SHIPPING_RECORD_RETURN, SHIPPING_WORKBENCH_ACTION_KEYS } from '@/lib/module-access'

const db = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
  context: vi.fn(), published: vi.fn(),
  restRows: vi.fn(), rpcRows: vi.fn(), rpc: vi.fn(), roleSettings: vi.fn(), roleCatalog: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: db.from, rpc: db.rpc } }))
vi.mock('@/lib/org-role-permissions', () => ({
  loadCurrentOrganizationRoleAssignments: db.context,
  loadOrgRolePermissionSettings: db.roleSettings,
  queryOrgRoles: db.roleCatalog,
}))
vi.mock('@/lib/middleware-rest-client', () => ({
  createMiddlewareRestClient: () => ({ selectRows: db.restRows }),
  readMiddlewareRpcRows: db.rpcRows,
}))
vi.mock('@/lib/permission-registry', () => ({
  loadShippingModulePermissionState: async () => {
    const keys: string[] = await db.published()
    return { registered: new Set(keys), published: new Set(keys), departmentLedgerPublished: keys.includes('shipping:ledger_view') }
  },
  loadRoleModulePermissionProjection: async () => ({
    publication: { registered: new Set<string>(), published: new Set<string>() },
    catalog: [],
    organizationEmployeePublication: ['user:view', 'user:manage_login', 'role:view'],
  }),
}))

const user = { id: 'staff', email: null, phone: null, display_name: null, org_id: 'org-a' }
const token = 'session-token'
const assignment = (roleCode: string, permissions: string[] = [], ownerGrant?: readonly string[]) => ({
  roleCode, permissions, ownerShippingPermissions: resolveOwnerShippingPermissions(
    ownerGrant ? { shipping_owner_permission_overrides: { role: ownerGrant } } : {},
    { id: 'role', code: roleCode, permissions },
  ),
})
const activeOrg = { orgId: 'org-a', assignments: [assignment('EMPLOYEE_SHIPPING', [], SHIPPING_OWNER_ACTION_KEYS)] }

const orgOnlyWorkbenchActions = SHIPPING_WORKBENCH_ACTION_KEYS
  .filter(key => key !== 'shipping:ledger_view' && key !== SHIPPING_RECORD_RETURN)
const workbenchPublication = [SHIPPING_OPERATE, ...SHIPPING_WORKBENCH_ACTION_KEYS]
const employeeOverridesEnabled = { employee_permission_overrides_enabled: true }

function mockEmployeeWorkbenchState(overrides: object[], inheritedLedger: boolean, orgWideLedger: boolean) {
  const scopes = [
    {
      permission_code: 'shipping:ledger_view',
      base_organization_wide: inheritedLedger,
      base_department_ids: [],
      organization_wide: orgWideLedger,
      department_ids: orgWideLedger ? [] : ['south'],
    },
    {
      permission_code: SHIPPING_RECORD_RETURN,
      base_organization_wide: false,
      base_department_ids: [],
      organization_wide: false,
      department_ids: [],
    },
  ]
  db.rpcRows.mockImplementation(async (name: string) => name === 'shipping_employee_permission_scopes_v1' ? scopes : overrides)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockReturnValue(db)
  db.select.mockReturnValue(db)
  db.eq.mockReturnValue(db)
  db.context.mockResolvedValue(activeOrg)
  db.published.mockResolvedValue(['shipping:operate', 'shipping:manage_connections', ...SHIPPING_OWNER_ACTION_KEYS])
  db.maybeSingle.mockResolvedValue({ data: { user_id: user.id, auth_method: 'fxiaoke' }, error: null })
})

it('reads back the combined employee table with exact organization points and derived prerequisites', async () => {
  db.context.mockResolvedValue({
    ...activeOrg, assignments: [
      { ...assignment('OPS', ['user:*']), roleName: '人员维护' },
      { ...assignment('ROLE_VIEWER', ['role:view']), roleName: '角色审阅' },
    ],
  })
  db.maybeSingle.mockResolvedValue({ data: { id: user.id, status: 'active', login_enabled: true }, error: null })
  db.restRows.mockResolvedValue([])
  mockEmployeeWorkbenchState([{ permission_code: 'user:manage_login', effect: 'DENY', scope: null }], false, false)

  const result = await loadEmployeePermissionTable(user.id, 'org-a')
  expect(result?.organization_permission_publication).toEqual(['user:view', 'user:manage_login', 'role:view'])
  expect(result?.permissions).toEqual(expect.arrayContaining([
    expect.objectContaining({
      key: 'user:manage_login', base: true, effective: false, scope_types: ['org'],
      override: { effect: 'DENY', scope: null }, sources: [{ kind: 'role', name: '人员维护' }],
    }),
    expect.objectContaining({
      key: 'role:view', base: true, effective: true, sources: [{ kind: 'role', name: '角色审阅' }],
    }),
    expect.objectContaining({ key: 'shipping:ledger_view', base: false, effective: true,
      effective_scope: { type: 'department', departments: [{ department_id: 'south', include_subdepartments: false }] } }),
  ]))
})

it('projects verified pending roles and scoped department grants only for the admin table', async () => {
  db.context.mockResolvedValue(null)
  db.roleSettings.mockResolvedValue({})
  db.roleCatalog.mockResolvedValue({ error: null, data: [
    { id: 'role', code: 'ORDINARY', name: '待生效角色', permissions: ['user:view'] },
    { id: 'other', code: 'OTHER', name: '其他角色', permissions: ['user:manage_login'] },
  ] })
  db.restRows.mockResolvedValue([])
  db.rpc.mockResolvedValue({ error: null, data: {
    target_revision: 'verified-directory-identity', pending_role_ids: ['role'], overrides: [],
    shipping_scopes: [
      { permission_code: 'shipping:ledger_view', base_organization_wide: false, base_department_ids: ['south'],
        organization_wide: false, department_ids: ['south'], base_sources: [{ kind: 'department', name: '华南' }] },
      { permission_code: SHIPPING_RECORD_RETURN, base_organization_wide: false, base_department_ids: [],
        organization_wide: false, department_ids: [] },
    ],
  } })
  expect(await loadEmployeePermissionTable(user.id, 'org-a', 'actor')).toMatchObject({
    target_revision: 'verified-directory-identity',
    permissions: expect.arrayContaining([
      expect.objectContaining({ key: 'user:view', base: true, sources: [{ kind: 'role', name: '待生效角色' }] }),
      expect.objectContaining({ key: 'user:manage_login', base: false, sources: [] }),
      expect.objectContaining({ key: 'shipping:ledger_view', base: true,
        base_scope: { type: 'department', departments: [{ department_id: 'south', include_subdepartments: false }] } }),
    ]),
  })
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith('admin_employee_prelogin_permission_projection_v1', {
    p_actor_id: 'actor', p_org_id: 'org-a', p_user_id: user.id,
  })
  expect(await loadPublishedShippingAccess(user.id)).toBeNull()
  expect(db.rpc).toHaveBeenCalledOnce()
  expect(db.rpcRows).not.toHaveBeenCalled()
})

describe('shipping entry authorization', () => {
  it('allows a verified Fxiaoke employee only the owner entry in the current organization', async () => {
    expect(await resolveShippingEntry(user, token)).toEqual({
      orgId: 'org-a', canOperate: false, canManageConnections: false, canViewOwn: true, canSubmitOwn: true, canReadLegacyReceipt: true, permissions: [], ownerPermissions: [...SHIPPING_OWNER_ACTION_KEYS],
    })
    expect(db.eq.mock.calls).toEqual([['token', token], ['user_id', user.id]])
    expect(await resolveShippingEntry({ ...user, org_id: 'org-b' }, token)).toMatchObject({ canViewOwn: false, canSubmitOwn: false })
  })

  it.each(['READONLY', 'FXIAOKE_BASELINE', 'SALES', 'SHIPPING_OPERATOR'])(
    'does not grant personal shipping or old receipt reads for the ordinary role %s', async (roleCode) => {
      db.context.mockResolvedValue({ ...activeOrg, assignments: [assignment(roleCode, ['quote:view'])] })
      expect(await resolveShippingEntry(user, token)).toMatchObject({
        canViewOwn: false, canSubmitOwn: false, canReadLegacyReceipt: false,
      })
    },
  )

  it('can read in the old bearer-receipt path with published ledger view and no personal shipping grants', async () => {
    db.published.mockResolvedValue(['shipping:ledger_view'])
    db.context.mockResolvedValue({ ...activeOrg, assignments: [assignment('OPERATIONS', ['shipping:ledger_view'])] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canViewOwn: false, canSubmitOwn: false, canReadLegacyReceipt: true,
    })
  })

  it('uses the final employee department set in place of organization-wide inherited ledger access', async () => {
    db.context.mockResolvedValue({ ...activeOrg, settings: { employee_permission_overrides_enabled: true },
      assignments: [assignment('OPERATIONS', ['shipping:ledger_view', 'shipping:record_return'])] })
    db.published.mockResolvedValue(['shipping:ledger_view', 'shipping:record_return'])
    const scopes = [
      { permission_code: 'shipping:ledger_view', base_organization_wide: true, base_department_ids: [],
        organization_wide: false, department_ids: ['south'] },
      { permission_code: 'shipping:record_return', base_organization_wide: true, base_department_ids: [],
        organization_wide: true, department_ids: [] },
    ]
    db.rpcRows.mockImplementation(async (key: string) => key === 'shipping_employee_permission_scopes_v1' ? scopes : [])
    db.restRows.mockResolvedValue([
      { id: 'east', name: '华东', org_id: 'org-a', status: 'active', parent_id: null },
      { id: 'south', name: '华南', org_id: 'org-a', status: 'active', parent_id: null },
    ])
    expect(await loadShippingLedgerAccess(user.id, false)).toMatchObject({
      organizationWide: false, organizationReturn: false, departments: [{ id: 'south' }],
    })
    expect(await resolveShippingEntry(user, token)).toMatchObject({ canOperate: false, departmentLedger: [{ id: 'south' }] })
    scopes[0].department_ids = []
    expect(await loadShippingLedgerAccess(user.id, false)).toBeNull()
  })

  it.each(orgOnlyWorkbenchActions)('uses personal DENY for %s without restoring it through the legacy operator grant', async (key) => {
    db.context.mockResolvedValue({
      ...activeOrg,
      settings: employeeOverridesEnabled,
      assignments: [assignment('OPERATIONS', [SHIPPING_OPERATE])],
    })
    db.published.mockResolvedValue(workbenchPublication)
    mockEmployeeWorkbenchState([], true, true)
    expect((await loadPublishedShippingAccess(user.id))?.permissions).toContain(key)

    mockEmployeeWorkbenchState([{ permission_code: key, effect: 'DENY', scope: null }], true, true)
    const access = await loadPublishedShippingAccess(user.id)
    expect(access?.permissions).toContain('shipping:ledger_view')
    expect(access?.permissions).not.toContain(key)
    expect(access?.permissions).not.toContain(SHIPPING_OPERATE)
    expect(access?.permissions).toEqual(expect.arrayContaining(orgOnlyWorkbenchActions.filter(action => action !== key)))
  })

  it.each(orgOnlyWorkbenchActions)('uses a role-free ALLOW for %s only with organization-wide ledger access', async (key) => {
    db.context.mockResolvedValue({ ...activeOrg, settings: employeeOverridesEnabled, assignments: [] })
    db.published.mockResolvedValue(workbenchPublication)
    const allow = { permission_code: key, effect: 'ALLOW', scope: { type: 'org' } }
    mockEmployeeWorkbenchState([
      allow,
      { permission_code: 'shipping:ledger_view', effect: 'ALLOW', scope: { type: 'org' } },
    ], false, true)
    expect(await loadPublishedShippingAccess(user.id)).toMatchObject({
      permissions: ['shipping:ledger_view', key],
      roleCodes: [],
    })

    mockEmployeeWorkbenchState([
      allow,
      { permission_code: 'shipping:ledger_view', effect: 'ALLOW', scope: {
        type: 'department', departments: [{ department_id: 'south', include_subdepartments: false }],
      } },
    ], false, false)
    db.restRows.mockResolvedValue([
      { id: 'south', name: '华南', org_id: 'org-a', status: 'active', parent_id: null },
    ])
    expect(await loadPublishedShippingAccess(user.id, 'scoped')).toMatchObject({
      permissions: [],
      roleCodes: [],
      departmentLedger: [{ id: 'south' }],
    })
  })

  it('keeps connection settings separate and recomputes the operator after grant or lifecycle changes', async () => {
    db.maybeSingle.mockResolvedValue({ data: { user_id: user.id, auth_method: 'local' }, error: null })
    db.context.mockResolvedValue({ ...activeOrg, assignments: [assignment('ADMIN', ['shipping:manage_connections'])] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canOperate: false, canManageConnections: true, canSubmitOwn: false,
    })
    db.context.mockResolvedValue({ ...activeOrg, assignments: [assignment('SHIPPING_OPERATOR', ['shipping:operate'])] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({ canOperate: true, canManageConnections: false })
    db.published.mockResolvedValue(['shipping:manage_connections'])
    expect(await resolveShippingEntry(user, token)).toMatchObject({ canOperate: false, canManageConnections: false })
  })

  it('uses the current projected actions and removes a revoked capability with no role-code fallback', async () => {
    const assigned = assignment('EMPLOYEE_SHIPPING', [], ['shipping:owner_view'])
    db.context.mockResolvedValue({ ...activeOrg, assignments: [assigned] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canViewOwn: true, canSubmitOwn: false, ownerPermissions: ['shipping:owner_view'],
    })
    db.context.mockResolvedValue({ ...activeOrg, assignments: [{ ...assigned, ownerShippingPermissions: [] }] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canViewOwn: false, canSubmitOwn: false, canReadLegacyReceipt: false, ownerPermissions: [],
    })
  })

  it('does not grant personal shipping to a historical baseline role with an old owner override', async () => {
    db.context.mockResolvedValue({ ...activeOrg, assignments: [assignment('FXIAOKE_BASELINE', [], SHIPPING_OWNER_ACTION_KEYS)] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canViewOwn: false, canSubmitOwn: false, canReadLegacyReceipt: false, ownerPermissions: [],
    })
  })

  it('rejects a missing membership, a mismatched session, or lack of authentication', async () => {
    db.context.mockResolvedValueOnce(null)
    expect(await resolveShippingEntry(user, token)).toBeNull()
    db.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'another', auth_method: 'fxiaoke' }, error: null })
    expect(await resolveShippingEntry(user, token)).toBeNull()
    expect(await resolveShippingEntry(user, null)).toBeNull()
  })
})
