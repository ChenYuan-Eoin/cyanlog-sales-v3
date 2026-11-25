import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveShippingEntry } from './entry-access'

const db = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
  context: vi.fn(), published: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: db.from } }))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: db.context }))
vi.mock('@/lib/permission-registry', () => ({ loadPublishedModulePermissionKeys: db.published }))

const user = { id: 'staff', email: null, phone: null, display_name: null, org_id: 'org-a' }
const token = 'session-token'
const activeOrg = { orgId: 'org-a', actorPermissions: [] }

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
      orgId: 'org-a', canOperate: false, canManageConnections: false, canSubmitOwn: true,
    })
    expect(db.eq.mock.calls).toEqual([['token', token], ['user_id', user.id]])
    expect(await resolveShippingEntry({ ...user, org_id: 'org-b' }, token)).toMatchObject({ canSubmitOwn: false })
  })

  it('keeps connection settings separate and recomputes the operator after grant or lifecycle changes', async () => {
    db.maybeSingle.mockResolvedValue({ data: { user_id: user.id, auth_method: 'local' }, error: null })
    db.context.mockResolvedValue({ ...activeOrg, actorPermissions: ['shipping:manage_connections'] })
    expect(await resolveShippingEntry(user, token)).toMatchObject({
      canOperate: false, canManageConnections: true, canSubmitOwn: false,
    })
    db.context.mockResolvedValue({ ...activeOrg, actorPermissions: ['shipping:operate'] })
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
