import { isMaskedApiKey, resolveRuntimeModel } from '@/lib/configs/runtime'
import type { AIConfigValue } from '@/lib/configs/types'

export interface AIProviderProbeResult {
  ok: boolean
  provider_kind: string
  api_format: string
  base_url: string
  model: string
  latency_ms: number
  status?: number
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  message: string
  error?: string
  checked_at: string
}

export interface AIProviderModelInfo {
  id: string
  owned_by?: string
}

export interface AIProviderModelListResult {
  ok: boolean
  provider_kind: string
  api_format: string
  base_url: string
  models: AIProviderModelInfo[]
  latency_ms: number
  status?: number
  message: string
  error?: string
  checked_at: string
}

type JsonRecord = Record<string, unknown>

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    return ''
  }
  const url = new URL(trimmed)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (!pathname || pathname === '/') {
    url.pathname = '/v1'
  } else if (!pathname.endsWith('/v1') && !pathname.includes('/v1/')) {
    url.pathname = `${pathname}/v1`
  } else {
    url.pathname = pathname
  }
  return url.toString().replace(/\/+$/, '')
}

export function getAIProviderRuntimeSignature(value: AIConfigValue): string {
  const providerKind = value.provider_kind || 'openai_compatible'
  const apiFormat = value.api_format || (providerKind === 'lm_studio' ? 'lm_studio' : 'openai_compatible')
  const baseUrl = value.base_url ? normalizeBaseUrl(value.base_url) : ''
  const model = resolveRuntimeModel(value)
  return [providerKind, apiFormat, baseUrl, model].join('|')
}

function getHeaders(apiKey: string | undefined): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (apiKey && !isMaskedApiKey(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function getTimeout(value: AIConfigValue): number {
  return Math.min(Math.max(value.timeout_ms || 10000, 1000), 120000)
}

function getUsage(payload: JsonRecord): AIProviderProbeResult['usage'] {
  const usage = payload.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return undefined
  }
  const record = usage as JsonRecord
  return {
    prompt_tokens: typeof record.prompt_tokens === 'number' ? record.prompt_tokens : undefined,
    completion_tokens: typeof record.completion_tokens === 'number' ? record.completion_tokens : undefined,
    total_tokens: typeof record.total_tokens === 'number' ? record.total_tokens : undefined,
  }
}

function getModelListUrls(baseUrl: string, providerKind: string): string[] {
  const urls = [`${baseUrl}/models`]
  if (providerKind === 'lm_studio') {
    try {
      const parsed = new URL(baseUrl)
      const lmStudioApiUrl = `${parsed.origin}/api/v1/models`
      if (!urls.includes(lmStudioApiUrl)) {
        urls.push(lmStudioApiUrl)
      }
    } catch {
      // normalizeBaseUrl already validated URL syntax before this helper is called.
    }
  }
  return urls
}

function getModelId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as JsonRecord
  const candidate = record.id ?? record.model ?? record.name
  return typeof candidate === 'string' && candidate.trim() ? candidate : null
}

function getModelOwner(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const owner = (value as JsonRecord).owned_by
  return typeof owner === 'string' ? owner : undefined
}

function getModels(payload: JsonRecord): AIProviderModelInfo[] {
  const source = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : []
  const seen = new Set<string>()
  const models: AIProviderModelInfo[] = []
  for (const item of source) {
    const id = getModelId(item)
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    models.push({ id, owned_by: getModelOwner(item) })
  }
  return models
}

export async function probeAIProvider(value: AIConfigValue): Promise<AIProviderProbeResult> {
  const startedAt = Date.now()
  const providerKind = value.provider_kind || 'openai_compatible'
  const apiFormat = value.api_format || (providerKind === 'lm_studio' ? 'lm_studio' : 'openai_compatible')
  const model = resolveRuntimeModel(value)

  if (providerKind === 'builtin' || providerKind === 'rule_engine' || value.model === 'rule-engine') {
    return {
      ok: true,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: '',
      model: value.model || 'rule-engine',
      latency_ms: Date.now() - startedAt,
      message: '规则引擎为内置兜底能力，不代表 AI 模型调用通过。',
      checked_at: new Date().toISOString(),
    }
  }

  if (!value.base_url) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: '',
      model,
      latency_ms: Date.now() - startedAt,
      message: '缺少 Base URL，无法测试连接。',
      error: 'missing_base_url',
      checked_at: new Date().toISOString(),
    }
  }

  if (!model) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: value.base_url,
      model,
      latency_ms: Date.now() - startedAt,
      message: '缺少模型 ID，无法测试连接。',
      error: 'missing_model',
      checked_at: new Date().toISOString(),
    }
  }

  if (!['openai_compatible', 'lm_studio', 'openai'].includes(providerKind) && !['openai_compatible', 'lm_studio'].includes(apiFormat)) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: value.base_url,
      model,
      latency_ms: Date.now() - startedAt,
      message: '当前连接测试只覆盖 OpenAI-compatible / LM Studio；该 Provider 可保存为草稿，但不能用此按钮证明可用。',
      error: 'unsupported_probe_format',
      checked_at: new Date().toISOString(),
    }
  }

  const baseUrl = normalizeBaseUrl(value.base_url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getTimeout(value))

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: getHeaders(value.api_key),
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a connection probe. Reply with OK only.' },
          { role: 'user', content: 'ping' },
        ],
        temperature: 0,
        max_tokens: 8,
        stream: false,
      }),
    })

    const text = await response.text()
    let payload: JsonRecord = {}
    try {
      payload = text ? JSON.parse(text) as JsonRecord : {}
    } catch {
      payload = {}
    }

    if (!response.ok) {
      const message = typeof payload.error === 'object' && payload.error && 'message' in payload.error
        ? String((payload.error as JsonRecord).message)
        : text.slice(0, 300)
      return {
        ok: false,
        provider_kind: providerKind,
        api_format: apiFormat,
        base_url: baseUrl,
        model,
        latency_ms: Date.now() - startedAt,
        status: response.status,
        message: '连接测试失败。',
        error: message || `HTTP ${response.status}`,
        checked_at: new Date().toISOString(),
      }
    }

    return {
      ok: true,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: baseUrl,
      model,
      latency_ms: Date.now() - startedAt,
      status: response.status,
      usage: getUsage(payload),
      message: '连接测试通过；这只证明当前草稿 Provider 可调用，不等于正式审核已使用该模型。',
      checked_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: baseUrl,
      model,
      latency_ms: Date.now() - startedAt,
      message: '连接测试异常。',
      error: error instanceof Error ? error.message : String(error),
      checked_at: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function listAIProviderModels(value: AIConfigValue): Promise<AIProviderModelListResult> {
  const startedAt = Date.now()
  const providerKind = value.provider_kind || 'openai_compatible'
  const apiFormat = value.api_format || (providerKind === 'lm_studio' ? 'lm_studio' : 'openai_compatible')

  if (providerKind === 'builtin' || providerKind === 'rule_engine' || value.model === 'rule-engine') {
    return {
      ok: true,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: '',
      models: [{ id: 'rule-engine', owned_by: 'builtin' }],
      latency_ms: Date.now() - startedAt,
      message: '规则引擎为内置兜底能力，不需要远端模型列表。',
      checked_at: new Date().toISOString(),
    }
  }

  if (!value.base_url) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: '',
      models: [],
      latency_ms: Date.now() - startedAt,
      message: '缺少 Base URL，无法获取模型列表。',
      error: 'missing_base_url',
      checked_at: new Date().toISOString(),
    }
  }

  if (!['openai_compatible', 'lm_studio', 'openai'].includes(providerKind) && !['openai_compatible', 'lm_studio'].includes(apiFormat)) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: value.base_url,
      models: [],
      latency_ms: Date.now() - startedAt,
      message: '当前模型列表只覆盖 OpenAI-compatible / LM Studio。',
      error: 'unsupported_model_list_format',
      checked_at: new Date().toISOString(),
    }
  }

  const baseUrl = normalizeBaseUrl(value.base_url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getTimeout(value))
  let lastStatus: number | undefined
  let lastError = ''

  try {
    for (const url of getModelListUrls(baseUrl, providerKind)) {
      const response = await fetch(url, {
        method: 'GET',
        headers: getHeaders(value.api_key),
        signal: controller.signal,
      })
      lastStatus = response.status
      const text = await response.text()
      let payload: JsonRecord = {}
      try {
        payload = text ? JSON.parse(text) as JsonRecord : {}
      } catch {
        payload = {}
      }

      if (!response.ok) {
        const message = typeof payload.error === 'object' && payload.error && 'message' in payload.error
          ? String((payload.error as JsonRecord).message)
          : text.slice(0, 300)
        lastError = message || `HTTP ${response.status}`
        continue
      }

      const models = getModels(payload)
      if (models.length > 0) {
        return {
          ok: true,
          provider_kind: providerKind,
          api_format: apiFormat,
          base_url: baseUrl,
          models,
          latency_ms: Date.now() - startedAt,
          status: response.status,
          message: '模型列表获取成功；保存并发布后才会进入正式运行时。',
          checked_at: new Date().toISOString(),
        }
      }
      lastError = '模型列表为空或返回格式无法识别。'
    }

    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: baseUrl,
      models: [],
      latency_ms: Date.now() - startedAt,
      status: lastStatus,
      message: '模型列表获取失败。',
      error: lastError || 'empty_model_list',
      checked_at: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ok: false,
      provider_kind: providerKind,
      api_format: apiFormat,
      base_url: baseUrl,
      models: [],
      latency_ms: Date.now() - startedAt,
      status: lastStatus,
      message: '模型列表获取异常。',
      error: error instanceof Error ? error.message : String(error),
      checked_at: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}
