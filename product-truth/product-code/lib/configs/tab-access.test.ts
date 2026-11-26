import { describe, expect, it } from 'vitest'
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
