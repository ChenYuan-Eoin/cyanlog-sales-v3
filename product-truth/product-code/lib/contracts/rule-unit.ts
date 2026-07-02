type JsonRecord = Record<string, unknown>

export type RuleUnitTranslationStatus =
  | 'ready'
  | 'needs_ai_translation'
  | 'incomplete_source'

export type RuleUnitSourceTrace = {
  owner: 'config_center'
  module: 'F009'
  source_of_truth: 'config_center_published_rule'
  rules_table: 'contract_rules_v2'
  snapshot_table: 'contract_rule_snapshots'
  rule_id: string
  snapshot_id: string | null
}

export type RuleUnit = {
  id: string
  rule_id: string
  code: string
  name: string | null
  business_domain: string | null
  risk_level: string | null
  applicable_scenarios: string[]
  scope: string | null
  version: number
  engine_type: string
  target_field: string | null
  clause_category: string | null
  field_hints: string[]
  semantic_prompt: string | null
  message_template: unknown
  source_trace: RuleUnitSourceTrace
  execution: {
    trigger_conditions: string[]
    risk_conditions: string[]
    exception_conditions: string[]
    evidence_requirements: string[]
    negotiation_action: string
    comment_template: unknown
  }
  translation: {
    status: RuleUnitTranslationStatus
    method: 'configured_fields' | 'ai_required'
    missing_fields: string[]
    notes: string[]
  }
}

export type RuleTranslationGate = {
  source_of_truth: 'config_center_published_rules'
  status: 'ready' | 'needs_ai_translation' | 'failed'
  total: number
  ready: number
  needs_ai_translation: number
  incomplete_source: number
  official_review_allowed: boolean
  blocking_reasons: string[]
}

export type RuleUnitRuleInput = {
  id: string
  code: string
  name?: string | null
  business_domain?: string | null
  risk_level?: string | null
  applicable_scenarios?: string[] | null
  scope?: string | null
  version: number | null
  engine_type: string | null
  target_field: string | null
  clause_category: string | null
  field_hints: string[] | null
  semantic_prompt: string | null
  message_template: unknown
}

export type RuleUnitSnapshotInput = {
  id: string
  rule_id: string
  version: number | null
  status?: string | null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function hasMessageTemplate(value: unknown): boolean {
  const record = asRecord(value)
  const explicitTemplate = [
    record.title,
    record.comment,
    record.suggestion,
    record.negotiation_action,
  ].some((item) => typeof item === 'string' && item.trim().length > 0)

  if (explicitTemplate) return true

  const levels = asRecord(record.levels)
  const outputs = asRecord(record.outputs)
  const hasLevelWording = Object.values(levels).some((item) => (
    typeof item === 'string' && item.trim().length > 0
  ))
  const hasOutputContract = [
    outputs.primary,
    outputs.secondary,
    outputs.comment_author,
  ].some((item) => typeof item === 'string' && item.trim().length > 0)

  return hasLevelWording && hasOutputContract
}

function normalizedEngineType(value: string | null): string {
  return nonEmptyString(value) || 'structured'
}

function needsSemanticPrompt(engineType: string): boolean {
  return engineType === 'semantic' || engineType === 'hybrid'
}

function sourceCompletenessMissing(
  rule: RuleUnitRuleInput,
  snapshot: RuleUnitSnapshotInput | null,
  engineType: string
): string[] {
  const missing: string[] = []
  if (!snapshot || snapshot.status !== 'published') missing.push('published_rule_snapshot')
  if (!nonEmptyString(rule.code)) missing.push('rule_code')
  if (!nonEmptyString(rule.business_domain)) missing.push('business_domain')
  if (!nonEmptyString(rule.risk_level)) missing.push('risk_level')
  if ((rule.applicable_scenarios || []).length === 0) missing.push('applicable_scenarios')
  if (!nonEmptyString(rule.scope)) missing.push('scope')
  if (!nonEmptyString(engineType)) missing.push('engine_type')
  if (!nonEmptyString(rule.clause_category)) missing.push('clause_category')
  if ((rule.field_hints || []).length === 0) missing.push('field_hints')
  return missing
}

function translationMissing(rule: RuleUnitRuleInput, engineType: string): string[] {
  const missing: string[] = []
  if ((engineType === 'structured' || engineType === 'hybrid') && !nonEmptyString(rule.target_field)) {
    missing.push('target_field')
  }
  if (needsSemanticPrompt(engineType) && !nonEmptyString(rule.semantic_prompt)) {
    missing.push('semantic_prompt')
  }
  if (!hasMessageTemplate(rule.message_template)) {
    missing.push('message_template')
  }
  return missing
}

function notesForRule(rule: RuleUnitRuleInput, snapshot: RuleUnitSnapshotInput | null): string[] {
  const notes: string[] = [
    'production source is F009 config center published rule snapshot',
  ]
  if (!snapshot) {
    notes.push('missing published snapshot blocks formal SkillBundle readiness')
  }
  if (!hasMessageTemplate(rule.message_template)) {
    notes.push('comment and negotiation wording still require AI or human translation confirmation')
  }
  return notes
}

export function buildRuleUnit(
  rule: RuleUnitRuleInput,
  snapshot: RuleUnitSnapshotInput | null
): RuleUnit {
  const engineType = normalizedEngineType(rule.engine_type)
  const sourceMissing = sourceCompletenessMissing(rule, snapshot, engineType)
  const translationMissingFields = translationMissing(rule, engineType)
  const status: RuleUnitTranslationStatus = sourceMissing.length > 0
    ? 'incomplete_source'
    : translationMissingFields.length > 0
      ? 'needs_ai_translation'
      : 'ready'
  const version = snapshot?.version ?? rule.version ?? 1

  return {
    id: snapshot?.id || `missing-snapshot:${rule.id}`,
    rule_id: rule.id,
    code: rule.code,
    name: rule.name || null,
    business_domain: rule.business_domain || null,
    risk_level: rule.risk_level || null,
    applicable_scenarios: rule.applicable_scenarios || [],
    scope: rule.scope || null,
    version,
    engine_type: engineType,
    target_field: rule.target_field,
    clause_category: rule.clause_category,
    field_hints: rule.field_hints || [],
    semantic_prompt: rule.semantic_prompt,
    message_template: rule.message_template,
    source_trace: {
      owner: 'config_center',
      module: 'F009',
      source_of_truth: 'config_center_published_rule',
      rules_table: 'contract_rules_v2',
      snapshot_table: 'contract_rule_snapshots',
      rule_id: rule.id,
      snapshot_id: snapshot?.id || null,
    },
    execution: {
      trigger_conditions: rule.field_hints || [],
      risk_conditions: [
        nonEmptyString(rule.semantic_prompt) || `按 ${rule.code} 的结构化字段 ${rule.target_field || '未配置字段'} 判断风险`,
      ],
      exception_conditions: [],
      evidence_requirements: [
        'evidence_text_exact_match',
        'source_range_required_for_word_comment',
      ],
      negotiation_action: nonEmptyString(asRecord(rule.message_template).negotiation_action)
        || (hasMessageTemplate(rule.message_template)
          ? 'use_configured_message_template'
          : 'requires_translation_before_formal_review'),
      comment_template: rule.message_template,
    },
    translation: {
      status,
      method: status === 'ready' ? 'configured_fields' : 'ai_required',
      missing_fields: [...sourceMissing, ...translationMissingFields],
      notes: notesForRule(rule, snapshot),
    },
  }
}

export function buildRuleUnits(
  rules: RuleUnitRuleInput[],
  snapshotsByRuleId: Map<string, RuleUnitSnapshotInput>
): RuleUnit[] {
  return rules.map((rule) => buildRuleUnit(rule, snapshotsByRuleId.get(rule.id) || null))
}

export function summarizeRuleTranslationGate(ruleUnits: RuleUnit[]): RuleTranslationGate {
  const ready = ruleUnits.filter((unit) => unit.translation.status === 'ready').length
  const needsAi = ruleUnits.filter((unit) => unit.translation.status === 'needs_ai_translation').length
  const incomplete = ruleUnits.filter((unit) => unit.translation.status === 'incomplete_source').length
  const blockingReasons: string[] = []

  if (ruleUnits.length === 0) {
    blockingReasons.push('no_published_config_center_rules')
  }
  if (incomplete > 0) {
    blockingReasons.push('rule_source_incomplete')
  }
  if (needsAi > 0) {
    blockingReasons.push('rule_translation_needs_confirmation')
  }

  const status = incomplete > 0 || ruleUnits.length === 0
    ? 'failed'
    : needsAi > 0
      ? 'needs_ai_translation'
      : 'ready'

  return {
    source_of_truth: 'config_center_published_rules',
    status,
    total: ruleUnits.length,
    ready,
    needs_ai_translation: needsAi,
    incomplete_source: incomplete,
    official_review_allowed: status === 'ready',
    blocking_reasons: blockingReasons,
  }
}
