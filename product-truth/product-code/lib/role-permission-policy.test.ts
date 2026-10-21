import { describe, expect, it, vi } from 'vitest'
import { canAccessOrgAdmin, canReviewContracts, hasPermission } from './permissions'
import { evaluateOrgConfigAccess } from './configs/access'
import { isRolePermissionEnabled, resolveRolePermissions, SUPER_ADMIN_CORE_PERMISSIONS, toggleRolePermission } from './role-permission-policy'

vi.mock('@/lib/scoped-access', () => ({
  getFreshUserScopedRoleAssignments: vi.fn(),
  getUserScopedRoleAssignments: vi.fn(),
}))

const role = { id: 'root-role', code: 'SUPER_ADMIN', permissions: ['*'] }

describe('organization role permission policy', () => {
  it('keeps templates when no override exists, but does not restore an empty override', () => {
    expect(resolveRolePermissions({}, role)).toEqual({ permissions: ['*'], overridden: false })
    expect(resolveRolePermissions({ role_permission_overrides: { 'root-role': [] } }, role))
      .toEqual({ permissions: [], overridden: true })
  })
  it('fails closed for malformed override containers and entries', () => {
    for (const settings of ['damaged', [], 1]) {
      expect(resolveRolePermissions(settings, role)).toEqual({ permissions: [], overridden: true })
    }
    for (const overrides of [null, [], { 'root-role': null }, { 'root-role': ['report:dept', 1] }]) {
      expect(resolveRolePermissions({ role_permission_overrides: overrides }, role))
        .toEqual({ permissions: [], overridden: true })
    }
  })
  it('keeps another role untouched and preserves unknown stored capabilities', () => {
    expect(resolveRolePermissions({ role_permission_overrides: { other: [] } }, role).overridden).toBe(false)
    expect(resolveRolePermissions({ role_permission_overrides: { 'root-role': ['future:read'] } }, role).permissions)
      .toEqual(['future:read'])
  })
  it('preserves legacy role-code capabilities only until the organization saves an override', () => {
    const admin = { id: 'admin', code: 'ADMIN', permissions: ['quote:view'] }
    const defaults = resolveRolePermissions(null, admin)
    expect(defaults.permissions).toEqual(expect.arrayContaining([
      'quote:view', 'admin:access', 'user:write', 'dept:write', 'contract:write', 'shipping:manage_connections',
    ]))
    expect(resolveRolePermissions({ role_permission_overrides: { admin: ['quote:view'] } }, admin))
      .toEqual({ permissions: ['quote:view'], overridden: true })
    expect(resolveRolePermissions({}, { ...role, permissions: [] }).permissions).toEqual(['*'])
    expect(resolveRolePermissions({}, { id: 'legal', code: 'LEGAL', permissions: [] }).permissions).toEqual(['contract:review'])
  })
  it('removes a leaf from global or resource wildcards without removing other reports', () => {
    for (const original of [['*'], ['report:*', 'future:read']]) {
      const permissions = toggleRolePermission(original, 'report:finance')
      expect(hasPermission(permissions, 'report:finance')).toBe(false)
      expect(hasPermission(permissions, 'report:dept')).toBe(true)
      if (original.includes('future:read')) expect(permissions).toContain('future:read')
    }
  })
  it('removes whole resource groups while preserving root recovery capabilities', () => {
    expect(toggleRolePermission(['*'], 'contract:*').some(key => key.startsWith('contract:'))).toBe(false)
    const permissions = toggleRolePermission(['*'], 'config:*', SUPER_ADMIN_CORE_PERMISSIONS)
    expect(hasPermission(permissions, 'config:publish')).toBe(false)
    for (const core of SUPER_ADMIN_CORE_PERMISSIONS) expect(hasPermission(permissions, core)).toBe(true)
  })
  it('does not grant unrelated capabilities when editing a narrow role', () => {
    expect(toggleRolePermission(['contract:view'], 'contract:review')).toEqual(['contract:view', 'contract:review'])
  })
  it('shows and revokes permissions implied by existing broader capabilities', () => {
    expect(isRolePermissionEnabled(['contract:write'], 'contract:review')).toBe(true)
    for (const original of [['*'], ['contract:*'], ['contract:write', 'future:read']]) {
      const permissions = toggleRolePermission(original, 'contract:review')
      expect(canReviewContracts(permissions, [])).toBe(false)
      expect(isRolePermissionEnabled(permissions, 'contract:view')).toBe(true)
      expect(isRolePermissionEnabled(permissions, 'contract:upload')).toBe(true)
      if (original.includes('future:read')) expect(permissions).toContain('future:read')
    }
    expect(isRolePermissionEnabled(['user:*'], 'admin:access')).toBe(true)
    expect(canAccessOrgAdmin(toggleRolePermission(['org:*', 'user:*'], 'admin:access'), [])).toBe(false)
    expect(isRolePermissionEnabled(toggleRolePermission(['contract:*'], 'contract:view'), 'contract:view')).toBe(false)
    expect(isRolePermissionEnabled(toggleRolePermission(['org:*', 'dept:*'], 'dept:write'), 'dept:write')).toBe(false)
  })
  it('revokes actual config read access including write and publish grants for ordinary roles', () => {
    for (const original of [['config:write'], ['config:publish'], ['config:*'], ['*']]) {
      expect(isRolePermissionEnabled(original, 'config:read')).toBe(true)
      const assignment = {
        grantedAt: null, roleId: 'ordinary-role', roleCode: 'SALES', roleName: '销售',
        scopeType: 'org' as const, scopeId: 'org-1', permissions: original, permissionsOverridden: true,
      }
      expect(evaluateOrgConfigAccess([assignment], 'org-1').canRead).toBe(true)
      const permissions = toggleRolePermission([...original, 'future:read'], 'config:read')
      expect(isRolePermissionEnabled(permissions, 'config:read')).toBe(false)
      expect(evaluateOrgConfigAccess([{ ...assignment, permissions }], 'org-1'))
        .toEqual({ canRead: false, canWrite: false, canPublish: false })
      expect(permissions).toContain('future:read')
    }
  })
})
