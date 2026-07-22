// REQ: F009-F012
// PURPOSE: 配置中心数据验证

import { z } from 'zod'
import type { ConfigType } from './types'

// 基础配置验证
export const configKeySchema = z
  .string()
  .min(1, '配置键不能为空')
  .max(100, '配置键过长')
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, '配置键格式错误，应为字母开头，可包含字母、数字、下划线或中划线，如 local_primary')

export const configCreateSchema = z.object({
  key: configKeySchema,
  name: z.string().min(1, '名称不能为空').max(200, '名称过长'),
  value: z.record(z.string(), z.unknown()),
  type: z.enum(['CONTRACT_RULE', 'TAX_RULE', 'APPROVAL_RULE', 'AI_CONFIG', 'UI_THEME']),
  description: z.string().max(1000).optional(),
})

export const configUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  value: z.record(z.string(), z.unknown()).optional(),
  description: z.string().max(1000).optional(),
})

// 税率规则值验证 (F010)
export const taxRuleValueSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  rate: z.number().min(0).max(1, '税率应在 0-1 之间'),
  category: z.string().min(1),
  region: z.string().optional(),
  effective_date: z.string().optional(),
  enabled: z.boolean(),
})

// 审批阈值验证 (F011)
export const approvalThresholdSchema = z.object({
  limit: z.number().min(0),
  approver_role: z.string().min(1),
  enabled: z.boolean(),
})

// 审批权限值验证 (F011)
export const approvalRuleValueSchema = z.object({
  rule_type: z.enum(['discount', 'contract']),
  thresholds: z.array(approvalThresholdSchema).min(1, '至少需要一条阈值规则'),
})

// AI 路由配置验证 (F012)
export const aiRoutingSchema = z.object({
  max_pages: z.number().int().min(1),
  strategy: z.enum(['full', 'chunked', 'rule', 'local_first', 'quality_first', 'cost_first', 'compliance_first']),
})

const aiModelMappingSchema = z.object({
  role: z.string().min(1).default('default'),
  display_name: z.string().optional(),
  request_model: z.string().default(''),
  context_window: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
})

// Provider 配置验证：只负责连接、认证、模型映射与供应商扩展参数。
export const aiProviderConfigValueSchema = z.object({
  kind: z.literal('provider').optional(),
  level: z.number().int().min(1).max(99),
  name: z.string().min(1),
  instance_id: configKeySchema.optional(),
  profile: z.string().min(1).optional(),
  provider_name: z.string().optional(),
  provider_url: z.string().url().or(z.string().length(0)).optional(),
  provider_kind: z.enum(['openai_compatible', 'lm_studio', 'openai', 'anthropic', 'builtin', 'rule_engine', 'custom']).default('openai_compatible'),
  api_format: z.string().optional(),
  base_url: z.string().url().or(z.string().length(0)).optional().default(''),
  api_key: z.string().optional(),
  model: z.string().optional().default(''),
  model_mappings: z.array(aiModelMappingSchema).optional(),
  capabilities: z.array(z.string()).optional(),
  bound_apps: z.array(z.string()).optional(),
  system_prompt: z.string().optional(),
  fallback_chain: z.array(z.string()).optional(),
  retry_count: z.number().int().min(0).max(10).optional(),
  cost_tracking: z.boolean().optional(),
  json_config: z.record(z.string(), z.unknown()).optional(),
  json_config_text: z.string().optional(),
  timeout_ms: z.number().int().min(1000).max(300000),
  enabled: z.boolean(),
  routing: aiRoutingSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.json_config_text && value.json_config_text.trim()) {
    try {
      JSON.parse(value.json_config_text)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['json_config_text'],
        message: 'JSON 扩展配置不是有效 JSON',
      })
    }
  }

  const isExternalProvider = !['builtin', 'rule_engine'].includes(value.provider_kind)
  if (value.enabled && isExternalProvider && !value.base_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['base_url'],
      message: '启用外部模型 Provider 时必须填写 Base URL',
    })
  }
  if (value.enabled && isExternalProvider && !value.model && !(value.model_mappings || []).some((mapping) => mapping.enabled !== false && mapping.request_model)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: '启用外部模型 Provider 时必须填写默认模型或启用至少一个模型映射',
    })
  }
})

export const aiApplicationConfigValueSchema = z.object({
  kind: z.literal('application'),
  name: z.string().min(1),
  enabled: z.boolean(),
  application_id: z.string().min(1).optional(),
  plan_mode: z.enum(['always_on', 'manual', 'scheduled']).optional(),
  capabilities: z.array(z.string()).optional(),
  bound_tools: z.array(z.string()).optional(),
  system_prompt: z.string().optional(),
  default_policy_key: z.string().optional(),
  json_config: z.record(z.string(), z.unknown()).optional(),
  json_config_text: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.json_config_text?.trim()) {
    try {
      JSON.parse(value.json_config_text)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['json_config_text'],
        message: 'JSON 扩展配置不是有效 JSON',
      })
    }
  }
})

export const aiToolPolicyConfigValueSchema = z.object({
  kind: z.literal('tool_policy'),
  name: z.string().min(1),
  enabled: z.boolean(),
  tool: z.string().min(1),
  capability: z.string().min(1),
  application_key: z.string().optional(),
  strategy: z.enum(['full', 'chunked', 'rule', 'local_first', 'quality_first', 'cost_first', 'compliance_first']),
  priority: z.number().int().min(1).max(999),
  provider_chain: z.array(z.string().min(1)).min(1, '工具策略至少需要一个 Provider'),
  fallback_chain: z.array(z.string()).optional(),
  timeout_ms: z.number().int().min(1000).max(300000),
  retry_count: z.number().int().min(0).max(10).optional(),
  cost_tracking: z.boolean().optional(),
  conditions: z.object({
    min_chars: z.number().int().min(0).optional(),
    max_chars: z.number().int().positive().optional(),
    min_pages: z.number().int().min(1).optional(),
    max_pages: z.number().int().min(1).optional(),
    document_formats: z.array(z.string()).optional(),
    sensitive_data: z.enum(['local_only', 'allow_cloud', 'any']).optional(),
  }).optional(),
  json_config: z.record(z.string(), z.unknown()).optional(),
  json_config_text: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.conditions?.min_chars !== undefined
    && value.conditions?.max_chars !== undefined
    && value.conditions.min_chars > value.conditions.max_chars) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['conditions', 'max_chars'],
      message: '最大字符数不能小于最小字符数',
    })
  }
  if (value.json_config_text?.trim()) {
    try {
      JSON.parse(value.json_config_text)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['json_config_text'],
        message: 'JSON 扩展配置不是有效 JSON',
      })
    }
  }
})

// 同一个 AI_CONFIG 发布通道承载三种可版本化对象；历史无 kind 对象按 Provider 兼容。
export const aiConfigValueSchema = z.union([
  aiProviderConfigValueSchema,
  aiApplicationConfigValueSchema,
  aiToolPolicyConfigValueSchema,
])

// 合同审核规则值验证 (F009)
export const contractRuleValueSchema = z.object({
  pattern: z.string().optional(),
  field: z.string().optional(),
  operator: z.enum(['gt', 'lt', 'eq', 'contains', 'gte', 'lte']).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  prompt: z.string().optional(),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.union([z.string(), z.number()]),
      })
    )
    .optional(),
})

export const uiThemeValueSchema = z.object({
  brandName: z.string().min(1).max(80).optional(),
  brandShortName: z.string().min(1).max(12).optional(),
  productTitle: z.string().min(1).max(120).optional(),
  productSubtitle: z.string().min(1).max(160).optional(),
  loginTitle: z.string().min(1).max(120).optional(),
  loginSubtitle: z.string().min(1).max(160).optional(),
  appearance: z.enum(['system', 'light', 'dark']).optional(),
  brandAssets: z.object({
    fullLogo: z.object({
      light: z.string().url().or(z.literal('')).optional(),
      dark: z.string().url().or(z.literal('')).optional(),
    }).optional(),
    symbol: z.object({
      light: z.string().url().or(z.literal('')).optional(),
      dark: z.string().url().or(z.literal('')).optional(),
    }).optional(),
    favicon: z.string().url().or(z.literal('')).optional(),
  }).optional(),
  logoUrl: z.string().url().or(z.literal('')).optional(),
  faviconUrl: z.string().url().or(z.literal('')).optional(),
  primary: z.string().min(1),
  primaryForeground: z.string().min(1),
  secondary: z.string().min(1),
  secondaryForeground: z.string().min(1),
  background: z.string().min(1),
  foreground: z.string().min(1),
  card: z.string().min(1).optional(),
  cardForeground: z.string().min(1).optional(),
  popover: z.string().min(1).optional(),
  popoverForeground: z.string().min(1).optional(),
  muted: z.string().min(1).optional(),
  mutedForeground: z.string().min(1).optional(),
  border: z.string().min(1),
  input: z.string().min(1),
  ring: z.string().min(1),
  destructive: z.string().min(1),
  destructiveForeground: z.string().min(1).optional(),
  radiusMd: z.number().min(0).max(32),
  radiusLg: z.number().min(0).max(32),
})

// 根据类型验证配置值
export function validateConfigValue(type: ConfigType, value: Record<string, unknown>): {
  valid: boolean
  error?: string
} {
  try {
    switch (type) {
      case 'TAX_RULE':
        taxRuleValueSchema.parse(value)
        break
      case 'APPROVAL_RULE':
        approvalRuleValueSchema.parse(value)
        break
      case 'AI_CONFIG':
        aiConfigValueSchema.parse(value)
        break
      case 'CONTRACT_RULE':
        contractRuleValueSchema.parse(value)
        break
      case 'UI_THEME':
        uiThemeValueSchema.parse(value)
        break
    }
    return { valid: true }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
      return { valid: false, error: issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ') }
    }
    return { valid: false, error: '配置值验证失败' }
  }
}
