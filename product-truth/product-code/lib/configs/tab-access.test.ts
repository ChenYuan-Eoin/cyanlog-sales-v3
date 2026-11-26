import { describe, expect, it } from 'vitest'
import { ORGANIZATION_ACTIONS_HEADER, resolveOrganizationPermissionDecision } from '@/lib/admin/organization-permission-decision'
import { getConfigsTabAccess, hasConfigsTabAccess, readConfigsTabAccess } from './tab-access'

describe('configuration center tab admission', () => {
  it.each([
    { permissions: ['config:read'], expected: ['general'] },
    { permissions: ['dept:directory_view'], expected: ['organization'] },
    { permissions: ['dept:write'], expected: ['organization'] },
    { permissions: ['org:source_preview'], expected: ['integrations'] },
    { permissions: ['role:manage'], expected: ['roles'] },
    { permissions: ['shipping:ledger_view'], expected: [] },
  ])('opens only real tabs for $permissions', ({ permissions, expected }) => {
    const tabs = getConfigsTabAccess({ permissions })
    expect(Object.keys(tabs).filter(key => tabs[key as keyof typeof tabs])).toEqual(expected)
    expect(hasConfigsTabAccess(tabs)).toBe(expected.length > 0)
  })

  it('requires effective shipping settings access independently of a raw shipping grant', () => {
    expect(hasConfigsTabAccess(getConfigsTabAccess({ permissions: ['shipping:settings_view'] }))).toBe(false)
    expect(getConfigsTabAccess({ permissions: [], shippingSettingsView: true })).toEqual({
      general: false, organization: false, integrations: false, roles: false, shipping: true,
    })
  })

  it('uses the exact employee organization result for only the organization and roles tabs', () => {
    const headers = new Headers({
      'x-user-permissions': 'org:write,dept:write,role:view,config:read',
      [ORGANIZATION_ACTIONS_HEADER]: JSON.stringify(resolveOrganizationPermissionDecision([])),
    })
    expect(readConfigsTabAccess(headers, true)).toEqual({
      general: true, organization: false, roles: false, integrations: false, shipping: true,
    })
    headers.set('x-user-permissions', '')
    headers.set(ORGANIZATION_ACTIONS_HEADER, JSON.stringify(resolveOrganizationPermissionDecision(['user:view', 'role:view'])))
    expect(readConfigsTabAccess(headers)).toEqual({
      general: false, organization: true, roles: true, integrations: false, shipping: false,
    })
  })
})

it('requires an exact source leaf or the verified source authority for the integrations tab', () => {
  const headers = new Headers({
    'x-user-role-codes': 'ADMIN',
    'x-user-authorization-role-codes': 'ADMIN',
    'x-user-permissions': 'org:*',
  })
  expect(readConfigsTabAccess(headers).integrations).toBe(false)
  headers.set('x-user-permissions', 'org:source_view')
  expect(readConfigsTabAccess(headers).integrations).toBe(true)
  headers.set('x-user-role-codes', 'SUPER_ADMIN')
  headers.set('x-user-permissions', '*')
  expect(readConfigsTabAccess(headers).integrations).toBe(true)
})
