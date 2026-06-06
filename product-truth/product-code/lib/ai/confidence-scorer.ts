// lib/ai/confidence-scorer.ts
// 置信度评分 — 评估AI输出的可信程度
// AI不是100%可靠，需要置信度评分让用户知道"这个结论有多可靠"

import { validateAIOutput } from '@/lib/validation/ai-output'

export interface ConfidenceScore {
  /** 总体置信度 0-1 */
  overall: number
  /** 各维度置信度 */
  dimensions: {
    /** 格式合规性（输出是否符合Schema） */
    formatCompliance: number
    /** 内容一致性（risks和summary是否一致） */
    contentConsistency: number
    /** 引用完整性（是否引用了原文） */
    citationCompleteness: number
    /** 规则匹配度（与规则引擎结果的一致性） */
    ruleAlignment: number
  }
  /** 评分理由 */
  reasoning: string
  /** 建议操作 */
  recommendation: 'accept' | 'review' | 'reject'
}

/**
 * 计算AI审核结果的置信度
 * 多维度评分，不是简单的是/否
 */
export function calculateConfidence(
  aiOutput: string,
  ruleEngineResult?: { risks: Array<{ level: string; title: string }> }
): ConfidenceScore {
  const dimensions = {
    formatCompliance: 0,
    contentConsistency: 0,
    citationCompleteness: 0,
    ruleAlignment: 0,
  }

  // 1. 格式合规性
  const validation = validateAIOutput(aiOutput)
  dimensions.formatCompliance = validation.valid ? 1.0 : 0.3

  if (!validation.valid) {
    return {
      overall: 0.3,
      dimensions,
      reasoning: 'AI输出格式校验失败，置信度低',
      recommendation: 'reject',
    }
  }

  const data = validation.data!

  // 2. 内容一致性
  // risks和summary是否一致（summary应该涵盖risks的要点）
  const riskKeywords = data.risks.map((r) => r.title.toLowerCase())
  const summaryLower = data.summary.toLowerCase()
  const matchedKeywords = riskKeywords.filter((k) => summaryLower.includes(k))
  dimensions.contentConsistency = matchedKeywords.length / Math.max(riskKeywords.length, 1)

  // 3. 引用完整性
  // 检查risks中的description是否包含原文引用（简化版：检查长度）
  const avgDescriptionLength = data.risks.reduce((sum, r) => sum + r.description.length, 0) / Math.max(data.risks.length, 1)
  dimensions.citationCompleteness = Math.min(avgDescriptionLength / 100, 1.0)

  // 4. 规则匹配度
  if (ruleEngineResult) {
    const aiRiskTitles = new Set(data.risks.map((r) => r.title))
    const ruleRiskTitles = new Set(ruleEngineResult.risks.map((r) => r.title))
    const common = [...aiRiskTitles].filter((t) => ruleRiskTitles.has(t))
    dimensions.ruleAlignment = common.length / Math.max(aiRiskTitles.size, ruleRiskTitles.size, 1)
  } else {
    dimensions.ruleAlignment = 0.5 // 无规则引擎结果，默认中等
  }

  // 计算总体置信度（加权平均）
  const weights = {
    formatCompliance: 0.3,
    contentConsistency: 0.25,
    citationCompleteness: 0.25,
    ruleAlignment: 0.2,
  }

  const overall =
    dimensions.formatCompliance * weights.formatCompliance +
    dimensions.contentConsistency * weights.contentConsistency +
    dimensions.citationCompleteness * weights.citationCompleteness +
    dimensions.ruleAlignment * weights.ruleAlignment

  // 决定建议操作
  let recommendation: ConfidenceScore['recommendation']
  if (overall >= 0.8) {
    recommendation = 'accept'
  } else if (overall >= 0.5) {
    recommendation = 'review'
  } else {
    recommendation = 'reject'
  }

  return {
    overall,
    dimensions,
    reasoning: generateReasoning(dimensions, overall),
    recommendation,
  }
}

function generateReasoning(dimensions: ConfidenceScore['dimensions'], _overall: number): string {
  const parts: string[] = []

  if (dimensions.formatCompliance < 1) {
    parts.push('格式合规性不足')
  }
  if (dimensions.contentConsistency < 0.5) {
    parts.push('摘要与风险点一致性较低')
  }
  if (dimensions.citationCompleteness < 0.5) {
    parts.push('引用完整性不足')
  }
  if (dimensions.ruleAlignment < 0.5) {
    parts.push('与规则引擎结果一致性较低')
  }

  if (parts.length === 0) {
    return '各项指标均达标，置信度高'
  }

  return parts.join('；')
}
