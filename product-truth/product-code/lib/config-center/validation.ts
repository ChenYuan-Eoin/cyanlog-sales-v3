// REQ: F037-F046
// PURPOSE: 报价域配置对象 zod 校验（每个域一个 schema）
import { z } from 'zod'
import { INTERNAL_FIELD_KEYS } from './types'

// ---------- O4 业务参数 ----------
// ---------- F049 区域税率 ----------
export const regionalTaxRateSchema = z.object({
  region: z.string().min(1).max(10),
  software_rate: z.number().min(0).max(1),
  service_rate: z.number().min(0).max(1),
  tax_inclusive: z.boolean().default(false),
  currency: z.string().min(3).max(3).default('CNY'),
  status: z.string().default('PUBLISHED'),
})

// ---------- F051 每角色折扣上限 ----------
export const discountPolicySchema = z.object({
  role_code: z.string().min(1).max(50),
  max_discount: z.number().min(0).max(1),
  hard_cap: z.number().min(0).max(1).nullable().optional(),
  status: z.string().default('PUBLISHED'),
})

export const businessParamSchema = z.object({
  param_key: z.string().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/, '参数 key 格式：大写字母+下划线，如 PRIVATE_MIN_SUB'),
  name: z.string().min(1).max(200),
  value: z.unknown(),
  data_type: z.enum(['number', 'string', 'bool', 'date', 'json']).default('number'),
  unit: z.string().max(20).optional(),
  category: z.enum(['pricing', 'approval', 'maintenance', 'gift', 'customer', 'payment', 'tax', 'quote']),
  is_secret: z.boolean().default(false),
  description: z.string().max(1000).optional(),
})

// ---------- O6 字段字典 ----------
export const fieldDictionarySchema = z.object({
  field_key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, '字段 key 格式：小写字母+下划线'),
  business_name: z.string().min(1).max(200),
  source: z.enum(['system', 'input', 'config', 'computed']).default('input'),
  transform_rule: z.enum(['direct', 'formula', 'semantic', 'conditional', 'capture']).default('direct'),
  output_classification: z.enum(['header', 'software', 'financial', 'clause', 'internal']).default('financial'),
  is_external: z.boolean().default(false),
  data_type: z.enum(['string', 'number', 'date', 'bool', 'enum', 'json']).default('string'),
  options: z.array(z.string()).optional(),
  default_value: z.unknown().optional(),
  remark: z.string().max(1000).optional(),
}).superRefine((value, ctx) => {
  // 隐藏字段（内部）不得标记为对外输出
  if (INTERNAL_FIELD_KEYS.includes(value.field_key as (typeof INTERNAL_FIELD_KEYS)[number]) && value.is_external) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['is_external'], message: '内部字段（成本/底价/毛利/审批等）不得对外输出' })
  }
  if (!value.is_external && value.output_classification !== 'internal') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output_classification'],
      message: '非对外字段的输出分类应为 internal（隐藏白名单原则）',
    })
  }
  if (value.is_external && value.output_classification === 'internal') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['is_external'],
      message: 'internal 分类字段不得对外输出',
    })
  }
})

// ---------- O9 单号规则 ----------
export const numberingRuleSchema = z.object({
  doc_type: z.string().min(1).max(50).default('quote'),
  prefix: z.string().max(50).default(''),
  date_format: z.string().max(20).default('YYYYMMDD'),
  seq_start: z.number().int().min(0).default(1),
  padding: z.number().int().min(0).max(12).default(4),
  suffix: z.string().max(50).default(''),
  separator: z.string().max(10).default(''),
  sample: z.string().max(100).optional(),
  enabled: z.boolean().default(true),
})

// ---------- O2 版本能力矩阵 ----------
export const productVersionSchema = z.object({
  version_code: z.string().min(1).max(20).regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().min(1).max(100),
  deployments: z.array(z.enum(['PUBLIC_CLOUD', 'PRIVATE', 'HA'])).min(1),
  auth_modes: z.array(z.enum(['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'])).min(1),
  term_options: z.array(z.union([z.number().int().positive(), z.null()])).optional(),
  capabilities: z.object({
    ha: z.boolean().default(false),
    xinchuang: z.boolean().default(false),
    onetime: z.boolean().default(false),
    migration: z.boolean().default(false),
  }).default({ ha: false, xinchuang: false, onetime: false, migration: false }),
  mutex: z.record(z.string(), z.array(z.string())).default({}),
})

// ---------- O3 多维价盘 ----------
export const priceMatrixRowSchema = z.object({
  product_id: z.string().uuid(),
  version_code: z.string().min(1).max(20),
  deployment: z.enum(['PUBLIC_CLOUD', 'PRIVATE', 'HA']),
  auth_mode: z.enum(['SUB_YEAR', 'SUB_3YEAR', 'ONETIME']),
  term_months: z.number().int().positive().nullable().optional(), // NULL=永久（买断）
  currency: z.string().length(3).default('CNY'),
  qty_from: z.number().int().min(1),
  qty_to: z.number().int().min(2).nullable().optional(),
  unit_price: z.number().nonnegative().nullable().optional(), // 10,000+ 档为 null
  list_price: z.number().nonnegative().nullable().optional(), // 10,000+ 档为 null
  sort_order: z.number().int().min(0).default(0),
}).superRefine((value, ctx) => {
  if (value.qty_to !== undefined && value.qty_to !== null && value.qty_to <= value.qty_from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['qty_to'], message: 'qty_to 必须大于 qty_from' })
  }
  // 两口径同时为空 = 无价档（如 10,000+「请联系我们」）；否则必须都有
  const hasUnit = value.unit_price !== null && value.unit_price !== undefined
  const hasList = value.list_price !== null && value.list_price !== undefined
  if (hasUnit !== hasList) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['list_price'], message: '累计价与区间单账号价必须同时给出或同时为空' })
  }
})

// ---------- O5 审批链/规则/节点 ----------
export const approvalChainSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  mode: z.enum(['serial', 'parallel']).default('serial'),
  quorum: z.enum(['all', 'any']).default('all'),
})

export const approvalNodeSchema = z.object({
  ord: z.number().int().min(1),
  assignee_type: z.enum(['role', 'org', 'user', 'relation']),
  assignee_value: z.string().min(1), // 只允许 role_id/org_id/user_id/relation 标识
  condition: z.record(z.string(), z.unknown()).default({}),
  skip_on_unchanged: z.boolean().default(true),
  timeout_hours: z.number().int().positive().optional(),
  escalation: z.record(z.string(), z.unknown()).default({}),
})

export const approvalRuleSchema = z.object({
  code: z.string().min(1).max(50),
  scene: z.enum(['QUOTE_DISCOUNT', 'MAINT_DISCOUNT', 'UPGRADE_DISCOUNT']),
  condition: z.record(z.string(), z.unknown()),
  chain_id: z.string().uuid().optional(),
  chain_code: z.string().min(1).max(50).optional(),
  priority: z.number().int().min(0).default(10),
  enabled: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (!value.chain_id && !value.chain_code) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chain_code'], message: '必须提供 chain_id 或 chain_code' })
  }
  if (value.chain_id && value.chain_code) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chain_code'], message: 'chain_id 与 chain_code 只能提供一个' })
  }
})

// ---------- O8 条款映射 ----------
export const clauseMappingSchema = z.object({
  code: z.string().min(1).max(100),
  match: z.record(z.string(), z.unknown()),
  clause_code: z.string().min(1).max(100),
  clause_text: z.string().optional(),
  template_ref: z.string().optional(),
  required: z.boolean().default(false),
  sort_order: z.number().int().min(0).default(0),
})

// ---------- O7 输出模板 ----------
export const outputTemplateSchema = z.object({
  code: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  doc_type: z.enum(['standard', 'customer']),
  scene: z.string().max(50).optional(),
  match_rule: z.record(z.string(), z.unknown()).default({}),
  variables: z.array(z.string()).default([]),
  content_ref: z.string().optional(),
})

// ---------- O1 产品目录属性（products.attributes） ----------
export const productCatalogAttributesSchema = z.object({
  category: z.enum(['BASE', 'FOLLOW_PRODUCT', 'FOLLOW_APP', 'FOLLOW_ECO']),
  standalone: z.boolean(),
  follows: z.array(z.string()).default([]),
  version_codes: z.array(z.string()).default([]),
  account_constraint: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, ctx) => {
  if (!value.standalone && value.follows.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['follows'], message: '跟随类产品必须声明跟随对象' })
  }
  if (value.standalone && value.category !== 'BASE') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['standalone'], message: '仅基座产品可单独售卖' })
  }
})

export type BusinessParamValue = z.infer<typeof businessParamSchema>
export type FieldDictionaryValue = z.infer<typeof fieldDictionarySchema>
export type NumberingRuleValue = z.infer<typeof numberingRuleSchema>
export type ProductVersionValue = z.infer<typeof productVersionSchema>
export type PriceMatrixRowValue = z.infer<typeof priceMatrixRowSchema>
export type ApprovalChainValue = z.infer<typeof approvalChainSchema>
export type ApprovalNodeValue = z.infer<typeof approvalNodeSchema>
export type ApprovalRuleValue = z.infer<typeof approvalRuleSchema>
export type ClauseMappingValue = z.infer<typeof clauseMappingSchema>
export type OutputTemplateValue = z.infer<typeof outputTemplateSchema>
export type ProductCatalogAttributes = z.infer<typeof productCatalogAttributesSchema>

/** 域 → schema 注册表 */
export const DOMAIN_SCHEMAS = {
  'business-params': businessParamSchema,
  'regional-tax-rates': regionalTaxRateSchema,
  'discount-policy': discountPolicySchema,
  'field-dictionary': fieldDictionarySchema,
  'numbering-rules': numberingRuleSchema,
  'product-versions': productVersionSchema,
  'price-matrix': priceMatrixRowSchema,
  'approval-chains': approvalChainSchema,
  'approval-rules': approvalRuleSchema,
  'clause-mappings': clauseMappingSchema,
  'output-templates': outputTemplateSchema,
} as const
