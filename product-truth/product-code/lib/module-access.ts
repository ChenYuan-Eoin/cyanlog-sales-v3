export const SHIPPING_OPERATE = 'shipping:operate'
export const SHIPPING_MANAGE_CONNECTIONS = 'shipping:manage_connections'
export const SHIPPING_BUNDLE = 'shipping:*'
export const REGISTERED_MODULE_PERMISSION_KEYS = [SHIPPING_OPERATE, SHIPPING_MANAGE_CONNECTIONS] as const
export const MODULE_PERMISSION_ROW_FIELDS = 'code,status,kind,category,resource,action,supported_scope_types,dependencies,enforcement_consumer'

export function hasPublishedShippingBundle(keys: ReadonlySet<string>): boolean {
  return REGISTERED_MODULE_PERMISSION_KEYS.every(key => keys.has(key))
}

const shippingConsumers = {
  [SHIPPING_OPERATE]: 'lib/shipping/operator-access.ts#requireShippingOperator',
  [SHIPPING_MANAGE_CONNECTIONS]: 'lib/shipping/connection-authorization.ts',
}

export function getPublishedModulePermissionKeys(rows: readonly unknown[]): string[] {
  return REGISTERED_MODULE_PERMISSION_KEYS.filter(code => {
    const matches = rows.filter((row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row) && 'code' in row && row.code === code)
    if (matches.length !== 1) return false
    const row = matches[0]
    return row.status === 'published' && row.kind === 'atomic' && row.resource === 'shipping'
      && row.category === 'shipping' && row.action === code.slice('shipping:'.length)
      && row.enforcement_consumer === shippingConsumers[code]
      && Array.isArray(row.supported_scope_types) && row.supported_scope_types.length === 1
      && row.supported_scope_types[0] === 'org'
      && Array.isArray(row.dependencies) && row.dependencies.length === 0
  })
}

const SHIPPING_CONNECTION_ROUTES = new Set([
  '/api/shipping/intake-settings', '/api/shipping/wecom', '/api/shipping/wecom/bot',
])
const SHIPPING_LEDGER_CARRIER_CHANGES = /^\/api\/shipping\/ledger\/[^/]+\/carrier-changes$/
const SHIPPING_LEDGER_WRITE = /^\/api\/shipping\/ledger\/[^/]+\/(amend|assign|cancel|confirm|reconcile|reopen|return)$/
const SHIPPING_LEGACY_RECONCILE = /^\/api\/shipping\/orders\/[^/]+\/reconcile$/

export function shippingPermissionRequirement(path: string, method: string, workspace: boolean) {
  const read = method === 'GET' || method === 'HEAD'
  const write = method === 'POST'
  if (read && path === '/shipping/settings') return SHIPPING_MANAGE_CONNECTIONS
  if (path === '/api/shipping/settings' && (read || write)) {
    return read && workspace ? SHIPPING_OPERATE : SHIPPING_MANAGE_CONNECTIONS
  }
  if (SHIPPING_CONNECTION_ROUTES.has(path) && (read || write)) return SHIPPING_MANAGE_CONNECTIONS
  if (path === '/api/shipping/contacts' && (read || write)) return SHIPPING_OPERATE
  if ((read || write) && SHIPPING_LEDGER_CARRIER_CHANGES.test(path)) return SHIPPING_OPERATE
  if (read && (path === '/api/shipping/ledger' || path === '/api/shipping/orders')) {
    return SHIPPING_OPERATE
  }
  if (write && (path === '/api/shipping/tracking' || SHIPPING_LEDGER_WRITE.test(path)
    || SHIPPING_LEGACY_RECONCILE.test(path))) return SHIPPING_OPERATE
  return null
}
