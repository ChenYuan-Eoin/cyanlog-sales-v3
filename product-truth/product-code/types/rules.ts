export interface Rule {
  id: string
  name: string
  description: string
  rule_type: 'structured' | 'semantic'
  risk_level: 'red' | 'yellow' | 'green'
  enabled: boolean
  config: {
    pattern?: string
    field?: string
    operator?: 'gt' | 'lt' | 'eq' | 'contains'
    value?: string | number
    prompt?: string
  }
  created_at: string
  updated_at: string
}

export type ContractRuleCategory = 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
export type ContractRuleEngineType = 'structured' | 'semantic' | 'hybrid'
export type ContractRuleOperator = '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'
export type ContractRuleRiskLevel = 'green' | 'yellow' | 'red'
export type ContractRuleLifecycleStatus = 'draft' | 'needs_translation' | 'ready_to_publish' | 'published' | 'archived'
export type ContractRuleTranslationStatus = 'not_started' | 'needs_ai_translation' | 'ready' | 'failed'

export type ContractRuleMessageTemplate = {
  title?: string
  description?: string
  suggestion?: string
  comment?: string
  negotiation_action?: string
  negotiation_required?: boolean
  owner_role?: string
  bottom_line?: string
  levels?: Record<string, string>
  outputs?: Record<string, string>
}

export interface ContractPolicyRule {
  id: string
  org_id: string
  rule_set_id?: string | null
  rule_set_document_id?: string | null
  code: string
  name: string
  description?: string | null
  business_domain?: string | null
  risk_level?: ContractRuleRiskLevel | null
  lifecycle_status?: ContractRuleLifecycleStatus | null
  translation_status?: ContractRuleTranslationStatus | null
  translation_notes?: unknown
  translation_diff?: unknown
  translated_at?: string | null
  translated_by?: string | null
  category: ContractRuleCategory
  engine_type: ContractRuleEngineType
  target_field?: string | null
  clause_category?: string | null
  field_hints?: string[] | null
  semantic_prompt?: string | null
  message_template?: ContractRuleMessageTemplate | null
  applicable_scenarios?: string[] | null
  scope?: 'org' | 'dept' | 'user' | null
  level_a_operator: ContractRuleOperator
  level_a_threshold: number
  level_a_unit?: string | null
  level_a_action?: string | null
  level_b_operator: ContractRuleOperator
  level_b_threshold: number
  level_b_unit?: string | null
  level_b_action?: string | null
  level_b_counterparty?: string | null
  level_c_operator: ContractRuleOperator
  level_c_threshold: number
  level_c_unit?: string | null
  level_c_action?: string | null
  level_c_message?: string | null
  approval_roles?: string[] | null
  priority?: number | null
  version: number
  is_active: boolean
  published_at?: string | null
  created_at: string
  updated_at: string
}

export type ContractRuleSetLifecycleStatus = ContractRuleLifecycleStatus
export type ContractRuleSetTranslationStatus = ContractRuleTranslationStatus

export type ContractRuleSetDocumentStatus = 'draft' | 'translated' | 'published' | 'archived'
export type ContractRuleSetDocumentSourceType = 'markdown' | 'upload' | 'github_reference' | 'manual_note'

export interface ContractRuleSetDocument {
  id: string
  org_id: string
  rule_set_id: string
  title: string
  source_type: ContractRuleSetDocumentSourceType
  source_uri?: string | null
  content_markdown: string
  content_hash: string
  version: number
  status: ContractRuleSetDocumentStatus
  translation_status: ContractRuleSetTranslationStatus
  translation_diff: unknown
  translation_summary: unknown
  last_translation_invocation_id?: string | null
  created_by?: string | null
  updated_by?: string | null
  created_at: string
  updated_at: string
}

export interface ContractRuleSet {
  id: string
  org_id: string
  code: string
  name: string
  description?: string | null
  applicable_scenario?: string | null
  priority?: number | null
  is_default?: boolean | null
  is_active: boolean
  version: number
  lifecycle_status: ContractRuleSetLifecycleStatus
  translation_status: ContractRuleSetTranslationStatus
  published_at?: string | null
  published_by?: string | null
  release_note?: string | null
  metadata?: unknown
  created_by?: string | null
  created_at: string
  updated_at: string
  latest_document?: ContractRuleSetDocument | null
  rule_count?: number
  published_rule_count?: number
  ready_rule_count?: number
  blocked_rule_count?: number
}
