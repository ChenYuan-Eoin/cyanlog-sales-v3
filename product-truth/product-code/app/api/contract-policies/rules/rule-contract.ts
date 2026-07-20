import { z } from 'zod'

export const RULE_WITH_PROBLEM_CATEGORY_SELECT = `
  *,
  problem_category:contract_rule_problem_categories(
    id,
    code,
    name,
    description,
    sort_order
  )
`

const propertyTypeSchema = z.enum([
  'money',
  'percentage',
  'duration',
  'date',
  'enum',
  'boolean',
  'text',
  'number',
])

const propertyOptionSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
}).strict()

const rulePropertySchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/, '属性标识只允许小写字母、数字和下划线'),
  label: z.string().trim().min(1).max(120),
  type: propertyTypeSchema,
  required: z.boolean(),
  description: z.string().trim().max(1000).optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).optional().nullable(),
  options: z.array(propertyOptionSchema).max(100).optional(),
}).strict().superRefine((property, ctx) => {
  if (property.type === 'enum' && (!property.options || property.options.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: '枚举属性至少需要一个选项',
    })
  }
  if (property.type === 'money' && !property.currency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currency'],
      message: '金额属性必须指定币种',
    })
  }
})

const conditionValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()).max(100),
  z.array(z.number().finite()).max(100),
])

const ruleConditionSchema = z.object({
  property_key: z.string().trim().min(1).max(80),
  operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in', 'exists', 'not_exists']),
  value: conditionValueSchema.optional(),
  unit: z.string().trim().max(40).optional().nullable(),
}).strict().superRefine((condition, ctx) => {
  if (!['exists', 'not_exists'].includes(condition.operator) && condition.value === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: '该判断条件必须填写比较值',
    })
  }
})

const ruleDecisionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/, '判定标识只允许小写字母、数字和下划线'),
  label: z.string().trim().min(1).max(120),
  outcome: z.enum(['pass', 'negotiate', 'block', 'manual_review']),
  priority: z.number().int().min(0).max(10_000),
  match: z.enum(['all', 'any']),
  conditions: z.array(ruleConditionSchema).min(1).max(20),
  action: z.string().trim().max(2000).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
}).strict()

export const ruleContractSchema = z.object({
  schema_version: z.literal('1.0'),
  properties: z.array(rulePropertySchema).min(1).max(30),
  decisions: z.array(ruleDecisionSchema).min(1).max(50),
  missing_evidence_outcome: z.enum(['manual_review', 'block']),
}).strict().superRefine((contract, ctx) => {
  const propertyKeys = new Set<string>()
  contract.properties.forEach((property, index) => {
    if (propertyKeys.has(property.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['properties', index, 'key'],
        message: '属性标识不能重复',
      })
    }
    propertyKeys.add(property.key)
  })

  const decisionIds = new Set<string>()
  contract.decisions.forEach((decision, decisionIndex) => {
    if (decisionIds.has(decision.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', decisionIndex, 'id'],
        message: '判定标识不能重复',
      })
    }
    decisionIds.add(decision.id)

    decision.conditions.forEach((condition, conditionIndex) => {
      if (!propertyKeys.has(condition.property_key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['decisions', decisionIndex, 'conditions', conditionIndex, 'property_key'],
          message: '判断条件引用了不存在的属性',
        })
      }
    })
  })
})

const problemCategoryIdSchema = z.string().uuid('请选择有效的问题分类')

const ruleBusinessFieldsSchema = z.object({
  name: z.string().trim().min(1, '规则名称不能为空').max(160),
  rule_set_id: z.string().uuid().optional().nullable(),
  problem_category_id: problemCategoryIdSchema,
  description: z.string().trim().max(4000).optional().nullable(),
  business_domain: z.string().trim().min(1).max(120).optional().default('contract_review'),
  risk_level: z.enum(['green', 'yellow', 'red']).optional().default('yellow'),
  rule_contract: ruleContractSchema,
  applicable_scenarios: z.array(z.string().trim().min(1).max(120)).max(50).optional().default(['standard_contract_review']),
  scope: z.enum(['org', 'dept', 'user']).optional().default('org'),
  approval_roles: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  priority: z.number().int().min(0).max(100_000).optional().default(100),
  is_active: z.boolean().optional().default(true),
}).strict()

export const createRuleSchema = ruleBusinessFieldsSchema.extend({
  code: z.string().trim().min(1, '规则编码不能为空').max(80).regex(/^[A-Z0-9_-]+$/, '规则编码只允许大写字母、数字、下划线和连字符'),
}).strict()

export const updateRuleSchema = ruleBusinessFieldsSchema.partial().extend({
  problem_category_id: problemCategoryIdSchema,
  rule_contract: ruleContractSchema,
}).strict()

export type RuleContract = z.infer<typeof ruleContractSchema>

type LegacyRuleAdapter = {
  category: 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
  engine_type: 'structured'
  target_field: string
  clause_category: string
  field_hints: string[]
  semantic_prompt: null
  message_template: Record<string, unknown>
  level_a_operator: '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'
  level_a_threshold: number
  level_a_unit: string
  level_a_action: string
  level_b_operator: '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'
  level_b_threshold: number
  level_b_unit: string
  level_b_action: string
  level_b_counterparty: string
  level_c_operator: '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'
  level_c_threshold: number
  level_c_unit: string
  level_c_action: string
  level_c_message: string
}

const legacyOperator = (operator: z.infer<typeof ruleConditionSchema>['operator']): LegacyRuleAdapter['level_a_operator'] => {
  if (operator === 'exists' || operator === 'not_exists') return 'contains'
  return operator
}

const numericThreshold = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
)

const legacyUnit = (contract: RuleContract, decision?: RuleContract['decisions'][number]) => {
  const condition = decision?.conditions[0]
  const property = contract.properties.find((item) => item.key === condition?.property_key)
    || contract.properties[0]
  return condition?.unit || property.unit || property.currency || (
    property.type === 'percentage' ? 'percent'
      : property.type === 'duration' ? 'day'
        : property.type === 'money' ? 'CNY'
          : 'text'
  )
}

export function buildLegacyRuleAdapter(
  contract: RuleContract,
  problemCategoryCode: string
): LegacyRuleAdapter {
  const firstProperty = contract.properties[0]
  const pass = contract.decisions.find((decision) => decision.outcome === 'pass')
    || contract.decisions[0]
  const negotiate = contract.decisions.find((decision) => decision.outcome === 'negotiate')
    || contract.decisions.find((decision) => decision.outcome === 'manual_review')
    || pass
  const block = contract.decisions.find((decision) => decision.outcome === 'block')
    || negotiate

  const conditionFor = (decision: RuleContract['decisions'][number]) => (
    decision.conditions.find((condition) => condition.property_key === firstProperty.key)
      || decision.conditions[0]
  )

  const passCondition = conditionFor(pass)
  const negotiateCondition = conditionFor(negotiate)
  const blockCondition = conditionFor(block)

  const legacyCategory: LegacyRuleAdapter['category'] = firstProperty.type === 'money'
    ? 'amount'
    : firstProperty.type === 'percentage'
      ? 'ratio'
      : firstProperty.type === 'duration'
        ? 'duration'
        : firstProperty.type === 'enum' || firstProperty.type === 'boolean'
          ? 'enum'
          : 'text'

  return {
    category: legacyCategory,
    engine_type: 'structured',
    target_field: firstProperty.key,
    clause_category: problemCategoryCode,
    field_hints: [],
    semantic_prompt: null,
    message_template: {
      source: 'rule_contract_v1',
      outcomes: Object.fromEntries(contract.decisions.map((decision) => [
        decision.outcome,
        decision.message || decision.action || decision.label,
      ])),
    },
    level_a_operator: legacyOperator(passCondition.operator),
    level_a_threshold: numericThreshold(passCondition.value),
    level_a_unit: legacyUnit(contract, pass),
    level_a_action: pass.action || 'auto_accept',
    level_b_operator: legacyOperator(negotiateCondition.operator),
    level_b_threshold: numericThreshold(negotiateCondition.value),
    level_b_unit: legacyUnit(contract, negotiate),
    level_b_action: negotiate.action || 'manual_review',
    level_b_counterparty: negotiate.message || '',
    level_c_operator: legacyOperator(blockCondition.operator),
    level_c_threshold: numericThreshold(blockCondition.value),
    level_c_unit: legacyUnit(contract, block),
    level_c_action: block.action || 'block',
    level_c_message: block.message || '',
  }
}

export function formatRuleValidationError(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return `${path}${issue.message}`
  }).join('；')
}
