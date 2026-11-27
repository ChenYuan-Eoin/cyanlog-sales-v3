import { z } from 'zod'
const fieldRule = z.object({ enabled: z.boolean(), required: z.boolean(), minLength: z.number().int().min(0).max(120) }).strict().refine(v => v.enabled || !v.required, '隐藏字段不能设为必填')
// Existing department IDs are PostgreSQL UUIDs and may use a legacy variant.
export const intakeDepartmentIdSchema = z.guid()
export const intakeRulesSchema = z.object({ companyName: fieldRule, team: fieldRule.refine(v => v.minLength <= 80, '团队最少字数不能超过80'), teamOptions: z.array(z.string().trim().min(1).max(80)).max(100), allowedDepartmentIds: z.array(intakeDepartmentIdSchema).max(500).nullable().optional() }).strict()
export type IntakeRules = z.infer<typeof intakeRulesSchema>
export const DEFAULT_INTAKE_RULES: IntakeRules = { companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: true, minLength: 1 }, teamOptions: [], allowedDepartmentIds: null }
export function effectiveShippingDepartmentIds<T extends { id: string; parentId: string | null }>(departments: T[], roots: string[] | null | undefined): Set<string> {
  if (roots == null) return new Set(departments.map(item => item.id))
  const selected = new Set(roots)
  const byId = new Map(departments.map(item => [item.id, item]))
  const allowed = new Set<string>()
  for (const department of departments) {
    let current: T | undefined = department
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      if (selected.has(current.id)) { allowed.add(department.id); break }
      visited.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return allowed
}
export function intakeFieldSchema(rule: IntakeRules['companyName'], label: string, max: number, options: string[] = []) {
  return z.string().trim().max(max).default('').superRefine((value, ctx) => {
    if (!rule.enabled) return
    if (rule.required && !value) ctx.addIssue({ code: 'custom', message: `请填写${label}` })
    else if (value && value.length < rule.minLength) ctx.addIssue({ code: 'custom', message: `${label}至少填写${rule.minLength}个字符` })
    if (value && options.length && !options.includes(value)) ctx.addIssue({ code: 'custom', message: `请选择后台配置的${label}` })
  }).transform(value => rule.enabled ? value : '')
}

export function toggleShippingDepartmentSubtree<T extends { id: string; parentId: string | null }>(departments: T[], roots: string[], id: string, checked: boolean): string[] {
  const byId = new Map(departments.map(department => [department.id, department]))
  if (!byId.has(id)) return roots
  const subtree = effectiveShippingDepartmentIds(departments, [id])
  const covered = effectiveShippingDepartmentIds(departments, roots)
  for (const childId of subtree) {
    if (checked) covered.add(childId)
    else covered.delete(childId)
  }
  if (!checked) {
    // The stored contract grants whole subtrees. Split an inherited parent
    // grant into the remaining siblings so the removed child stays excluded.
    let parent = byId.get(id)?.parentId
    const visited = new Set<string>()
    while (parent && !visited.has(parent)) {
      visited.add(parent)
      covered.delete(parent)
      parent = byId.get(parent)?.parentId
    }
  }
  return departments.filter(department => covered.has(department.id) && (!department.parentId || !covered.has(department.parentId))).map(department => department.id)
}
