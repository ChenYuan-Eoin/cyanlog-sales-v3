import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { DEFAULT_INTAKE_RULES, intakeRulesSchema } from './intake-rules'
import { validateShippingDepartmentRoots } from './department-access'
export async function loadIntakeSettings(orgId: string) {
  const { data, error } = await supabaseAdmin.from('shipping_intake_settings').select('rules').eq('org_id', orgId).maybeSingle()
  if (error) throw new ShippingError(503, '员工提报字段配置读取失败，请稍后重试。')
  if (!data) return DEFAULT_INTAKE_RULES
  const parsed = intakeRulesSchema.safeParse(data.rules)
  if (!parsed.success) throw new ShippingError(503, '员工提报字段配置无效，请联系管理员。')
  return { ...parsed.data, allowedDepartmentIds: parsed.data.allowedDepartmentIds ?? null }
}
export async function saveIntakeSettings(orgId: string, userId: string, input: unknown) {
  const parsed = intakeRulesSchema.parse(input)
  const rules = parsed.allowedDepartmentIds === undefined
    ? { ...parsed, allowedDepartmentIds: (await loadIntakeSettings(orgId)).allowedDepartmentIds }
    : parsed
  await validateShippingDepartmentRoots(orgId, rules.allowedDepartmentIds)
  const { error } = await supabaseAdmin.from('shipping_intake_settings').upsert({ org_id: orgId, rules, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
  if (error) throw new ShippingError(503, '员工提报字段配置保存失败。')
  return loadIntakeSettings(orgId)
}
