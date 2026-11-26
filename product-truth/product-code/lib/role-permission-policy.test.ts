import { describe, expect, it, vi } from 'vitest'
import { canAccessOrgAdmin, canReviewContracts, hasPermission } from './permissions'
import { evaluateOrgConfigAccess } from './configs/access'
import { SHIPPING_WORKBENCH_ACTION_KEYS } from './module-access'
import {
  getPermissionGrantSource,
  grantExplicitRolePermissions,
  isRolePermissionEnabled,
  isRolePermissionExplicitlyGranted,
  resolveRolePermissions,
  revokeRolePermissions,
  SUPER_ADMIN_CORE_PERMISSIONS,
  toggleExplicitRolePermission,
} from './role-permission-policy'

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
      'quote:view', 'admin:access', 'user:write', 'dept:write', 'contract:write',
    ]))
    expect(defaults.permissions).not.toContain('shipping:manage_connections')
    expect(resolveRolePermissions({ role_permission_overrides: { admin: ['quote:view'] } }, admin))
      .toEqual({ permissions: ['quote:view'], overridden: true })
    expect(resolveRolePermissions({}, { ...role, permissions: [] }).permissions).toEqual(['*'])
    expect(resolveRolePermissions({}, { id: 'legal', code: 'LEGAL', permissions: [] }).permissions).toEqual([
      'contract:review',
    ])
  })
  it('removes a leaf from global or resource wildcards without removing other reports', () => {
    for (const original of [['*'], ['report:*', 'future:read']]) {
      const permissions = revokeRolePermissions(original, ['report:finance'])
      expect(hasPermission(permissions, 'report:finance')).toBe(false)
      expect(hasPermission(permissions, 'report:dept')).toBe(true)
      if (original.includes('future:read')) expect(permissions).toContain('future:read')
    }
  })
  it('removes whole resource groups while preserving root recovery capabilities', () => {
    expect(revokeRolePermissions(['*'], ['contract:*']).some(key => key.startsWith('contract:'))).toBe(false)
    const permissions = revokeRolePermissions(['*'], ['config:*'], SUPER_ADMIN_CORE_PERMISSIONS)
    expect(hasPermission(permissions, 'config:publish')).toBe(false)
    for (const core of SUPER_ADMIN_CORE_PERMISSIONS) expect(hasPermission(permissions, core)).toBe(true)
  })
  it('does not grant unrelated capabilities when editing a narrow role', () => {
    expect(toggleExplicitRolePermission(['contract:view'], 'contract:review')).toEqual(['contract:view', 'contract:review'])
  })
  it('withdraws a shipping action inherited from the old grant while preserving its published siblings', () => {
    const granted = ['shipping:operate', 'shipping:manage_connections', 'quote:view']
    const published = new Set<string>(SHIPPING_WORKBENCH_ACTION_KEYS)
    const next = revokeRolePermissions(granted, ['shipping:order_confirm'], [], published)
    expect(isRolePermissionEnabled(next, 'shipping:order_confirm')).toBe(false)
    expect(isRolePermissionEnabled(next, 'shipping:record_review')).toBe(true)
    expect(isRolePermissionEnabled(next, 'shipping:settings_view')).toBe(true)
    expect(next).toContain('quote:view')
    expect(next).not.toContain('shipping:operate')
  })

  it('preserves inherited shipping capability when only part of its replacement family is published', () => {
    const granted = ['shipping:*']
    expect(revokeRolePermissions(granted, ['shipping:order_confirm'], [], new Set(['shipping:order_confirm'])))
      .toEqual(granted)
  })
  it('shows and revokes permissions implied by existing broader capabilities', () => {
    expect(isRolePermissionEnabled(['contract:write'], 'contract:review')).toBe(true)
    for (const original of [['*'], ['contract:*'], ['contract:write', 'future:read']]) {
      const permissions = revokeRolePermissions(original, ['contract:review'])
      expect(canReviewContracts(permissions, [])).toBe(false)
      expect(isRolePermissionEnabled(permissions, 'contract:view')).toBe(true)
      expect(isRolePermissionEnabled(permissions, 'contract:upload')).toBe(true)
      if (original.includes('future:read')) expect(permissions).toContain('future:read')
    }
    expect(isRolePermissionEnabled(['user:*'], 'admin:access')).toBe(true)
    expect(canAccessOrgAdmin(revokeRolePermissions(['org:*', 'user:*'], ['admin:access']), [])).toBe(false)
    expect(isRolePermissionEnabled(revokeRolePermissions(['contract:*'], ['contract:view']), 'contract:view')).toBe(false)
    expect(isRolePermissionEnabled(revokeRolePermissions(['org:*', 'dept:*'], ['dept:write']), 'dept:write')).toBe(false)
  })
  it('explains direct, bundle and dependency grants without treating aggregates as checkboxes', () => {
    expect(getPermissionGrantSource(['report:dept'], 'report:dept')).toMatchObject({
      grant: 'report:dept',
      via: 'direct',
    })
    expect(getPermissionGrantSource(['config:*'], 'config:write')).toMatchObject({
      grant: 'config:*',
      via: 'bundle',
    })
    expect(getPermissionGrantSource(['contract:write'], 'contract:review')).toMatchObject({
      grant: 'contract:write',
      via: 'dependency',
    })
    expect(getPermissionGrantSource(['future:read'], 'report:finance')).toBeNull()
  })
  it('revokes actual config read access including write and publish grants for ordinary roles', () => {
    for (const original of [['config:write'], ['config:publish'], ['config:*'], ['*']]) {
      expect(isRolePermissionEnabled(original, 'config:read')).toBe(true)
      const assignment = {
        grantedAt: null, roleId: 'ordinary-role', roleCode: 'SALES', roleName: '销售',
        scopeType: 'org' as const, scopeId: 'org-1', permissions: original, permissionsOverridden: true,
      }
      expect(evaluateOrgConfigAccess([assignment], 'org-1').canRead).toBe(true)
      const permissions = revokeRolePermissions([...original, 'future:read'], ['config:read'])
      expect(isRolePermissionEnabled(permissions, 'config:read')).toBe(false)
      expect(evaluateOrgConfigAccess([{ ...assignment, permissions }], 'org-1'))
        .toEqual({ canRead: false, canWrite: false, canPublish: false })
      expect(permissions).toContain('future:read')
    }
  })
  it('keeps exact explicit membership separate from effective access', () => {
    expect(isRolePermissionExplicitlyGranted(['*'], 'config:write')).toBe(false)
    expect(isRolePermissionEnabled(['*'], 'config:write')).toBe(true)
    expect(isRolePermissionExplicitlyGranted(['config:write'], 'config:write')).toBe(true)
  })
  it('toggles only the clicked exact grant and preserves broader sources', () => {
    expect(toggleExplicitRolePermission(['config:*'], 'config:write')).toEqual(['config:*', 'config:write'])
    const removed = toggleExplicitRolePermission(['config:*', 'config:write'], 'config:write')
    expect(removed).toEqual(['config:*'])
    expect(isRolePermissionExplicitlyGranted(removed, 'config:write')).toBe(false)
    expect(isRolePermissionEnabled(removed, 'config:write')).toBe(true)
    expect(getPermissionGrantSource(removed, 'config:write')).toMatchObject({
      grant: 'config:*',
      via: 'bundle',
    })
  })
  it('keeps a dependency explanation after its duplicate direct grant is removed', () => {
    const removed = toggleExplicitRolePermission(
      ['contract:write', 'contract:review'],
      'contract:review',
    )
    expect(removed).toEqual(['contract:write'])
    expect(isRolePermissionExplicitlyGranted(removed, 'contract:review')).toBe(false)
    expect(isRolePermissionEnabled(removed, 'contract:review')).toBe(true)
    expect(getPermissionGrantSource(removed, 'contract:review')).toMatchObject({
      grant: 'contract:write',
      via: 'dependency',
    })
  })
  it('makes group selection explicit without changing the selected key set', () => {
    const selected = grantExplicitRolePermissions(
      ['config:publish'],
      ['config:read', 'config:write', 'config:publish'],
    )
    expect(selected).toEqual(['config:publish', 'config:read', 'config:write'])
    expect(selected.every((key) => isRolePermissionExplicitlyGranted(selected, key))).toBe(true)
  })
})


it('only expands published shipping actions while preserving the original catalog when clearing a wildcard', () => {
  const allowed = new Set(['shipping:operate'])
  const next = revokeRolePermissions(['*'], ['report:finance'], [], allowed)
  expect(next).toContain('shipping:operate')
  expect(next).not.toContain('shipping:manage_connections')
  expect(next).not.toContain('shipping:*')
  expect(next).not.toContain('tender:view')
  expect(next).not.toContain('knowledge:view')
  expect(next).toContain('quote:create')
})
