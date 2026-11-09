import { loadIntakeSettings } from './intake-settings'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { resolvePublicShippingOrgId } from './runtime-config'
import { DEFAULT_INTAKE_SERVICES, SF_SERVICE_CATALOG, type ShippingServiceOption } from './sf-service-catalog'

export async function loadPublicIntakeOptions() {
  return loadIntakeOptionsForOrg(await resolvePublicShippingOrgId())
}

/** Only call with an organization resolved from a trusted session or bot record. */
export async function loadIntakeOptionsForOrg(orgId: string) {
  if (!orgId) throw new ShippingError(403, '缺少可信组织范围。')
  const [connection, rules] = await Promise.all([
    supabaseAdmin.from('shipping_carrier_connections').select('authorized_services').eq('org_id', orgId).eq('carrier_key', 'sf').eq('environment', 'production').neq('connection_status', 'disabled').maybeSingle(),
    loadIntakeSettings(orgId),
  ])
  if (connection.error) throw new ShippingError(503, '提报设置暂不可用，请稍后重试。')
  const configured = connection.data?.authorized_services
  const services: ShippingServiceOption[] = Array.isArray(configured) && configured.length ? configured.filter((item): item is ShippingServiceOption => Number.isInteger(item?.id) && item.id > 0 && typeof item.name === 'string').map((item): ShippingServiceOption => ({ id: item.id, name: item.name, preference: item.preference === 'urgent' ? 'urgent' : 'standard', limitation: SF_SERVICE_CATALOG.find(row => row.id === item.id)?.limitation })).filter(item => !item.limitation) : DEFAULT_INTAKE_SERVICES
  return { orgId, rules, services, emailAvailable: false, requireVerification: false }
}
