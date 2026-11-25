import { describe, expect, it } from 'vitest'
import {
  getPublishedModulePermissionKeys, SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE, shippingPermissionRequirement,
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

  it('separates workspace settings from connection management and shipment execution', () => {
    expect(shippingPermissionRequirement('/api/shipping/settings', 'GET', true)).toBe(SHIPPING_OPERATE)
    expect(shippingPermissionRequirement('/api/shipping/settings', 'POST', true)).toBe(SHIPPING_MANAGE_CONNECTIONS)
    expect(shippingPermissionRequirement('/shipping/settings', 'GET', false)).toBe(SHIPPING_MANAGE_CONNECTIONS)
    expect(shippingPermissionRequirement('/api/shipping/ledger/ORDER-0/confirm', 'POST', false)).toBe(SHIPPING_OPERATE)
    expect(shippingPermissionRequirement('/api/shipping/owner/orders', 'GET', false)).toBeNull()
  })
})
