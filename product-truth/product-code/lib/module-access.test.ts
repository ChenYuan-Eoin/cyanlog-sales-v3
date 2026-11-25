import { describe, expect, it } from 'vitest'
import {
  getEffectiveShippingPermissions, getPublishedModulePermissionKeys, getShippingPermissionPublication, SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE, shippingPermissionRequirement,
} from './module-access'

const operator = {
  code: SHIPPING_OPERATE, resource: 'shipping', action: 'operate', kind: 'atomic', category: 'shipping',
  status: 'published', supported_scope_types: ['org'], dependencies: [],
  enforcement_consumer: 'lib/shipping/operator-access.ts#requireShippingOperator',
}
const connections = {
  ...operator, code: SHIPPING_MANAGE_CONNECTIONS, action: 'manage_connections',
  enforcement_consumer: 'lib/shipping/connection-authorization.ts',
}

describe('shipping-only registered actions', () => {
  it('keeps unrelated modules at their existing access paths', () => {
    expect(getPublishedModulePermissionKeys([operator, connections, { ...operator, code: 'tender:view' }]))
      .toEqual([SHIPPING_OPERATE, SHIPPING_MANAGE_CONNECTIONS])
    for (const path of ['/configs', '/api/quotes', '/contracts', '/schedule', '/knowledge', '/tenders']) {
      expect(shippingPermissionRequirement(path, 'GET', false)).toBeNull()
    }
  })

  it('fails closed for duplicate, unpublished, wrong-scope or incorrectly bound keys', () => {
    expect(getPublishedModulePermissionKeys([operator, { ...operator, status: 'disabled' }, connections]))
      .toEqual([SHIPPING_MANAGE_CONNECTIONS])
    expect(getPublishedModulePermissionKeys([
      { ...operator, supported_scope_types: ['org', 'department'] },
      { ...connections, enforcement_consumer: 'unrelated consumer' },
    ])).toEqual([])
  })

  it('makes saved granular grants independent and bridges legacy permissions only while registered', () => {
    const detail = { ...operator, code: 'shipping:order_confirm', action: 'order_confirm', dependencies: ['shipping:ledger_view'], enforcement_consumer: 'lib/shipping/http.ts' }
    const publication = getShippingPermissionPublication([operator, connections, detail])
    expect(getEffectiveShippingPermissions(['shipping:order_confirm'], publication))
      .toEqual(['shipping:order_confirm'])
    expect(getEffectiveShippingPermissions(['shipping:operate'], publication))
      .toContain('shipping:order_confirm')
    expect(getEffectiveShippingPermissions(['shipping:manage_connections'], publication))
      .not.toContain('shipping:order_confirm')
    const disabled = getShippingPermissionPublication([operator, connections, { ...detail, status: 'disabled' }])
    expect(getEffectiveShippingPermissions(['shipping:operate'], disabled))
      .not.toContain('shipping:order_confirm')
    const absent = getShippingPermissionPublication([operator, connections])
    expect(getEffectiveShippingPermissions(['shipping:operate'], absent))
      .toContain('shipping:order_confirm')
    expect(getEffectiveShippingPermissions(['shipping:order_confirm'], absent))
      .toEqual([])
  })

  it('separates workspace settings from connection management and shipment execution', () => {
    expect(shippingPermissionRequirement('/api/shipping/settings', 'GET', true)).toBe('shipping:ledger_view')
    expect(shippingPermissionRequirement('/api/shipping/settings', 'POST', true)).toBeNull()
    expect(shippingPermissionRequirement('/shipping/settings', 'GET', false)).toBe('shipping:settings_view')
    expect(shippingPermissionRequirement('/api/shipping/ledger/ORDER-0/confirm', 'POST', false)).toBe('shipping:order_confirm')
    expect(shippingPermissionRequirement('/api/shipping/ledger/ORDER-0/carrier-changes', 'GET', false)).toBe('shipping:ledger_view')
    expect(shippingPermissionRequirement('/api/shipping/ledger/ORDER-0/carrier-changes', 'POST', false)).toBe('shipping:order_change')
    expect(shippingPermissionRequirement('/api/shipping/owner/orders', 'GET', false)).toBeNull()
  })
})
