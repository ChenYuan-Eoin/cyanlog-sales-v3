import type {
  ContractRuleContract,
  ContractRuleLifecycleStatus,
  ContractRuleTranslationStatus,
} from '@/types/rules'
import { normalizeRuleContract } from '@/lib/rules/rule-contract'

type RulePublicationInput = {
  code?: string | null
  name?: string | null
  rule_set_id?: string | null
  problem_category_id?: string | null
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
  rule_contract?: ContractRuleContract | null | unknown
  is_active?: boolean | null
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Transitional snapshots may carry the canonical contract either in the
 * dedicated column or inside the old message_template envelope. Presence is
 * enough to select the canonical release path: an invalid canonical draft must
 * fail closed instead of falling through to the legacy single-rule publisher.
 */
export function hasCanonicalRuleDefinition(rule: RulePublicationInput): boolean {
  const nested = asRecord(rule.message_template)?.rule_contract
  return rule.rule_contract !== undefined && rule.rule_contract !== null
    || nested !== undefined && nested !== null
}

function canonicalRuleContract(rule: RulePublicationInput) {
  return normalizeRuleContract(rule.rule_contract)
    || normalizeRuleContract(asRecord(rule.message_template)?.rule_contract)
}

export function missingRulePublicationFields(rule: RulePublicationInput): string[] {
  const missing: string[] = []

  // Canonical rules are business contracts. Their publication must never be
  // blocked by compatibility columns that the user no longer configures.
  if (hasCanonicalRuleDefinition(rule)) {
    const contract = canonicalRuleContract(rule)
    if (!nonEmptyString(rule.code)) missing.push('code')
    if (!nonEmptyString(rule.name)) missing.push('name')
    if (!nonEmptyString(rule.rule_set_id)) missing.push('rule_set_id')
    if (!nonEmptyString(rule.problem_category_id)) missing.push('problem_category_id')
    if (!nonEmptyString(rule.business_domain)) missing.push('business_domain')
    if (!Array.isArray(rule.applicable_scenarios) || rule.applicable_scenarios.length === 0) {
      missing.push('applicable_scenarios')
    }
    if (!nonEmptyString(rule.scope)) missing.push('scope')
    if (rule.is_active !== true) missing.push('is_active')
    if (!contract || contract.properties.length === 0 || contract.decisions.length === 0) {
      missing.push('rule_contract')
      return Array.from(new Set(missing))
    }
    if (contract.properties.some((property) => property.type === 'money' && !nonEmptyString(property.currency))) {
      missing.push('rule_contract.money.currency')
    }
    if (contract.properties.some((property) => property.type === 'enum' && !property.options?.length)) {
      missing.push('rule_contract.enum.options')
    }
    if (!contract.decisions.some((decision) => decision.outcome !== 'pass')) {
      missing.push('rule_contract.risk_decision')
    }
    if (contract.decisions.some((decision) => (
      decision.outcome !== 'pass'
      && (!nonEmptyString(decision.action) || !nonEmptyString(decision.message))
    ))) {
      missing.push('rule_contract.risk_handling')
    }
    return Array.from(new Set(missing))
  }

  // NULL remains the explicit legacy boundary. Only genuinely old snapshots
  // use the old technical publication gate.
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
