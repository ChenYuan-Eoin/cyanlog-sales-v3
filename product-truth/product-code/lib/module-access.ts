import { isShippingOwnerPermission, SHIPPING_OWNER_ACTION_KEYS, type ShippingOwnerPermissionKey } from './shipping/owner-permission-keys'
export { SHIPPING_OWNER_ACTION_KEYS } from './shipping/owner-permission-keys'

export const SHIPPING_OPERATE = 'shipping:operate'
export const SHIPPING_MANAGE_CONNECTIONS = 'shipping:manage_connections'
export const SHIPPING_BUNDLE = 'shipping:*'

export const SHIPPING_ACTION_DEFINITIONS = {
  'shipping:owner_view': ['查看本人寄件记录', '查看本人提报的工单、回执和系统已保存的物流。'],
  'shipping:owner_submit': ['提交本人寄件', '在本人提报入口提交一票或批量寄件工单。'],
  'shipping:owner_address_write': ['保存本人常用地址', '更新本人快捷使用的寄件地址。'],
  'shipping:owner_resubmit': ['修改并重提本人退回工单', '修改已退回的本人提报后重新提交。'],
  'shipping:owner_tracking_refresh': ['同步本人运单物流', '向承运商查询本人运单状态并回写已验证的状态。'],
  'shipping:owner_cancel': ['取消本人工单或运单', '按本人单据的处理状态取消符合条件的工单或运单。'],
  'shipping:owner_change': ['本人运单在途转寄与退回', '对符合条件的本人运单发起在途转寄或退回。'],
  'shipping:ledger_view': ['查看收寄台账', '查看当前组织的寄件工单和系统已保存的物流。'],
  'shipping:record_create': ['录入寄件工单', '在工作台录入或批量提报工单。'],
  'shipping:record_review': ['核对与处理工单', '分配归属、修改、退回或重新核对工单。'],
  'shipping:order_confirm': ['确认并下单', '确认审核后的工单并向顺丰下单。'],
  'shipping:order_reconcile': ['查回下单结果', '从承运商核实并回写下单结果。'],
  'shipping:tracking_refresh': ['同步运单物流', '向承运商查询运单轨迹并在有依据时更新平台记录。'],
  'shipping:order_cancel': ['取消运单', '按承运商与运单状态校验取消符合条件的运单。'],
  'shipping:order_change': ['在途转寄与退回', '对符合条件的运单发起在途转寄或退回。'],
  'shipping:settings_view': ['查看寄件设置', '查看脱敏后的顺丰连接、月结与寄件规则。'],
  'shipping:connection_write': ['维护顺丰连接', '更新顺丰连接凭据或执行连接验证。'],
  'shipping:billing_write': ['维护月结与可提报服务', '维护月结账号和可提报服务产品。'],
  'shipping:intake_write': ['维护默认寄方与提报规则', '维护公司默认寄件资料和提报规则。'],
  'shipping:intercept_enable': ['启用在途转寄与退回', '为本组织的顺丰连接启用在途处理能力。'],
} as const

export type ShippingActionKey = keyof typeof SHIPPING_ACTION_DEFINITIONS
export const SHIPPING_WORKBENCH_ACTION_KEYS = [
  'shipping:ledger_view', 'shipping:record_create', 'shipping:record_review', 'shipping:order_confirm',
  'shipping:order_reconcile', 'shipping:tracking_refresh', 'shipping:order_cancel', 'shipping:order_change',
] as const satisfies readonly ShippingActionKey[]
export const SHIPPING_SETTINGS_ACTION_KEYS = [
  'shipping:settings_view', 'shipping:connection_write', 'shipping:billing_write', 'shipping:intake_write',
  'shipping:intercept_enable',
] as const satisfies readonly ShippingActionKey[]
export const SHIPPING_WORKBENCH_PERMISSION_KEYS = SHIPPING_WORKBENCH_ACTION_KEYS
export const SHIPPING_SETTINGS_PERMISSION_KEYS = SHIPPING_SETTINGS_ACTION_KEYS
export const REGISTERED_MODULE_PERMISSION_KEYS = [
  SHIPPING_OPERATE, SHIPPING_MANAGE_CONNECTIONS, ...SHIPPING_OWNER_ACTION_KEYS, ...SHIPPING_WORKBENCH_ACTION_KEYS, ...SHIPPING_SETTINGS_ACTION_KEYS,
] as const
export type ShippingPermissionKey = typeof REGISTERED_MODULE_PERMISSION_KEYS[number]
export const MODULE_PERMISSION_ROW_FIELDS = 'code,status,kind,category,resource,action,supported_scope_types,dependencies,enforcement_consumer'

export function hasPublishedShippingBundle(keys: ReadonlySet<string>): boolean {
  return keys.has(SHIPPING_OPERATE) && keys.has(SHIPPING_MANAGE_CONNECTIONS)
}

export function hasRestrictedShippingRoleSet(roleCodes: readonly string[]): boolean {
  return roleCodes.every(code => code === 'FXIAOKE_BASELINE' || code === 'READONLY' || code === 'SHIPPING_OPERATOR')
}

const workbenchActions = new Set<string>(SHIPPING_WORKBENCH_ACTION_KEYS)
const settingsActions = new Set<string>(SHIPPING_SETTINGS_ACTION_KEYS)

export function legacyShippingPermission(key: string) {
  if (workbenchActions.has(key)) return SHIPPING_OPERATE
  if (settingsActions.has(key)) return SHIPPING_MANAGE_CONNECTIONS
  return null
}

export function shippingActionViewDependency(key: string): ShippingActionKey | null {
  if (key !== 'shipping:owner_view' && isShippingOwnerPermission(key)) return 'shipping:owner_view'
  if (key !== 'shipping:ledger_view' && workbenchActions.has(key)) return 'shipping:ledger_view'
  if (key !== 'shipping:settings_view' && settingsActions.has(key)) return 'shipping:settings_view'
  return null
}

type ShippingGrants = readonly string[] | ReadonlySet<string>

function contains(grants: ShippingGrants, key: string): boolean {
  return 'has' in grants ? grants.has(key) : grants.includes(key)
}

function explicitlyAllows(grants: ShippingGrants, key: string) {
  return contains(grants, key) || contains(grants, SHIPPING_BUNDLE) || contains(grants, '*')
}

export function hasShippingPermission(grants: ShippingGrants, key: string): boolean {
  if (isShippingOwnerPermission(key)) return contains(grants, key)
  if (explicitlyAllows(grants, key)) return true
  const legacy = legacyShippingPermission(key)
  return !!legacy && contains(grants, legacy)
}

export function expandLegacyShippingPermissions(grants: readonly string[]): string[] {
  const expanded = new Set(grants)
  for (const key of [...SHIPPING_WORKBENCH_ACTION_KEYS, ...SHIPPING_SETTINGS_ACTION_KEYS]) {
    if (hasShippingPermission(grants, key)) expanded.add(key)
  }
  return Array.from(expanded)
}

export function getPublishedModulePermissionKeys(rows: readonly unknown[]): string[] {
  return REGISTERED_MODULE_PERMISSION_KEYS.filter(code => {
    const matches = rows.filter((row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row) && 'code' in row && row.code === code)
    if (matches.length !== 1) return false
    const row = matches[0]
    const consumer = code === SHIPPING_OPERATE ? 'lib/shipping/operator-access.ts#requireShippingOperator'
      : code === SHIPPING_MANAGE_CONNECTIONS ? 'lib/shipping/connection-authorization.ts' : 'lib/shipping/http.ts'
    const dependency = shippingActionViewDependency(code)
    return row.status === 'published' && row.kind === 'atomic' && row.resource === 'shipping'
      && row.category === 'shipping' && row.action === code.slice('shipping:'.length)
      && row.enforcement_consumer === consumer
      && Array.isArray(row.supported_scope_types) && row.supported_scope_types.length === 1
      && row.supported_scope_types[0] === (isShippingOwnerPermission(code) ? 'self' : 'org')
      && Array.isArray(row.dependencies)
      && (dependency ? row.dependencies.length === 1 && row.dependencies[0] === dependency : row.dependencies.length === 0)
  })
}

export function getShippingPermissionPublication(rows: readonly unknown[]) {
  const registered = new Set(rows.flatMap(row =>
    row && typeof row === 'object' && 'code' in row && typeof row.code === 'string' ? [row.code] : []))
  return { registered, published: new Set(getPublishedModulePermissionKeys(rows)) }
}

/** The legacy registration bridges absent detailed rows, but never a present unpublished row. */
export function getEffectiveShippingPermissions(
  grants: readonly string[], { registered, published }: { registered: ReadonlySet<string>; published: ReadonlySet<string> },
): ShippingPermissionKey[] {
  return REGISTERED_MODULE_PERMISSION_KEYS.filter(key => {
    if (isShippingOwnerPermission(key)) return false
    const available = published.has(key)
    if (available && explicitlyAllows(grants, key)) return true
    if (!available && registered.has(key)) return false
    const legacy = legacyShippingPermission(key)
    return !!legacy && published.has(legacy) && explicitlyAllows(grants, legacy)
  })
}

export function getEffectiveOwnerShippingPermissions(
  grants: readonly string[], { published }: { published: ReadonlySet<string> },
): ShippingOwnerPermissionKey[] {
  if (!published.has('shipping:owner_view') || !grants.includes('shipping:owner_view')) return []
  return SHIPPING_OWNER_ACTION_KEYS.filter(key => published.has(key) && grants.includes(key))
}

const SETTINGS_WRITES = {
  save_connection: 'shipping:connection_write',
  test_sandbox_connection: 'shipping:connection_write',
  test_production_connection: 'shipping:connection_write',
  save_authorized_services: 'shipping:billing_write',
  add_billing_account: 'shipping:billing_write',
  set_default_account: 'shipping:billing_write',
  deactivate_account: 'shipping:billing_write',
  save_sender: 'shipping:intake_write',
  enable_sf_intercept_access: 'shipping:intercept_enable',
  // Import writes credentials, accounts and sender data in a single operation.
  import_legacy_configuration: SHIPPING_MANAGE_CONNECTIONS,
  save_operator_access: SHIPPING_MANAGE_CONNECTIONS,
  import_legacy_operator_access: SHIPPING_MANAGE_CONNECTIONS,
} as const satisfies Record<string, ShippingPermissionKey>

export function shippingSettingsWritePermission(action: unknown): ShippingPermissionKey | null {
  if (typeof action !== 'string' || !Object.hasOwn(SETTINGS_WRITES, action)) return null
  return SETTINGS_WRITES[action as keyof typeof SETTINGS_WRITES]
}

const LEGACY_CONNECTION_ROUTES = new Set(['/api/shipping/wecom', '/api/shipping/wecom/bot'])
const LEDGER_ITEM = /^\/api\/shipping\/ledger\/[^/]+\/([^/]+)$/
const OWNER_ITEM = /^\/api\/shipping\/owner\/orders\/SO-\d{8}-[A-Z0-9]{8}\/([^/]+)$/
const LEGACY_RECONCILE = /^\/api\/shipping\/orders\/[^/]+\/reconcile$/

export function shippingOwnerPermissionRequirement(path: string, method: string): ShippingOwnerPermissionKey | null {
  const read = method === 'GET' || method === 'HEAD'
  const write = method === 'POST'
  if (!read && !write) return null
  if (read && /^\/api\/shipping\/public\/orders\/[^/]+$/.test(path)) return 'shipping:owner_view'
  if (path === '/api/shipping/owner/orders') return read ? 'shipping:owner_view' : 'shipping:owner_submit'
  if (path === '/api/shipping/owner/profile') return read ? 'shipping:owner_view' : 'shipping:owner_address_write'
  const ownerAction = OWNER_ITEM.exec(path)?.[1]
  if (ownerAction === 'resubmit') return 'shipping:owner_resubmit'
  if (ownerAction === 'carrier-changes') return 'shipping:owner_change'
  if (write && ownerAction === 'tracking') return 'shipping:owner_tracking_refresh'
  if (write && ownerAction === 'cancel') return 'shipping:owner_cancel'
  return null
}

export function shippingPermissionRequirement(path: string, method: string, workspace: boolean): ShippingPermissionKey | null {
  const read = method === 'GET' || method === 'HEAD'
  const write = method === 'POST'
  if (!read && !write) return null
  if (path === '/shipping/settings') return read ? 'shipping:settings_view' : null
  if (path === '/api/shipping/settings') return read ? (workspace ? 'shipping:ledger_view' : 'shipping:settings_view') : null
  if (path === '/api/shipping/intake-settings') return read ? 'shipping:settings_view' : 'shipping:intake_write'
  if (LEGACY_CONNECTION_ROUTES.has(path)) return SHIPPING_MANAGE_CONNECTIONS
  if (path === '/api/shipping/contacts') return read ? 'shipping:ledger_view' : 'shipping:record_create'
  if (path === '/api/shipping/ledger') return read ? 'shipping:ledger_view' : 'shipping:record_create'
  if (read && path === '/api/shipping/orders') return 'shipping:ledger_view'
  if (write && path === '/api/shipping/tracking') return 'shipping:tracking_refresh'
  if (write && LEGACY_RECONCILE.test(path)) return 'shipping:order_reconcile'
  const action = LEDGER_ITEM.exec(path)?.[1]
  if (read) return action === 'carrier-changes' ? 'shipping:ledger_view' : null
  switch (action) {
    case 'assign': case 'amend': case 'return': case 'reopen': return 'shipping:record_review'
    case 'confirm': return 'shipping:order_confirm'
    case 'reconcile': return 'shipping:order_reconcile'
    case 'cancel': return 'shipping:order_cancel'
    case 'carrier-changes': return 'shipping:order_change'
    default: return null
  }
}
