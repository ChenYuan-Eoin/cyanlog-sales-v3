import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveShippingEntry } from './entry-access'

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
const activeOrg = { orgId: 'org-a', assignments: [{ roleCode: 'FXIAOKE_BASELINE', permissions: [] }] }

beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockReturnValue(db)
  db.select.mockReturnValue(db)
  db.eq.mockReturnValue(db)
  db.context.mockResolvedValue(activeOrg)
  db.published.mockResolvedValue(['shipping:operate', 'shipping:manage_connections'])
  db.maybeSingle.mockResolvedValue({ data: { user_id: user.id, auth_method: 'fxiaoke' }, error: null })
})

describe('shipping entry authorization', () => {
  it('allows a verified Fxiaoke employee only the owner entry in the current organization', async () => {
    expect(await resolveShippingEntry(user, token)).toEqual({
      orgId: 'org-a', canOperate: false, canManageConnections: false, canViewOwn: true, canSubmitOwn: true, permissions: [],
    })
    expect(db.eq.mock.calls).toEqual([['token', token], ['user_id', user.id]])
    expect(await resolveShippingEntry({ ...user, org_id: 'org-b' }, token)).toMatchObject({ canViewOwn: false, canSubmitOwn: false })
  })

  it.each([
    [['READONLY'], true, false],
    [['READONLY', 'FXIAOKE_BASELINE'], true, true],
    [['READONLY', 'SALES'], true, true],
    [[], false, false],
  ] as const)('derives owner read and write access from the current organization roles %j', async (roles, canViewOwn, canSubmitOwn) => {
    db.context.mockResolvedValue({ ...activeOrg, assignments: roles.map(roleCode => ({ roleCode, permissions: [] })) })
    expect(await resolveShippingEntry(user, token)).toMatchObject({ canViewOwn, canSubmitOwn })
  })

  it('keeps connection settings separate and recomputes the operator after grant or lifecycle changes', async () => {
    db.maybeSingle.mockResolvedValue({ data: { user_id: user.id, auth_method: 'local' }, error: null })
    db.context.mockResolvedValue({ ...activeOrg, assignments: [{ roleCode: 'ADMIN', permissions: ['shipping:manage_connections'] }] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canOperate: false, canManageConnections: true, canSubmitOwn: false,
    })
    db.context.mockResolvedValue({ ...activeOrg, assignments: [{ roleCode: 'SHIPPING_OPERATOR', permissions: ['shipping:operate'] }] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({ canOperate: true, canManageConnections: false })
    db.published.mockResolvedValue(['shipping:manage_connections'])
    expect(await resolveShippingEntry(user, token)).toMatchObject({ canOperate: false, canManageConnections: false })
  })

  it('rejects a missing membership, a mismatched session, or lack of authentication', async () => {
    db.context.mockResolvedValueOnce(null)
    expect(await resolveShippingEntry(user, token)).toBeNull()
    db.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'another', auth_method: 'fxiaoke' }, error: null })
    expect(await resolveShippingEntry(user, token)).toBeNull()
    expect(await resolveShippingEntry(user, null)).toBeNull()
  })
})
