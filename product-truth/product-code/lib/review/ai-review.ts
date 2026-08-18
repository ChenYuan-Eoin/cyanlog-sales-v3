// REQ: F053（AI 审核助手）
// PURPOSE: 基于 F047 自动核验结果调用平台 AI 生成审核意见（风险摘要 + 修正建议）。
// 原则：未配置 use point / 调用失败 / 输出不合法 → 返回 null 提示，不伪造 AI 意见。
import { executeAIUsePoint } from '@/lib/ai/runtime-executor'
import { resolvePublishedAIExecutionPlan } from '@/lib/ai/runtime-plan'
import type { QuoteReviewResult } from './quote-review'

export const QUOTE_REVIEW_AI_USE_POINT = 'quote.review.assistant'

export interface QuoteReviewAiSummary {
  summary: string
  risks: string[]
  suggestions: string[]
}

export interface QuoteReviewAiOutput {
  summary: QuoteReviewAiSummary | null
  reason?: string
}

export function buildQuoteReviewAiPrompt(review: QuoteReviewResult, quote: { quote_no?: string | null; customer_name?: string | null; total_amount?: number | null; discount_rate?: number | null; currency?: string | null }): string {
  const lines = review.checks.map((c) => `${c.ok ? '[通过]' : c.level === 'block' ? '[阻断]' : '[提醒]'} ${c.label}${c.message ? `：${c.message}` : ''}`)
  return [
    '以下是系统自动审核核验结果（不满足项需按规则处理）：',
    `报价：${quote.quote_no ?? '-'}｜客户：${quote.customer_name ?? '-'}｜币种：${quote.currency ?? '-'}｜总额：${quote.total_amount ?? '-'}｜折扣：${quote.discount_rate ?? 0}`,
    '核验明细：',
    lines.join('\n'),
    '',
    '请基于以上核验结果输出审核意见，必须严格遵守：只总结核验结果中已出现的事实，不得编造缺失项或补充核验清单之外的风险。',
  ].join('\n')
}

export async function generateQuoteReviewAiSummary(input: {
  orgId: string
  review: QuoteReviewResult
  quote: { quote_no?: string | null; customer_name?: string | null; total_amount?: number | null; discount_rate?: number | null; currency?: string | null }
}): Promise<QuoteReviewAiOutput> {
  try {
    const plan = await resolvePublishedAIExecutionPlan({
      orgId: input.orgId,
      usePointId: QUOTE_REVIEW_AI_USE_POINT,
      executionEnvironment: 'hosted',
    })
    if (!plan) {
      return { summary: null, reason: '未配置报价审核 AI 助手（quote.review.assistant）' }
    }
    const result = await executeAIUsePoint<QuoteReviewAiSummary>({
      orgId: input.orgId,
      usePointId: QUOTE_REVIEW_AI_USE_POINT,
      executionEnvironment: 'hosted',
      plan,
      temperature: 0,
      maxTokens: 800,
      messages: [
        { role: 'system', content: '你是报价审核助手。基于给定的自动核验结果生成审核意见，输出 JSON：{"summary":"一句话结论","risks":["风险点"],"suggestions":["修正建议"]}。只总结核验结果中已出现的事实，不得编造。' },
        { role: 'user', content: buildQuoteReviewAiPrompt(input.review, input.quote) },
      ],
      validateOutput: (text: string) => {
        try {
          const parsed = JSON.parse(text) as Partial<QuoteReviewAiSummary>
          if (typeof parsed.summary === 'string' && Array.isArray(parsed.risks) && Array.isArray(parsed.suggestions)) {
            return { ok: true as const, value: { summary: parsed.summary, risks: parsed.risks.map(String), suggestions: parsed.suggestions.map(String) } }
          }
        } catch {
          // fallthrough
        }
        return { ok: false as const, error: 'INVALID_JSON' }
      },
    })
    if (!result.value) {
      return { summary: null, reason: 'AI 调用失败或输出格式不合法' }
    }
    return { summary: result.value }
  } catch (error) {
    console.error('[F053] AI review summary failed:', error)
    return { summary: null, reason: 'AI 审核助手暂不可用（未配置或调用失败）' }
  }
}
