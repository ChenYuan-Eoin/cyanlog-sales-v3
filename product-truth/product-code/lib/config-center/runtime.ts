// REQ: F037-F046
// PURPOSE: 配置中心运行时读取（业务面只读消费已发布配置）
import { supabaseAdmin } from '@/lib/supabase'
import { DOMAIN_REGISTRY, type ConfigDomain, type ConfigStatus } from './types'

export interface ConfigCenterRow {
  id: string
  org_id: string
  status: ConfigStatus
  version: number
  [key: string]: unknown
}

/** 列出某域已发布配置（配置中心唯一消费入口） */
export async function listPublishedByDomain(domain: ConfigDomain, orgId: string): Promise<ConfigCenterRow[]> {
  const def = DOMAIN_REGISTRY[domain]
  const { data, error } = await supabaseAdmin
    .from(def.table)
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }
  return (data || []) as ConfigCenterRow[]
}

/** 取某域单条已发布配置 */
export async function getPublishedByDomain(
  domain: ConfigDomain,
  orgId: string,
  filter: Record<string, string>
): Promise<ConfigCenterRow | null> {
  const def = DOMAIN_REGISTRY[domain]
  let query = supabaseAdmin
    .from(def.table)
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')

  for (const [key, value] of Object.entries(filter)) {
    query = query.eq(key, value)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    throw error
  }
  return (data || null) as ConfigCenterRow | null
}

/** 参数速读：取某业务参数已发布 value（JSON 数组/对象） */
export async function getPublishedParamJson<T = unknown>(orgId: string, paramKey: string): Promise<T | null> {
  const row = await getPublishedByDomain('business-params', orgId, { param_key: paramKey })
  if (!row) {
    return null
  }
  const value = (row as { value?: unknown }).value
  if (value && typeof value === 'object') {
    return value as T
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return null
}

/** 参数速读：取某业务参数已发布 value（string） */
export async function getPublishedParamString(orgId: string, paramKey: string): Promise<string | null> {
  const row = await getPublishedByDomain('business-params', orgId, { param_key: paramKey })
  if (!row) {
    return null
  }
  const value = (row as { value?: unknown }).value
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object') {
    const v = (value as Record<string, unknown>).value
    return typeof v === 'string' ? v : null
  }
  return null
}

/** 区域税率：按 region 取已发布税率（无配置回退 CN，再回退默认 13/6） */
export interface RegionTaxRates {
  region: string
  softwareRate: number
  serviceRate: number
  taxInclusive: boolean
  currency: string
}

export async function getRegionTaxRates(orgId: string, region = 'CN'): Promise<RegionTaxRates> {
  const fallback: RegionTaxRates = { region, softwareRate: 0.13, serviceRate: 0.06, taxInclusive: false, currency: 'CNY' }
  for (const r of [region, 'CN']) {
    try {
      const row = await getPublishedByDomain('regional-tax-rates', orgId, { region: r })
      if (row) {
        return {
          region: r,
          softwareRate: Number((row as { software_rate?: unknown }).software_rate ?? 0.13),
          serviceRate: Number((row as { service_rate?: unknown }).service_rate ?? 0.06),
          taxInclusive: Boolean((row as { tax_inclusive?: unknown }).tax_inclusive ?? false),
          currency: String((row as { currency?: unknown }).currency ?? 'CNY'),
        }
      }
    } catch (error) {
      console.error(`[F049] getRegionTaxRates(${r}) failed:`, error)
    }
  }
  return fallback
}

/** 参数速读：取某业务参数已发布 value（number） */
export async function getPublishedParamNumber(orgId: string, paramKey: string): Promise<number | null> {
  const row = await getPublishedByDomain('business-params', orgId, { param_key: paramKey })
  if (!row) {
    return null
  }
  const value = (row as { value?: unknown }).value
  if (typeof value === 'number') {
    return value
  }
  if (value && typeof value === 'object') {
    const v = (value as Record<string, unknown>).value
    return typeof v === 'number' ? v : null
  }
  return null
}
