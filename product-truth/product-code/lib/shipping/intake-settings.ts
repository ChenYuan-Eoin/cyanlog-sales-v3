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
  const patch = intakeRulesSchema.partial().parse(input)
  const snapshot = await supabaseAdmin.from('shipping_intake_settings').select('rules').eq('org_id', orgId).maybeSingle()
  if (snapshot.error) throw new ShippingError(503, '员工提报字段配置读取失败，请稍后重试。')
  const current = snapshot.data ? intakeRulesSchema.safeParse(snapshot.data.rules) : { success: true as const, data: DEFAULT_INTAKE_RULES }
  if (!current.success) throw new ShippingError(503, '员工提报字段配置无效，请联系管理员。')
  const rules = intakeRulesSchema.parse({ ...current.data, ...patch })
  await validateShippingDepartmentRoots(orgId, rules.allowedDepartmentIds)
  const values = { org_id: orgId, rules, updated_by: userId, updated_at: new Date().toISOString() }
  if (snapshot.data) {
    const saved = await supabaseAdmin.from('shipping_intake_settings').update(values)
      .eq('org_id', orgId).eq('rules', JSON.stringify(snapshot.data.rules)).select('org_id').maybeSingle()
    if (saved.error) throw new ShippingError(503, '员工提报字段配置保存失败。')
    if (!saved.data) throw new ShippingError(409, '配置已被其他操作更新，本次未覆盖，请刷新后重新保存。')
  } else {
    const saved = await supabaseAdmin.from('shipping_intake_settings').insert(values)
    if (saved.error?.code === '23505') throw new ShippingError(409, '配置已被其他操作更新，本次未覆盖，请刷新后重新保存。')
    if (saved.error) throw new ShippingError(503, '员工提报字段配置保存失败。')
  }
  return loadIntakeSettings(orgId)
}
