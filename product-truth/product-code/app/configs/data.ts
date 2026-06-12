// configs/data.ts - Server-side data fetching
// 服务端获取数据，避免客户端并发请求

import { supabaseAdmin } from '@/lib/supabase'
import { isSchemaDriftError } from '@/lib/db-compat'
import { unstable_cache } from 'next/cache'

// 价盘数据获取（带 60s 缓存）
export const fetchProducts = unstable_cache(
  async (orgId: string) => {
    try {
      const result = await supabaseAdmin
        .from('products')
        .select('id, code, name, specification, unit, base_price, cost_price, min_price, tier_pricing_enabled, status, org_id, product_price_tiers(*)')
        .eq('org_id', orgId)
        .order('code')

      if (result.error) {
        if (isSchemaDriftError(result.error)) {
          const legacy = await supabaseAdmin
            .from('products')
            .select('*')
            .order('code')
          return { data: legacy.data || [], error: null }
        }
        return { data: [], error: result.error }
      }
      return { data: result.data || [], error: null }
    } catch (e) {
      return { data: [], error: e }
    }
  },
  ['products-by-org'],
  { revalidate: 60, tags: ['products'] }
)

// 规则数据获取
export const fetchRules = unstable_cache(
  async (orgId: string) => {
    try {
      const result = await supabaseAdmin
        .from('rules')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100)
      return { data: result.data || [], error: result.error }
    } catch (e) {
      return { data: [], error: e }
    }
  },
  ['rules-by-org'],
  { revalidate: 120, tags: ['rules'] }
)

// 角色数据获取
export const fetchRoles = unstable_cache(
  async (orgId: string) => {
    try {
      const result = await supabaseAdmin
        .from('roles')
        .select('*')
        .eq('org_id', orgId)
      return { data: result.data || [], error: result.error }
    } catch (e) {
      return { data: [], error: e }
    }
  },
  ['roles-by-org'],
  { revalidate: 300, tags: ['roles'] }
)

// 并行获取所有数据
export async function fetchAllConfigsData(orgId: string) {
  const [productsRes, rulesRes, rolesRes] = await Promise.all([
    fetchProducts(orgId),
    fetchRules(orgId),
    fetchRoles(orgId),
  ])

  return {
    products: productsRes.data,
    rules: rulesRes.data,
    roles: rolesRes.data,
  }
}
