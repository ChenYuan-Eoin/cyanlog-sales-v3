// lib/validation/ai-output.ts
// AI输出格式校验 — Zod Schema + 自动重试机制
// AI输出不可控，用Schema校验保证前端拿到合法JSON，失败自动重试

import { z } from 'zod'
import {
  evaluateRuleContractReadings,
  normalizeDurationUnit,
  normalizeRuleContract,
  riskLevelForOutcome,
  type RulePropertyReading,
} from '@/lib/rules/rule-contract'
import type { ContractRuleContract, ContractRuleProperty } from '@/types/rules'

// ─── Zod Schema定义 ─────────────────────────────────────

const RiskLevelSchema = z.enum(['red', 'yellow', 'green'])

const PropertyReadingSchema = z.object({
  propertyKey: z.string().min(1),
  status: z.enum(['read', 'missing', 'ambiguous', 'unit_conflict']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  unit: z.string().min(1).optional(),
  evidence: z.string().min(2).optional(),
  confidence: z.number().min(0).max(1),
})

const RiskSchema = z.object({
  ruleId: z.string().optional(),
  ruleCode: z.string().min(1),
  ruleVersion: z.number().optional(),
  decisionId: z.string().min(1).optional(),
  propertyReadings: z.array(PropertyReadingSchema).max(30).optional(),
  level: RiskLevelSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  suggestion: z.string().min(1).max(1000),
  counterparty: z.string().optional(),
  evidence: z.array(z.string().min(2)),
})

const RawRiskSchema = z.object({
  ruleId: z.string().optional(),
  ruleCode: z.string().min(1),
  ruleVersion: z.number().optional(),
  decisionId: z.string().min(1).optional(),
  propertyReadings: z.array(PropertyReadingSchema).max(30).optional(),
  level: RiskLevelSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  suggestion: z.string().min(1).max(1000).optional(),
  counterparty: z.string().optional(),
  evidence: z.array(z.string().min(2)).min(1).optional(),
})

const RawAIReviewOutputSchema = z.object({
  risks: z.array(RawRiskSchema).max(50),
  summary: z.string().min(1).max(5000),
})

export const AIReviewOutputSchema = z.object({
  risks: z.array(RiskSchema).max(50), // 最多50个风险点
  summary: z.string().min(1).max(5000),
})

export type AIReviewOutput = z.infer<typeof AIReviewOutputSchema>
type RawAIReviewOutput = z.infer<typeof RawAIReviewOutputSchema>
type RawRisk = RawAIReviewOutput['risks'][number]

// ─── 参数约束配置 ─────────────────────────────────────────

export interface AIParameterConstraints {
  temperature: { min: number; max: number; default: number }
  maxOutputTokens: { min: number; max: number; default: number }
  topP: { min: number; max: number; default: number }
}

export const DEFAULT_CONSTRAINTS: AIParameterConstraints = {
  temperature: { min: 0.1, max: 1.0, default: 0.3 },
  maxOutputTokens: { min: 100, max: 8000, default: 4000 },
  topP: { min: 0.1, max: 1.0, default: 0.9 },
}

/**
 * 校验并修正参数
 * 防止前端传非法参数导致AI输出异常
 */
export function constrainParameters(
  params: Partial<{ temperature: number; maxOutputTokens: number; topP: number }>
): { temperature: number; maxOutputTokens: number; topP: number } {
  const clamp = (value: number | undefined, min: number, max: number, defaultValue: number): number => {
    if (value === undefined || Number.isNaN(value)) return defaultValue
    return Math.max(min, Math.min(max, value))
  }

  return {
    temperature: clamp(params.temperature, DEFAULT_CONSTRAINTS.temperature.min, DEFAULT_CONSTRAINTS.temperature.max, DEFAULT_CONSTRAINTS.temperature.default),
    maxOutputTokens: clamp(params.maxOutputTokens, DEFAULT_CONSTRAINTS.maxOutputTokens.min, DEFAULT_CONSTRAINTS.maxOutputTokens.max, DEFAULT_CONSTRAINTS.maxOutputTokens.default),
    topP: clamp(params.topP, DEFAULT_CONSTRAINTS.topP.min, DEFAULT_CONSTRAINTS.topP.max, DEFAULT_CONSTRAINTS.topP.default),
  }
}

// ─── 输出校验 + 自动重试 ──────────────────────────────────

export interface ValidationResult {
  valid: boolean
  data?: AIReviewOutput
  error?: string
  retryable: boolean
  warnings?: string[]
  droppedRisks?: number
}

export type RuntimeRuleConstraint = {
  code?: string | null
  version?: number | null
  clause_category?: string | null
  target_field?: string | null
  field_hints?: string[] | null
  execution_protocol?: 'rule_contract_v1' | 'legacy_adapter' | null
  rule_contract?: ContractRuleContract | null
}

export type AIOutputRuntimeConstraints = {
  contractText?: string
  rules?: RuntimeRuleConstraint[]
  requireEvidenceInSource?: boolean
  requireRuleEvidenceHint?: boolean
  allowPartialRiskAcceptance?: boolean
}

const MAX_RETRIES = 3

/**
 * 校验AI输出并自动重试
 * 校验失败时自动重试，最多3次，重试失败降级到规则引擎
 */
export async function validateAIOutputWithRetry(
  rawOutput: string,
  retryFn?: () => Promise<string>,
  constraints?: AIOutputRuntimeConstraints
): Promise<ValidationResult> {
  let lastError = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const textToValidate = attempt === 0 ? rawOutput : await retryFn?.()

    if (!textToValidate) {
      return { valid: false, error: 'No output to validate', retryable: false }
    }

    const result = validateAIOutput(textToValidate, constraints)

    if (result.valid) {
      return result
    }

    lastError = result.error || 'Unknown validation error'

    // 如果是结构性错误（如缺少字段），重试
    // 如果是内容性错误（如字段类型不对），也重试
    if (result.retryable && attempt < MAX_RETRIES) {
      console.warn(`[AI Validation] Attempt ${attempt + 1} failed, retrying...: ${lastError}`)
      continue
    }

    // 不可重试或重试次数用完
    return { valid: false, error: lastError, retryable: false }
  }

  return { valid: false, error: `Validation failed after ${MAX_RETRIES} retries: ${lastError}`, retryable: false }
}

/**
 * 单次校验AI输出
 */
export function validateAIOutput(
  rawOutput: string,
  constraints: AIOutputRuntimeConstraints = {}
): ValidationResult {
  try {
    // 尝试从文本中提取JSON
    const jsonStr = extractJSON(rawOutput)
    if (!jsonStr) {
      return { valid: false, error: 'No JSON found in output', retryable: true }
    }

    const parsed = JSON.parse(jsonStr)
    const validated = RawAIReviewOutputSchema.safeParse(parsed)

    if (validated.success) {
      const runtimeValidation = validateRuntimeConstraints(validated.data, constraints)
      if (!runtimeValidation.valid) {
        return runtimeValidation
      }
      return runtimeValidation
    }

    // 分析错误类型，决定是否可重试
    const errors = validated.error.issues
    const isRetryable = errors.some((e: { message: string }) => {
      // 缺少字段 → 可重试（可能是流式输出截断）
      if (e.message.includes('Required')) return true
      // 类型错误 → 可重试（可能是模型幻觉）
      if (e.message.includes('Expected')) return true
      return false
    })

    return {
      valid: false,
      error: `Schema validation failed: ${validated.error.issues.map((e) => `${String(e.path)}: ${e.message}`).join('; ')}`,
      retryable: isRetryable,
    }
  } catch (err) {
    return {
      valid: false,
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    }
  }
}

function normalizeRuleCode(value: string | null | undefined) {
  return (value || '').trim().toUpperCase().replace(/@V\d+$/, '')
}

function normalizeEvidenceText(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[，。；：、,.!?！？;:（）()【】\[\]《》"“”'‘’]/g, '')
    .toLowerCase()
}

function sourceContainsEvidence(source: string, evidence: string) {
  const trimmed = evidence.trim()
  if (trimmed.length === 0) return false
  if (source.includes(trimmed)) return true
  const normalizedSource = normalizeEvidenceText(source)
  const normalizedEvidence = normalizeEvidenceText(trimmed)
  return normalizedEvidence.length >= 6 && normalizedSource.includes(normalizedEvidence)
}

function meaningfulEvidence(evidence: string) {
  const normalized = normalizeEvidenceText(evidence)
  if (normalized.length < 6) return false
  if (/^\d+(\.\d+)?%?$/.test(normalized)) return false
  return true
}

function ruleHints(rule: RuntimeRuleConstraint | undefined) {
  if (!rule) return []
  const canonical = normalizeRuleContract(rule.rule_contract)
  if (canonical) {
    return canonical.properties.flatMap((property) => [
      property.label,
      property.description,
      ...(property.options || []).flatMap((option) => [option.label, option.value]),
    ])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalizeEvidenceText)
      .filter((value) => value.length >= 2)
  }
  return [
    ...(Array.isArray(rule.field_hints) ? rule.field_hints : []),
    rule.clause_category,
    rule.target_field,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeEvidenceText)
    .filter((value) => value.length >= 2)
}

function evidenceMatchesRuleHints(evidenceItems: string[], rule: RuntimeRuleConstraint | undefined) {
  const hints = ruleHints(rule)
  if (hints.length === 0) return true
  return evidenceItems.some((evidence) => {
    const normalizedEvidence = normalizeEvidenceText(evidence)
    return hints.some((hint) => normalizedEvidence.includes(hint))
  })
}

function unitsEqual(left: string | undefined, right: string | undefined) {
  if (!left || !right) return left === right
  return left.trim().toUpperCase() === right.trim().toUpperCase()
}

function validateReadingValue(
  property: ContractRuleProperty,
  rawValue: string | number | boolean | undefined,
  rawUnit: string | undefined,
  path: string
): { errors: string[]; value?: string | number | boolean; unit?: string } {
  const errors: string[] = []
  let value = rawValue
  let unit = rawUnit?.trim()

  if (value === undefined) {
    return { errors: [`${path}.value: read status requires a typed value`] }
  }

  if (['money', 'percentage', 'duration', 'number'].includes(property.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path}.value: ${property.type} requires a finite number`)
    }
  } else if (property.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}.value: boolean requires true or false`)
  } else if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path}.value: ${property.type} requires a non-empty string`)
  }

  if (property.type === 'money') {
    const expected = property.currency || property.unit || undefined
    if (!unit) errors.push(`${path}.unit: money requires an explicit currency`)
    if (expected && unit && !unitsEqual(unit, expected)) {
      errors.push(`${path}.unit: expected ${expected} for ${property.key}`)
    }
    unit = unit?.toUpperCase()
  } else if (property.type === 'percentage') {
    const expected = property.unit || 'percent'
    if (!unit || !unitsEqual(unit, expected)) {
      errors.push(`${path}.unit: expected ${expected} for ${property.key}`)
    }
    unit = 'percent'
  } else if (property.type === 'duration') {
    const normalized = normalizeDurationUnit(unit)
    if (!normalized) errors.push(`${path}.unit: duration requires day, month, or year`)
    unit = normalized
  } else if (property.type === 'number') {
    if (property.unit && !unitsEqual(unit, property.unit)) {
      errors.push(`${path}.unit: expected ${property.unit} for ${property.key}`)
    } else if (!property.unit && unit) {
      errors.push(`${path}.unit: ${property.key} has no configured unit`)
    }
  } else if (unit) {
    errors.push(`${path}.unit: ${property.type} does not accept a unit`)
  }

  if (property.type === 'enum' && typeof value === 'string') {
    const option = property.options?.find((candidate) => (
      candidate.value === value || candidate.label === value
    ))
    if (!option) errors.push(`${path}.value: value is not a configured option for ${property.key}`)
    else value = option.value
  }

  if (property.type === 'date' && typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${path}.value: date must use YYYY-MM-DD`)
  }

  return { errors, value, unit }
}

function validateCanonicalRisk(input: {
  risk: RawRisk
  rule: RuntimeRuleConstraint
  canonical: ContractRuleContract
  index: number
  constraints: AIOutputRuntimeConstraints
}): { errors: string[]; normalized?: AIReviewOutput['risks'][number] } {
  const { risk, rule, canonical, index, constraints } = input
  const path = `risks.${index}`
  const errors: string[] = []
  const propertyByKey = new Map(canonical.properties.map((property) => [property.key, property]))
  const rawReadings = risk.propertyReadings || []
  const seenKeys = new Set<string>()
  const readings: Record<string, RulePropertyReading> = {}
  const normalizedReadings: NonNullable<AIReviewOutput['risks'][number]['propertyReadings']> = []

  if (rawReadings.length === 0) errors.push(`${path}.propertyReadings: canonical output requires typed readings`)

  rawReadings.forEach((rawReading, readingIndex) => {
    const readingPath = `${path}.propertyReadings.${readingIndex}`
    const property = propertyByKey.get(rawReading.propertyKey)
    if (!property) {
      errors.push(`${readingPath}.propertyKey: ${rawReading.propertyKey} is not defined by rule_contract`)
      return
    }
    if (seenKeys.has(rawReading.propertyKey)) {
      errors.push(`${readingPath}.propertyKey: duplicate reading for ${rawReading.propertyKey}`)
      return
    }
    seenKeys.add(rawReading.propertyKey)

    const evidence = rawReading.evidence?.trim()
    const evidenceRequired = rawReading.status !== 'missing'
    if (evidenceRequired && (!evidence || !meaningfulEvidence(evidence))) {
      errors.push(`${readingPath}.evidence: reading requires meaningful source evidence`)
    } else if (evidence && !meaningfulEvidence(evidence)) {
      errors.push(`${readingPath}.evidence: reading evidence is too short or generic`)
    } else if (evidence && !constraints.contractText) {
      errors.push(`${readingPath}.evidence: contract source is required to validate continuous evidence`)
    } else if (evidence && constraints.contractText && !constraints.contractText.includes(evidence)) {
      errors.push(`${readingPath}.evidence: evidence is not a continuous source fragment`)
    }

    let value = rawReading.value
    let unit = rawReading.unit
    if (rawReading.status === 'read') {
      const validatedValue = validateReadingValue(property, value, unit, readingPath)
      errors.push(...validatedValue.errors)
      value = validatedValue.value
      unit = validatedValue.unit
    } else if (value !== undefined) {
      errors.push(`${readingPath}.value: ${rawReading.status} status must not provide a decided value`)
    }

    const reading: RulePropertyReading = {
      property_key: rawReading.propertyKey,
      status: rawReading.status,
      confidence: rawReading.confidence,
      ...(value !== undefined ? { value } : {}),
      ...(unit ? { unit } : {}),
      ...(evidence ? { evidence } : {}),
    }
    readings[property.key] = reading
    normalizedReadings.push({
      propertyKey: property.key,
      status: reading.status,
      confidence: reading.confidence,
      ...(reading.value !== undefined ? { value: reading.value } : {}),
      ...(reading.unit ? { unit: reading.unit } : {}),
      ...(reading.evidence ? { evidence: reading.evidence } : {}),
    })
  })

  for (const property of canonical.properties) {
    if (!seenKeys.has(property.key)) {
      errors.push(`${path}.propertyReadings: missing defined property ${property.key}`)
    }
  }

  if (errors.length > 0) return { errors }

  const evaluation = evaluateRuleContractReadings(canonical, readings)
  const normalizedBase = {
    ruleId: risk.ruleId,
    ruleCode: normalizeRuleCode(risk.ruleCode) || risk.ruleCode,
    ruleVersion: typeof rule.version === 'number' ? rule.version : risk.ruleVersion,
    propertyReadings: normalizedReadings,
    evidence: evaluation.evidence,
  }
  const normalized = evaluation.status === 'decided' && evaluation.decision
    ? RiskSchema.parse({
        ...normalizedBase,
        decisionId: evaluation.decision.id,
        level: riskLevelForOutcome(evaluation.decision.outcome),
        title: evaluation.decision.label,
        description: evaluation.decision.message || evaluation.decision.label,
        suggestion: evaluation.decision.action || evaluation.decision.message || evaluation.decision.label,
      })
    : RiskSchema.parse({
        ...normalizedBase,
        level: riskLevelForOutcome(evaluation.outcome),
        ...canonicalUnresolvedCopy(canonical, evaluation),
      })
  return { errors: [], normalized }
}

function canonicalUnresolvedCopy(
  canonical: ContractRuleContract,
  evaluation: ReturnType<typeof evaluateRuleContractReadings>
): { title: string; description: string; suggestion: string } {
  const labels = new Map(canonical.properties.map((property) => [property.key, property.label]))
  const readable = (keys: string[]) => keys.map((key) => labels.get(key) || key).join('、')
  const details: string[] = []
  if (evaluation.missing_property_keys.length > 0) {
    details.push(`缺少必填属性：${readable(evaluation.missing_property_keys)}`)
  }
  if (evaluation.ambiguous_property_keys.length > 0) {
    details.push(`同一属性存在多个冲突值：${readable(evaluation.ambiguous_property_keys)}`)
  }
  if (evaluation.unit_conflict_property_keys.length > 0) {
    details.push(`属性单位或币种冲突：${readable(evaluation.unit_conflict_property_keys)}`)
  }
  if (evaluation.status === 'no_decision') {
    details.push('已读取属性未命中任何已配置判定')
  }

  const reason = evaluation.status === 'no_decision'
    ? '没有可达判定'
    : evaluation.unit_conflict_property_keys.length > 0
      ? '属性单位或币种冲突'
      : evaluation.ambiguous_property_keys.length > 0
        ? '属性值存在冲突'
        : '缺少必填属性'
  const disposition = evaluation.outcome === 'block' ? '按规则阻断' : '需人工复核'
  return {
    title: `${reason}，${disposition}`,
    description: `${details.join('；') || '规则事实不足'}。处置：${disposition}。`,
    suggestion: evaluation.outcome === 'block'
      ? '补充或澄清规则事实后重新审核；当前按规则阻断'
      : '提交人工复核，确认规则事实后重新审核',
  }
}

function validateLegacyRisk(input: {
  risk: RawRisk
  rule: RuntimeRuleConstraint | undefined
  index: number
  constraints: AIOutputRuntimeConstraints
}): { errors: string[]; normalized?: AIReviewOutput['risks'][number] } {
  const { risk, rule, index, constraints } = input
  const path = `risks.${index}`
  const parsed = RiskSchema.safeParse(risk)
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((issue) => (
        `${path}.${issue.path.join('.')}: ${issue.message}`
      )),
    }
  }

  const evidence = parsed.data.evidence
  const errors: string[] = []
  if (evidence.length === 0) {
    errors.push(`${path}.evidence: legacy output requires source evidence`)
  }
  if (evidence.some((item) => !meaningfulEvidence(item))) {
    errors.push(`${path}.evidence: evidence is too short or generic`)
  }
  if (constraints.requireEvidenceInSource && constraints.contractText
    && evidence.some((item) => !sourceContainsEvidence(constraints.contractText || '', item))) {
    errors.push(`${path}.evidence: evidence is not a continuous source fragment`)
  }
  if (constraints.requireRuleEvidenceHint && !evidenceMatchesRuleHints(evidence, rule)) {
    errors.push(`${path}.evidence: evidence does not match rule field hints`)
  }
  if (errors.length > 0) return { errors }

  return {
    errors: [],
    normalized: {
      ...parsed.data,
      ruleCode: normalizeRuleCode(parsed.data.ruleCode) || parsed.data.ruleCode,
      ruleVersion: typeof rule?.version === 'number' ? rule.version : parsed.data.ruleVersion,
    }
  }
}

function validateRuntimeConstraints(
  data: RawAIReviewOutput,
  constraints: AIOutputRuntimeConstraints
): ValidationResult {
  const rules = constraints.rules || []
  const rulesByCode = new Map(
    rules
      .filter((rule) => normalizeRuleCode(rule.code))
      .map((rule) => [normalizeRuleCode(rule.code), rule])
  )
  const allowedRuleCodes = new Set(rulesByCode.keys())
  const errors: string[] = []
  const acceptedRisks: AIReviewOutput['risks'] = []
  let rejectedRiskCount = 0

  for (const [index, risk] of data.risks.entries()) {
    const normalizedRuleCode = normalizeRuleCode(risk.ruleCode)
    const rule = rulesByCode.get(normalizedRuleCode)
    let riskErrors: string[] = []
    let normalizedRisk: AIReviewOutput['risks'][number] | undefined

    if (allowedRuleCodes.size > 0 && !allowedRuleCodes.has(normalizedRuleCode)) {
      riskErrors.push(`risks.${index}.ruleCode: ${risk.ruleCode} is not in current SkillBundle`)
    } else if (rule?.execution_protocol === 'rule_contract_v1' || rule?.rule_contract) {
      const canonical = normalizeRuleContract(rule.rule_contract)
      if (!canonical) {
        riskErrors.push(`risks.${index}.ruleCode: canonical rule_contract is invalid`)
      } else {
        const validation = validateCanonicalRisk({ risk, rule, canonical, index, constraints })
        riskErrors = validation.errors
        normalizedRisk = validation.normalized
      }
    } else {
      const validation = validateLegacyRisk({ risk, rule, index, constraints })
      riskErrors = validation.errors
      normalizedRisk = validation.normalized
    }

    if (riskErrors.length > 0) {
      errors.push(...riskErrors)
      rejectedRiskCount += 1
      continue
    }

    if (normalizedRisk) acceptedRisks.push(normalizedRisk)
  }

  if (errors.length > 0) {
    if (constraints.allowPartialRiskAcceptance && acceptedRisks.length > 0) {
      return {
        valid: true,
        data: {
          ...data,
          risks: acceptedRisks,
        },
        retryable: false,
        warnings: errors,
        droppedRisks: rejectedRiskCount,
      }
    }

    return {
      valid: false,
      error: `Runtime validation failed: ${errors.join('; ')}`,
      retryable: true,
      warnings: errors,
      droppedRisks: rejectedRiskCount,
    }
  }

  return {
    valid: true,
    data: {
      ...data,
      risks: acceptedRisks,
    },
    retryable: false,
    droppedRisks: 0,
  }
}

// ─── 工具函数 ──────────────────────────────────────────

/**
 * 从文本中提取JSON
 * 策略：找最外层的完整JSON对象
 */
function extractJSON(text: string): string | null {
  const withoutReasoning = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')

  // 先尝试整个文本是否是JSON
  const trimmed = withoutReasoning.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  // 找文本中的JSON对象（代码块、markdown等）
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim()
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return inner
    }
  }

  // 找最外层的大括号
  let depth = 0
  let start = -1
  for (let i = 0; i < withoutReasoning.length; i++) {
    if (withoutReasoning[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (withoutReasoning[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        return withoutReasoning.slice(start, i + 1)
      }
    }
  }

  return null
}
