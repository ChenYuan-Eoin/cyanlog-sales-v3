import type {
  ContractRuleLifecycleStatus,
  ContractRuleTranslationStatus,
} from '@/types/rules'

type RulePublicationInput = {
  business_domain?: string | null
  risk_level?: string | null
  applicable_scenarios?: string[] | null
  scope?: string | null
  engine_type?: string | null
  target_field?: string | null
  clause_category?: string | null
  field_hints?: string[] | null
  semantic_prompt?: string | null
  message_template?: unknown
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasMessageTemplate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).some((item) => (
    (typeof item === 'string' && item.trim().length > 0)
    || item === true
  ))
}

export function missingRulePublicationFields(rule: RulePublicationInput): string[] {
  const missing: string[] = []
  const engineType = nonEmptyString(rule.engine_type) ? String(rule.engine_type) : 'structured'

  if (!nonEmptyString(rule.business_domain)) missing.push('business_domain')
  if (!nonEmptyString(rule.risk_level)) missing.push('risk_level')
  if (!Array.isArray(rule.applicable_scenarios) || rule.applicable_scenarios.length === 0) {
    missing.push('applicable_scenarios')
  }
  if (!nonEmptyString(rule.scope)) missing.push('scope')
  if (!nonEmptyString(rule.clause_category)) missing.push('clause_category')
  if (!Array.isArray(rule.field_hints) || rule.field_hints.length === 0) missing.push('field_hints')
  if ((engineType === 'structured' || engineType === 'hybrid') && !nonEmptyString(rule.target_field)) {
    missing.push('target_field')
  }
  if ((engineType === 'semantic' || engineType === 'hybrid') && !nonEmptyString(rule.semantic_prompt)) {
    missing.push('semantic_prompt')
  }
  if (!hasMessageTemplate(rule.message_template)) missing.push('message_template')

  return missing
}

export function inferRuleTranslationStatus(rule: RulePublicationInput): ContractRuleTranslationStatus {
  return missingRulePublicationFields(rule).length === 0 ? 'ready' : 'needs_ai_translation'
}

export function inferRuleLifecycleStatus(rule: RulePublicationInput): ContractRuleLifecycleStatus {
  return inferRuleTranslationStatus(rule) === 'ready' ? 'ready_to_publish' : 'needs_translation'
}
