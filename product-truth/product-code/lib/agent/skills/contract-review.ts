// lib/agent/skills/contract-review.ts
// 合同审核Agent — 基于BaseAgent的ReAct实现
// Agent不是替代人工，而是辅助人工——先AI预审，再人工终审

import { BaseAgent, type AgentTool } from '../base'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import { executeRules } from '@/lib/rules/engine'
import type { BaseMemory } from '@/lib/memory/base'

/**
 * 合同审核Agent配置
 */
export const CONTRACT_REVIEW_CONFIG = {
  name: 'ContractReviewAgent',
  systemPrompt: `你是法务合同审核专家。你的任务是分析合同，识别风险点。

工作流程：
1. 先调用规则引擎进行结构化扫描
2. 再调用AI模型进行语义分析
3. 综合结果，生成审核报告

输出格式：
{
  "risks": [
    {
      "level": "red|yellow|green",
      "title": "风险标题",
      "description": "详细描述",
      "suggestion": "建议处理方式"
    }
  ],
  "summary": "总体评估摘要"
}`,
  maxIterations: 3,
  temperature: 0.3,
  maxTokens: 4000,
}

/**
 * 合同审核Agent
 * Agent如何工作？
 * 1. 接收合同文本
 * 2. 调用规则引擎（结构化扫描）
 * 3. 调用AI模型（语义分析）
 * 4. 综合结果，生成报告
 */
export class ContractReviewAgent extends BaseAgent {
  constructor(memory: BaseMemory) {
    super(CONTRACT_REVIEW_CONFIG, memory)

    // 注册工具
    this.registerTool(ruleEngineTool)
    this.registerTool(aiReviewTool)
  }

  /**
   * 思考步骤 — 决定下一步行动
   */
  protected async reason(context: string): Promise<{
    reasoning: string
    action?: { tool: string; parameters: Record<string, unknown> }
  }> {
    // 简化版：根据上下文决定调用哪个工具
    // 实际应用应该用LLM生成思考
    if (context.includes('规则引擎')) {
      return {
        reasoning: '规则引擎已执行，接下来调用AI模型进行语义分析',
        action: { tool: 'aiReview', parameters: { text: context } },
      }
    }

    return {
      reasoning: '开始合同审核，先调用规则引擎',
      action: { tool: 'ruleEngine', parameters: { text: context } },
    }
  }

  /**
   * 生成最终输出
   */
  protected async generateOutput(thoughts: Array<{
    reasoning: string
    action?: { tool: string; parameters: Record<string, unknown> }
    observation?: string
  }>): Promise<string> {
    // 综合所有观察和思考，生成最终报告
    const observations = thoughts
      .filter((t) => t.observation)
      .map((t) => t.observation)
      .join('\n')

    return `合同审核报告：\n\n${observations}`
  }
}

// ─── 工具定义 ──────────────────────────────────────────

const ruleEngineTool: AgentTool = {
  name: 'ruleEngine',
  description: '使用规则引擎进行结构化扫描',
  parameters: {},
  async execute(params: Record<string, unknown>) {
    const text = params.text as string
    if (!text) throw new Error('Missing text parameter')

    const result = await executeRules(text)
    return result
  },
}

const aiReviewTool: AgentTool = {
  name: 'aiReview',
  description: '使用AI模型进行语义分析',
  parameters: {},
  async execute(params: Record<string, unknown>) {
    const text = params.text as string
    if (!text) throw new Error('Missing text parameter')

    const result = await reviewWithFailoverSync(text, {
      tool: 'contract_review',
      capability: 'contract_review',
      phase: 'agent_contract_review',
    })
    return result
  },
}
