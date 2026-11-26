import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { ORGANIZATION_ACTIONS_HEADER, resolveOrganizationPermissionDecision } from '@/lib/admin/organization-permission-decision'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  getDefaultOrgId: vi.fn(), getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(), getUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'employee', org_id: 'org-1' })) }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === 'users' ? { id: 'employee', org_id: 'org-1' } : null, error: null }),
          maybeSingle: async () => ({ data: { user_id: 'employee', auth_method: 'fxiaoke' } }),
        }),
      }),
    }),
  },
}))
vi.mock('@/lib/scoped-access', async original => ({ ...await original<typeof import('@/lib/scoped-access')>(), ...mocks }))
vi.mock('@/lib/org-role-permissions', () => ({
  canManageSystemAuthorizations: () => false,
  queryOrgRoles: () => ({ select: () => ({ in: async () => ({ data: [{ id: 'org-role', name: '运营' }] }) }) }),
}))

function request(permissions: string[], orgId = 'org-1') {
  return new NextRequest('https://example.test/api/auth/me', { headers: {
    authorization: 'Bearer valid-session',
    'x-user-id': 'employee',
    'x-org-id': orgId,
    [ORGANIZATION_ACTIONS_HEADER]: JSON.stringify(resolveOrganizationPermissionDecision(permissions)),
  } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getDefaultOrgId.mockResolvedValue('org-outdated')
  mocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
  mocks.getFreshUserScopedRoleAssignments.mockResolvedValue([])
  mocks.getUserScopedRoleAssignments.mockResolvedValue([])
})

it('shows the configuration link for an effective employee grant without adding any role identity', async () => {
  const result = await GET(request(['user:view']))
  expect(result.status).toBe(200)
  expect((await result.json()).user).toMatchObject({ canManageOrg: true, canViewConfigs: true, roles: [], scopedRoles: [] })
  expect(mocks.getFreshDefaultOrgId).toHaveBeenCalledWith('employee')
  expect(mocks.getDefaultOrgId).not.toHaveBeenCalled()
})

it('applies the employee result only for the current organization and preserves the independently assigned role', async () => {
  const assignment: ScopedRoleAssignment = {
    scopeType: 'org', scopeId: 'org-1', roleId: 'org-role', roleCode: 'OPERATIONS', roleName: '运营',
    permissions: ['org:write', 'role:view', 'user:view'], grantedAt: null,
  }
  mocks.getFreshUserScopedRoleAssignments.mockResolvedValue([assignment])
  const narrowed = await GET(request([]))
  expect((await narrowed.json()).user).toMatchObject({ canManageOrg: false, canViewConfigs: false, roles: [{ code: 'OPERATIONS', name: '运营' }] })
  const unmatched = await GET(request([], 'org-other'))
  expect((await unmatched.json()).user).toMatchObject({ canManageOrg: true, canViewConfigs: true })
})
