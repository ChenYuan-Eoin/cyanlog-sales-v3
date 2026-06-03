// SpaceX级AI服务故障容错链
// 多级降级：本地模型 -> 云端主力 -> 规则引擎 -> 人工标记

import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'

export interface AIProvider {
  name: string
  call: (contractText: string, abortSignal?: AbortSignal) => Promise<ReadableStream>
  timeout: number
}

// 本地模型 (LM Studio/Ollama)
const localProvider: AIProvider = {
  name: 'local',
  timeout: 5000,
  async call(contractText, abortSignal) {
    const local = createOpenAI({
      baseURL: process.env.LOCAL_MODEL_URL || 'http://localhost:1234/v1',
      apiKey: 'not-needed',
    })

    const result = streamText({
      model: local('local-model'),
      messages: [
        {
          role: 'system',
          content: `你是法务合同审核助手。识别合同风险并以 JSON 格式返回：
{\n  "risks": [{\n    "level": "red|yellow|green",\n    "title": "风险标题",\n    "description": "问题描述",\n    "suggestion": "建议"\n  }],\n  "summary": "总体评估"\n}`,
        },
        { role: 'user', content: contractText.substring(0, 4000) },
      ],
      maxOutputTokens: 2000,
      temperature: 0.3,
      abortSignal,
    })

    return result.toTextStreamResponse().body!
  },
}

// 云端主力模型 (通过中转站)
const cloudProvider: AIProvider = {
  name: 'cloud',
  timeout: 15000,
  async call(contractText, abortSignal) {
    const gateway = createOpenAI({
      baseURL: process.env.AI_GATEWAY_URL || 'https://cloud.yiyongai.cn/v1',
      apiKey: process.env.AI_GATEWAY_API_KEY,
    })

    const result = streamText({
      model: gateway(process.env.AI_MODEL || 'claude-sonnet-4-6'),
      messages: [
        {
          role: 'system',
          content: `你是一位专业的法务合同审核专家。请分析合同内容并识别风险。
请按以下 JSON 格式返回：
{\n  "risks": [\n    {\n      "level": "red|yellow|green",\n      "title": "风险标题（简短）",\n      "description": "问题详细描述",\n      "suggestion": "建议处理方式"\n    }\n  ],\n  "summary": "总体评估摘要"\n}`,
        },
        {
          role: 'user',
          content: `请审核以下合同：\n\n${contractText.substring(0, 8000)}`,
        },
      ],
      maxOutputTokens: 4000,
      temperature: 0.3,
      abortSignal,
    })

    return result.toTextStreamResponse().body!
  },
}

// 规则引擎降级（纯本地，无AI）
const ruleEngineProvider: AIProvider = {
  name: 'rule-engine',
  timeout: 1000,
  async call(contractText) {
    // 简化的规则匹配，返回流式JSON
    const rules = [
      { pattern: /账期.*(\d+).*天/i, field: 'payment_term_days', threshold: 90, level: 'red' as const },
      { pattern: /违约金.*(\d+)%/i, field: 'penalty_rate', threshold: 5, level: 'yellow' as const },
      { pattern: /保密.*(\d+).*年/i, field: 'confidentiality_years', threshold: 5, level: 'green' as const },
    ]

    const risks = []
    for (const rule of rules) {
      const match = contractText.match(rule.pattern)
      if (match) {
        const value = parseFloat(match[1])
        if (value > rule.threshold) {
          risks.push({
            level: rule.level,
            title: `${rule.field} 超标`,
            description: `检测到 ${rule.field}: ${value}，超过建议阈值 ${rule.threshold}`,
            suggestion: `建议协商调整至 ${rule.threshold} 以内`,
          })
        }
      }
    }

    const result = {
      risks: risks.length > 0 ? risks : [{ level: 'green', title: '无重大风险', description: '基础规则扫描未发现明显风险', suggestion: '建议人工复核' }],
      summary: risks.length > 0 ? `发现 ${risks.length} 项规则命中` : '基础规则扫描完成，建议进一步人工审核',
    }

    // 转换为流
    const encoder = new TextEncoder()
    const chunks = JSON.stringify(result).match(/.{1,50}/g) || [JSON.stringify(result)]
    let index = 0

    return new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index]))
          index++
        } else {
          controller.close()
        }
      },
    })
  },
}

// 带超时的 fetch 包装
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController: AbortController
): Promise<T> {
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  try {
    return await promise
  } finally {
    clearTimeout(timeout)
  }
}

// 主故障转移链
export async function reviewWithFailover(
  contractText: string,
  preferredProvider?: string
): Promise<{ stream: ReadableStream; provider: string; degraded: boolean }> {
  const providers = preferredProvider
    ? [getProviderByName(preferredProvider), ruleEngineProvider]
    : [localProvider, cloudProvider, ruleEngineProvider]

  const errors: string[] = []

  for (const provider of providers) {
    const abortController = new AbortController()

    try {
      console.log(`[AI Failover] Trying ${provider.name}...`)
      const stream = await withTimeout(
        provider.call(contractText, abortController.signal),
        provider.timeout,
        abortController
      )

      const isDegraded = provider.name === 'rule-engine'
      console.log(`[AI Failover] ✓ Using ${provider.name}${isDegraded ? ' (DEGRADED MODE)' : ''}`)

      return { stream, provider: provider.name, degraded: isDegraded }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.warn(`[AI Failover] ✗ ${provider.name} failed: ${errorMsg}`)
      errors.push(`${provider.name}: ${errorMsg}`)
    }
  }

  // 全部失败，返回人工标记
  console.error('[AI Failover] All providers failed:', errors)

  const encoder = new TextEncoder()
  const fallbackStream = new ReadableStream({
    start(controller) {
      const data = JSON.stringify({
        risks: [{
          level: 'yellow',
          title: 'AI服务暂时不可用',
          description: '所有AI提供方均不可用，建议人工审核',
          suggestion: '请法务同事人工审核此合同',
        }],
        summary: 'AI审核服务暂时不可用，已切换至人工审核建议模式',
        _meta: { degraded: true, errors },
      })
      controller.enqueue(encoder.encode(data))
      controller.close()
    },
  })

  return { stream: fallbackStream, provider: 'manual-fallback', degraded: true }
}

function getProviderByName(name: string): AIProvider {
  switch (name) {
    case 'local': return localProvider
    case 'cloud': return cloudProvider
    case 'rule-engine': return ruleEngineProvider
    default: return cloudProvider
  }
}
