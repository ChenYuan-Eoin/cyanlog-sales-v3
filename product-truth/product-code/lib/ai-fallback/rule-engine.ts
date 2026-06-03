// 第 3 级降级：规则引擎（兜底）
// 仅结构化规则，无 LLM 能力

import type { AiClient, AnalyzeRequest } from './types'

export interface RuleMatch {
  ruleId: string
  matched: boolean
  reason: string
  severity: 'info' | 'warning' | 'critical'
}

export class RuleEngineClient implements AiClient {
  readonly source = 'rules' as const
  readonly timeoutMs = 45_000

  // 简化的规则集：硬编码示例规则
  private rules = [
    { id: 'R001', pattern: /违约金.*?(\d+)\s*%/i, severity: 'warning' as const, desc: '违约金比例' },
    { id: 'R002', pattern: /解除合同/g, severity: 'critical' as const, desc: '合同解除条款' },
    { id: 'R003', pattern: /不可抗力/g, severity: 'info' as const, desc: '不可抗力条款' },
    { id: 'R004', pattern: /知识产权/g, severity: 'info' as const, desc: '知识产权约定' },
    { id: 'R005', pattern: /保密/g, severity: 'info' as const, desc: '保密条款' },
  ]

  async call(req: AnalyzeRequest): Promise<unknown> {
    const matches: RuleMatch[] = []

    for (const rule of this.rules) {
      if (rule.pattern.test(req.text)) {
        matches.push({
          ruleId: rule.id,
          matched: true,
          reason: rule.desc,
          severity: rule.severity,
        })
      }
    }

    return {
      type: 'rule-based',
      matches,
      summary: this.summarize(matches),
      note: 'AI 分析不可用，结果基于结构化规则',
    }
  }

  async healthCheck(): Promise<boolean> {
    return true // 规则引擎始终可用
  }

  private summarize(matches: RuleMatch[]): string {
    if (matches.length === 0) return '未匹配任何规则'
    const critical = matches.filter((m) => m.severity === 'critical').length
    const warning = matches.filter((m) => m.severity === 'warning').length
    return `匹配 ${matches.length} 条规则（${critical} 关键、${warning} 警告）`
  }
}
