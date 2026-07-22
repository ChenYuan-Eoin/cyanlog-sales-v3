import { supabaseAdmin } from '@/lib/supabase'
import { getAIProviderInstanceId, type AIConfigValue } from '@/lib/configs/types'

export interface ProviderConfigRow {
  id: string
  key: string
  value: AIConfigValue | Record<string, unknown> | null
}

export function findDuplicateAIProviderInstanceInRows(
  rows: ProviderConfigRow[],
  instanceId: string
): ProviderConfigRow | null {
  return rows.find((row) => {
    const value = (row.value || {}) as AIConfigValue
    return (value.kind || 'provider') === 'provider'
      && getAIProviderInstanceId(value, row.key) === instanceId
  }) || null
}

export async function findDuplicateAIProviderInstance(
  orgId: string,
  instanceId: string,
  excludeConfigId?: string
): Promise<ProviderConfigRow | null> {
  let query = supabaseAdmin
    .from('configs')
    .select('id,key,value')
    .eq('org_id', orgId)
    .eq('type', 'AI_CONFIG')

  if (excludeConfigId) {
    query = query.neq('id', excludeConfigId)
  }

  const { data, error } = await query
  if (error) throw error

  return findDuplicateAIProviderInstanceInRows(
    (data || []) as ProviderConfigRow[],
    instanceId
  )
}
