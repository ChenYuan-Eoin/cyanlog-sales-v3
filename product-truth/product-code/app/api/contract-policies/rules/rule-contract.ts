import { z } from 'zod'
import type {
  ContractRuleCondition,
  ContractRuleConditionOperator,
  ContractRuleContract,
  ContractRuleProperty,
  ContractRulePropertyType,
} from '@/types/rules'

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

const PROPERTY_TYPES = [
  'money',
  'percentage',
  'duration',
  'date',
  'enum',
  'boolean',
  'text',
  'number',
] as const

const CONDITION_OPERATORS = [
  '>=',
  '<=',
  '=',
  '>',
  '<',
  'contains',
  'in',
  'exists',
  'not_exists',
] as const

const NUMERIC_OPERATORS = ['>=', '<=', '=', '>', '<', 'exists', 'not_exists'] as const

/**
 * Canonical property/condition matrix shared by API validation and the rule
 * designer.  This is business data validation, not runtime model selection.
 */
export const RULE_CONDITION_OPERATORS: Record<
  ContractRulePropertyType,
  readonly ContractRuleConditionOperator[]
> = {
  money: NUMERIC_OPERATORS,
  percentage: NUMERIC_OPERATORS,
  duration: NUMERIC_OPERATORS,
  number: NUMERIC_OPERATORS,
  date: NUMERIC_OPERATORS,
  enum: ['=', 'in', 'exists', 'not_exists'],
  boolean: ['=', 'exists', 'not_exists'],
  text: ['contains', 'exists', 'not_exists'],
}

const propertyTypeSchema = z.enum(PROPERTY_TYPES)
const conditionOperatorSchema = z.enum(CONDITION_OPERATORS)
const DURATION_UNITS = new Set(['day', 'month', 'year'])
const VALUELESS_OPERATORS = new Set<ContractRuleConditionOperator>(['exists', 'not_exists'])

export type RuleContractMatrixIssue = {
  path: Array<string | number>
  message: string
}

export function allowedConditionOperators(
  type: ContractRulePropertyType
): readonly ContractRuleConditionOperator[] {
  return RULE_CONDITION_OPERATORS[type]
}

function hasConfiguredValue(value: unknown) {
  return value !== undefined && value !== null
}

function normalizedOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function expectedConditionUnit(property: ContractRuleProperty) {
  if (property.type === 'money') return normalizedOptionalText(property.currency)?.toUpperCase()
  if (property.type === 'percentage') return 'percent'
  if (property.type === 'duration' || property.type === 'number') {
    return normalizedOptionalText(property.unit)
  }
  return undefined
}

function canonicalDurationUnit(unit: string | null | undefined): string | undefined {
  const normalized = normalizedOptionalText(unit)?.toLowerCase()
  if (!normalized) return undefined
  if (['month', 'months', 'mon', '月', '个月', '個月'].includes(normalized || '')) return 'month'
  if (['year', 'years', 'yr', '年'].includes(normalized || '')) return 'year'
  if (['day', 'days', 'd', '日', '天', '工作日', '自然日'].includes(normalized)) return 'day'
  return normalized
}

function propertyMatrixIssues(property: ContractRuleProperty, propertyIndex: number): RuleContractMatrixIssue[] {
  const issues: RuleContractMatrixIssue[] = []
  const add = (field: string, message: string) => issues.push({
    path: ['properties', propertyIndex, field],
    message,
  })

  if (property.type === 'money') {
    if (!normalizedOptionalText(property.currency)) add('currency', '金额属性必须指定币种')
    if (normalizedOptionalText(property.unit)) add('unit', '金额属性使用币种作为单位，不能另设单位')
  } else if (normalizedOptionalText(property.currency)) {
    add('currency', '只有金额属性可以指定币种')
  }

  if (property.type === 'percentage' && property.unit !== 'percent') {
    add('unit', '比例属性单位必须为 percent')
  }
  if (property.type === 'duration' && !DURATION_UNITS.has(property.unit || '')) {
    add('unit', '时限属性单位只能为 day、month 或 year')
  }
  if (!['money', 'percentage', 'duration', 'number'].includes(property.type) && normalizedOptionalText(property.unit)) {
    add('unit', '该属性类型不允许配置单位')
  }

  if (property.type === 'enum') {
    if (!property.options || property.options.length === 0) {
      add('options', '枚举属性至少需要一个选项')
    } else {
      const optionValues = new Set<string>()
      property.options.forEach((option, optionIndex) => {
        if (optionValues.has(option.value)) {
          issues.push({
            path: ['properties', propertyIndex, 'options', optionIndex, 'value'],
            message: '枚举选项值不能重复',
          })
        }
        optionValues.add(option.value)
      })
    }
  } else if (property.options && property.options.length > 0) {
    add('options', '只有枚举属性可以配置选项')
  }

  return issues
}

function conditionMatrixIssues(
  property: ContractRuleProperty,
  condition: ContractRuleCondition,
  decisionIndex: number,
  conditionIndex: number
): RuleContractMatrixIssue[] {
  const issues: RuleContractMatrixIssue[] = []
  const basePath = ['decisions', decisionIndex, 'conditions', conditionIndex] as Array<string | number>
  const add = (field: string, message: string) => issues.push({
    path: [...basePath, field],
    message,
  })

  if (!allowedConditionOperators(property.type).includes(condition.operator)) {
    add('operator', `${property.type} 属性不允许运算符 ${condition.operator}`)
    return issues
  }

  if (VALUELESS_OPERATORS.has(condition.operator)) {
    if (hasConfiguredValue(condition.value)) add('value', '已填写/未填写条件不能携带比较值')
    if (normalizedOptionalText(condition.unit)) add('unit', '已填写/未填写条件不能携带单位')
    return issues
  }

  const expectedUnit = expectedConditionUnit(property)
  const actualUnit = normalizedOptionalText(condition.unit)
  if (expectedUnit && actualUnit !== expectedUnit) {
    add('unit', `条件单位必须与属性单位一致：${expectedUnit}`)
  } else if (!expectedUnit && actualUnit) {
    add('unit', '该属性的条件不能携带单位')
  }

  if (['money', 'percentage', 'duration', 'number'].includes(property.type)) {
    if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
      add('value', '数值属性的比较值必须是有限数字')
    }
    return issues
  }

  if (property.type === 'date') {
    if (!isIsoDate(condition.value)) add('value', '日期比较值必须是有效的 YYYY-MM-DD')
    return issues
  }

  if (property.type === 'boolean') {
    if (typeof condition.value !== 'boolean') add('value', '是/否属性的比较值必须是布尔值')
    return issues
  }

  if (property.type === 'enum') {
    const allowedValues = new Set((property.options || []).map((option) => option.value))
    if (condition.operator === 'in') {
      if (!Array.isArray(condition.value)
        || condition.value.length === 0
        || condition.value.some((value) => typeof value !== 'string' || !allowedValues.has(value))) {
        add('value', '枚举“属于其中”必须选择一个或多个现有选项')
      }
    } else if (typeof condition.value !== 'string' || !allowedValues.has(condition.value)) {
      add('value', '枚举比较值必须是现有选项')
    }
    return issues
  }

  if (property.type === 'text') {
    if (typeof condition.value !== 'string' || !condition.value.trim()) {
      add('value', '文本比较值不能为空')
    }
  }

  return issues
}

export function ruleContractMatrixIssues(
  contract: Pick<ContractRuleContract, 'properties' | 'decisions'>
): RuleContractMatrixIssue[] {
  const issues = contract.properties.flatMap(propertyMatrixIssues)
  const properties = new Map(contract.properties.map((property) => [property.key, property]))
  contract.decisions.forEach((decision, decisionIndex) => {
    decision.conditions.forEach((condition, conditionIndex) => {
      const property = properties.get(condition.property_key)
      if (property) {
        issues.push(...conditionMatrixIssues(property, condition, decisionIndex, conditionIndex))
        if (property.required && condition.operator === 'not_exists') {
          issues.push({
            path: ['decisions', decisionIndex, 'conditions', conditionIndex, 'operator'],
            message: '必填属性缺失时会先进入缺少证据处理，不能再配置“未填写”判定；请改为可选属性',
          })
        }
      }
    })
  })
  return issues
}

function numericReconciledValue(value: ContractRuleCondition['value']) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return ''
}

/** Reconcile a condition after its property type/unit/options change. */
export function reconcileConditionForProperty(
  condition: ContractRuleCondition,
  property: ContractRuleProperty
): ContractRuleCondition {
  const allowed = allowedConditionOperators(property.type)
  const operator = allowed.includes(condition.operator) ? condition.operator : '='

  if (VALUELESS_OPERATORS.has(operator)) {
    return {
      property_key: property.key,
      operator,
      value: undefined,
      unit: undefined,
    }
  }

  let value: ContractRuleCondition['value']
  if (['money', 'percentage', 'duration', 'number'].includes(property.type)) {
    value = numericReconciledValue(condition.value)
  } else if (property.type === 'boolean') {
    value = typeof condition.value === 'boolean'
      ? condition.value
      : condition.value === 'false'
        ? false
        : true
  } else if (property.type === 'enum') {
    const optionValues = (property.options || []).map((option) => option.value)
    if (operator === 'in') {
      const retained = Array.isArray(condition.value)
        ? condition.value.filter((item): item is string => typeof item === 'string' && optionValues.includes(item))
        : typeof condition.value === 'string' && optionValues.includes(condition.value)
          ? [condition.value]
          : []
      value = retained.length > 0 ? retained : optionValues.slice(0, 1)
    } else {
      value = typeof condition.value === 'string' && optionValues.includes(condition.value)
        ? condition.value
        : optionValues[0] || ''
    }
  } else if (property.type === 'date') {
    value = isIsoDate(condition.value) ? condition.value : ''
  } else if (operator === 'in') {
    value = Array.isArray(condition.value)
      ? condition.value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : typeof condition.value === 'string'
        ? condition.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
        : []
  } else {
    value = typeof condition.value === 'string'
      ? condition.value
      : hasConfiguredValue(condition.value)
        ? String(condition.value)
        : ''
  }

  return {
    property_key: property.key,
    operator,
    value,
    unit: expectedConditionUnit(property),
  }
}

/**
 * Bring legacy/read-only rule assets into the canonical editor shape before a
 * human edits and saves them. This does not invent properties or decisions; it
 * only removes obsolete cross-type fields and reconciles existing conditions.
 */
export function reconcileRuleContractForEditing(
  contract: ContractRuleContract
): ContractRuleContract {
  const properties = contract.properties.map((property): ContractRuleProperty => {
    const base = {
      ...property,
      options: property.options?.map((option) => ({ ...option })),
    }

    if (property.type === 'money') {
      const currency = normalizedOptionalText(property.currency)?.toUpperCase()
      const unit = normalizedOptionalText(property.unit)
      const unitCurrency = unit?.toUpperCase().match(/^[A-Z]{3}$/)?.[0]
      if (!currency && unitCurrency) {
        return { ...base, unit: undefined, currency: unitCurrency, options: undefined }
      }
      return {
        ...base,
        unit: currency && unitCurrency === currency ? undefined : unit,
        currency,
        options: undefined,
      }
    }
    if (property.type === 'percentage') {
      const unit = normalizedOptionalText(property.unit)?.toLowerCase()
      return {
        ...base,
        unit: ['%', 'percent', 'ratio'].includes(unit || '') ? 'percent' : unit,
        currency: undefined,
        options: undefined,
      }
    }
    if (property.type === 'duration') {
      return {
        ...base,
        unit: canonicalDurationUnit(property.unit),
        currency: undefined,
        options: undefined,
      }
    }
    if (property.type === 'number') {
      return {
        ...base,
        unit: normalizedOptionalText(property.unit),
        currency: undefined,
        options: undefined,
      }
    }
    if (property.type === 'enum') {
      return { ...base, unit: undefined, currency: undefined }
    }
    return { ...base, unit: undefined, currency: undefined, options: undefined }
  })
  const propertiesByKey = new Map(properties.map((property) => [property.key, property]))

  return {
    ...contract,
    properties,
    decisions: contract.decisions.map((decision) => ({
      ...decision,
      conditions: decision.conditions.map((condition) => {
        const property = propertiesByKey.get(condition.property_key)
        return property
          ? reconcileConditionForProperty(condition, property)
          : { ...condition }
      }),
    })),
  }
}

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
  unit: z.string().trim().min(1).max(40).optional().nullable(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).optional().nullable(),
  options: z.array(propertyOptionSchema).max(100).optional(),
}).strict()

const conditionValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()).max(100),
  z.array(z.number().finite()).max(100),
])

const ruleConditionSchema = z.object({
  property_key: z.string().trim().min(1).max(80),
  operator: conditionOperatorSchema,
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

  ruleContractMatrixIssues(contract).forEach((issue) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: issue.path,
      message: issue.message,
    })
  })
})

const problemCategoryIdSchema = z.string().uuid('请选择有效的问题分类')

const ruleBusinessFieldsSchema = z.object({
  name: z.string().trim().min(1, '规则名称不能为空').max(160),
  rule_set_id: z.string().uuid('请选择有效的规则集'),
  problem_category_id: problemCategoryIdSchema,
  description: z.string().trim().max(4000).optional().nullable(),
  business_domain: z.string().trim().min(1).max(120).optional().default('contract_review'),
  risk_level: z.enum(['green', 'yellow', 'red']).optional().default('yellow'),
  rule_contract: ruleContractSchema,
  applicable_scenarios: z.array(z.string().trim().min(1).max(120)).max(50).optional().default(['contract_review']),
  scope: z.enum(['org', 'dept', 'user']).optional().default('org'),
  approval_roles: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  priority: z.number().int().min(0).max(100_000).optional().default(100),
  is_active: z.boolean().optional().default(true),
}).strict()

export const createRuleSchema = ruleBusinessFieldsSchema.extend({
  // API imports may provide a stable code. Interactive creation can omit it;
  // the server creates the internal identifier so it is not a business field.
  code: z.string().trim().min(1, '规则编码不能为空').max(80).regex(/^[A-Z0-9_-]+$/, '规则编码只允许大写字母、数字、下划线和连字符').optional(),
}).strict()

export const updateRuleSchema = ruleBusinessFieldsSchema.partial().extend({
  rule_set_id: z.string().uuid('请选择有效的规则集'),
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
