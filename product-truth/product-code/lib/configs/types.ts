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
  strategy: 'full' | 'chunked' | 'rule' | 'local_first' | 'quality_first' | 'cost_first' | 'compliance_first'
}

export type AIProviderKind = 'openai_compatible' | 'lm_studio' | 'openai' | 'anthropic' | 'builtin' | 'rule_engine' | 'custom'
export type AIProfile = 'local_primary' | 'cloud_primary' | 'sales_cloud_backup' | 'rule_engine' | 'custom'
export type AIConfigKind = 'provider' | 'application' | 'tool_policy'

// Provider 只描述“怎么连接模型”。历史记录没有 kind 时按 provider 兼容读取。
export interface AIConfigValue {
  kind?: 'provider'
  level: number // 策略优先级，数值越小越先匹配；不是固定 L1/L2/L3 模型层
  name: string
  instance_id?: string // 运行时稳定身份；策略引用它，不引用配置行 key 或 L1/L2/L3 标签
  profile?: AIProfile | string
  provider_kind?: AIProviderKind
  base_url: string
  api_key?: string // 加密存储，API 返回时脱敏
  model: string
  timeout_ms: number
  enabled: boolean
  provider_name?: string
  provider_url?: string
  api_format?: 'openai_compatible' | 'anthropic_compatible' | 'lm_studio' | 'builtin' | string
  model_mappings?: Array<{
    role: string
    display_name?: string
    request_model: string
    context_window?: number
    enabled?: boolean
  }>
  capabilities?: string[]
  bound_apps?: string[]
  system_prompt?: string
  json_config?: Record<string, unknown>
  json_config_text?: string
  fallback_chain?: string[]
  retry_count?: number
  cost_tracking?: boolean
  routing?: AIRoutingConfig
}

export function getAIProviderInstanceId(
  value: Pick<AIConfigValue, 'instance_id' | 'profile'> | Record<string, unknown> | null | undefined,
  fallbackKey?: string
): string {
  const record = value as Record<string, unknown> | null | undefined
  const instanceId = typeof record?.instance_id === 'string' ? record.instance_id.trim() : ''
  if (instanceId) return instanceId

  const profile = typeof record?.profile === 'string' ? record.profile.trim() : ''
  return profile || fallbackKey?.trim() || ''
}

// 模型应用描述 Agent/计划如何使用模型，不保存连接密钥和降级链。
export interface AIApplicationConfigValue {
  kind: 'application'
  name: string
  enabled: boolean
  application_id?: string
  plan_mode?: 'always_on' | 'manual' | 'scheduled'
  capabilities?: string[]
  bound_tools?: string[]
  system_prompt?: string
  default_policy_key?: string
  json_config?: Record<string, unknown>
  json_config_text?: string
}

export interface AIToolPolicyCondition {
  min_chars?: number
  max_chars?: number
  min_pages?: number
  max_pages?: number
  document_formats?: string[]
  sensitive_data?: 'local_only' | 'allow_cloud' | 'any'
}

// 工具策略描述“哪个业务工具在什么条件下按什么顺序消费 Provider”。
export interface AIToolPolicyConfigValue {
  kind: 'tool_policy'
  name: string
  enabled: boolean
  tool: string
  capability: string
  application_key?: string
  strategy: AIRoutingConfig['strategy']
  priority: number
  provider_chain: string[]
  fallback_chain?: string[]
  timeout_ms: number
  retry_count?: number
  cost_tracking?: boolean
  conditions?: AIToolPolicyCondition
  json_config?: Record<string, unknown>
  json_config_text?: string
}

export type AIConfigRecordValue = AIConfigValue | AIApplicationConfigValue | AIToolPolicyConfigValue

export function getAIConfigKind(value: Record<string, unknown> | null | undefined): AIConfigKind {
  return value?.kind === 'application' || value?.kind === 'tool_policy'
    ? value.kind
    : 'provider'
}

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
    label: 'AI 模型配置',
    description: '本地模型、云端模型连接配置',
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
