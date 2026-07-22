export interface ReviewComplianceDisplay {
  missing_required_clauses: string[]
  dangerous_clauses: string[]
  ambiguous_clauses: string[]
  unbalanced_clauses: string[]
  party_a_consistency: string
  party_b_consistency: string
  issues: string[]
}

export interface ReviewExecutionPresentation {
  isRuleEngine: boolean
  resultTitle: string
  completionLabel: string
  degradedMessage: string
}

const RULE_ENGINE_PROVIDER_IDS = new Set(['rule_engine', 'AI_LEVEL_3'])

export function getReviewExecutionPresentation(
  provider: string | null | undefined,
): ReviewExecutionPresentation {
  const isRuleEngine = Boolean(provider && RULE_ENGINE_PROVIDER_IDS.has(provider))

  if (isRuleEngine) {
    return {
      isRuleEngine: true,
      resultTitle: '规则风险点',
      completionLabel: '规则复审完成（非 AI）',
      degradedMessage: '当前结果来自确定性规则引擎，未调用 AI 模型。必须人工复核，或选择本地/云端模型重新审核。',
    }
  }

  return {
    isRuleEngine: false,
    resultTitle: 'AI 风险点',
    completionLabel: 'AI 审核完成',
    degradedMessage: '当前 AI 结果来自降级路径，请结合调用记录和人工复核。',
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function normalizeReviewCompliance(value: unknown): ReviewComplianceDisplay {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    missing_required_clauses: stringList(source.missing_required_clauses),
    dangerous_clauses: stringList(source.dangerous_clauses),
    ambiguous_clauses: stringList(source.ambiguous_clauses),
    unbalanced_clauses: stringList(source.unbalanced_clauses),
    party_a_consistency: typeof source.party_a_consistency === 'string'
      ? source.party_a_consistency
      : 'unknown',
    party_b_consistency: typeof source.party_b_consistency === 'string'
      ? source.party_b_consistency
      : 'unknown',
    issues: stringList(source.issues),
  }
}
