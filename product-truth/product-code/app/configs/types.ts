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
  aiRuntimePolicy?: RuntimePolicy | null
}

export type AIRuntimeState =
  | 'builtin_ready'
  | 'missing_base_url'
  | 'missing_credential'
  | 'unreachable_in_vercel'
  | 'local_health_ok'
  | 'local_cli_ready'
  | 'local_auth_failed'
  | 'local_health_failed'
  | 'local_generation_failed'
  | 'remote_health_ok'
  | 'remote_auth_failed'
  | 'remote_health_failed'
  | 'remote_generation_failed'
  | 'ready_to_call'
  | 'recent_invocation_passed'
  | 'recent_invocation_partial'
  | 'recent_invocation_failed'

export interface RuntimeInvocationSummary {
  id?: string
  provider: string | null
  model: string | null
  status: string | null
  degraded: boolean
  fallback_reason: string | null
  error_message: string | null
  intended_provider_profile?: string | null
  intended_provider_model?: string | null
  requested_provider_profile?: string | null
  requested_provider_model?: string | null
  requested_provider_accepted?: boolean | null
  transport: string | null
  provider_kind: string | null
  attempt_errors: Array<string | null>
  created_at: string | null
}

export interface RuntimeProvider {
  profile: string
  provider_kind: 'openai_compatible' | 'builtin'
  provider: string
  model: string
  runtime_location: 'local' | 'cloud' | 'builtin'
  level: number
  timeout_ms: number
  stages: string[]
  role: 'primary' | 'fallback'
  capabilities: string[]
  health_check_required: boolean
  source_config_id?: string | null
  source_config_key?: string | null
  source_kind?: 'database_config' | 'builtin_rule_engine' | 'missing_database_config'
  source_label?: string
  base_url_configured: boolean
  credential_state: 'configured' | 'missing' | 'not_required'
  runtime_state: AIRuntimeState
  runtime_reason: string
  runtime_action: string | null
  runtime_environment: string
  local_endpoint: boolean
  latest_invocation: RuntimeInvocationSummary | null
  latest_intended_invocation?: RuntimeInvocationSummary | null
  latest_requested_invocation?: RuntimeInvocationSummary | null
  latest_related_invocation?: RuntimeInvocationSummary | null
  latest_tender_invocation?: RuntimeInvocationSummary | null
  latest_tender_intended_invocation?: RuntimeInvocationSummary | null
  latest_tender_requested_invocation?: RuntimeInvocationSummary | null
  tender_runtime?: {
    runtime_state: AIRuntimeState
    runtime_reason: string
    runtime_action: string | null
    runtime_environment: string
    local_endpoint: boolean
  } | null
}

export interface RuntimePolicy {
  id: string
  key: string
  version: number
  status: string
  is_current: boolean
  timeout_ms: number
  routing_policy?: Record<string, unknown>
  fallback_policy?: Record<string, unknown>
  audit_policy?: Record<string, unknown>
  provider_chain: RuntimeProvider[]
  source_config_ids: string[]
  source_summary?: {
    policy_source: 'database_model_policy'
    provider_config_source: 'database_configs'
    form_draft_source: 'browser_form_draft'
    environment_source: 'not_configured' | 'present_not_consumed_by_published_policy'
    environment_keys_present: string[]
  }
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
export type ConfigSectionId = 'trading' | 'contract-ai' | 'ai-platform' | 'org-access' | 'experience'
