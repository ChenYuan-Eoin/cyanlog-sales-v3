import { describe, expect, it } from 'vitest'
import { resolveRolePermissions } from './role-permission-resolution'

describe('catalog-free role permission resolution', () => {
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
