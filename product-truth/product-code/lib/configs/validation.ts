// REQ: F009-F012
// PURPOSE: 配置中心数据验证

import { z } from 'zod'
import type { ConfigType } from './types'
import {
  canonicalizeProviderBaseUrl,
  validateProviderEndpointLocation,
} from './provider-endpoint'

// 基础配置验证
export const configKeySchema = z
  .string()
  .min(1, '配置键不能为空')
  .max(100, '配置键过长')
  .regex(/^[A-Z][A-Z0-9_]*$/, '配置键格式错误，应为大写字母+下划线，如 TAX_STANDARD')

export const configCreateSchema = z.object({
  key: configKeySchema,
  name: z.string().min(1, '名称不能为空').max(200, '名称过长'),
  value: z.record(z.string(), z.unknown()),
  type: z.enum(['CONTRACT_RULE', 'TAX_RULE', 'APPROVAL_RULE', 'AI_CONFIG', 'UI_THEME']),
  description: z.string().max(1000).optional(),
  revision_source_id: z.string().trim().min(1).optional(),
  credential_action: z.enum(['reuse', 'replace', 'clear']).optional(),
}).superRefine((value, ctx) => {
  if (Boolean(value.revision_source_id) !== Boolean(value.credential_action)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.revision_source_id ? ['credential_action'] : ['revision_source_id'],
      message: 'Provider 修订必须同时提供来源记录和凭据动作',
    })
  }
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
  strategy: z.enum(['full', 'chunked', 'rule']),
})

export const aiModelStageSchema = z.enum([
  'structured_rules',
  'template_compare',
  'semantic_review',
  'tender_long_document_parse',
  'comment_patch_draft',
  'report_summary',
  'rule_fallback',
])

const aiAssetIdSchema = z
  .string()
  .trim()
  .min(2, '资产 ID 至少 2 个字符')
  .max(100, '资产 ID 过长')
  .regex(/^[a-z][a-z0-9._-]*$/, '资产 ID 只能使用小写字母、数字、点、横线和下划线')

const aiCapabilitySchema = z
  .string()
  .trim()
  .min(2, '能力标识至少 2 个字符')
  .max(80, '能力标识过长')
  .regex(/^[a-z][a-z0-9._-]*$/, '能力标识格式无效')

const aiPlatformBaseShape = {
  schema_version: z.literal('ai-platform.v1'),
  asset_id: aiAssetIdSchema,
  enabled: z.boolean(),
}

export const providerConnectionValueSchema = z.object({
  ...aiPlatformBaseShape,
  kind: z.literal('provider_connection'),
  provider_type: z.literal('openai_compatible'),
  runtime_location: z.enum(['local', 'cloud']),
  auth_mode: z.enum(['none', 'bearer']).optional(),
  base_url: z.string().trim().url('Provider 地址必须是完整 URL')
    .transform((value) => canonicalizeProviderBaseUrl(value)),
  api_key: z.string().min(4).or(z.literal('')).optional(),
  connection_timeout_ms: z.number().int().min(1000).max(300000),
}).strict().superRefine((value, ctx) => {
  const location = validateProviderEndpointLocation(value.base_url, value.runtime_location)
  if (!location.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['base_url'],
      message: location.reason,
    })
  }
  const effectiveAuthMode = value.auth_mode ?? (value.api_key ? 'bearer' : 'none')
  if (effectiveAuthMode === 'none' && value.api_key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['api_key'],
      message: '免认证连接不能保存 Bearer Token',
    })
  }
})

export const modelCatalogEntryValueSchema = z.object({
  ...aiPlatformBaseShape,
  kind: z.literal('model_catalog_entry'),
  provider_connection_id: aiAssetIdSchema,
  model_id: z.string().trim().min(1, '模型 ID 不能为空').max(200),
  capabilities: z.array(aiCapabilitySchema).min(1, '至少选择一项模型能力'),
  context_window: z.number().int().positive().max(10_000_000).optional(),
}).strict()

export const aiApplicationValueSchema = z.object({
  ...aiPlatformBaseShape,
  kind: z.literal('ai_application'),
  capabilities: z.array(aiCapabilitySchema).min(1, '至少定义一项应用能力'),
}).strict()

export const businessUsePointValueSchema = z.object({
  ...aiPlatformBaseShape,
  kind: z.literal('business_use_point'),
  module_id: aiAssetIdSchema,
  required_capabilities: z.array(aiCapabilitySchema).min(1, '至少定义一项所需能力'),
}).strict()

export const applicationBindingValueSchema = z.object({
  ...aiPlatformBaseShape,
  kind: z.literal('application_binding'),
  business_use_point_id: aiAssetIdSchema,
  ai_application_id: aiAssetIdSchema,
}).strict()

export const routePolicyValueSchema = z.object({
  ...aiPlatformBaseShape,
  kind: z.literal('route_policy'),
  ai_application_id: aiAssetIdSchema,
  model_catalog_entry_ids: z.array(aiAssetIdSchema).min(1, '至少选择一个候选模型')
    .refine((items) => new Set(items).size === items.length, '候选模型不能重复'),
  strategy: z.literal('ordered_fallback'),
  timeout_ms: z.number().int().min(1000).max(300000),
  failure_action: z.enum(['manual_review', 'stop']),
}).strict()

export const aiPlatformAssetValueSchema = z.discriminatedUnion('kind', [
  providerConnectionValueSchema,
  modelCatalogEntryValueSchema,
  aiApplicationValueSchema,
  businessUsePointValueSchema,
  applicationBindingValueSchema,
  routePolicyValueSchema,
])

// AI 模型配置值验证 (F012)
export const aiConfigValueSchema = z.object({
  kind: z.literal('provider').optional(),
  level: z.number().int().min(1).max(3),
  name: z.string().min(1),
  profile: z.string().min(1).optional(),
  provider_kind: z.enum(['openai_compatible', 'builtin']).default('openai_compatible'),
  base_url: z.string().url().or(z.string().length(0)),
  api_key: z.string().min(4).or(z.literal('')).optional(),
  model: z.string().min(1),
  timeout_ms: z.number().int().min(1000).max(300000),
  enabled: z.boolean(),
  routing: aiRoutingSchema.optional(),
  stages: z.array(aiModelStageSchema).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.provider_kind === 'openai_compatible' && value.base_url.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['base_url'],
      message: 'OpenAI 兼容模型必须填写 base_url',
    })
  }
  if (value.provider_kind === 'builtin' && value.model !== 'rule-engine') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: '内置 provider 目前仅支持 rule-engine',
    })
  }
})

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

export const anyAIConfigValueSchema = z.union([
  aiPlatformAssetValueSchema,
  aiConfigValueSchema,
])

const aiPlatformKinds = new Set([
  'provider_connection',
  'model_catalog_entry',
  'ai_application',
  'business_use_point',
  'application_binding',
  'route_policy',
])

function parseAIConfigValue(value: Record<string, unknown>) {
  if (typeof value.kind === 'string' && aiPlatformKinds.has(value.kind)) {
    const parsed = aiPlatformAssetValueSchema.parse(value)
    if (parsed.kind === 'provider_connection') {
      return {
        ...parsed,
        auth_mode: parsed.auth_mode ?? (parsed.api_key ? 'bearer' : 'none'),
      }
    }
    return parsed
  }
  return aiConfigValueSchema.parse(value)
}

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
export function parseConfigValue(type: ConfigType, value: Record<string, unknown>): {
  valid: boolean
  data?: Record<string, unknown>
  error?: string
} {
  try {
    let parsed: unknown
    switch (type) {
      case 'TAX_RULE':
        parsed = taxRuleValueSchema.parse(value)
        break
      case 'APPROVAL_RULE':
        parsed = approvalRuleValueSchema.parse(value)
        break
      case 'AI_CONFIG':
        parsed = parseAIConfigValue(value)
        break
      case 'CONTRACT_RULE':
        parsed = contractRuleValueSchema.parse(value)
        break
      case 'UI_THEME':
        parsed = uiThemeValueSchema.parse(value)
        break
    }
    return { valid: true, data: parsed as Record<string, unknown> }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
      return { valid: false, error: issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ') }
    }
    return { valid: false, error: '配置值验证失败' }
  }
}

export function validateConfigValue(type: ConfigType, value: Record<string, unknown>): {
  valid: boolean
  error?: string
} {
  const parsed = parseConfigValue(type, value)
  return parsed.valid ? { valid: true } : { valid: false, error: parsed.error }
}
