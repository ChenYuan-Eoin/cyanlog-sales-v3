import { z } from 'zod'
const fieldRule = z.object({ enabled: z.boolean(), required: z.boolean(), minLength: z.number().int().min(0).max(120) }).strict().refine(v => v.enabled || !v.required, '隐藏字段不能设为必填')
export const intakeRulesSchema = z.object({ companyName: fieldRule, team: fieldRule.refine(v => v.minLength <= 80, '团队最少字数不能超过80'), teamOptions: z.array(z.string().trim().min(1).max(80)).max(100) }).strict()
export type IntakeRules = z.infer<typeof intakeRulesSchema>
export const DEFAULT_INTAKE_RULES: IntakeRules = { companyName: { enabled: true, required: true, minLength: 4 }, team: { enabled: true, required: true, minLength: 1 }, teamOptions: [] }
export function intakeFieldSchema(rule: IntakeRules['companyName'], label: string, max: number, options: string[] = []) {
  return z.string().trim().max(max).default('').superRefine((value, ctx) => {
    if (!rule.enabled) return
    if (rule.required && !value) ctx.addIssue({ code: 'custom', message: `请填写${label}` })
    else if (value && value.length < rule.minLength) ctx.addIssue({ code: 'custom', message: `${label}至少填写${rule.minLength}个字符` })
    if (value && options.length && !options.includes(value)) ctx.addIssue({ code: 'custom', message: `请选择后台配置的${label}` })
  }).transform(value => rule.enabled ? value : '')
}
