// AI 服务多级故障容错链
// 运行时顺序：配置中心已发布 AI_CONFIG -> 环境变量默认值 -> 规则引擎 -> 人工建议

import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import { listPublishedAIProviders, type PublishedAIProviderConfig } from '@/lib/configs/runtime'
import { executeRules } from '@/lib/rules/engine'
import { validateAIOutput } from '@/lib/validation/ai-output'

export interface ReviewOptions {
  preferredProvider?: string
  orgId?: string
}

export interface AIProvider {
  id: string
  name: string
  timeout: number
  providerKind: 'openai_compatible' | 'builtin'
  config: PublishedAIProviderConfig
}

export interface SyncReviewResult {
  risks: Array<{
    ruleId?: string
    ruleCode?: string
    ruleVersion?: number
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    counterparty?: string
    evidence?: string[]
  }>
  summary: string
  provider: string
  model: string
  providerKind: 'openai_compatible' | 'builtin' | 'manual'
  degraded: boolean
}

interface HealthRecord {
  healthy: boolean
  checkedAt: number
}

const HEALTH_CACHE_TTL = 60_000
const HEALTH_CACHE = new Map<string, HealthRecord>()

function normalizeOptions(options?: string | ReviewOptions): ReviewOptions {
  return typeof options === 'string'
    ? { preferredProvider: options }
    : (options || {})
}

function estimatePageCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = text.split(/\s+/).filter((word) => /^[a-zA-Z]+$/.test(word)).length
  return Math.max(1, Math.ceil(chineseChars / 500 + englishWords / 300))
}

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

async function isProviderHealthy(provider: AIProvider): Promise<boolean> {
  if (provider.providerKind !== 'openai_compatible') {
    return true
  }

  const isLocal = isLocalEndpoint(provider.config.base_url)
  if (!isLocal && !provider.config.api_key) {
    HEALTH_CACHE.set(provider.id, { healthy: false, checkedAt: Date.now() })
    return false
  }

  if (!isLocal) {
    return true
  }

  const now = Date.now()
  const cached = HEALTH_CACHE.get(provider.id)
  if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL) {
    return cached.healthy
  }

  try {
    const base = provider.config.base_url.endsWith('/') ? provider.config.base_url : `${provider.config.base_url}/`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(new URL('models', base), { signal: controller.signal })
    clearTimeout(timeout)
    const healthy = res.ok
    HEALTH_CACHE.set(provider.id, { healthy, checkedAt: now })
    return healthy
  } catch {
    HEALTH_CACHE.set(provider.id, { healthy: false, checkedAt: now })
    return false
  }
}

function markProviderUnhealthy(providerId: string): void {
  HEALTH_CACHE.set(providerId, { healthy: false, checkedAt: Date.now() })
}

function getDefaultProviders(): PublishedAIProviderConfig[] {
  return [
    {
      config_id: 'env-local',
      key: 'AI_LOCAL_PRIMARY',
      display_name: '本地模型',
      level: 1,
      name: '本地模型',
      profile: 'local_primary',
      provider_kind: 'openai_compatible',
      base_url: process.env.LOCAL_MODEL_URL || 'http://localhost:1234/v1',
      api_key: process.env.LOCAL_MODEL_API_KEY || 'not-needed',
      model: process.env.LOCAL_MODEL_NAME || 'local-model',
      timeout_ms: 45_000,
      enabled: true,
      routing: { max_pages: 15, strategy: 'full' },
    },
    {
      config_id: 'env-cloud',
      key: 'AI_SALES_CLOUD_BACKUP',
      display_name: '销售云端模型',
      level: 2,
      name: '销售云端模型',
      profile: 'sales_cloud_backup',
      provider_kind: 'openai_compatible',
      base_url: process.env.AI_GATEWAY_URL || 'https://cloud.yiyongai.cn/v1',
      api_key: process.env.AI_GATEWAY_API_KEY,
      model: process.env.AI_MODEL || 'claude-sonnet-4-6',
      timeout_ms: 20_000,
      enabled: true,
      routing: { max_pages: 80, strategy: 'chunked' },
    },
    {
      config_id: 'env-rule',
      key: 'AI_RULE_FALLBACK',
      display_name: '规则引擎',
      level: 3,
      name: '规则引擎',
      profile: 'rule_engine',
      provider_kind: 'builtin',
      base_url: '',
      api_key: undefined,
      model: 'rule-engine',
      timeout_ms: 1_000,
      enabled: true,
      routing: { max_pages: 999, strategy: 'rule' },
    },
  ]
}

async function loadProviders(orgId?: string): Promise<AIProvider[]> {
  const published = orgId ? await listPublishedAIProviders(orgId).catch(() => []) : []
  const configs = published.length > 0 ? published : getDefaultProviders()

  return configs
    .filter((config) => config.enabled)
    .sort((left, right) => left.level - right.level)
    .map((config) => ({
      id: config.key,
      name: config.profile || config.name || config.key,
      timeout: config.timeout_ms,
      providerKind: config.provider_kind || (config.model === 'rule-engine' ? 'builtin' : 'openai_compatible'),
      config,
    }))
}

function matchesProvider(provider: AIProvider, preferredProvider: string): boolean {
  const needle = preferredProvider.toLowerCase()
  if (needle === 'local') {
    return provider.providerKind === 'openai_compatible' && isLocalEndpoint(provider.config.base_url)
  }
  if (needle === 'cloud') {
    return provider.providerKind === 'openai_compatible' && !isLocalEndpoint(provider.config.base_url)
  }
  if (needle === 'rule-engine') {
    return provider.providerKind === 'builtin'
  }
  return [
    provider.id,
    provider.name,
    provider.config.profile,
    provider.config.display_name,
    provider.config.name,
    provider.config.model,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => value.toLowerCase() === needle)
}

function determineStartIndex(providers: AIProvider[], contractText: string, preferredProvider?: string): number {
  if (preferredProvider) {
    const exactIndex = providers.findIndex((provider) => matchesProvider(provider, preferredProvider))
    if (exactIndex >= 0) {
      return exactIndex
    }
  }

  const pageCount = estimatePageCount(contractText)
  const byRouting = providers.findIndex((provider) => (
    provider.providerKind !== 'builtin'
    && (!provider.config.routing || pageCount <= provider.config.routing.max_pages)
  ))

  if (byRouting >= 0) {
    return byRouting
  }

  const nonBuiltinIndex = providers.findIndex((provider) => provider.providerKind !== 'builtin')
  return nonBuiltinIndex >= 0 ? nonBuiltinIndex : 0
}

function buildProviderChain(providers: AIProvider[], contractText: string, preferredProvider?: string): AIProvider[] {
  if (providers.length === 0) {
    return []
  }

  const startIndex = determineStartIndex(providers, contractText, preferredProvider)
  return providers.slice(startIndex)
}

function hasAttemptedPreferredProvider(preferredProvider: string | undefined, attemptedProviders: Set<string>): boolean {
  if (!preferredProvider) {
    return false
  }

  const needle = preferredProvider.toLowerCase()
  return Array.from(attemptedProviders).some((providerId) => {
    const normalizedId = providerId.toLowerCase()
    if (normalizedId === needle) {
      return true
    }
    if (needle === 'local') {
      return normalizedId.includes('local')
    }
    if (needle === 'cloud') {
      return normalizedId.includes('cloud')
    }
    if (needle === 'rule-engine') {
      return normalizedId.includes('rule')
    }
    return false
  })
}

function truncateTextForProvider(contractText: string, provider: AIProvider): string {
  const inputLimit = isLocalEndpoint(provider.config.base_url) ? 4000 : 8000
  return contractText.substring(0, inputLimit)
}

async function callOpenAICompatibleProvider(
  provider: AIProvider,
  contractText: string,
  abortSignal?: AbortSignal
): Promise<ReadableStream> {
  const gateway = createOpenAI({
    baseURL: provider.config.base_url,
    apiKey: provider.config.api_key || 'not-needed',
  })

  const prompt = isLocalEndpoint(provider.config.base_url)
    ? `你是法务合同审核助手。识别合同风险并以 JSON 格式返回：
{\n  "risks": [{\n    "level": "red|yellow|green",\n    "title": "风险标题",\n    "description": "问题描述",\n    "suggestion": "建议"\n  }],\n  "summary": "总体评估"\n}`
    : `你是一位专业的法务合同审核专家。请分析合同内容并识别风险。
请按以下 JSON 格式返回：
{\n  "risks": [\n    {\n      "level": "red|yellow|green",\n      "title": "风险标题（简短）",\n      "description": "问题详细描述",\n      "suggestion": "建议处理方式"\n    }\n  ],\n  "summary": "总体评估摘要"\n}`

  const result = streamText({
    model: gateway(provider.config.model),
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `请审核以下合同：\n\n${truncateTextForProvider(contractText, provider)}`,
      },
    ],
    maxOutputTokens: isLocalEndpoint(provider.config.base_url) ? 2000 : 4000,
    temperature: 0.3,
    abortSignal,
  })

  return result.toTextStreamResponse().body!
}

async function callRuleEngineProvider(contractText: string, orgId?: string): Promise<ReadableStream> {
  const result = await executeRules(contractText, orgId)
  const encoder = new TextEncoder()
  const chunks = JSON.stringify({
    risks: result.risks,
    summary: result.summary,
  }).match(/.{1,80}/g) || ['{}']
  let index = 0

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
        return
      }
      controller.close()
    },
  })
}

async function callProvider(
  provider: AIProvider,
  contractText: string,
  orgId?: string,
  abortSignal?: AbortSignal
): Promise<ReadableStream> {
  if (provider.providerKind === 'builtin' || provider.config.model === 'rule-engine') {
    return callRuleEngineProvider(contractText, orgId)
  }

  return callOpenAICompatibleProvider(provider, contractText, abortSignal)
}

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

export async function reviewWithFailover(
  contractText: string,
  options?: string | ReviewOptions
): Promise<{
  stream: ReadableStream
  provider: string
  model: string
  providerKind: AIProvider['providerKind'] | 'manual'
  degraded: boolean
}> {
  const { preferredProvider, orgId } = normalizeOptions(options)
  const errors: string[] = []
  const providers = buildProviderChain(await loadProviders(orgId), contractText, preferredProvider)

  for (const provider of providers) {
    if (!(await isProviderHealthy(provider))) {
      continue
    }

    const abortController = new AbortController()
    try {
      const stream = await withTimeout(
        callProvider(provider, contractText, orgId, abortController.signal),
        provider.timeout,
        abortController
      )

      return {
        stream,
        provider: provider.id,
        model: provider.config.model,
        providerKind: provider.providerKind,
        degraded: provider.providerKind === 'builtin',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${provider.id}: ${message}`)
      if (provider.providerKind === 'openai_compatible') {
        markProviderUnhealthy(provider.id)
      }
    }
  }

  const encoder = new TextEncoder()
  const fallbackStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({
        risks: [{
          level: 'yellow',
          title: 'AI 服务暂时不可用',
          description: '所有 AI 提供方均不可用，建议人工审核',
          suggestion: '请法务同事人工审核此合同',
        }],
        summary: 'AI 审核服务暂时不可用，已切换至人工审核建议模式',
        _meta: { degraded: true, errors },
      })))
      controller.close()
    },
  })

  return {
    stream: fallbackStream,
    provider: 'manual-fallback',
    model: 'manual-review',
    providerKind: 'manual',
    degraded: true,
  }
}

export async function reviewWithFailoverSync(
  contractText: string,
  options?: string | ReviewOptions,
  maxRetries: number = 3
): Promise<SyncReviewResult> {
  const normalizedOptions = normalizeOptions(options)
  let lastError: string | undefined
  const attemptedProviders = new Set<string>()

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const effectivePreferredProvider = normalizedOptions.preferredProvider
      && hasAttemptedPreferredProvider(normalizedOptions.preferredProvider, attemptedProviders)
      ? undefined
      : normalizedOptions.preferredProvider

    const { stream, provider, model, providerKind, degraded } = await reviewWithFailover(contractText, {
      ...normalizedOptions,
      preferredProvider: effectivePreferredProvider,
    })

    attemptedProviders.add(provider)

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

    const validation = validateAIOutput(fullText)
    if (validation.valid && validation.data) {
      return {
        risks: validation.data.risks,
        summary: validation.data.summary,
        provider,
        model,
        providerKind,
        degraded,
      }
    }

    lastError = validation.error
    if (provider === 'manual-fallback') {
      break
    }
  }

  return {
    risks: [{
      level: 'yellow',
      title: 'AI 输出格式异常',
      description: lastError || 'AI 输出无法解析',
      suggestion: '建议人工复核此合同',
    }],
    summary: `AI 审核输出格式异常，已降级到人工审核建议（已尝试 ${attemptedProviders.size} 个 provider）`,
    provider: 'manual-fallback',
    model: 'manual-review',
    providerKind: 'manual',
    degraded: true,
  }
}
