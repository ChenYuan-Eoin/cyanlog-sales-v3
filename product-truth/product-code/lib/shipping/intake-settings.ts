import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { DEFAULT_INTAKE_RULES, intakeRulesSchema } from './intake-rules'

const intakeFieldsPatchSchema = intakeRulesSchema.pick({ companyName: true })
const intakeDepartmentScopeSchema = intakeRulesSchema.pick({ allowedDepartmentIds: true })
  .refine(input => Array.isArray(input.allowedDepartmentIds), {
    path: ['allowedDepartmentIds'],
    message: '请明确选择允许提报的部门。',
  })

function parseStoredRules(value: unknown) {
  const parsed = intakeRulesSchema.safeParse(value)
  if (!parsed.success) throw new ShippingError(503, '员工提报字段配置无效，请联系管理员。')
  return parsed.data
}

async function loadIntakeSettingsSnapshot(orgId: string) {
  const { data, error } = await supabaseAdmin.from('shipping_intake_settings').select('rules').eq('org_id', orgId).maybeSingle()
  if (error) throw new ShippingError(503, '员工提报字段配置读取失败，请稍后重试。')
  return { data, rules: data ? parseStoredRules(data.rules) : DEFAULT_INTAKE_RULES }
}

export async function loadIntakeSettings(orgId: string) {
  const { rules } = await loadIntakeSettingsSnapshot(orgId)
  return { ...rules, allowedDepartmentIds: rules.allowedDepartmentIds ?? null }
}

export async function saveIntakeSettings(orgId: string, userId: string, input: unknown) {
  const patch = intakeFieldsPatchSchema.parse(input)
  const snapshot = await loadIntakeSettingsSnapshot(orgId)
  const rules = intakeRulesSchema.parse({ ...snapshot.rules, ...patch })
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

export async function saveIntakeDepartmentScope(orgId: string, userId: string, input: unknown) {
  const { allowedDepartmentIds } = intakeDepartmentScopeSchema.parse(input)
  const snapshot = await loadIntakeSettingsSnapshot(orgId)
  const { data, error } = await supabaseAdmin.rpc('admin_set_shipping_intake_departments_v1', {
    p_actor_id: userId,
    p_org_id: orgId,
    p_expected_rules: snapshot.data?.rules ?? null,
    p_allowed_department_ids: allowedDepartmentIds,
  })
  if (error?.code === '42501') throw new ShippingError(403, '仅系统超级管理员可以管理寄件提报部门。')
  if (error?.code === '40001') throw new ShippingError(409, '配置已被其他操作更新，本次未覆盖，请刷新后重新保存。')
  if (error?.code === '22023' || error?.code === '23514') {
    throw new ShippingError(400, '所选部门重复、不存在、已停用或不属于当前组织。')
  }
  if (error) throw new ShippingError(503, '寄件提报部门暂不可用。')
  return parseStoredRules(data)
}
