import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveShippingEntry } from './entry-access'
import { resolveOwnerShippingPermissions } from '@/lib/role-permission-resolution'
import { SHIPPING_OWNER_ACTION_KEYS } from '@/lib/module-access'

const db = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
  context: vi.fn(), published: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: db.from } }))
vi.mock('@/lib/org-role-permissions', () => ({ loadCurrentOrganizationRoleAssignments: db.context }))
vi.mock('@/lib/permission-registry', () => ({
  loadShippingModulePermissionState: async () => {
    const keys: string[] = await db.published()
    return { registered: new Set(keys), published: new Set(keys) }
  },
}))

const user = { id: 'staff', email: null, phone: null, display_name: null, org_id: 'org-a' }
const token = 'session-token'
const assignment = (roleCode: string, permissions: string[] = [], ownerGrant?: readonly string[]) => ({
  roleCode, permissions, ownerShippingPermissions: resolveOwnerShippingPermissions(
    ownerGrant ? { shipping_owner_permission_overrides: { role: ownerGrant } } : {},
    { id: 'role', code: roleCode, permissions },
  ),
})
const activeOrg = { orgId: 'org-a', assignments: [assignment('FXIAOKE_BASELINE', [], SHIPPING_OWNER_ACTION_KEYS)] }

beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockReturnValue(db)
  db.select.mockReturnValue(db)
  db.eq.mockReturnValue(db)
  db.context.mockResolvedValue(activeOrg)
  db.published.mockResolvedValue(['shipping:operate', 'shipping:manage_connections', ...SHIPPING_OWNER_ACTION_KEYS])
  db.maybeSingle.mockResolvedValue({ data: { user_id: user.id, auth_method: 'fxiaoke' }, error: null })
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
    const assigned = { ...assignment('FXIAOKE_BASELINE'), ownerShippingPermissions: ['shipping:owner_view'] }
    db.context.mockResolvedValue({ ...activeOrg, assignments: [assigned] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canViewOwn: true, canSubmitOwn: false, ownerPermissions: ['shipping:owner_view'],
    })
    db.context.mockResolvedValue({ ...activeOrg, assignments: [{ ...assigned, ownerShippingPermissions: [] }] })
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
