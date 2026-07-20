// REQ: F009-F012
// PURPOSE: 配置中心类型定义

import type { UIThemeConfigValue } from '@/lib/ui-theme-shared'

export type ConfigType = 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG' | 'UI_THEME'
export type ConfigStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

// 基础配置接口
export interface Config {
  id: string
  key: string
  name: string
  value: Record<string, unknown>
  type: ConfigType
  status: ConfigStatus
  version: number
  description?: string
  org_id?: string
  created_by?: string
  created_at: string
  updated_at: string
}

// 配置版本历史
export interface ConfigVersion {
  id: string
  config_id: string
  version: number
  value: Record<string, unknown>
  status: ConfigStatus
  created_by?: string
  created_at: string
}

// 税率规则值 (F010)
export interface TaxRuleValue {
  code?: string
  name?: string
  rate: number // 0.13 = 13%
  category: string
  region?: string
  effective_date?: string
  enabled: boolean
}

// 审批权限阈值 (F011)
export interface ApprovalThreshold {
  limit: number
  approver_role: string
  enabled: boolean
}

// 审批权限值 (F011)
export interface ApprovalRuleValue {
  rule_type: 'discount' | 'contract'
  thresholds: ApprovalThreshold[]
}

// AI 模型路由配置 (F012)
export interface AIRoutingConfig {
  max_pages: number
  strategy: 'full' | 'chunked' | 'rule'
}

export type AIProviderKind = 'openai_compatible' | 'builtin'
export type AIProfile = 'local_primary' | 'cloud_primary' | 'sales_cloud_backup' | 'rule_engine' | 'custom'
export type AIModelStage =
  | 'structured_rules'
  | 'template_compare'
  | 'semantic_review'
  | 'tender_long_document_parse'
  | 'comment_patch_draft'
  | 'report_summary'
  | 'rule_fallback'

// AI 模型配置值 (F012)
export interface AIConfigValue {
  level: number // 1, 2, 3
  name: string
  profile?: AIProfile | string
  provider_kind?: AIProviderKind
  base_url: string
  api_key?: string // 加密存储，API 返回时脱敏
  model: string
  timeout_ms: number
  enabled: boolean
  routing?: AIRoutingConfig
  stages?: AIModelStage[]
}

/**
 * WP01 AI platform control-plane contract.
 *
 * These assets intentionally stay independent from the legacy AIConfigValue.
 * The legacy shape remains readable by the runtime until WP02 switches the
 * execution path; new platform assets are dark-launched in the configs store.
 */
export const AI_PLATFORM_SCHEMA_VERSION = 'ai-platform.v1' as const

export type AIPlatformAssetKind =
  | 'provider_connection'
  | 'model_catalog_entry'
  | 'ai_application'
  | 'business_use_point'
  | 'application_binding'
  | 'route_policy'

export type LegacyAIConfigKind = 'provider' | 'application' | 'tool_policy'
export type AIConfigKind = AIPlatformAssetKind | LegacyAIConfigKind

export interface AIPlatformAssetBase {
  schema_version: typeof AI_PLATFORM_SCHEMA_VERSION
  kind: AIPlatformAssetKind
  asset_id: string
  enabled: boolean
}

export interface ProviderConnectionValue extends AIPlatformAssetBase {
  kind: 'provider_connection'
  provider_type: 'openai_compatible'
  runtime_location: 'local' | 'cloud'
  auth_mode?: 'none' | 'bearer'
  base_url: string
  api_key?: string
  connection_timeout_ms: number
}

export interface ModelCatalogEntryValue extends AIPlatformAssetBase {
  kind: 'model_catalog_entry'
  provider_connection_id: string
  model_id: string
  capabilities: string[]
  context_window?: number
}

export interface AIApplicationValue extends AIPlatformAssetBase {
  kind: 'ai_application'
  capabilities: string[]
}

export interface BusinessUsePointValue extends AIPlatformAssetBase {
  kind: 'business_use_point'
  module_id: string
  required_capabilities: string[]
}

export interface ApplicationBindingValue extends AIPlatformAssetBase {
  kind: 'application_binding'
  business_use_point_id: string
  ai_application_id: string
}

export interface RoutePolicyValue extends AIPlatformAssetBase {
  kind: 'route_policy'
  ai_application_id: string
  model_catalog_entry_ids: string[]
  strategy: 'ordered_fallback'
  timeout_ms: number
  failure_action: 'manual_review' | 'stop'
}

export type AIPlatformAssetValue =
  | ProviderConnectionValue
  | ModelCatalogEntryValue
  | AIApplicationValue
  | BusinessUsePointValue
  | ApplicationBindingValue
  | RoutePolicyValue

export type UIThemeValue = UIThemeConfigValue

// 合同审核规则值 (F009) - 与现有 Rule 类型兼容
export interface ContractRuleValue {
  pattern?: string
  field?: string
  operator?: 'gt' | 'lt' | 'eq' | 'contains' | 'gte' | 'lte'
  value?: string | number
  prompt?: string // 语义规则用
  conditions?: Array<{
    field: string
    operator: string
    value: string | number
  }>
}

// API DTOs
export interface ConfigCreateDTO {
  key: string
  name: string
  value: Record<string, unknown>
  revision_source_id?: string
  credential_action?: 'reuse' | 'replace' | 'clear'
  type: ConfigType
  description?: string
}

export interface ConfigUpdateDTO {
  name?: string
  value?: Record<string, unknown>
  description?: string
}

export interface ConfigListQuery {
  type?: ConfigType
  status?: ConfigStatus
  org_id?: string
}

// 配置类型元数据
export const CONFIG_TYPE_META: Record<ConfigType, { label: string; description: string }> = {
  CONTRACT_RULE: {
    label: '合同审核规则',
    description: '红绿灯规则、语义规则配置',
  },
  TAX_RULE: {
    label: '税率规则',
    description: '增值税率、报价计算税率配置',
  },
  APPROVAL_RULE: {
    label: '审批权限',
    description: '折扣审批、合同审批权限配置',
  },
  AI_CONFIG: {
    label: 'AI 平台配置',
    description: 'Provider、模型目录、AI 应用、业务用点、绑定与路由',
  },
  UI_THEME: {
    label: '界面主题',
    description: '运行时按钮/表单/卡片主题变量',
  },
}

export const CONFIG_STATUS_META: Record<ConfigStatus, { label: string; className: string }> = {
  DRAFT: {
    label: '草稿',
    className: 'bg-slate-100 text-slate-600',
  },
  PUBLISHED: {
    label: '已发布',
    className: 'bg-emerald-100 text-emerald-700',
  },
  ARCHIVED: {
    label: '已归档',
    className: 'bg-gray-100 text-gray-500',
  },
}
