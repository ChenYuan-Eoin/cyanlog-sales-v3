// lib/ai/hallucination-detector.ts
// 幻觉检测 — 检测AI输出中是否存在"编造"的内容
// AI幻觉是最大风险，需要检测机制

import { validateAIOutput } from '@/lib/validation/ai-output'

export interface HallucinationReport {
  /** 是否存在幻觉 */
  hasHallucination: boolean
  /** 幻觉类型 */
  hallucinationType?: 'fabricated_clause' | 'misattributed_risk' | 'invented_citation'
  /** 置信度 0-1 */
  confidence: number
  /** 具体问题 */
  issues: Array<{
    /** 问题描述 */
    description: string
    /** 涉及的文本 */
    text: string
    /** 严重程度 */
    severity: 'high' | 'medium' | 'low'
  }>
  /** 检测方法 */
  detectionMethod: string
}

/**
 * 幻觉检测器
 * 幻觉检测的核心是"回溯验证"——AI说的每一句话，都要能在原文中找到依据
 */
export function detectHallucination(
  aiOutput: string,
  originalText: string
): HallucinationReport {
  const issues: HallucinationReport['issues'] = []

  // 1. 格式校验
  const validation = validateAIOutput(aiOutput)
  if (!validation.valid) {
    return {
      hasHallucination: true,
      hallucinationType: 'fabricated_clause',
      confidence: 0.9,
      issues: [{
        description: 'AI输出格式非法，可能是幻觉',
        text: aiOutput.substring(0, 200),
        severity: 'high',
      }],
      detectionMethod: 'format_validation',
    }
  }

  const data = validation.data!
  const originalLower = originalText.toLowerCase()

  // 2. 风险点回溯验证
  // 每个风险点的描述应该在原文中有对应内容
  for (const risk of data.risks) {
    const descriptionLower = risk.description.toLowerCase()
    const titleLower = risk.title.toLowerCase()

    // 检查风险描述中的关键词是否在原文中出现
    const keywords = extractKeywords(descriptionLower)
    const missingKeywords = keywords.filter((k) => !originalLower.includes(k))

    if (missingKeywords.length > keywords.length * 0.5) {
      issues.push({
        description: `风险点"${risk.title}"的描述中，超过50%的关键词在原文中未找到`,
        text: risk.description,
        severity: 'high',
      })
    }

    // 检查风险标题是否在原文中有对应
    const titleKeywords = extractKeywords(titleLower)
    const missingTitleKeywords = titleKeywords.filter((k) => !originalLower.includes(k))

    if (missingTitleKeywords.length > titleKeywords.length * 0.5) {
      issues.push({
        description: `风险标题"${risk.title}"中，超过50%的关键词在原文中未找到`,
        text: risk.title,
        severity: 'medium',
      })
    }
  }

  // 3. 摘要一致性验证
  // 摘要应该涵盖风险点的要点
  const summaryLower = data.summary.toLowerCase()
  for (const risk of data.risks) {
    const riskKeywords = extractKeywords(risk.title.toLowerCase())
    const matchedInSummary = riskKeywords.filter((k) => summaryLower.includes(k))

    if (matchedInSummary.length === 0 && riskKeywords.length > 0) {
      issues.push({
        description: `摘要未提及风险"${risk.title}"`,
        text: data.summary,
        severity: 'low',
      })
    }
  }

  // 4. 生成报告
  const hasHallucination = issues.some((i) => i.severity === 'high')
  const confidence = hasHallucination
    ? Math.min(issues.filter((i) => i.severity === 'high').length / data.risks.length, 1.0)
    : 0.1

  return {
    hasHallucination,
    hallucinationType: hasHallucination ? 'misattributed_risk' : undefined,
    confidence,
    issues,
    detectionMethod: 'keyword_backtracking',
  }
}

/**
 * 提取关键词（简化版）
 * 实际应用应该用NLP分词，这里用简单空格分词演示
 */
function extractKeywords(text: string): string[] {
  // 过滤停用词和短词
  const stopWords = new Set(['的', '了', '在', '是', '和', '与', '或', '为', '有', 'the', 'a', 'an', 'is', 'are', 'and', 'or'])
  return text
    .split(/\s+|[^\u4e00-\u9fa5a-zA-Z0-9]/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
}
