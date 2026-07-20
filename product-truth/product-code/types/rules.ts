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

/**
 * 规则的单层业务分类。分类回答“这是哪一类业务问题”，不承担字段类型、
 * 执行引擎或为了展示而生的树形层级职责。
 */
export interface ContractProblemCategory {
  id: string
  org_id: string
  code: string
  name: string
  description?: string | null
  sort_order?: number | null
  is_active?: boolean | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

export type ContractRulePropertyType =
  | 'money'
  | 'percentage'
  | 'duration'
  | 'date'
  | 'enum'
  | 'boolean'
  | 'text'
  | 'number'

export type ContractRuleOutcome = 'pass' | 'negotiate' | 'block' | 'manual_review'
export type ContractRuleMissingEvidenceOutcome = 'manual_review' | 'block'

export type ContractRuleConditionOperator =
  | '>='
  | '<='
  | '='
  | '>'
  | '<'
  | 'contains'
  | 'in'
  | 'exists'
  | 'not_exists'

export type ContractRuleScalarValue = string | number | boolean
export type ContractRuleConditionValue = ContractRuleScalarValue | string[] | number[]

export interface ContractRulePropertyOption {
  value: string
  label: string
}

/**
 * 规则详情中的业务属性定义。key 是稳定引用，label 是用户可读名称。
 * 属性由规则作者预先定义；运行时只读取这些属性，不动态创造属性。
 */
export interface ContractRuleProperty {
  key: string
  label: string
  description?: string | null
  type: ContractRulePropertyType
  required: boolean
  unit?: string | null
  currency?: string | null
  options?: ContractRulePropertyOption[] | null
}

export interface ContractRuleCondition {
  property_key: string
  operator: ContractRuleConditionOperator
  value?: ContractRuleConditionValue
  unit?: string | null
}

export interface ContractRuleDecision {
  id: string
  label: string
  outcome: ContractRuleOutcome
  priority: number
  match: 'all' | 'any'
  conditions: ContractRuleCondition[]
  action?: string | null
  message?: string | null
}

/**
 * 规则运行唯一业务协议。问题分类属于规则关系，不重复嵌入这里；条款定位、
 * 模型、Prompt 和旧 target_field 等运行细节也不属于可配置合同。
 */
export interface ContractRuleContract {
  schema_version: '1.0'
  properties: ContractRuleProperty[]
  decisions: ContractRuleDecision[]
  missing_evidence_outcome: ContractRuleMissingEvidenceOutcome
}

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
  problem_category_id?: string | null
  problem_category?: ContractProblemCategory | null
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
  rule_contract?: ContractRuleContract | null
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
