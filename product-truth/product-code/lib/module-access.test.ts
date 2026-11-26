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

function granularPermission(action: string, dependency?: string) {
  return {
    ...operator, code: `shipping:${action}`, action, dependencies: dependency ? [`shipping:${dependency}`] : [],
    enforcement_consumer: 'lib/shipping/http.ts',
  }
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

  it('publishes department scope only for the exact ledger-view definition', () => {
    const organizationOnly = granularPermission('ledger_view')
    const scopedLedger = { ...organizationOnly, supported_scope_types: ['org', 'department'] }
    expect(getShippingPermissionPublication([scopedLedger]).departmentLedgerPublished).toBe(true)
    expect(getShippingPermissionPublication([organizationOnly]).published.has(organizationOnly.code)).toBe(true)
    for (const rows of [
      [organizationOnly], [organizationOnly, scopedLedger], [{ ...scopedLedger, status: 'draft' }],
      [{ ...scopedLedger, supported_scope_types: ['org', 'space'] }],
      [{ ...granularPermission('record_review', 'ledger_view'), supported_scope_types: ['org', 'department'] }],
    ]) expect(getShippingPermissionPublication(rows).departmentLedgerPublished).toBe(false)
  })

  it('makes saved granular grants independent and bridges legacy permissions only while registered', () => {
    const ledger = granularPermission('ledger_view')
    const confirm = granularPermission('order_confirm', 'ledger_view')
    const publication = getShippingPermissionPublication([operator, connections, ledger, confirm])
    expect(getEffectiveShippingPermissions(['shipping:ledger_view', 'shipping:order_confirm'], publication))
      .toEqual(['shipping:ledger_view', 'shipping:order_confirm'])
    expect(getEffectiveShippingPermissions(['shipping:order_confirm'], publication)).toEqual([])
    expect(getEffectiveShippingPermissions(['shipping:operate'], publication))
      .toContain('shipping:order_confirm')
    expect(getEffectiveShippingPermissions(['shipping:manage_connections'], publication))
      .not.toContain('shipping:order_confirm')
    const disabled = getShippingPermissionPublication([operator, connections, ledger, { ...confirm, status: 'disabled' }])
    expect(getEffectiveShippingPermissions(['shipping:operate'], disabled))
      .not.toContain('shipping:order_confirm')
    const absent = getShippingPermissionPublication([operator, connections])
    expect(getEffectiveShippingPermissions(['shipping:operate'], absent))
      .toContain('shipping:order_confirm')
    expect(getEffectiveShippingPermissions(['shipping:order_confirm'], absent))
      .toEqual([])
  })

  it.each([
    { view: 'ledger_view', action: 'order_confirm', legacy: operator },
    { view: 'settings_view', action: 'connection_write', legacy: connections },
  ])('requires the effective $view grant for $action', ({ view, action, legacy }) => {
    const viewPermission = granularPermission(view)
    const actionPermission = granularPermission(action, view)
    const grants = [viewPermission.code, actionPermission.code]
    const published = getShippingPermissionPublication([legacy, viewPermission, actionPermission])
    const disabledView = getShippingPermissionPublication([legacy, { ...viewPermission, status: 'disabled' }, actionPermission])
    const absentView = getShippingPermissionPublication([legacy, actionPermission])

    expect(getEffectiveShippingPermissions(grants, published)).toEqual(grants)
    expect(getEffectiveShippingPermissions([actionPermission.code], published)).toEqual([])
    expect(getEffectiveShippingPermissions(grants, disabledView)).toEqual([])
    expect(getEffectiveShippingPermissions([legacy.code], disabledView)).not.toContain(actionPermission.code)
    expect(getEffectiveShippingPermissions([legacy.code], absentView)).toContain(actionPermission.code)
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
