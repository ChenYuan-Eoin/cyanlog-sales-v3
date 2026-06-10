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
