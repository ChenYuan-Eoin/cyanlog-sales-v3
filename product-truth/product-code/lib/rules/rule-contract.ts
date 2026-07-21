import type {
  ContractProblemCategory,
  ContractRuleCondition,
  ContractRuleConditionOperator,
  ContractRuleContract,
  ContractRuleDecision,
  ContractRuleMissingEvidenceOutcome,
  ContractRuleOutcome,
  ContractRuleProperty,
  ContractRulePropertyOption,
  ContractRulePropertyType,
  ContractRuleRiskLevel,
} from '@/types/rules'
import type { FlexibleRule, LevelOperator, RuleCategory } from './types'

type UnknownRecord = Record<string, unknown>

export type RuleContractAsset = {
  id?: string
  org_id?: string
  code?: string
  name?: string
  description?: string | null
  business_domain?: string | null
  risk_level?: ContractRuleRiskLevel | null
  problem_category_id?: string | null
  problem_category?: ContractProblemCategory | null
  rule_contract?: ContractRuleContract | null
  message_template?: unknown
  category?: RuleCategory
  target_field?: string | null
  clause_category?: string | null
  field_hints?: string[] | null
  level_a?: FlexibleRule['level_a'] | null
  level_b?: FlexibleRule['level_b'] | null
  level_c?: FlexibleRule['level_c'] | null
  level_a_operator?: LevelOperator
  level_a_threshold?: number
  level_a_unit?: string | null
  level_a_action?: string | null
  level_b_operator?: LevelOperator
  level_b_threshold?: number
  level_b_unit?: string | null
  level_b_action?: string | null
  level_b_counterparty?: string | null
  level_c_operator?: LevelOperator
  level_c_threshold?: number
  level_c_unit?: string | null
  level_c_action?: string | null
  level_c_message?: string | null
}

export interface RulePropertyReading {
  property_key: string
  status: 'read' | 'missing' | 'ambiguous' | 'unit_conflict'
  value?: string | number | boolean
  unit?: string
  evidence?: string
  confidence: number
}

export interface RuleContractEvaluation {
  status: 'decided' | 'missing_evidence' | 'no_decision'
  outcome: ContractRuleOutcome
  risk_level: ContractRuleRiskLevel
  decision?: ContractRuleDecision
  readings: Record<string, RulePropertyReading>
  evidence: string[]
  missing_property_keys: string[]
  ambiguous_property_keys: string[]
  unit_conflict_property_keys: string[]
}

/**
 * Runtime-only binding. It is intentionally not part of ContractRuleContract and
 * must never be written back as rule configuration. The business contract says
 * what a rule means; this compiled value only helps runtime locate source clauses.
 */
export interface CompiledRuleContract {
  contract: ContractRuleContract
  source: 'canonical' | 'legacy-adapter'
  locator_terms: string[]
  property_bindings: Array<{
    property: ContractRuleProperty
    locator_terms: string[]
    legacy_target_field?: string
    legacy_category?: RuleCategory
    truthy_terms?: string[]
    falsy_terms?: string[]
  }>
}

const PROPERTY_TYPES = new Set<ContractRulePropertyType>([
  'money',
  'percentage',
  'duration',
  'date',
  'enum',
  'boolean',
  'text',
  'number',
])

const OUTCOMES = new Set<ContractRuleOutcome>(['pass', 'negotiate', 'block', 'manual_review'])
const MISSING_EVIDENCE_OUTCOMES = new Set<ContractRuleMissingEvidenceOutcome>(['manual_review', 'block'])
const CONDITION_OPERATORS = new Set<ContractRuleConditionOperator>([
  '>=',
  '<=',
  '=',
  '>',
  '<',
  'contains',
  'in',
  'exists',
  'not_exists',
])

const PROPERTY_CONDITION_OPERATORS: Record<ContractRulePropertyType, ReadonlySet<ContractRuleConditionOperator>> = {
  money: new Set(['>=', '<=', '=', '>', '<', 'exists', 'not_exists']),
  percentage: new Set(['>=', '<=', '=', '>', '<', 'exists', 'not_exists']),
  duration: new Set(['>=', '<=', '=', '>', '<', 'exists', 'not_exists']),
  date: new Set(['>=', '<=', '=', '>', '<', 'exists', 'not_exists']),
  enum: new Set(['=', 'in', 'exists', 'not_exists']),
  boolean: new Set(['=', 'exists', 'not_exists']),
  text: new Set(['contains', 'exists', 'not_exists']),
  number: new Set(['>=', '<=', '=', '>', '<', 'exists', 'not_exists']),
}

const OUTCOME_RISK: Record<ContractRuleOutcome, ContractRuleRiskLevel> = {
  block: 'red',
  negotiate: 'yellow',
  manual_review: 'yellow',
  pass: 'green',
}

const OUTCOME_PRIORITY: Record<ContractRuleOutcome, number> = {
  block: 3,
  negotiate: 2,
  manual_review: 2,
  pass: 1,
}

const INTERNAL_FIELD_TERMS: Record<string, string[]> = {
  contract_amount: ['合同金额', '合同总额', '合同总价', '总金额', '含税总价'],
  payment_schedule: ['付款节奏', '首付款', '首期款', '预付款', '账期', '尾款'],
  first_payment_rate: ['首付款', '首期款', '首付', '预付款', '定金'],
  payment_term_days: ['账期', '付款期限', '付款周期', '验收后付款'],
  acceptance_silent_days: ['默示验收', '视为验收', '自动验收', '验收异议'],
  confidentiality_years: ['保密期', '保密期限', '保密义务', '永久'],
  warranty_days: ['质保期', '保修期', '质量保证期'],
  auto_renew_notice_days: ['自动续约', '续约通知', '续期通知'],
  termination_notice_days: ['解除通知', '终止通知', '提前通知'],
  liability_cap: ['责任上限', '赔偿上限', '责任总额'],
  breach_penalty_cap: ['违约金', '赔偿上限', '违约责任'],
  tax_rate: ['税率', '增值税税率'],
  warranty_deposit_rate: ['质保金', '质量保证金', '保证金'],
  termination_refund_clause: ['终止退款', '解除退款', '退费', '退款', '未消耗', '未使用'],
  acceptance_failure_clause: ['验收不通过', '验收未通过', '整改', '重交'],
  indirect_loss_clause: ['间接损失', '可得利益', '商誉', '惩罚性赔偿'],
  entity_payment_amount_consistency: ['收款账户', '合同主体', '金额一致', '大写金额'],
  ip_ownership_clause: ['知识产权', '著作权', '专利', '源代码', '成果归属'],
  data_security_clause: ['客户数据', '个人信息', 'AI训练', '跨境', '数据删除'],
  renewal_clause: ['续约', '自动续期', '自动续约'],
  dispute_resolution_clause: ['争议解决', '仲裁', '管辖', '诉讼'],
  change_process_clause: ['合同变更', '变更流程', '补充协议'],
  sla_commitment: ['SLA', '服务等级', '系统可用性', '营业损失', '赔偿责任'],
}

const LEGACY_BOOLEAN_BINDINGS: Record<string, { truthy: string[]; falsy?: string[] }> = {
  termination_refund_clause: {
    truthy: ['不予退还', '不退费', '全额退款'],
    falsy: ['按未消耗退还', '退还未使用', '退还未消耗'],
  },
  acceptance_failure_clause: {
    truthy: ['全额退款', '立即解除', '单方解除', '间接损失'],
    falsy: ['整改', '重交', '修复'],
  },
  indirect_loss_clause: {
    truthy: ['间接损失', '可得利益', '商誉损失', '惩罚性赔偿', '一切损失'],
  },
  entity_payment_amount_consistency: {
    truthy: ['收款账户不一致', '主体不一致', '金额不一致', '大写金额不一致', '另行指定账户'],
  },
  data_security_clause: {
    truthy: ['用于训练', 'AI训练', '跨境', '境外', '无法删除', '永久保留'],
    falsy: ['不得用于训练', '不用于训练', '可以删除', '应当删除'],
  },
  renewal_clause: {
    truthy: ['自动续约', '自动续期', '无权退出', '不得退出', '单方涨价'],
    falsy: ['提前通知', '书面通知', '退出权', '不续约'],
  },
  change_process_clause: {
    truthy: ['口头变更', '单方变更', '无需书面', '电话确认'],
    falsy: ['补充协议', '双方签字', '双方盖章', '书面变更'],
  },
  sla_commitment: {
    truthy: ['营业损失', '承担全部赔偿', '全部赔偿责任', '无限赔偿'],
  },
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeOptions(value: unknown): ContractRulePropertyOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  const options = value.flatMap((candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      return [{ value: candidate.trim(), label: candidate.trim() }]
    }
    const record = asRecord(candidate)
    if (!record || !nonEmptyString(record.value)) return []
    return [{
      value: record.value.trim(),
      label: nonEmptyString(record.label) ? record.label.trim() : record.value.trim(),
    }]
  })
  return options.length > 0 ? options : undefined
}

function normalizeProperty(value: unknown): ContractRuleProperty | null {
  const record = asRecord(value)
  if (!record || !nonEmptyString(record.key) || !nonEmptyString(record.label)) return null
  if (!nonEmptyString(record.type) || !PROPERTY_TYPES.has(record.type as ContractRulePropertyType)) return null
  return {
    key: record.key.trim(),
    label: record.label.trim(),
    description: nonEmptyString(record.description) ? record.description.trim() : undefined,
    type: record.type as ContractRulePropertyType,
    required: record.required !== false,
    unit: nonEmptyString(record.unit) ? record.unit.trim() : undefined,
    currency: nonEmptyString(record.currency) ? record.currency.trim().toUpperCase() : undefined,
    options: normalizeOptions(record.options),
  }
}

function normalizeCondition(value: unknown): ContractRuleCondition | null {
  const record = asRecord(value)
  if (!record || !nonEmptyString(record.property_key)) return null
  if (!nonEmptyString(record.operator) || !CONDITION_OPERATORS.has(record.operator as ContractRuleConditionOperator)) {
    return null
  }
  const condition: ContractRuleCondition = {
    property_key: record.property_key.trim(),
    operator: record.operator as ContractRuleConditionOperator,
  }
  if ('value' in record) {
    condition.value = record.value as ContractRuleCondition['value']
  }
  if (nonEmptyString(record.unit)) condition.unit = record.unit.trim()
  return condition
}

function normalizeDecision(value: unknown): ContractRuleDecision | null {
  const record = asRecord(value)
  if (!record || !nonEmptyString(record.id) || !nonEmptyString(record.label)) return null
  if (!nonEmptyString(record.outcome) || !OUTCOMES.has(record.outcome as ContractRuleOutcome)) return null
  if (!Array.isArray(record.conditions)) return null
  const conditions = record.conditions.map(normalizeCondition)
  if (conditions.some((condition) => !condition)) return null
  return {
    id: record.id.trim(),
    label: record.label.trim(),
    outcome: record.outcome as ContractRuleOutcome,
    priority: finiteNumber(record.priority),
    match: record.match === 'any' ? 'any' : 'all',
    conditions: conditions as ContractRuleCondition[],
    action: nonEmptyString(record.action) ? record.action.trim() : undefined,
    message: nonEmptyString(record.message) ? record.message.trim() : undefined,
  }
}

/** Parse an untrusted JSON value into the canonical v1 business contract. */
export function normalizeRuleContract(value: unknown): ContractRuleContract | null {
  const record = asRecord(value)
  if (!record || record.schema_version !== '1.0') return null
  if (!Array.isArray(record.properties) || !Array.isArray(record.decisions)) return null
  if (!nonEmptyString(record.missing_evidence_outcome)
    || !MISSING_EVIDENCE_OUTCOMES.has(record.missing_evidence_outcome as ContractRuleMissingEvidenceOutcome)) {
    return null
  }

  const properties = record.properties.map(normalizeProperty)
  const decisions = record.decisions.map(normalizeDecision)
  if (properties.some((property) => !property) || decisions.some((decision) => !decision)) return null

  const normalizedProperties = properties as ContractRuleProperty[]
  const keys = new Set<string>()
  for (const property of normalizedProperties) {
    if (keys.has(property.key)) return null
    keys.add(property.key)
  }
  for (const decision of decisions as ContractRuleDecision[]) {
    if (decision.conditions.some((condition) => !keys.has(condition.property_key))) return null
    if (decision.conditions.some((condition) => {
      const property = normalizedProperties.find((candidate) => candidate.key === condition.property_key)
      return !property || !PROPERTY_CONDITION_OPERATORS[property.type].has(condition.operator)
    })) return null
  }

  return {
    schema_version: '1.0',
    properties: normalizedProperties,
    decisions: decisions as ContractRuleDecision[],
    missing_evidence_outcome: record.missing_evidence_outcome as ContractRuleMissingEvidenceOutcome,
  }
}

/** Empty, safe draft used by the rule editor before the first property is added. */
export function createDefaultRuleContract(): ContractRuleContract {
  return {
    schema_version: '1.0',
    properties: [],
    decisions: [],
    missing_evidence_outcome: 'manual_review',
  }
}

function safeKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'rule_value'
}

function legacyPropertyType(category: RuleCategory | undefined): ContractRulePropertyType {
  switch (category) {
    case 'amount': return 'money'
    case 'ratio': return 'percentage'
    case 'duration': return 'duration'
    case 'enum': return 'enum'
    case 'text': return 'text'
    default: return 'text'
  }
}

function normalizeLegacyUnit(value: unknown, type: ContractRulePropertyType): string | undefined {
  if (nonEmptyString(value)) {
    const unit = value.trim().toLowerCase()
    if (unit === 'amount' || unit === 'cny' || unit === 'yuan') return 'CNY'
    if (unit === 'percent' || unit === 'ratio') return 'percent'
    return unit
  }
  if (type === 'money') return 'CNY'
  if (type === 'percentage') return 'percent'
  return undefined
}

function legacyLevel(asset: RuleContractAsset, level: 'a' | 'b' | 'c') {
  const nested = asRecord(asset[`level_${level}` as keyof RuleContractAsset])
  const operator = (nested?.operator || asset[`level_${level}_operator` as keyof RuleContractAsset] || '=') as LevelOperator
  const threshold = finiteNumber(nested?.threshold ?? asset[`level_${level}_threshold` as keyof RuleContractAsset])
  const unit = nested?.unit ?? asset[`level_${level}_unit` as keyof RuleContractAsset]
  const action = nested?.action ?? asset[`level_${level}_action` as keyof RuleContractAsset]
  const message = nested?.message ?? (level === 'c' ? asset.level_c_message : undefined)
  return {
    operator: CONDITION_OPERATORS.has(operator as ContractRuleConditionOperator)
      ? operator as ContractRuleConditionOperator
      : '=',
    threshold,
    unit: nonEmptyString(unit) ? unit : undefined,
    action: nonEmptyString(action) ? action : undefined,
    message: nonEmptyString(message) ? message : undefined,
  }
}

function levelDecision(
  level: 'a' | 'b' | 'c',
  propertyKey: string,
  asset: RuleContractAsset,
  override?: Partial<ContractRuleDecision>
): ContractRuleDecision {
  const config = legacyLevel(asset, level)
  const outcome: ContractRuleOutcome = level === 'c' ? 'block' : level === 'b' ? 'negotiate' : 'pass'
  return {
    id: `legacy_level_${level}`,
    label: level === 'c' ? '红线' : level === 'b' ? '需谈判' : '通过',
    outcome,
    priority: level === 'c' ? 300 : level === 'b' ? 200 : 100,
    match: 'all',
    conditions: [{
      property_key: propertyKey,
      operator: config.operator,
      value: config.threshold,
      unit: config.unit,
    }],
    action: config.action,
    message: config.message,
    ...override,
  }
}

/**
 * Explicit one-way adapter for existing target_field + Level A/B/C assets.
 * New code executes the returned canonical contract; legacy columns never become
 * a second runtime protocol.
 */
export function adaptLegacyRuleAsset(asset: RuleContractAsset): ContractRuleContract {
  const targetField = nonEmptyString(asset.target_field) ? asset.target_field : undefined
  const category = asset.category

  if (targetField === 'payment_schedule') {
    const levelC = legacyLevel(asset, 'c')
    return {
      schema_version: '1.0',
      properties: [
        {
          key: 'first_payment_rate',
          label: '首付款比例',
          type: 'percentage',
          required: false,
          unit: 'percent',
        },
        {
          key: 'payment_term_days',
          label: '付款账期',
          type: 'duration',
          required: false,
          unit: 'day',
        },
      ],
      decisions: [
        {
          id: 'legacy_payment_term_redline',
          label: '账期超过红线',
          outcome: 'block',
          priority: 400,
          match: 'all',
          conditions: [{ property_key: 'payment_term_days', operator: '>', value: 30, unit: 'day' }],
          action: levelC.action,
          message: levelC.message,
        },
        levelDecision('c', 'first_payment_rate', asset),
        levelDecision('b', 'first_payment_rate', asset),
        levelDecision('a', 'first_payment_rate', asset),
      ],
      missing_evidence_outcome: 'manual_review',
    }
  }

  const booleanBinding = targetField ? LEGACY_BOOLEAN_BINDINGS[targetField] : undefined
  if (booleanBinding) {
    const propertyKey = safeKey(targetField || asset.code || 'rule_value')
    return {
      schema_version: '1.0',
      properties: [{
        key: propertyKey,
        label: asset.name || targetField || '风险事实',
        type: 'boolean',
        required: true,
        options: [
          { value: 'true', label: '存在风险事实' },
          { value: 'false', label: '未发现风险事实' },
        ],
      }],
      decisions: [
        {
          id: 'legacy_risk_present',
          label: '风险事实成立',
          outcome: 'block',
          priority: 300,
          match: 'all',
          conditions: [{ property_key: propertyKey, operator: '=', value: true }],
          action: legacyLevel(asset, 'c').action,
          message: legacyLevel(asset, 'c').message,
        },
        {
          id: 'legacy_risk_absent',
          label: '未发现风险事实',
          outcome: 'pass',
          priority: 100,
          match: 'all',
          conditions: [{ property_key: propertyKey, operator: '=', value: false }],
          action: legacyLevel(asset, 'a').action,
        },
      ],
      missing_evidence_outcome: 'manual_review',
    }
  }

  const propertyType = legacyPropertyType(category)
  const propertyKey = safeKey(targetField || category || asset.code || 'rule_value')
  const levelA = legacyLevel(asset, 'a')
  const property: ContractRuleProperty = {
    key: propertyKey,
    label: asset.name || targetField || '规则属性',
    type: propertyType,
    required: true,
    unit: normalizeLegacyUnit(levelA.unit, propertyType),
    currency: propertyType === 'money' ? 'CNY' : undefined,
  }

  return {
    schema_version: '1.0',
    properties: [property],
    decisions: [
      levelDecision('c', propertyKey, asset),
      levelDecision('b', propertyKey, asset),
      levelDecision('a', propertyKey, asset),
    ],
    missing_evidence_outcome: 'manual_review',
  }
}

/** Resolve direct canonical JSON, then a temporary nested draft, then legacy columns. */
export function resolveRuleContract(asset: RuleContractAsset): ContractRuleContract {
  const direct = normalizeRuleContract(asset.rule_contract)
  if (direct && direct.properties.length > 0 && direct.decisions.length > 0) return direct

  // Temporary compatibility for drafts created before rule_contract became a column.
  const nested = normalizeRuleContract(asRecord(asset.message_template)?.rule_contract)
  if (nested && nested.properties.length > 0 && nested.decisions.length > 0) return nested

  return adaptLegacyRuleAsset(asset)
}

export type RuleContractConfigurationStatus = 'canonical_complete' | 'legacy_compatible' | 'incomplete'

export function ruleContractConfigurationStatus(asset: RuleContractAsset): RuleContractConfigurationStatus {
  const directValue = asset.rule_contract
  const nestedValue = asRecord(asset.message_template)?.rule_contract
  const canonical = normalizeRuleContract(directValue) || normalizeRuleContract(nestedValue)
  if (canonical?.properties.length && canonical.decisions.length) return 'canonical_complete'
  if (directValue !== undefined && directValue !== null || nestedValue !== undefined && nestedValue !== null) {
    return 'incomplete'
  }
  // Runtime compatibility is intentionally separate from user-confirmed
  // configuration completeness. A legacy adapter can keep old reviews running,
  // but it must never make the new rule editor or release gate look complete.
  return 'legacy_compatible'
}

export function isResolvedRuleContractComplete(asset: RuleContractAsset): boolean {
  return ruleContractConfigurationStatus(asset) === 'canonical_complete'
}

function termFragments(value: unknown): string[] {
  if (!nonEmptyString(value)) return []
  const full = value.trim()
  const fragments = full
    .split(/[，。；、,;\s/()（）:：\-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 20)
  const stripped = full
    .replace(/(比例|金额|天数|期限|日期|状态|是否|内容|文本)$/u, '')
    .trim()
  return Array.from(new Set([
    ...(full.length <= 24 ? [full] : []),
    ...fragments,
    ...(stripped.length >= 2 && stripped !== full ? [stripped] : []),
  ]))
}

function legacyTerms(asset: RuleContractAsset, property: ContractRuleProperty): string[] {
  const terms = new Set<string>()
  if (nonEmptyString(asset.target_field) && asset.target_field !== 'payment_schedule') {
    for (const term of INTERNAL_FIELD_TERMS[asset.target_field] || []) terms.add(term)
  }
  for (const term of INTERNAL_FIELD_TERMS[property.key] || []) terms.add(term)
  return Array.from(terms)
}

export function compileRuleContract(asset: RuleContractAsset): CompiledRuleContract {
  const directCandidate = normalizeRuleContract(asset.rule_contract)
    || normalizeRuleContract(asRecord(asset.message_template)?.rule_contract)
  const direct = directCandidate
    && directCandidate.properties.length > 0
    && directCandidate.decisions.length > 0
    ? directCandidate
    : null
  const contract = direct || adaptLegacyRuleAsset(asset)
  const source: CompiledRuleContract['source'] = direct ? 'canonical' : 'legacy-adapter'
  const sharedTerms = new Set<string>()

  for (const value of [
    asset.problem_category?.name,
    asset.problem_category?.code,
    asset.name,
    asset.description,
  ]) {
    for (const term of termFragments(value)) sharedTerms.add(term)
  }
  if (source === 'legacy-adapter') {
    for (const hint of asset.field_hints || []) {
      if (nonEmptyString(hint)) sharedTerms.add(hint.trim())
    }
  }

  const propertyBindings = contract.properties.map((property) => {
    const terms = new Set<string>(termFragments(property.label))
    for (const option of property.options || []) {
      for (const term of termFragments(option.label)) terms.add(term)
    }
    for (const term of INTERNAL_FIELD_TERMS[property.key] || []) terms.add(term)
    if (source === 'legacy-adapter') {
      for (const term of legacyTerms(asset, property)) terms.add(term)
    }
    for (const term of terms) sharedTerms.add(term)

    const booleanBinding = source === 'legacy-adapter' && nonEmptyString(asset.target_field)
      ? LEGACY_BOOLEAN_BINDINGS[asset.target_field]
      : undefined
    return {
      property,
      locator_terms: Array.from(terms),
      legacy_target_field: source === 'legacy-adapter' && nonEmptyString(asset.target_field)
        ? asset.target_field
        : property.key,
      legacy_category: source === 'legacy-adapter' ? asset.category : undefined,
      truthy_terms: booleanBinding?.truthy,
      falsy_terms: booleanBinding?.falsy,
    }
  })

  return {
    contract,
    source,
    locator_terms: Array.from(sharedTerms),
    property_bindings: propertyBindings,
  }
}

interface ClauseCandidate {
  text: string
  index: number
  score: number
}

function sourceClauses(sourceText: string): Array<{ text: string; index: number }> {
  const clauses: Array<{ text: string; index: number }> = []
  const pattern = /[^\n。！？；;]+[。！？；;]?/g
  for (const match of sourceText.matchAll(pattern)) {
    const text = match[0].trim()
    if (text) clauses.push({ text, index: match.index || 0 })
  }
  return clauses
}

function includesTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase())
}

function locateClauses(
  sourceText: string,
  propertyTerms: string[],
  sharedTerms: string[]
): ClauseCandidate[] {
  const candidates = sourceClauses(sourceText).map((clause) => {
    const propertyMatches = propertyTerms.filter((term) => includesTerm(clause.text, term)).length
    const sharedMatches = sharedTerms.filter((term) => includesTerm(clause.text, term)).length
    return {
      ...clause,
      score: propertyMatches * 100 + sharedMatches * 10,
    }
  }).filter((candidate) => candidate.score > 0)

  if (candidates.length === 0) return []
  const topScore = Math.max(...candidates.map((candidate) => candidate.score))
  return candidates
    .filter((candidate) => candidate.score === topScore)
    .sort((left, right) => left.index - right.index)
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0,
  一: 1, 壹: 1,
  二: 2, 两: 2, 贰: 2, 兩: 2,
  三: 3, 叁: 3, 參: 3,
  四: 4, 肆: 4,
  五: 5, 伍: 5,
  六: 6, 陆: 6, 陸: 6,
  七: 7, 柒: 7,
  八: 8, 捌: 8,
  九: 9, 玖: 9,
}

const SMALL_UNITS: Record<string, number> = {
  十: 10, 拾: 10,
  百: 100, 佰: 100,
  千: 1000, 仟: 1000,
}

const LARGE_UNITS: Record<string, number> = {
  万: 10000, 萬: 10000,
  亿: 100000000, 億: 100000000,
}

export function parseChineseNumericText(raw: string): number | null {
  const normalized = raw.trim().replace(/[,，\s]/g, '')
  if (!normalized) return null
  const arabic = Number(normalized)
  if (Number.isFinite(arabic)) return arabic

  let total = 0
  let section = 0
  let digit = 0
  let sawToken = false
  for (const char of normalized) {
    if (char in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[char]
      sawToken = true
      continue
    }
    if (char in SMALL_UNITS) {
      const unit = SMALL_UNITS[char]
      section += (digit || 1) * unit
      digit = 0
      sawToken = true
      continue
    }
    if (char in LARGE_UNITS) {
      const unit = LARGE_UNITS[char]
      section += digit
      total += (section || 1) * unit
      section = 0
      digit = 0
      sawToken = true
      continue
    }
    return null
  }
  return sawToken ? total + section + digit : null
}

interface ValueCandidate {
  value: string | number | boolean
  unit?: string
  raw: string
  start: number
  end: number
}

const CHINESE_NUMBER_SOURCE = '零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億兩參陸'

function numericCandidates(text: string, property: ContractRuleProperty): ValueCandidate[] {
  const candidates: ValueCandidate[] = []
  const pushMatches = (
    pattern: RegExp,
    convert: (match: RegExpMatchArray) => { value: number; unit?: string } | null
  ) => {
    for (const match of text.matchAll(pattern)) {
      const converted = convert(match)
      if (!converted) continue
      candidates.push({
        ...converted,
        raw: match[0],
        start: match.index || 0,
        end: (match.index || 0) + match[0].length,
      })
    }
  }

  if (property.type === 'money') {
    const pattern = new RegExp(`(?:(人民币|RMB|CNY|美元|美金|USD|欧元|EUR|[￥¥$€])\\s*)?([0-9][0-9,]*(?:\\.[0-9]+)?|[${CHINESE_NUMBER_SOURCE}]+)\\s*(亿元|万元|亿|万|元|美元|美金|USD|欧元|EUR)?`, 'gi')
    pushMatches(pattern, (match) => {
      const prefix = (match[1] || '').toUpperCase()
      const suffix = (match[3] || '').toUpperCase()
      if (!prefix && !suffix) return null
      const numeric = parseChineseNumericText(match[2])
      if (numeric === null) return null
      const multiplier = match[3] === '亿元' || match[3] === '亿'
        ? 100000000
        : match[3] === '万元' || match[3] === '万'
          ? 10000
          : 1
      const currencySource = `${prefix}:${suffix}`
      const currency = /美元|美金|USD|\$/.test(currencySource)
        ? 'USD'
        : /欧元|EUR|€/.test(currencySource)
          ? 'EUR'
          : 'CNY'
      return { value: numeric * multiplier, unit: currency }
    })
  } else if (property.type === 'percentage') {
    pushMatches(/([0-9]+(?:\.[0-9]+)?)\s*%/g, (match) => ({
      value: Number(match[1]),
      unit: 'percent',
    }))
    const chinesePattern = new RegExp(`百分之([0-9]+(?:\\.[0-9]+)?|[${CHINESE_NUMBER_SOURCE}]+)`, 'g')
    pushMatches(chinesePattern, (match) => {
      const value = parseChineseNumericText(match[1])
      return value === null ? null : { value, unit: 'percent' }
    })
  } else if (property.type === 'duration') {
    if (text.includes('永久')) {
      const start = text.indexOf('永久')
      candidates.push({
        value: Number.MAX_SAFE_INTEGER,
        unit: 'day',
        raw: '永久',
        start,
        end: start + 2,
      })
    }
    const durationPattern = new RegExp(`([0-9]+(?:\\.[0-9]+)?|[${CHINESE_NUMBER_SOURCE}]+)\\s*(?:个)?\\s*(工作日|自然日|天|日|月|年)`, 'g')
    pushMatches(durationPattern, (match) => {
      const value = parseChineseNumericText(match[1])
      if (value === null) return null
      const rawUnit = match[2]
      return {
        value,
        unit: rawUnit === '月' ? 'month' : rawUnit === '年' ? 'year' : 'day',
      }
    })
  } else if (property.type === 'number') {
    pushMatches(/-?[0-9]+(?:\.[0-9]+)?/g, (match) => ({ value: Number(match[0]), unit: property.unit || undefined }))
  }

  return candidates
}

function termPositions(text: string, terms: string[]): number[] {
  const lower = text.toLowerCase()
  const positions: number[] = []
  for (const term of terms) {
    const normalized = term.toLowerCase()
    let index = lower.indexOf(normalized)
    while (index >= 0) {
      positions.push(index)
      index = lower.indexOf(normalized, index + Math.max(1, normalized.length))
    }
  }
  return positions
}

function allPropertyMentionsNegated(text: string, terms: string[]): boolean {
  const negations = ['未约定', '未单独约定', '未明确', '未载明', '未说明', '没有约定', '无约定', '缺失', '不明确', '待定']
  const lower = text.toLowerCase()
  let found = false
  let positive = false
  for (const term of terms) {
    const normalized = term.toLowerCase()
    let index = lower.indexOf(normalized)
    while (index >= 0) {
      found = true
      const window = lower.slice(Math.max(0, index - 12), Math.min(lower.length, index + normalized.length + 8))
      if (!negations.some((negation) => window.includes(negation))) positive = true
      index = lower.indexOf(normalized, index + Math.max(1, normalized.length))
    }
  }
  return found && !positive
}

function selectNumericCandidate(
  text: string,
  candidates: ValueCandidate[],
  terms: string[]
): { status: 'read'; candidate: ValueCandidate } | { status: 'missing' | 'ambiguous' } {
  if (candidates.length === 0) return { status: 'missing' }
  const positions = termPositions(text, terms)
  if (positions.length === 0) {
    const distinct = new Set(candidates.map((candidate) => `${candidate.value}:${candidate.unit || ''}`))
    return distinct.size === 1
      ? { status: 'read', candidate: candidates[0] }
      : { status: 'ambiguous' }
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    distance: Math.min(...positions.map((position) => (
      position <= candidate.start
        ? candidate.start - position
        : position - candidate.end
    ))),
  })).sort((left, right) => left.distance - right.distance || left.candidate.start - right.candidate.start)
  const nearestDistance = scored[0].distance
  const nearest = scored.filter((item) => item.distance === nearestDistance)
  const distinct = new Set(nearest.map((item) => `${item.candidate.value}:${item.candidate.unit || ''}`))
  return distinct.size === 1
    ? { status: 'read', candidate: nearest[0].candidate }
    : { status: 'ambiguous' }
}

function readBoolean(
  text: string,
  property: ContractRuleProperty,
  truthyTerms: string[] = [],
  falsyTerms: string[] = []
): { status: 'read'; value: boolean; raw: string } | { status: 'missing' | 'ambiguous' } {
  const optionTruth = (property.options || [])
    .filter((option) => option.value.toLowerCase() === 'true')
    .map((option) => option.label)
  const optionFalse = (property.options || [])
    .filter((option) => option.value.toLowerCase() === 'false')
    .map((option) => option.label)
  // If the clause uses a question/answer shape such as “是否允许转包：否”,
  // only the answer side expresses the value. The label side merely names the
  // configured property and must not be mistaken for a positive assertion.
  const delimiter = text.search(/[:：]/)
  const assertionText = delimiter >= 0 ? text.slice(delimiter + 1) : text
  const explicitAnswers = Array.from(assertionText.matchAll(/(?:^|[，。；;、,\s])(?:为|系)?\s*(是|否)(?=$|[，。；;、,\s])/g))
    .map((match) => match[1] === '是')
  const trueTerms = [...truthyTerms, ...optionTruth, '存在', '允许', '需要']
  const falseTerms = [...falsyTerms, ...optionFalse, '不存在', '不允许', '无需']
  const matchedFalse = falseTerms.filter((term) => term && includesTerm(assertionText, term))
  // A longer negative phrase such as “不允许” or “不得用于训练” must not
  // simultaneously match its shorter positive substring.
  const matchedTrue = trueTerms.filter((term) => (
    term
    && includesTerm(assertionText, term)
    && !matchedFalse.some((negative) => negative.includes(term))
  ))
  const hasTrue = matchedTrue.length > 0 || explicitAnswers.includes(true)
  const hasFalse = matchedFalse.length > 0 || explicitAnswers.includes(false)
  if (hasTrue && hasFalse) return { status: 'ambiguous' }
  if (explicitAnswers.includes(true)) return { status: 'read', value: true, raw: '是' }
  if (explicitAnswers.includes(false)) return { status: 'read', value: false, raw: '否' }
  if (matchedTrue.length > 0) return { status: 'read', value: true, raw: matchedTrue[0] }
  if (matchedFalse.length > 0) return { status: 'read', value: false, raw: matchedFalse[0] }
  return { status: 'missing' }
}

function readEnum(
  text: string,
  options: ContractRulePropertyOption[]
): { status: 'read'; value: string; raw: string } | { status: 'missing' | 'ambiguous' } {
  const matches = options.filter((option) => (
    includesTerm(text, option.label) || includesTerm(text, option.value)
  ))
  const values = new Set(matches.map((option) => option.value))
  if (values.size === 0) return { status: 'missing' }
  if (values.size > 1) return { status: 'ambiguous' }
  return { status: 'read', value: matches[0].value, raw: matches[0].label }
}

function readDate(text: string): { status: 'read'; value: string; raw: string } | { status: 'missing' | 'ambiguous' } {
  const matches = Array.from(text.matchAll(/(20\d{2})[年\-/](0?[1-9]|1[0-2])[月\-/](0?[1-9]|[12]\d|3[01])日?/g))
  const values = matches.map((match) => ({
    value: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`,
    raw: match[0],
  }))
  const distinct = new Set(values.map((value) => value.value))
  if (distinct.size === 0) return { status: 'missing' }
  if (distinct.size > 1) return { status: 'ambiguous' }
  return { status: 'read', ...values[0] }
}

function readPropertyFromClause(
  clause: string,
  binding: CompiledRuleContract['property_bindings'][number]
): RulePropertyReading {
  const { property } = binding
  if (allPropertyMentionsNegated(clause, binding.locator_terms)) {
    return { property_key: property.key, status: 'missing', confidence: 0 }
  }

  if (['money', 'percentage', 'duration', 'number'].includes(property.type)) {
    const selected = selectNumericCandidate(
      clause,
      numericCandidates(clause, property),
      binding.locator_terms
    )
    if (selected.status !== 'read') {
      return { property_key: property.key, status: selected.status, confidence: 0 }
    }
    if (property.type === 'money'
      && property.currency
      && selected.candidate.unit
      && property.currency.toUpperCase() !== selected.candidate.unit.toUpperCase()) {
      return {
        property_key: property.key,
        status: 'unit_conflict',
        unit: selected.candidate.unit,
        evidence: clause,
        confidence: 0.9,
      }
    }
    return {
      property_key: property.key,
      status: 'read',
      value: selected.candidate.value,
      unit: selected.candidate.unit || property.unit || undefined,
      evidence: clause,
      confidence: 0.9,
    }
  }

  if (property.type === 'boolean') {
    const read = readBoolean(clause, property, binding.truthy_terms, binding.falsy_terms)
    if (read.status !== 'read') return { property_key: property.key, status: read.status, confidence: 0 }
    return {
      property_key: property.key,
      status: 'read',
      value: read.value,
      evidence: clause,
      confidence: 0.85,
    }
  }

  if (property.type === 'enum') {
    const read = readEnum(clause, property.options || [])
    if (read.status !== 'read') return { property_key: property.key, status: read.status, confidence: 0 }
    return {
      property_key: property.key,
      status: 'read',
      value: read.value,
      evidence: clause,
      confidence: 0.85,
    }
  }

  if (property.type === 'date') {
    const read = readDate(clause)
    if (read.status !== 'read') return { property_key: property.key, status: read.status, confidence: 0 }
    return {
      property_key: property.key,
      status: 'read',
      value: read.value,
      evidence: clause,
      confidence: 0.9,
    }
  }

  if (property.type === 'text') {
    return {
      property_key: property.key,
      status: 'read',
      value: clause,
      evidence: clause,
      confidence: 0.75,
    }
  }

  return { property_key: property.key, status: 'missing', confidence: 0 }
}

function readProperty(
  sourceText: string,
  compiled: CompiledRuleContract,
  binding: CompiledRuleContract['property_bindings'][number]
): RulePropertyReading {
  const clauses = locateClauses(sourceText, binding.locator_terms, compiled.locator_terms)
  if (clauses.length === 0) {
    return { property_key: binding.property.key, status: 'missing', confidence: 0 }
  }

  const readings = clauses.map((clause) => readPropertyFromClause(clause.text, binding))
  const successful = readings.filter((reading) => reading.status === 'read')
  const ambiguous = readings.some((reading) => reading.status === 'ambiguous')
  const unitConflict = readings.some((reading) => reading.status === 'unit_conflict')
  if (ambiguous) return { property_key: binding.property.key, status: 'ambiguous', confidence: 0 }
  if (unitConflict) {
    const conflict = readings.find((reading) => reading.status === 'unit_conflict')
    return conflict || { property_key: binding.property.key, status: 'unit_conflict', confidence: 0 }
  }
  if (successful.length === 0) return { property_key: binding.property.key, status: 'missing', confidence: 0 }

  const distinct = new Set(successful.map((reading) => `${String(reading.value)}:${reading.unit || ''}`))
  if (distinct.size > 1) {
    return { property_key: binding.property.key, status: 'ambiguous', confidence: 0 }
  }
  return successful[0]
}

export function normalizeDurationUnit(unit: string | null | undefined): 'day' | 'month' | 'year' | undefined {
  if (!unit) return undefined
  const normalized = unit.trim().toLowerCase()
  if (['day', 'days', 'd', '日', '天', '工作日', '自然日'].includes(normalized)) return 'day'
  if (['month', 'months', 'mon', '月', '个月', '個月'].includes(normalized)) return 'month'
  if (['year', 'years', 'yr', '年'].includes(normalized)) return 'year'
  return undefined
}

function durationInUnit(value: number, sourceUnit: string | undefined, targetUnit: string | undefined): number {
  const source = normalizeDurationUnit(sourceUnit)
  const target = normalizeDurationUnit(targetUnit)
  if (!source || !target || source === target) return value
  const days = source === 'year' ? value * 365 : source === 'month' ? value * 30 : value
  if (target === 'year') return days / 365
  if (target === 'month') return days / 30
  return days
}

function conditionMatches(
  condition: ContractRuleCondition,
  reading: RulePropertyReading | undefined,
  property: ContractRuleProperty | undefined
): boolean {
  if (condition.operator === 'exists') return reading?.status === 'read'
  if (condition.operator === 'not_exists') return !reading || reading.status !== 'read'
  if (!reading || reading.status !== 'read' || reading.value === undefined) return false
  const expected = condition.value
  if (expected === undefined) return false

  if (condition.operator === 'contains') {
    return String(reading.value).includes(String(expected))
  }
  if (condition.operator === 'in') {
    return Array.isArray(expected)
      ? expected.some((value) => String(value) === String(reading.value))
      : String(expected).split(',').map((value) => value.trim()).includes(String(reading.value))
  }

  if (property?.type === 'enum' && condition.operator === '=') {
    const expectedValue = property.options?.find((option) => (
      option.value === String(expected) || option.label === String(expected)
    ))?.value || String(expected)
    return String(reading.value) === expectedValue
  }

  if (typeof reading.value === 'number' && typeof expected === 'number') {
    const actual = property?.type === 'duration'
      ? durationInUnit(reading.value, reading.unit, condition.unit || property.unit || reading.unit)
      : reading.value
    switch (condition.operator) {
      case '>=': return actual >= expected
      case '<=': return actual <= expected
      case '>': return actual > expected
      case '<': return actual < expected
      case '=': return actual === expected
      default: return false
    }
  }

  if (condition.operator === '=') return String(reading.value) === String(expected)
  const left = typeof reading.value === 'string' ? Date.parse(reading.value) : Number(reading.value)
  const right = typeof expected === 'string' ? Date.parse(expected) : Number(expected)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  switch (condition.operator) {
    case '>=': return left >= right
    case '<=': return left <= right
    case '>': return left > right
    case '<': return left < right
    default: return false
  }
}

function sortDecisions(decisions: ContractRuleDecision[]): ContractRuleDecision[] {
  return [...decisions].sort((left, right) => (
    right.priority - left.priority
    || OUTCOME_PRIORITY[right.outcome] - OUTCOME_PRIORITY[left.outcome]
    || left.id.localeCompare(right.id)
  ))
}

export function riskLevelForOutcome(outcome: ContractRuleOutcome): ContractRuleRiskLevel {
  return OUTCOME_RISK[outcome]
}

/**
 * Execute configured decisions against already located, typed property readings.
 * The semantic model may propose a decision id, but only this deterministic
 * function selects the actual outcome.
 */
function evaluatePreparedRuleContractReadings(
  contract: ContractRuleContract,
  suppliedReadings: Record<string, RulePropertyReading>
): RuleContractEvaluation {
  const readings = Object.fromEntries(contract.properties.map((property) => [
    property.key,
    suppliedReadings[property.key] || {
      property_key: property.key,
      status: 'missing' as const,
      confidence: 0,
    },
  ]))
  const missingKeys = contract.properties
    .filter((property) => property.required && readings[property.key]?.status === 'missing')
    .map((property) => property.key)
  const ambiguousKeys = contract.properties
    .filter((property) => readings[property.key]?.status === 'ambiguous')
    .map((property) => property.key)
  const unitConflictKeys = contract.properties
    .filter((property) => readings[property.key]?.status === 'unit_conflict')
    .map((property) => property.key)
  const hasAnyReading = Object.values(readings).some((reading) => reading.status === 'read')
  const propertiesByKey = new Map(contract.properties.map((property) => [property.key, property]))
  const evidence = Array.from(new Set(
    Object.values(readings).flatMap((reading) => reading.evidence ? [reading.evidence] : [])
  ))

  if (missingKeys.length > 0 || ambiguousKeys.length > 0 || unitConflictKeys.length > 0) {
    const outcome = contract.missing_evidence_outcome
    return {
      status: 'missing_evidence',
      outcome,
      risk_level: riskLevelForOutcome(outcome),
      readings,
      evidence,
      missing_property_keys: missingKeys,
      ambiguous_property_keys: ambiguousKeys,
      unit_conflict_property_keys: unitConflictKeys,
    }
  }

  const decision = sortDecisions(contract.decisions).find((candidate) => (
    candidate.match === 'any'
      ? candidate.conditions.some((condition) => conditionMatches(
          condition,
          readings[condition.property_key],
          propertiesByKey.get(condition.property_key)
        ))
      : candidate.conditions.every((condition) => conditionMatches(
          condition,
          readings[condition.property_key],
          propertiesByKey.get(condition.property_key)
        ))
  ))

  if (!decision) {
    const outcome = contract.missing_evidence_outcome
    return {
      status: hasAnyReading ? 'no_decision' : 'missing_evidence',
      outcome,
      risk_level: riskLevelForOutcome(outcome),
      readings,
      evidence,
      missing_property_keys: [],
      ambiguous_property_keys: [],
      unit_conflict_property_keys: [],
    }
  }

  return {
    status: 'decided',
    outcome: decision.outcome,
    risk_level: riskLevelForOutcome(decision.outcome),
    decision,
    readings,
    evidence,
    missing_property_keys: [],
    ambiguous_property_keys: [],
    unit_conflict_property_keys: [],
  }
}

export function evaluateRuleContractReadings(
  contractValue: ContractRuleContract,
  suppliedReadings: Record<string, RulePropertyReading>
): RuleContractEvaluation {
  const contract = normalizeRuleContract(contractValue)
  if (!contract) throw new Error('Invalid canonical rule contract')
  return evaluatePreparedRuleContractReadings(contract, suppliedReadings)
}

/**
 * Whether an all-missing input can reach the contract's generic
 * missing-evidence outcome.
 *
 * Optional properties may deliberately use an explicit `not_exists`
 * decision. In that case absence is a configured business fact with its own
 * decision branch, not generic missing evidence. Release acceptance must test
 * that decision branch and must not invent an unreachable missing-evidence
 * obligation.
 */
export function ruleContractRequiresMissingEvidenceCase(
  contractValue: ContractRuleContract
): boolean {
  const contract = normalizeRuleContract(contractValue)
  if (!contract) return false
  return evaluatePreparedRuleContractReadings(contract, {}).status === 'missing_evidence'
}

/**
 * Execute the canonical business contract. Runtime first locates relevant source
 * clauses, then reads only pre-defined properties inside those clauses.
 */
export function evaluateRuleContract(
  asset: RuleContractAsset,
  sourceText: string
): RuleContractEvaluation {
  const compiled = compileRuleContract(asset)
  const readings = Object.fromEntries(compiled.property_bindings.map((binding) => (
    [binding.property.key, readProperty(sourceText, compiled, binding)]
  )))
  return evaluatePreparedRuleContractReadings(compiled.contract, readings)
}
