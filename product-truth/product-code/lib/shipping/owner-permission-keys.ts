export const SHIPPING_OWNER_ACTION_KEYS = [
  'shipping:owner_view',
  'shipping:owner_submit',
  'shipping:owner_address_write',
  'shipping:owner_resubmit',
  'shipping:owner_tracking_refresh',
  'shipping:owner_cancel',
  'shipping:owner_change',
] as const

export type ShippingOwnerPermissionKey = typeof SHIPPING_OWNER_ACTION_KEYS[number]

export const SHIPPING_OWNER_VIEW = SHIPPING_OWNER_ACTION_KEYS[0]

export function isShippingOwnerPermission(key: unknown): key is ShippingOwnerPermissionKey {
  return SHIPPING_OWNER_ACTION_KEYS.some(action => action === key)
}
