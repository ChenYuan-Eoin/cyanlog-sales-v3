/**
 * 语义规则执行器
 * 特点：AI语义理解，灵活匹配
 * 适用：模糊描述、意图识别、上下文理解
 */

import { reviewWithFailoverSync } from '@/lib/ai/failover'
import type { Rule, RuleExecutionResult, ContractData } from './types'

// AI 响应结构
interface AISemanticResponse {
  triggered: boolean
  confidence: number
  extractedInfo?: {
    issues?: Array<{
      location?: string
      description: string
      severity?: 'high' | 'medium' | 'low'
    }>
    suggestions?: string[]
  }
  reasoning?: string
}

/**
 * 执行语义规则
 */
export async function executeSemanticRule(
  rule: Rule,
  contract: ContractData,
  aiConfig?: { model?: string; timeout?: number }
): Promise<RuleExecutionResult> {
  const startTime = Date.now()
  const semanticCondition = rule.semantic_condition || rule.description || ''

  if (!semanticCondition) {
    return createResult(rule, false, null, Date.now() - startTime, '语义条件未设置')
  }

  try {
    // 构建 AI Prompt
    const prompt = buildSemanticPrompt(semanticCondition, contract)

    // 调用 AI（直接获取结构化响应）
    const parsed = await callAIWithFallback(prompt, aiConfig, contract.org_id)

    // 构建执行结果
    const triggered = parsed.triggered && parsed.confidence > 0.6

    return createSemanticResult(
      rule,
      triggered,
      parsed,
      Date.now() - startTime
    )

  } catch (error) {
    return createResult(
      rule,
      false,
      null,
      Date.now() - startTime,
      `AI执行失败: ${error}`
    )
  }
}

/**
 * 构建语义规则 AI Prompt
 */
function buildSemanticPrompt(condition: string, contract: ContractData): string {
  return `你是一名专业的合同审核法务助手。请根据以下审核要求审查合同内容。

## 审核要求
${condition}

## 合同内容
${contract.text.substring(0, 15000)}

${contract.clauses ? `
## 条款结构
${contract.clauses.map(c => `
${c.number} ${c.title}
${c.content}
`).join('\n')}
` : ''}

## 输出要求
请以 JSON 格式返回结果，不要包含任何其他内容：
{
  "triggered": true/false,
  "confidence": 0-1之间的数字,
  "extractedInfo": {
    "issues": [
      {
        "location": "条款位置(如: 第3条)",
        "description": "具体风险描述",
        "severity": "high/medium/low"
      }
    ],
    "suggestions": ["修改建议1", "修改建议2"]
  },
  "reasoning": "判断理由(简短)"
}

规则：
- triggered=true 表示合同存在审核要求中指出的问题
- confidence 表示判断的置信度(0-1)
- 只在确实有问题时才设置 triggered=true
- 尽量提供具体的条款位置和准确的描述`
}

/**
 * 调用 AI 带降级机制
 * 使用项目中的 reviewWithFailoverSync
 */
async function callAIWithFallback(
  prompt: string,
  config?: { model?: string; timeout?: number },
  orgId?: string
): Promise<AISemanticResponse> {
  try {
    // 使用项目中现有的 AI 调用方式
    const result = await reviewWithFailoverSync(prompt, {
      preferredProvider: config?.model,
      orgId,
      tool: 'contract_review',
      capability: 'rule_semantic_eval',
      phase: 'semantic_rule_execution',
    })

    // 将结果转换为语义规则需要的格式
    const risks = result.risks || []
    const triggered = risks.length > 0 && risks.some(r => r.level !== 'green')

    return {
      triggered,
      confidence: triggered ? 0.8 : 0.9,
      extractedInfo: {
        issues: risks.map(r => ({
          location: '合同中',
          description: r.description || r.title,
          severity: r.level === 'red' ? 'high' : r.level === 'yellow' ? 'medium' : 'low'
        })),
        suggestions: risks.map(r => r.suggestion).filter(Boolean) as string[]
      },
      reasoning: result.summary
    }

  } catch (error) {
    console.warn('AI调用失败，返回未触发:', error)

    // 降级：简单关键词匹配
    const lowerPrompt = prompt.toLowerCase()
    const hasRisk = lowerPrompt.includes('风险') ||
      lowerPrompt.includes('问题') ||
      lowerPrompt.includes('违约') ||
      lowerPrompt.includes('违规')

    return {
      triggered: hasRisk,
      confidence: 0.3,
      reasoning: hasRisk ? '基于关键词的降级检测' : '未检测到风险关键词'
    }
  }
}

/**
 * 创建语义规则执行结果
 */
function createSemanticResult(
  rule: Rule,
  triggered: boolean,
  aiResponse: AISemanticResponse,
  executionTime: number
): RuleExecutionResult {
  const messageConfig = rule.message_config as { title?: string; description?: string; suggestion?: string } || {}

  // 构建描述
  let description = messageConfig.description || rule.description || ''
  if (aiResponse.extractedInfo?.issues && aiResponse.extractedInfo.issues.length > 0) {
    const issueDescriptions = aiResponse.extractedInfo.issues
      .map(i => `[${i.location || '未定位'}] ${i.description}`)
      .join('；')
    description = triggered
      ? `发现${aiResponse.extractedInfo.issues.length}个风险点：${issueDescriptions}`
      : description
  }

  // 构建建议
  let suggestion = messageConfig.suggestion || ''
  if (aiResponse.extractedInfo?.suggestions && aiResponse.extractedInfo.suggestions.length > 0) {
    suggestion = aiResponse.extractedInfo.suggestions.join('；')
  }

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    ruleType: 'semantic',
    ruleCode: rule.rule_code || undefined,
    riskLevel: triggered ? rule.level as 'red' | 'yellow' | 'green' : 'green',
    title: messageConfig.title || rule.name,
    description,
    suggestion,
    evidence: aiResponse.extractedInfo?.issues
      ? aiResponse.extractedInfo.issues.map(i => i.description)
      : undefined,
    triggered,
    executionTime,
    details: `置信度: ${Math.round(aiResponse.confidence * 100)}%; 判断: ${aiResponse.reasoning || '无'}`,
  }
}

/**
 * 创建基础结果
 */
function createResult(
  rule: Rule,
  triggered: boolean,
  extractedValue: string | null,
  executionTime: number,
  details: string
): RuleExecutionResult {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    ruleType: 'semantic',
    ruleCode: rule.rule_code || undefined,
    riskLevel: triggered ? rule.level as 'red' | 'yellow' | 'green' : 'green',
    title: rule.name,
    description: triggered ? (rule.description || '') : '规则未触发',
    triggered,
    executionTime,
    details
  }
}

/**
 * 批量执行语义规则
 */
export async function executeSemanticRules(
  rules: Rule[],
  contract: ContractData,
  aiConfig?: { model?: string; timeout?: number },
  onProgress?: (completed: number, total: number) => void
): Promise<RuleExecutionResult[]> {
  const results: RuleExecutionResult[] = []

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]

    try {
      // AI 规则串行执行，避免并发过大
      const result = await executeSemanticRule(rule, contract, aiConfig)
      results.push(result)
    } catch (error) {
      results.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleType: 'semantic',
        riskLevel: 'green',
        title: rule.name,
        description: `语义规则执行异常: ${error}`,
        triggered: false,
        executionTime: 0,
        details: String(error)
      })
    }

    // 进度回调
    if (onProgress) {
      onProgress(i + 1, rules.length)
    }

    // AI 调用间隔，避免 rate limit
    if (i < rules.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return results
}

/**
 * 模拟 AI 调用（用于测试）
 */
export async function mockCallAI(prompt: string): Promise<string> {
  // 简单模拟：根据 prompt 内容返回模拟结果
  if (prompt.includes('风险') || prompt.includes('问题')) {
    return JSON.stringify({
      triggered: true,
      confidence: 0.85,
      extractedInfo: {
        issues: [
          { location: '第7条', description: '违约金比例偏高', severity: 'medium' }
        ],
        suggestions: ['建议将违约金比例调整为合同总价的5%']
      },
      reasoning: '检测到违约金条款存在风险'
    })
  }

  return JSON.stringify({
    triggered: false,
    confidence: 0.9,
    reasoning: '未发现明显问题'
  })
}
