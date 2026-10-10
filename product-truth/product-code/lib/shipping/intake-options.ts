import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { resolvePublicShippingOrgId } from './runtime-config'
import { DEFAULT_INTAKE_SERVICES, SF_SERVICE_CATALOG, type ShippingServiceOption } from './sf-service-catalog'

export async function loadPublicIntakeOptions() {
  const orgId = await resolvePublicShippingOrgId()
  const [email, connection] = await Promise.all([
    supabaseAdmin.from('shipping_email_access_settings').select('enabled,require_verification').eq('org_id', orgId).maybeSingle(),
    supabaseAdmin.from('shipping_carrier_connections').select('authorized_services').eq('org_id', orgId).eq('carrier_key', 'sf').eq('environment', 'production').neq('connection_status', 'disabled').maybeSingle(),
  ])
  if (email.error || connection.error) throw new ShippingError(503, '提报设置暂不可用，请稍后重试。')
  const configured = connection.data?.authorized_services
  const services: ShippingServiceOption[] = Array.isArray(configured) && configured.length ? configured.filter((item): item is ShippingServiceOption => Number.isInteger(item?.id) && item.id > 0 && typeof item.name === 'string').map((item): ShippingServiceOption => ({ id: item.id, name: item.name, preference: item.preference === 'urgent' ? 'urgent' : 'standard', limitation: SF_SERVICE_CATALOG.find(row => row.id === item.id)?.limitation })).filter(item => !item.limitation) : DEFAULT_INTAKE_SERVICES
  return { orgId, services, emailAvailable: email.data?.enabled === true, requireVerification: email.data?.require_verification === true }
}
