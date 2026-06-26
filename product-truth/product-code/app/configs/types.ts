// configs/types.ts - 配置中心类型定义
// 从 ConfigsClient.tsx 提取

export interface Config {
  id: string
  key: string
  name: string
  value: Record<string, unknown>
  type: 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG' | 'UI_THEME'
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  version: number
  description?: string
  created_at: string
  updated_at: string
}

export interface ProductPriceTier {
  id?: string
  qty_from: number
  qty_to: number | null
  unit_price: number
  sort_order?: number
}

export interface ProductRecord {
  id: string
  code: string
  name: string
  specification?: string | null
  unit?: string | null
  base_price: number
  cost_price?: number | null
  min_price?: number | null
  tier_pricing_enabled: boolean
  status: 'active' | 'inactive' | 'discontinued'
  product_categories?: { name: string } | null
  product_price_tiers?: ProductPriceTier[]
}

import type { ContractPolicyRule } from '@/types/rules'

export interface ConfigsInitialData {
  products?: ProductRecord[]
  rules?: ContractPolicyRule[]
  roles?: unknown[]
  configs?: Config[]
}

export interface ScopedRoleAssignment {
  roleId: string
  roleName: string
  roleCode: string
  scopeType: 'org' | 'department' | 'space'
  scopeId: string | null
  scopeName: string
  grantedAt: string | null
}

export interface OrgSummaryUser {
  id: string
  email: string
  display_name: string
  title: string
  primary_dept_name: string
  primary_dept_id?: string | null
  role_names: string
  role_ids?: string[]
  role_codes?: string[]
  scoped_roles?: ScopedRoleAssignment[]
  status: string
  must_change_password: boolean
  login_enabled?: boolean
  report_to_user_id?: string | null
  report_to_user_name?: string | null
}

export interface OrgSummaryDepartment {
  id: string
  name: string
  code?: string | null
  depth?: number
  parent_id?: string | null
  parent_name: string | null
  member_count: number
  leader_id?: string | null
  leader_name?: string | null
}

export interface OrgSummaryRole {
  id: string
  code: string
  name: string
}

export interface OrgSummarySpace {
  id: string
  name: string
  description?: string | null
  department_id: string
  department_name: string
  owner_id?: string | null
}

export interface OrgSummaryPayload {
  organization?: {
    id: string
    name: string
    slug?: string | null
  }
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  roles: OrgSummaryRole[]
  spaces: OrgSummarySpace[]
}

export type FeishuSyncFeedbackStatus = 'success' | 'warning' | 'error'

export interface FeishuSyncFeedback {
  status: FeishuSyncFeedbackStatus
  title: string
  message: string
  detail?: string
}

export interface PermissionCatalogItem {
  key: string
  label: string
  description: string
}

export interface PermissionCatalogGroup {
  id: string
  label: string
  description: string
  items: PermissionCatalogItem[]
}

export type ConfigTabId = 'price-list' | 'rules' | 'tax' | 'approval' | 'ai' | 'theme' | 'org-structure' | 'role-access'
export type ConfigSectionId = 'trading' | 'contract-ai' | 'org-access' | 'experience'
