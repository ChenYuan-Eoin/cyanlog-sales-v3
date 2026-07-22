export type ContractRuleLifecycle =
  | 'draft'
  | 'needs_translation'
  | 'ready_to_publish'
  | 'published'
  | 'archived'

export type ContractRuleTranslationStatus = 'not_started' | 'needs_ai_translation' | 'ready' | 'failed'
export type ContractRuleEngineType = 'structured' | 'semantic' | 'hybrid'
export type ContractRuleCategory = 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
export type ContractRuleOperator = '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'
export type ContractRuleRiskLevel = 'red' | 'yellow' | 'green'

export interface ContractRuleLatestEvaluation {
  id: string
  status: 'passed' | 'failed' | 'error'
  mode: 'deterministic' | 'model'
  provider: string | null
  degraded: boolean
  created_at: string
}

export interface ContractRuleMessageTemplate {
  comment_template?: string
  evidence_requirement?: string
  exception?: string
  negotiation_guidance?: string
  source_reference?: string
  [key: string]: unknown
}

export interface ContractRuleAsset {
  id: string
  org_id: string
  rule_set_id: string | null
  code: string
  name: string
  description: string | null
  category: ContractRuleCategory
  applicable_scenarios: string[]
  scope: 'org' | 'dept' | 'user'
  level_a_operator: ContractRuleOperator
  level_a_threshold: number | null
  level_a_unit: string | null
  level_a_action: string | null
  level_b_operator: ContractRuleOperator
  level_b_threshold: number | null
  level_b_unit: string | null
  level_b_action: string | null
  level_b_counterparty: string | null
  level_c_operator: ContractRuleOperator
  level_c_threshold: number | null
  level_c_unit: string | null
  level_c_action: string | null
  level_c_message: string | null
  approval_roles: string[]
  version: number
  priority: number
  is_active: boolean
  engine_type: ContractRuleEngineType
  target_field: string | null
  clause_category: string | null
  field_hints: string[]
  semantic_prompt: string | null
  message_template: ContractRuleMessageTemplate
  business_domain: string | null
  risk_level: ContractRuleRiskLevel
  lifecycle_status: ContractRuleLifecycle
  translation_status: ContractRuleTranslationStatus
  translation_notes: string[]
  translation_diff: unknown[]
  translated_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  latest_evaluation?: ContractRuleLatestEvaluation
}

export interface ContractRuleSetAsset {
  id: string
  org_id: string
  name: string
  code: string
  description: string | null
  applicable_scenario: string | null
  priority: number
  is_default: boolean
  is_active: boolean
  version: number
  lifecycle_status: ContractRuleLifecycle
  translation_status: ContractRuleTranslationStatus
  published_at: string | null
  release_note: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  rules: ContractRuleAsset[]
}

export interface ContractRuleAssetHealth {
  blockers: string[]
  warnings: string[]
  publishable: boolean
  testMode: 'deterministic' | 'model_required'
}

export interface ContractRuleAssetSummary {
  published: number
  rules: number
  sets: number
}

export interface ContractRuleEvaluationEvidence {
  evaluation_status: 'passed' | 'failed' | 'error'
  evaluation_run_id: string | null
  provider: string | null
  degraded: boolean
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

export type ContractRuleTestResult =
  | {
      status: 'matched'
      mode: 'deterministic' | 'model'
      level: 'A' | 'B' | 'C'
      action: string | null
      reason: string
      evidence?: ContractRuleEvaluationEvidence
    }
  | {
      status: 'not_matched'
      mode: 'deterministic' | 'model'
      reason: string
      evidence?: ContractRuleEvaluationEvidence
    }
  | {
      status: 'needs_model'
      mode: 'model_required'
      reason: string
      evidence?: ContractRuleEvaluationEvidence
    }
