import { z } from 'zod'

import type {
  ContractRuleAsset,
  ContractRuleAssetHealth,
  ContractRuleOperator,
  ContractRuleTestResult,
} from '@/types/contract-rule-assets'

const operatorSchema = z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in'])
const nullableNumber = z.number().finite().nullable().optional()
const nullableText = z.string().trim().nullable().optional()

export const ruleSetCreateSchema = z.object({
  name: z.string().trim().min(1, '规则集名称不能为空'),
  code: z.string().trim().min(1, '规则集编码不能为空').max(80),
  description: nullableText,
  applicable_scenario: nullableText,
  priority: z.number().int().min(0).max(10000).optional(),
})

export const ruleSetUpdateSchema = ruleSetCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
})

const commonRuleFields = {
  rule_set_id: z.string().uuid('请选择有效规则集'),
  code: z.string().trim().min(1, '规则编码不能为空').max(80),
  name: z.string().trim().min(1, '规则名称不能为空'),
  description: nullableText,
  category: z.enum(['ratio', 'amount', 'duration', 'enum', 'text']),
  applicable_scenarios: z.array(z.string().trim().min(1)).optional(),
  scope: z.enum(['org', 'dept', 'user']).optional(),
  level_a_operator: operatorSchema,
  level_a_threshold: nullableNumber,
  level_a_unit: nullableText,
  level_a_action: nullableText,
  level_b_operator: operatorSchema,
  level_b_threshold: nullableNumber,
  level_b_unit: nullableText,
  level_b_action: nullableText,
  level_b_counterparty: nullableText,
  level_c_operator: operatorSchema,
  level_c_threshold: nullableNumber,
  level_c_unit: nullableText,
  level_c_action: nullableText,
  level_c_message: nullableText,
  approval_roles: z.array(z.string()).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
  engine_type: z.enum(['structured', 'semantic', 'hybrid']),
  target_field: nullableText,
  clause_category: nullableText,
  field_hints: z.array(z.string().trim().min(1)).optional(),
  semantic_prompt: nullableText,
  message_template: z.record(z.string(), z.unknown()).optional(),
  business_domain: nullableText,
  risk_level: z.enum(['red', 'yellow', 'green']),
  translation_status: z.enum(['not_started', 'needs_ai_translation', 'ready', 'failed']).optional(),
}

export const ruleCreateSchema = z.object(commonRuleFields)
export const ruleUpdateSchema = z.object(commonRuleFields).partial()

const numericCategories = new Set(['ratio', 'amount', 'duration'])

function isPresent(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
}

export function getRuleAssetHealth(rule: ContractRuleAsset): ContractRuleAssetHealth {
  const blockers: string[] = []
  const warnings: string[] = []
  const usesDeterministicThreshold = numericCategories.has(rule.category)

  if (!rule.rule_set_id) blockers.push('未归属规则集')
  if (!rule.code.trim()) blockers.push('缺少规则编码')
  if (!rule.name.trim()) blockers.push('缺少规则名称')
  if (rule.engine_type !== 'semantic' && !isPresent(rule.target_field)) {
    blockers.push('结构化或混合规则缺少判定字段')
  }

  if (usesDeterministicThreshold) {
    const thresholds = [rule.level_a_threshold, rule.level_b_threshold, rule.level_c_threshold]
    if (thresholds.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      blockers.push('数值规则的 A/B/C 阈值不完整')
    }
  }

  if (rule.engine_type !== 'structured' && !isPresent(rule.semantic_prompt)) {
    blockers.push('语义或混合规则缺少模型判定指令')
  }

  if (![rule.level_a_action, rule.level_b_action, rule.level_c_action].every(isPresent)) {
    blockers.push('A/B/C 处理动作不完整')
  }
  if (rule.translation_status !== 'ready') blockers.push('规则转译尚未确认')
  if (!isPresent(rule.message_template?.comment_template)) blockers.push('未配置客户侧批注模板')
  if (!isPresent(rule.message_template?.negotiation_guidance)) blockers.push('未配置销售谈判口径')
  if (!isPresent(rule.message_template?.bottom_line)) blockers.push('未配置销售退让底线')
  if (!isPresent(rule.message_template?.evidence_requirement)) blockers.push('未配置证据要求')

  return {
    blockers,
    warnings,
    publishable: blockers.length === 0 && rule.is_active && rule.lifecycle_status !== 'archived',
    testMode:
      rule.engine_type === 'structured' && usesDeterministicThreshold
        ? 'deterministic'
        : 'model_required',
  }
}

function compare(value: number, operator: ContractRuleOperator, threshold: number): boolean {
  switch (operator) {
    case '>=':
      return value >= threshold
    case '<=':
      return value <= threshold
    case '=':
      return value === threshold
    case '>':
      return value > threshold
    case '<':
      return value < threshold
    default:
      return false
  }
}

export function evaluateRuleSample(
  rule: ContractRuleAsset,
  input: { fields?: Record<string, unknown>; text?: string }
): ContractRuleTestResult {
  const numeric = numericCategories.has(rule.category)

  if (rule.engine_type !== 'structured' || !numeric) {
    return {
      status: 'needs_model',
      mode: 'model_required',
      reason: '该规则包含语义判断，确定性测试不能伪造命中结果；请在发布评测中调用已配置模型。',
    }
  }

  if (!rule.target_field) {
    return { status: 'not_matched', mode: 'deterministic', reason: '规则缺少判定字段。' }
  }

  const raw = input.fields?.[rule.target_field]
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) {
    return {
      status: 'not_matched',
      mode: 'deterministic',
      reason: `请为字段 ${rule.target_field} 提供有效数值。`,
    }
  }

  const levels = [
    { level: 'A' as const, operator: rule.level_a_operator, threshold: rule.level_a_threshold, action: rule.level_a_action, unit: rule.level_a_unit },
    { level: 'B' as const, operator: rule.level_b_operator, threshold: rule.level_b_threshold, action: rule.level_b_action, unit: rule.level_b_unit },
    { level: 'C' as const, operator: rule.level_c_operator, threshold: rule.level_c_threshold, action: rule.level_c_action, unit: rule.level_c_unit },
  ]

  for (const item of levels) {
    if (typeof item.threshold === 'number' && compare(value, item.operator, item.threshold)) {
      return {
        status: 'matched',
        mode: 'deterministic',
        level: item.level,
        action: item.action,
        reason: `${rule.target_field}=${value} 命中 ${item.level} 档：${item.operator} ${item.threshold}${item.unit || ''}`,
      }
    }
  }

  return {
    status: 'not_matched',
    mode: 'deterministic',
    reason: `${rule.target_field}=${value} 未命中已配置的 A/B/C 阈值。`,
  }
}

export function sanitizeRuleMutation<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value === '' ? null : value])
  ) as T
}
