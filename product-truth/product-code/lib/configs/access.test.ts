import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/scoped-access', () => ({
  getFreshUserScopedRoleAssignments: vi.fn(),
  getUserScopedRoleAssignments: vi.fn(),
}))

import {
  getFreshUserScopedRoleAssignments,
  getUserScopedRoleAssignments,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'
import {
  evaluateOrgConfigAccess,
  getUserOrgConfigAccess,
  userHasFreshOrgConfigAccess,
  userHasOrgConfigAccess,
} from './access'

const mockGetFreshUserScopedRoleAssignments = vi.mocked(getFreshUserScopedRoleAssignments)
const mockGetUserScopedRoleAssignments = vi.mocked(getUserScopedRoleAssignments)

function assignment(
  permissions: string[],
  scopeType: ScopedRoleAssignment['scopeType'] = 'org'
): ScopedRoleAssignment {
  return {
    scopeType,
    scopeId: scopeType === 'org' ? 'org-1' : `${scopeType}-1`,
    grantedAt: '2026-07-15T00:00:00.000Z',
    roleId: 'role-1',
    roleCode: 'CONFIG_OPERATOR',
    roleName: 'Config operator',
    permissions,
  }
}

describe('organization config access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    '*',
    'config:*',
    'config:read',
    'config:write',
    'config:publish',
  ])('allows read for exact organization permission %s', (permission) => {
    expect(evaluateOrgConfigAccess([assignment([permission])], 'org-1')).toMatchObject({
      canRead: true,
    })
  })

  it.each([
    '*',
    'config:*',
    'config:write',
  ])('allows write for exact organization permission %s', (permission) => {
    expect(evaluateOrgConfigAccess([assignment([permission])], 'org-1')).toMatchObject({
      canWrite: true,
    })
  })

  it('does not let read-only config permission write', () => {
    expect(evaluateOrgConfigAccess([assignment(['config:read'])], 'org-1')).toEqual({
      canRead: true,
      canWrite: false,
      canPublish: false,
    })
  })

  it.each(['*', 'config:*', 'config:publish'])(
    'allows publish for exact organization permission %s',
    (permission) => {
      expect(evaluateOrgConfigAccess([assignment([permission])], 'org-1')).toMatchObject({
        canPublish: true,
      })
    }
  )

  it('does not let publish-only permission edit, delete, rollback, or probe', () => {
    expect(evaluateOrgConfigAccess([assignment(['config:publish'])], 'org-1')).toEqual({
      canRead: true,
      canWrite: false,
      canPublish: true,
    })
  })

  it.each(['department', 'space'] as const)(
    'rejects config and global wildcards outside the exact org scope (%s)',
    (scopeType) => {
      expect(evaluateOrgConfigAccess([
        assignment(['*', 'config:*'], scopeType),
        assignment(['contract:*']),
      ], 'org-1')).toEqual({
        canRead: false,
        canWrite: false,
        canPublish: false,
      })
    }
  )

  it('does not infer config access from organization-management roles or permissions', () => {
    expect(evaluateOrgConfigAccess([
      {
        ...assignment(['admin:access', 'org:write']),
        roleCode: 'ADMIN',
        roleName: 'Administrator',
      },
    ], 'org-1')).toEqual({
      canRead: false,
      canWrite: false,
      canPublish: false,
    })
  })

  it('loads DB-backed scoped role assignments for the requested user', async () => {
    mockGetUserScopedRoleAssignments.mockResolvedValue([
      assignment(['config:publish']),
    ])

    await expect(getUserOrgConfigAccess('user-1', 'org-1')).resolves.toEqual({
      canRead: true,
      canWrite: false,
      canPublish: true,
    })
    expect(mockGetUserScopedRoleAssignments).toHaveBeenCalledOnce()
    expect(mockGetUserScopedRoleAssignments).toHaveBeenCalledWith('user-1')
  })

  it('returns the requested access decision from one DB-backed lookup', async () => {
    mockGetUserScopedRoleAssignments.mockResolvedValue([
      assignment(['config:read']),
    ])

    await expect(userHasOrgConfigAccess('user-2', 'org-1', 'read')).resolves.toBe(true)
    await expect(userHasOrgConfigAccess('user-2', 'org-1', 'write')).resolves.toBe(false)
    await expect(userHasOrgConfigAccess('user-2', 'org-1', 'publish')).resolves.toBe(false)
    expect(mockGetUserScopedRoleAssignments).toHaveBeenCalledTimes(3)
  })

  it('uses an uncached assignment lookup for state-changing access checks', async () => {
    mockGetFreshUserScopedRoleAssignments.mockResolvedValue([
      assignment(['config:write']),
    ])

    await expect(userHasFreshOrgConfigAccess('user-2', 'org-1', 'write')).resolves.toBe(true)
    expect(mockGetFreshUserScopedRoleAssignments).toHaveBeenCalledOnce()
    expect(mockGetFreshUserScopedRoleAssignments).toHaveBeenCalledWith('user-2')
    expect(mockGetUserScopedRoleAssignments).not.toHaveBeenCalled()
  })

  it('propagates assignment lookup failures instead of granting access', async () => {
    mockGetUserScopedRoleAssignments.mockRejectedValue(new Error('role lookup failed'))

    await expect(getUserOrgConfigAccess('user-3', 'org-1')).rejects.toThrow('role lookup failed')
  })

  it('rejects an org-scoped permission assigned to a different organization', () => {
    expect(evaluateOrgConfigAccess([
      {
        ...assignment(['*', 'config:*']),
        scopeId: 'org-2',
      },
    ], 'org-1')).toEqual({
      canRead: false,
      canWrite: false,
      canPublish: false,
    })
  })
})
