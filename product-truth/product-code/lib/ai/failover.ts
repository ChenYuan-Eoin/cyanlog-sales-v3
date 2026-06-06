// AI服务多级故障容错链
// 多级降级：本地模型 -> 云端主力 -> 规则引擎 -> 人工标记
// REQ: F022-ai-fallback
// SPEC: LM Studio本地模型超时45秒，页数≤15走本地，>15走云端
//
// 【技术选型】
// - Vercel AI SDK (ai@3.x): 统一流式接口，支持多Provider切换
//   备选：直接调用OpenAI/Anthropic SDK（节省~15KB bundle，但代码复杂度上升）
//   权衡：SDK提供标准化的streamText/toTextStreamResponse，降低维护成本
//
// - 本地模型 (LM Studio): 数据不出境，合规要求
//   备选：Ollama（更轻量，但API兼容性差）
//   权衡：LM Studio提供OpenAI兼容接口，与ai-sdk无缝集成
//
// - 规则引擎兜底: 确定性输出，可解释性强
//   备选：更便宜的云端AI（如GPT-3.5）
//   权衡：规则引擎不依赖网络，合规审计时可解释每一步判断逻辑
//
// - 健康缓存 (TTL 60s): 避免高并发下重复探测
//   备选：Redis集中缓存（增加依赖，但集群共享状态）
//   权衡：进程内Map足够，单个实例承载的并发有限，无需引入Redis复杂度

import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'

export interface AIProvider {
  name: string
  call: (contractText: string, abortSignal?: AbortSignal) => Promise<ReadableStream>
  timeout: number
}

// ─── Provider 健康状态缓存 ─────────────────────────────
// 高并发下避免每个请求都探测本地模型，用共享缓存

interface HealthRecord {
  healthy: boolean
  checkedAt: number
}

const HEALTH_CACHE_TTL = 60_000 // 60秒 TTL
const HEALTH_CACHE = new Map<string, HealthRecord>()

async function isProviderHealthy(name: string, checkFn: () => Promise<boolean>): Promise<boolean> {
  const now = Date.now()
  const cached = HEALTH_CACHE.get(name)
  if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL) {
    return cached.healthy
  }
  try {
    const healthy = await checkFn()
    HEALTH_CACHE.set(name, { healthy, checkedAt: now })
    return healthy
  } catch {
    HEALTH_CACHE.set(name, { healthy: false, checkedAt: now })
    return false
  }
}

function markProviderUnhealthy(name: string): void {
  HEALTH_CACHE.set(name, { healthy: false, checkedAt: Date.now() })
}

// 本地模型健康检查
async function checkLocalModelHealth(): Promise<boolean> {
  const localUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:1234/v1'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${localUrl}/models`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

// ─── 页数路由决策 ──────────────────────────────────────
// 按文档特征智能选择Provider，而非简单顺序降级

function estimatePageCount(text: string): number {
  // 简化估算：中文字符 ≈ 500字/页，英文 ≈ 300词/页
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = text.split(/\s+/).filter(w => /^[a-zA-Z]+$/.test(w)).length
  return Math.max(1, Math.ceil(chineseChars / 500 + englishWords / 300))
}

function determineStartProvider(contractText: string): 'local' | 'cloud' {
  const pages = estimatePageCount(contractText)
  // FREEZE-SPEC: ≤15页走本地模型，>15页直接走云端（本地模型推理慢）
  if (pages <= 15) return 'local'
  return 'cloud'
}

// ─── Provider 定义 ─────────────────────────────────────

// 本地模型 (LM Studio/Ollama)
// FREEZE-SPEC: 超时45秒（不是5秒！）
const localProvider: AIProvider = {
  name: 'local',
  timeout: 45_000,
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
// 1. 先按文档特征决定入口Provider（页数≤15→本地，>15→云端）
// 2. 入口Provider失败时，降级到下一级
// 3. 全部失败时，返回规则引擎兜底
// 4. 规则引擎也失败时，返回人工标记
export async function reviewWithFailover(
  contractText: string,
  preferredProvider?: string
): Promise<{ stream: ReadableStream; provider: string; degraded: boolean }> {
  const errors: string[] = []

  // 确定入口Provider
  const startProvider = preferredProvider || determineStartProvider(contractText)
  const providers: AIProvider[] = []

  if (startProvider === 'local') {
    // 本地优先路径：本地 → 云端 → 规则引擎
    const localHealthy = await isProviderHealthy('local', checkLocalModelHealth)
    if (localHealthy) {
      providers.push(localProvider, cloudProvider, ruleEngineProvider)
    } else {
      console.warn('[AI Failover] Local model unhealthy, skipping to cloud')
      providers.push(cloudProvider, ruleEngineProvider)
    }
  } else {
    // 云端优先路径：云端 → 规则引擎（跳过本地，因为文档太长）
    providers.push(cloudProvider, ruleEngineProvider)
  }

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

      // 标记Provider不健康，避免后续请求继续尝试
      if (provider.name === 'local' || provider.name === 'cloud') {
        markProviderUnhealthy(provider.name)
      }
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

// 带超时的 fetch 包装

import { validateAIOutput } from '@/lib/validation/ai-output'

export interface SyncReviewResult {
  risks: Array<{
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
  }>
  summary: string
  provider: string
  degraded: boolean
}

/**
 * 非流式AI审核 — 用于后台任务队列
 * 与 reviewWithFailover 共用同一套降级逻辑，但返回结构化结果
 * 输出校验失败时自动重试，避免重复尝试相同provider
 */
export async function reviewWithFailoverSync(
  contractText: string,
  preferredProvider?: string,
  maxRetries: number = 3
): Promise<SyncReviewResult> {
  let lastError: string | undefined
  const attemptedProviders = new Set<string>()

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 如果指定provider已尝试过，让reviewWithFailover自动选择下一个
    const effectivePreferred = attemptedProviders.has(preferredProvider || '')
      ? undefined
      : preferredProvider

    const { stream, provider, degraded } = await reviewWithFailover(contractText, effectivePreferred)
    attemptedProviders.add(provider)

    // 读取流式输出为完整文本
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }

    // 校验输出格式
    const validation = validateAIOutput(fullText)

    if (validation.valid && validation.data) {
      return {
        risks: validation.data.risks,
        summary: validation.data.summary,
        provider,
        degraded,
      }
    }

    lastError = validation.error
    console.warn(`[AI Failover] Sync output validation failed (attempt ${attempt + 1}/${maxRetries + 1}, provider: ${provider}):`, lastError)

    // 如果所有provider都已尝试过，不再重试
    if (attemptedProviders.size >= 3) {
      console.warn('[AI Failover] All providers exhausted, stopping retry')
      break
    }
  }

  // 全部重试都失败，返回降级结果
  return {
    risks: [{
      level: 'yellow',
      title: 'AI输出格式异常',
      description: lastError || 'AI输出无法解析',
      suggestion: '建议人工复核此合同',
    }],
    summary: `AI审核输出格式异常（已尝试${attemptedProviders.size}个provider，重试${maxRetries}次），已降级到人工审核建议`,
    provider: 'manual-fallback',
    degraded: true,
  }
}
