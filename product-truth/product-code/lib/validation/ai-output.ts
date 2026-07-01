// lib/validation/ai-output.ts
// AI输出格式校验 — Zod Schema + 自动重试机制
// AI输出不可控，用Schema校验保证前端拿到合法JSON，失败自动重试

import { z } from 'zod'

// ─── Zod Schema定义 ─────────────────────────────────────

const RiskLevelSchema = z.enum(['red', 'yellow', 'green'])

const RiskSchema = z.object({
  ruleId: z.string().optional(),
  ruleCode: z.string().min(1),
  ruleVersion: z.number().optional(),
  level: RiskLevelSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  suggestion: z.string().min(1).max(1000),
  counterparty: z.string().optional(),
  evidence: z.array(z.string().min(2)).min(1),
})

export const AIReviewOutputSchema = z.object({
  risks: z.array(RiskSchema).max(50), // 最多50个风险点
  summary: z.string().min(1).max(5000),
})

export type AIReviewOutput = z.infer<typeof AIReviewOutputSchema>

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
}

export type RuntimeRuleConstraint = {
  code?: string | null
  clause_category?: string | null
  target_field?: string | null
  field_hints?: string[] | null
}

export type AIOutputRuntimeConstraints = {
  contractText?: string
  rules?: RuntimeRuleConstraint[]
  requireEvidenceInSource?: boolean
  requireRuleEvidenceHint?: boolean
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
    const validated = AIReviewOutputSchema.safeParse(parsed)

    if (validated.success) {
      const runtimeValidation = validateRuntimeConstraints(validated.data, constraints)
      if (!runtimeValidation.valid) {
        return runtimeValidation
      }
      return { valid: true, data: validated.data, retryable: false }
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

function validateRuntimeConstraints(
  data: AIReviewOutput,
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

  for (const [index, risk] of data.risks.entries()) {
    const path = `risks.${index}`
    const normalizedRuleCode = normalizeRuleCode(risk.ruleCode)

    if (allowedRuleCodes.size > 0 && !allowedRuleCodes.has(normalizedRuleCode)) {
      errors.push(`${path}.ruleCode: ${risk.ruleCode} is not in current SkillBundle`)
    }

    const evidence = risk.evidence || []
    const weakEvidence = evidence.filter((item) => !meaningfulEvidence(item))
    if (weakEvidence.length > 0) {
      errors.push(`${path}.evidence: evidence is too short or generic`)
    }

    if (constraints.requireEvidenceInSource && constraints.contractText) {
      const missing = evidence.filter((item) => !sourceContainsEvidence(constraints.contractText || '', item))
      if (missing.length > 0) {
        errors.push(`${path}.evidence: evidence is not a continuous source fragment`)
      }
    }

    if (constraints.requireRuleEvidenceHint && !evidenceMatchesRuleHints(evidence, rulesByCode.get(normalizedRuleCode))) {
      errors.push(`${path}.evidence: evidence does not match rule field hints`)
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: `Runtime validation failed: ${errors.join('; ')}`,
      retryable: true,
    }
  }

  return { valid: true, data, retryable: false }
}

// ─── 工具函数 ──────────────────────────────────────────

/**
 * 从文本中提取JSON
 * 策略：找最外层的完整JSON对象
 */
function extractJSON(text: string): string | null {
  // 先尝试整个文本是否是JSON
  const trimmed = text.trim()
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
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (text[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}
