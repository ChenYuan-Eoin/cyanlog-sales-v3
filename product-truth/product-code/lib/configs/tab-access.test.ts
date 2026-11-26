import { describe, expect, it } from 'vitest'
import { getConfigsTabAccess, hasConfigsTabAccess } from './tab-access'

describe('configuration center tab admission', () => {
  it.each([
    { permissions: ['config:read'], expected: ['general'] },
    { permissions: ['dept:directory_view'], expected: ['organization'] },
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
