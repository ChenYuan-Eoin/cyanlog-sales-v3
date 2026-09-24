// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  orgId: vi.fn(),
  roleAssignments: vi.fn(),
  roles: vi.fn(),
  permissions: vi.fn(),
  point: vi.fn(),
  direct: vi.fn(),
  membership: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: m.orgId,
  getUserScopedRoleAssignments: m.roleAssignments,
  getOrgRoleCodes: m.roles,
  getOrgPermissions: m.permissions,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => table === 'permission_points'
          ? { maybeSingle: m.point }
          : table === 'user_organizations'
            ? { eq: () => ({ maybeSingle: m.membership }) }
            : { eq: () => ({ eq: () => ({ maybeSingle: m.direct }) }) },
      }),
    }),
  },
}))

import { requireShippingOperator } from './operator-access'
import { ShippingError } from './config'

describe('organization-scoped shipping operator access', () => {
  beforeEach(() => {
    m.orgId.mockReset().mockResolvedValue('org-1')
    m.roleAssignments.mockReset().mockResolvedValue([])
    m.roles.mockReset().mockReturnValue([])
    m.permissions.mockReset().mockReturnValue([])
    m.point.mockReset().mockResolvedValue({ data: { id: 'shipping-operate', scope: { legacyAllowlistMigratedOrgIds: ['org-1'] } }, error: null })
    m.direct.mockReset().mockResolvedValue({ data: null, error: null })
    m.membership.mockReset().mockResolvedValue({ data: null, error: null })
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('requires an organization-scoped permission assignment', async () => {
    await expect(requireShippingOperator('operator-1')).rejects.toMatchObject({ status: 403 })
    m.direct.mockResolvedValue({ data: { id: 'assignment-1' }, error: null })
    await expect(requireShippingOperator('operator-1')).resolves.toBe('org-1')
  })

  it('accepts a permission granted through an organization role', async () => {
    m.permissions.mockReturnValue(['shipping:operate'])
    await expect(requireShippingOperator('operator-1')).resolves.toBe('org-1')
  })

  it('accepts the temporary legacy allowlist only until migration is marked complete', async () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    m.membership.mockResolvedValue({ data: { user_id: userId }, error: null })
    m.point.mockResolvedValue({ data: { id: 'shipping-operate', scope: { legacyAllowlistMigrated: false } }, error: null })
    await expect(requireShippingOperator(userId)).resolves.toBe('org-1')
    m.point.mockResolvedValue({ data: { id: 'shipping-operate', scope: { legacyAllowlistMigratedOrgIds: ['org-1'] } }, error: null })
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
  })

  it('does not silently grant access when the permission data API fails', async () => {
    m.point.mockResolvedValue({ data: null, error: new Error('permission table unavailable') })
    await expect(requireShippingOperator('operator-1')).rejects.toBeInstanceOf(ShippingError)
  })
})
