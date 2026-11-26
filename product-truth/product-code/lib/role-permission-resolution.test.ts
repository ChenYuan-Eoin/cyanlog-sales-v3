import { describe, expect, it } from 'vitest'
import { resolveOwnerShippingPermissions, resolveRolePermissions } from './role-permission-resolution'
import { SHIPPING_OWNER_ACTION_KEYS } from './shipping/owner-permission-keys'

describe('explicit personal shipping grants', () => {
  const role = { id: 'role-id', code: 'SALES', permissions: ['*'] }

  it.each(['SALES', 'READONLY', 'SHIPPING_OPERATOR', 'FXIAOKE_BASELINE', 'ORG_SUPER_ADMIN'])(
    'does not grant personal shipping based on the ordinary role %s or wildcard', (code) => {
      expect(resolveOwnerShippingPermissions({}, { ...role, code })).toEqual([])
    },
  )

  it('uses only the stored grant for this role and treats other entries, malformed grants and revocation as empty', () => {
    for (const grants of [[], ['shipping:owner_submit'], ['shipping:owner_view', '*']]) {
      expect(resolveOwnerShippingPermissions({ shipping_owner_permission_overrides: { [role.id]: grants } }, role)).toEqual([])
    }
    const stored = ['shipping:owner_view', 'shipping:owner_submit']
    expect(resolveOwnerShippingPermissions({ shipping_owner_permission_overrides: { [role.id]: stored } }, role)).toEqual(stored)
    expect(resolveOwnerShippingPermissions({ shipping_owner_permission_overrides: { another: stored } }, role)).toEqual([])
  })

  it('keeps the system super administrator definition fixed despite legacy stored overrides', () => {
    const root = { ...role, code: 'SUPER_ADMIN', permissions: [] }
    for (const settings of [null, {}, [], {
      role_permission_overrides: { [root.id]: ['role:manage'] },
      shipping_owner_permission_overrides: { [root.id]: [] },
    }, {
      role_permission_overrides: { [root.id]: [] },
      shipping_owner_permission_overrides: null,
    }]) {
      expect(resolveRolePermissions(settings, root)).toEqual({ permissions: ['*'], overridden: false })
      expect(resolveOwnerShippingPermissions(settings, root)).toEqual(SHIPPING_OWNER_ACTION_KEYS)
    }
  })
})

describe('catalog-free role permission resolution', () => {
  it('keeps the Fxiaoke baseline permission fixed even if an administrator changes the template or override', () => {
    expect(resolveRolePermissions({ role_permission_overrides: { baseline: ['*', 'admin:access'] } }, {
      id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['shipping:operate'],
    })).toEqual({ permissions: ['quote:view', 'contract:view', 'customer:view'], overridden: true })
  })
  it('uses the role template until the tenant creates an override', () => {
    expect(resolveRolePermissions({}, {
      id: 'admin-role',
      code: 'ADMIN',
      permissions: ['quote:view'],
    })).toEqual({
      permissions: expect.arrayContaining(['quote:view', 'admin:access', 'user:write', 'dept:write']),
      overridden: false,
    })
  })

  it('requires administrators to have a stored grant to manage shipping connections', () => {
    const admin = { id: 'admin-role', code: 'ADMIN', permissions: ['config:read'] }
    expect(resolveRolePermissions({}, admin).permissions).not.toContain('shipping:manage_connections')
    expect(resolveRolePermissions({}, { ...admin, permissions: ['shipping:manage_connections'] }).permissions)
      .toContain('shipping:manage_connections')
  })

  it('treats an empty or malformed tenant override as revocation, never a template fallback', () => {
    expect(resolveRolePermissions({
      role_permission_overrides: { 'admin-role': [] },
    }, {
      id: 'admin-role',
      code: 'ADMIN',
      permissions: ['*'],
    })).toEqual({ permissions: [], overridden: true })

    expect(resolveRolePermissions({
      role_permission_overrides: { 'admin-role': [null] },
    }, {
      id: 'admin-role',
      code: 'ADMIN',
      permissions: ['*'],
    })).toEqual({ permissions: [], overridden: true })
  })
})
