import { ShippingError } from './config'
import type { Contact, ShippingInput, ShippingPayment, TrackingResult } from './types'
import { getShippingRuntimeConfig, selectAuthorizedShippingService } from './runtime-config'
import { cancelSfOrder, createSfOrder, lookupSfOrder, querySfTracking } from './sf-client'

// Business metadata may cross into the workflow/store; provider secrets may not.
export type CarrierOrderContext = {
  orgId: string
  connectionId: string
  environment: 'sandbox' | 'production'
  connectionKey: string
  billingAccountId: string | null
  billingAccountTail: string
  senderProfileId: string | null
  sender: Contact
  services: Array<{ id: number; name: string; preference: 'standard' | 'urgent' }>
  snapshot: Record<string, unknown>
}

export type CarrierSelection = {
  orgId: string
  connectionId?: string
  billingAccountId?: string | null
  payment?: ShippingPayment
  senderOverride?: Contact
  allowHistorical?: boolean
  requireOrderCapability?: boolean
  expectedEnvironment?: 'sandbox' | 'production' | null
}

export type ConnectedCarrier = {
  key: string
  context: CarrierOrderContext
  selectService(preference?: 'standard' | 'urgent', serviceId?: number): CarrierOrderContext['services'][number]
  create(requestId: string, input: ShippingInput): Promise<string | null>
  lookup(requestId: string): Promise<string | null>
  cancel(requestId: string): Promise<void>
  track(waybill: string, phoneSuffix?: string): Promise<TrackingResult & { source: 'carrier' | 'sandbox_mock' }>
}

export interface CarrierAdapter {
  key: string
  connect(selection: CarrierSelection): Promise<ConnectedCarrier>
}

const sfAdapter: CarrierAdapter = {
  key: 'sf',
  async connect(selection) {
    const { expectedEnvironment, ...runtimeSelection } = selection
    const config = await getShippingRuntimeConfig(runtimeSelection)
    if (expectedEnvironment && config.environment !== expectedEnvironment) throw new ShippingError(409, '快递连接环境与原单不一致，不能改用其他环境处理历史订单。')
    // Enumerate public metadata instead of spreading decrypted provider config.
    const context: CarrierOrderContext = {
      orgId: config.orgId, connectionId: config.connectionId, environment: config.environment,
      connectionKey: config.connectionKey, billingAccountId: config.billingAccountId,
      billingAccountTail: config.billingAccountTail, senderProfileId: config.senderProfileId,
      sender: config.sender, services: config.services, snapshot: config.snapshot,
    }
    return {
      key: 'sf', context,
      selectService: (preference, serviceId) => selectAuthorizedShippingService(config.services, preference, serviceId),
      create: (requestId, input) => createSfOrder(requestId, input, config),
      lookup: requestId => lookupSfOrder(requestId, config),
      cancel: async requestId => { await cancelSfOrder(requestId, config) },
      track: async (waybill, phoneSuffix) => ({
        ...await querySfTracking(waybill, phoneSuffix, config),
        // SF sandbox routes are MOCK; the core must never persist them as fact.
        source: config.environment === 'production' ? 'carrier' : 'sandbox_mock',
      }),
    }
  },
}

// Static installed adapters only. No arbitrary module/URL can be configured here.
export function getCarrierAdapter(key: string): CarrierAdapter {
  if (key === sfAdapter.key) return sfAdapter
  throw new ShippingError(400, '当前承运商尚未接入，不能执行寄件操作。')
}

// Before adapter metadata existed, every stored/imported request was SF-only.
// Only absence uses that compatibility default; invalid/unknown keys fail closed.
export function getHistoricalCarrierAdapter(key: unknown): CarrierAdapter {
  if (key === undefined || key === null) return getCarrierAdapter('sf')
  if (typeof key !== 'string') throw new ShippingError(409, '历史订单承运商标识无效。')
  return getCarrierAdapter(key)
}
