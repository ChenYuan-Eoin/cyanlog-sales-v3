// AI 模型路由与降级链
// 运行时顺序：配置中心已发布 AI_CONFIG 实例池 -> 环境变量默认实例 -> 规则引擎 -> 人工建议

import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { listPublishedAIProviders, type PublishedAIProviderConfig } from '@/lib/configs/runtime'
import { executeRules } from '@/lib/rules/engine'
import { validateAIOutput } from '@/lib/validation/ai-output'
import { generateWithLmStudioCli, probeLmStudioCliModel } from '@/lib/ai/lm-studio-cli'
import { normalizeOpenAICompatibleBaseUrl, openAICompatibleModelsUrl } from '@/lib/ai/openai-compatible'

export interface ReviewOptions {
  preferredProvider?: string
  orgId?: string
  skillContext?: {
    source?: unknown
    outputSchema?: unknown
    compiledFrom?: unknown
    rules?: Array<{
      code?: string | null
      version?: number | null
      clause_category?: string | null
      target_field?: string | null
      field_hints?: string[] | null
    }>
  }
}

export interface AIProvider {
  id: string
  name: string
  timeout: number
  providerKind: 'openai_compatible' | 'builtin'
  config: PublishedAIProviderConfig
}

export type AITransport =
  | 'openai_compatible_http'
  | 'lm_studio_cli'
  | 'builtin_rule_engine'
  | 'manual_fallback'

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
  transport: AITransport
  degraded: boolean
  attemptErrors?: string[]
  validationWarnings?: string[]
  droppedRiskCount?: number
  inputStats?: ReviewInputStats
}

export interface ReviewInputStats {
  original_text_length: number
  submitted_text_length: number
  estimated_page_count: number
  total_chunk_count: number
  selected_chunk_count: number
  character_coverage_ratio: number
  selection_strategy: 'full_text' | 'balanced_chunked' | 'leading_truncation'
  coverage_limited: boolean
}

export interface TextGenerationResult {
  text: string
  provider: string
  model: string
  providerKind: 'openai_compatible' | 'manual'
  transport: AITransport
  degraded: boolean
  attemptErrors?: string[]
}

interface HealthRecord {
  healthy: boolean
  checkedAt: number
}

type ProviderCallResult = {
  stream: ReadableStream
  transport: AITransport
  attemptErrors?: string[]
  inputStats?: ReviewInputStats
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

function providerAuthHeaders(provider: AIProvider): HeadersInit | undefined {
  const apiKey = providerApiKey(provider)
  if (!apiKey) {
    return undefined
  }
  return { Authorization: `Bearer ${apiKey}` }
}

function providerApiKey(provider: AIProvider): string | undefined {
  const apiKey = provider.config.api_key?.trim()
  if (!apiKey || apiKey === 'not-needed') {
    return undefined
  }
  return apiKey
}

function openAIOptions(provider: AIProvider) {
  const apiKey = providerApiKey(provider)
  return {
    baseURL: normalizeOpenAICompatibleBaseUrl(provider.config.base_url),
    ...(apiKey ? { apiKey } : {}),
  }
}

function supportsTemperature(provider: AIProvider): boolean {
  const model = provider.config.model.toLowerCase()
  return !(
    model.startsWith('gpt-5')
    || model.includes('thinking')
    || model.includes('reasoning')
  )
}

async function isProviderHealthy(provider: AIProvider): Promise<boolean> {
  if (provider.providerKind !== 'openai_compatible') {
    return true
  }

  const isLocal = isLocalEndpoint(provider.config.base_url)
  if (!isLocal && !providerApiKey(provider)) {
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(openAICompatibleModelsUrl(provider.config.base_url), {
      signal: controller.signal,
      headers: providerAuthHeaders(provider),
    })
    clearTimeout(timeout)
    const healthy = res.ok || await canUseLmStudioCli(provider)
    HEALTH_CACHE.set(provider.id, { healthy, checkedAt: now })
    return healthy
  } catch {
    const healthy = await canUseLmStudioCli(provider)
    HEALTH_CACHE.set(provider.id, { healthy, checkedAt: now })
    return healthy
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
      display_name: '本地模型实例',
      level: 1,
      name: '本地模型实例',
      profile: 'local_primary',
      provider_kind: 'openai_compatible',
      base_url: process.env.LOCAL_MODEL_URL || 'http://127.0.0.1:1234/v1',
      api_key: process.env.LOCAL_MODEL_API_KEY || undefined,
      model: process.env.LOCAL_MODEL_NAME || 'local-model',
      timeout_ms: 120_000,
      enabled: true,
      routing: { max_pages: 15, strategy: 'full' },
      stages: ['semantic_review', 'comment_patch_draft', 'report_summary'],
    },
    {
      config_id: 'env-cloud',
      key: 'AI_SALES_CLOUD_BACKUP',
      display_name: '销售云端模型实例',
      level: 2,
      name: '销售云端模型实例',
      profile: 'sales_cloud_backup',
      provider_kind: 'openai_compatible',
      base_url: process.env.AI_GATEWAY_URL || 'https://cloud.yiyongai.cn/v1',
      api_key: process.env.AI_GATEWAY_API_KEY,
      model: process.env.AI_MODEL || 'claude-sonnet-4-6',
      timeout_ms: 240_000,
      enabled: true,
      routing: { max_pages: 80, strategy: 'chunked' },
      stages: ['semantic_review', 'tender_long_document_parse', 'comment_patch_draft', 'report_summary'],
    },
    {
      config_id: 'env-rule',
      key: 'AI_RULE_FALLBACK',
      display_name: '规则兜底执行器',
      level: 3,
      name: '规则兜底执行器',
      profile: 'rule_engine',
      provider_kind: 'builtin',
      base_url: '',
      api_key: undefined,
      model: 'rule-engine',
      timeout_ms: 1_000,
      enabled: true,
      routing: { max_pages: 999, strategy: 'rule' },
      stages: ['structured_rules', 'rule_fallback'],
    },
  ]
}

async function loadProviders(orgId?: string): Promise<AIProvider[]> {
  const published = orgId ? await listPublishedAIProviders(orgId).catch(() => []) : []
  const configs = published.length > 0 ? published : getDefaultProviders()

  return configs
    .filter((config) => config.enabled)
    .sort((left, right) => (
      providerRuntimeTier(left) - providerRuntimeTier(right)
      || left.level - right.level
    ))
    .map((config) => ({
      id: config.key,
      name: config.profile || config.name || config.key,
      timeout: config.timeout_ms,
      providerKind: config.provider_kind || (config.model === 'rule-engine' ? 'builtin' : 'openai_compatible'),
      config,
    }))
}

function providerRuntimeTier(config: PublishedAIProviderConfig): number {
  if ((config.provider_kind || (config.model === 'rule-engine' ? 'builtin' : 'openai_compatible')) === 'builtin') {
    return 3
  }
  return isLocalEndpoint(config.base_url) ? 1 : 2
}

function matchesProvider(provider: AIProvider, preferredProvider: string): boolean {
  const needle = preferredProvider.toLowerCase()
  if (needle === 'local' || needle === 'pool:local') {
    return provider.providerKind === 'openai_compatible' && isLocalEndpoint(provider.config.base_url)
  }
  if (needle === 'cloud' || needle === 'pool:cloud') {
    return provider.providerKind === 'openai_compatible' && !isLocalEndpoint(provider.config.base_url)
  }
  if (needle === 'rule-engine' || needle === 'executor:rule-engine') {
    return provider.providerKind === 'builtin'
  }
  if (needle.startsWith('stage:')) {
    const stage = needle.slice('stage:'.length)
    return (provider.config.stages || []).map((item) => item.toLowerCase()).includes(stage)
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

  const chunkedCloudIndex = providers.findIndex((provider) => (
    provider.providerKind !== 'builtin'
    && !isLocalEndpoint(provider.config.base_url)
    && provider.config.routing?.strategy === 'chunked'
  ))
  if (chunkedCloudIndex >= 0) {
    return chunkedCloudIndex
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
    if (needle === 'pool:local') {
      return normalizedId.includes('local')
    }
    if (needle === 'cloud') {
      return normalizedId.includes('cloud')
    }
    if (needle === 'pool:cloud') {
      return normalizedId.includes('cloud')
    }
    if (needle === 'rule-engine' || needle === 'executor:rule-engine') {
      return normalizedId.includes('rule')
    }
    if (needle.startsWith('stage:')) {
      return true
    }
    return false
  })
}

type ReviewTextChunk = {
  index: number
  start: number
  end: number
  content: string
  score: number
}

function providerInputBudget(provider: AIProvider): number {
  if (isLocalEndpoint(provider.config.base_url)) {
    const pages = provider.config.routing?.max_pages || 15
    return Math.min(24_000, Math.max(8_000, pages * 1200))
  }

  if (provider.config.routing?.strategy === 'chunked') {
    const pages = provider.config.routing.max_pages || 80
    return Math.min(120_000, Math.max(24_000, pages * 1200))
  }

  return 32_000
}

function buildReviewChunks(text: string): ReviewTextChunk[] {
  const chunkSize = 5000
  const overlap = 400
  const chunks: ReviewTextChunk[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize)
    chunks.push({
      index,
      start,
      end,
      content: text.slice(start, end),
      score: 0,
    })
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
    index += 1
  }

  return chunks
}

function reviewSignalTerms(skillContext?: ReviewOptions['skillContext']): string[] {
  const ruleHints = (skillContext?.rules || []).flatMap((rule) => rule.field_hints || [])
  return Array.from(new Set([
    ...ruleHints,
    '付款',
    '退款',
    '验收',
    '默示验收',
    '违约',
    '赔偿',
    '责任上限',
    '保密',
    '知识产权',
    '源代码',
    '数据',
    'SLA',
    '续约',
    '争议解决',
    '税率',
    '合同金额',
    '收款',
  ].map((term) => term.trim()).filter(Boolean)))
}

function scoreReviewChunks(chunks: ReviewTextChunk[], skillContext?: ReviewOptions['skillContext']): ReviewTextChunk[] {
  const terms = reviewSignalTerms(skillContext)
  return chunks.map((chunk) => {
    const score = terms.reduce((total, term) => (
      chunk.content.includes(term) ? total + 1 : total
    ), 0)
    return { ...chunk, score }
  })
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Array<{ start: number; end: number }> = []

  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (!last || interval.start > last.end) {
      merged.push({ ...interval })
    } else {
      last.end = Math.max(last.end, interval.end)
    }
  }

  return merged
}

function coverageRatio(textLength: number, selected: ReviewTextChunk[]) {
  if (textLength <= 0) return 1
  const covered = mergeIntervals(selected.map((chunk) => ({ start: chunk.start, end: chunk.end })))
    .reduce((total, interval) => total + interval.end - interval.start, 0)
  return Math.min(1, covered / textLength)
}

function selectBalancedChunks(
  chunks: ReviewTextChunk[],
  budget: number,
  skillContext?: ReviewOptions['skillContext']
): ReviewTextChunk[] {
  if (chunks.length === 0) return []
  const selected = new Map<number, ReviewTextChunk>()
  const add = (chunk: ReviewTextChunk | undefined) => {
    if (!chunk) return
    selected.set(chunk.index, chunk)
  }

  add(chunks[0])
  add(chunks[chunks.length - 1])

  for (const chunk of scoreReviewChunks(chunks, skillContext)
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)) {
    add(chunks[chunk.index])
    const length = Array.from(selected.values()).reduce((total, item) => total + item.content.length, 0)
    if (length >= budget) break
  }

  const currentLength = () => Array.from(selected.values()).reduce((total, item) => total + item.content.length, 0)
  const targetAdditional = chunks.length - selected.size
  const step = targetAdditional > 0 ? chunks.length / (targetAdditional + 1) : chunks.length
  for (let cursor = 1; currentLength() < budget && selected.size < chunks.length; cursor += 1) {
    const index = Math.min(chunks.length - 1, Math.max(0, Math.round(step * cursor)))
    add(chunks[index])
    if (cursor > chunks.length * 2) {
      break
    }
  }
  for (const chunk of chunks) {
    if (currentLength() >= budget) {
      break
    }
    add(chunk)
  }

  return Array.from(selected.values())
    .sort((left, right) => left.start - right.start)
    .reduce<ReviewTextChunk[]>((acc, chunk) => {
      const currentLength = acc.reduce((total, item) => total + item.content.length, 0)
      if (currentLength < budget || acc.length === 0) acc.push(chunk)
      return acc
    }, [])
}

function prepareContractReviewInput(
  contractText: string,
  provider: AIProvider,
  skillContext?: ReviewOptions['skillContext']
): { text: string; stats: ReviewInputStats } {
  const budget = providerInputBudget(provider)
  const estimatedPageCount = estimatePageCount(contractText)

  if (contractText.length <= budget) {
    return {
      text: contractText,
      stats: {
        original_text_length: contractText.length,
        submitted_text_length: contractText.length,
        estimated_page_count: estimatedPageCount,
        total_chunk_count: 1,
        selected_chunk_count: 1,
        character_coverage_ratio: 1,
        selection_strategy: 'full_text',
        coverage_limited: false,
      },
    }
  }

  const isCloudChunked = !isLocalEndpoint(provider.config.base_url) && provider.config.routing?.strategy === 'chunked'
  if (!isCloudChunked) {
    const submitted = contractText.slice(0, budget)
    return {
      text: submitted,
      stats: {
        original_text_length: contractText.length,
        submitted_text_length: submitted.length,
        estimated_page_count: estimatedPageCount,
        total_chunk_count: Math.ceil(contractText.length / budget),
        selected_chunk_count: 1,
        character_coverage_ratio: submitted.length / contractText.length,
        selection_strategy: 'leading_truncation',
        coverage_limited: true,
      },
    }
  }

  const chunks = buildReviewChunks(contractText)
  const selected = selectBalancedChunks(chunks, budget, skillContext)
  const text = selected.map((chunk) => (
    `[合同片段 ${chunk.index + 1}/${chunks.length} | 原文位置 ${chunk.start}-${chunk.end}]\n${chunk.content}`
  )).join('\n\n')
  const ratio = coverageRatio(contractText.length, selected)

  return {
    text,
    stats: {
      original_text_length: contractText.length,
      submitted_text_length: selected.reduce((total, chunk) => total + chunk.content.length, 0),
      estimated_page_count: estimatedPageCount,
      total_chunk_count: chunks.length,
      selected_chunk_count: selected.length,
      character_coverage_ratio: ratio,
      selection_strategy: 'balanced_chunked',
      coverage_limited: ratio < 0.9,
    },
  }
}

async function canUseLmStudioCli(provider: AIProvider): Promise<boolean> {
  if (provider.providerKind !== 'openai_compatible' || !isLocalEndpoint(provider.config.base_url)) {
    return false
  }

  return await probeLmStudioCliModel(provider.config.model) === 'ready'
}

async function callLocalCliIfReady(
  provider: AIProvider,
  system: string,
  prompt: string,
  abortSignal?: AbortSignal
): Promise<string | null> {
  if (!(await canUseLmStudioCli(provider))) {
    return null
  }

  return generateWithLmStudioCli({
    model: provider.config.model,
    system,
    prompt,
    timeoutMs: provider.timeout,
    signal: abortSignal,
  })
}

function buildSkillBoundPrompt(provider: AIProvider, skillContext?: ReviewOptions['skillContext']) {
  const base = isLocalEndpoint(provider.config.base_url)
    ? '你是 ONES 业务运营合同审核角色。'
    : '你是 ONES 业务运营合同审核角色，负责把合同风险转化为可追溯的风险项、销售谈判建议和 Word 批注意图。'
  const rules = (skillContext?.rules || [])
    .filter((rule) => rule.code)
    .map((rule) => {
      const hints = Array.isArray(rule.field_hints) && rule.field_hints.length > 0
        ? ` hints=${rule.field_hints.join('/')}`
        : ''
      return `${rule.code}@v${rule.version ?? 'x'} ${rule.clause_category || ''} ${rule.target_field || ''}${hints}`.trim()
    })
    .join('\n')

  return [
    base,
    '只能依据配置中心已发布规则、SkillBundle、模型策略和合同原文判断，不得编造未在原文中出现的数字、日期、主体或条款。',
    '只输出高置信风险，最多 5 项；如果风险不能同时绑定规则和原文证据，就不要输出该风险。',
    '每条 evidence 必须是合同原文的连续片段，不能摘要、不能跨条款拼接，并且必须包含所选规则的一项 hints。',
    '规则编码和版本必须来自可用规则快照，例如 R001@v3 代表 ruleCode=R001、ruleVersion=3。',
    '不要为了覆盖所有规则而枚举风险；只输出确实命中的风险。无法正式命中时返回 {"risks":[],"summary":"未发现可定位风险"}。',
    '输出必须是 JSON 对象，不要 Markdown，不要解释性前后缀。',
    'JSON schema:',
    '{',
    '  "risks": [',
    '    {',
    '      "ruleCode": "R001-R015 中的规则编码",',
    '      "ruleVersion": 1,',
    '      "level": "red|yellow|green",',
    '      "title": "风险标题",',
    '      "description": "问题描述，必须对应规则和证据",',
    '      "suggestion": "销售谈判或合同修改建议",',
    '      "counterparty": "可选，对价或谈判口径",',
    '      "evidence": ["合同原文中的连续片段，禁止摘要或改写"]',
    '    }',
    '  ],',
    '  "summary": "总体评估"',
    '}',
    '二次校验要求：每个风险必须有规则编码、原文证据、风险说明、建议动作；证据不能只是产品名、公司名、单个数字或通用词。',
    rules ? `可用规则快照:\n${rules}` : '可用规则快照：缺失，必须返回空 risks 并说明 skill 未绑定。',
    skillContext?.source ? `规则源与参考资产: ${JSON.stringify(skillContext.source).slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n')
}

async function callOpenAICompatibleProvider(
  provider: AIProvider,
  contractText: string,
  skillContext?: ReviewOptions['skillContext'],
  abortSignal?: AbortSignal
): Promise<ProviderCallResult> {
  const attemptErrors: string[] = []
  const isLocalProvider = isLocalEndpoint(provider.config.base_url)
  const preparedInput = prepareContractReviewInput(contractText, provider, skillContext)

  const prompt = buildSkillBoundPrompt(provider, skillContext)
  const userPrompt = [
    '请审核以下合同。',
    '如果合同被分成多个片段，片段均来自同一份原文；风险证据必须逐字引用片段中的原文连续内容。',
    `输入覆盖率：${Math.round(preparedInput.stats.character_coverage_ratio * 100)}%，选择策略：${preparedInput.stats.selection_strategy}。`,
    '',
    preparedInput.text,
  ].join('\n')
  const httpCall = async (): Promise<ProviderCallResult> => {
    if (isLocalProvider && !providerApiKey(provider)) {
      throw new Error('LM Studio HTTP Token 未配置；已尝试本机 CLI 通道')
    }

    const gateway = createOpenAI(openAIOptions(provider))
    const result = await generateText({
      model: gateway.chat(provider.config.model),
      system: prompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      maxOutputTokens: isLocalEndpoint(provider.config.base_url) ? 2000 : 4000,
      ...(supportsTemperature(provider) ? { temperature: 0.3 } : {}),
      abortSignal,
    })

    const encoder = new TextEncoder()
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(result.text))
          controller.close()
        },
      }),
      transport: 'openai_compatible_http',
      attemptErrors,
      inputStats: preparedInput.stats,
    }
  }

  try {
    return await httpCall()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    attemptErrors.push(`${provider.id}: ${isLocalProvider ? 'local_http_failed' : 'http_failed'}: ${message}`)
    if (!isLocalProvider) {
      throw error
    }
  }

  const localCliText = await callLocalCliIfReady(
    provider,
    prompt,
    userPrompt,
    abortSignal
  )
  if (localCliText) {
    const encoder = new TextEncoder()
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(localCliText))
          controller.close()
        },
      }),
      transport: 'lm_studio_cli',
      attemptErrors,
      inputStats: preparedInput.stats,
    }
  }

  throw new Error(attemptErrors[attemptErrors.length - 1] || 'local HTTP failed and LM Studio CLI is unavailable')
}

async function callTextGenerationProvider(
  provider: AIProvider,
  system: string,
  prompt: string,
  abortSignal?: AbortSignal
): Promise<{ text: string; transport: AITransport; attemptErrors: string[] }> {
  if (provider.providerKind !== 'openai_compatible') {
    throw new Error('内置规则引擎不支持合同正文生成')
  }

  const isLocalProvider = isLocalEndpoint(provider.config.base_url)
  if (isLocalProvider && !providerApiKey(provider)) {
    const localCliText = await callLocalCliIfReady(provider, system, prompt, abortSignal)
    if (localCliText) {
      return {
        text: localCliText.trim(),
        transport: 'lm_studio_cli',
        attemptErrors: [`${provider.id}: local_http_failed: LM Studio HTTP Token 未配置；已尝试本机 CLI 通道`],
      }
    }
    throw new Error('LM Studio HTTP Token 未配置，且本机 CLI 通道不可用')
  }

  const gateway = createOpenAI(openAIOptions(provider))

  try {
    const result = await generateText({
      model: gateway.chat(provider.config.model),
      system,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: isLocalEndpoint(provider.config.base_url) ? 4000 : 8000,
      ...(supportsTemperature(provider) ? { temperature: 0.2 } : {}),
      abortSignal,
    })

    return {
      text: result.text.trim(),
      transport: 'openai_compatible_http',
      attemptErrors: [],
    }
  } catch (error) {
    if (!isLocalProvider) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    const attemptErrors = [`${provider.id}: local_http_failed: ${message}`]
    const localCliText = await callLocalCliIfReady(provider, system, prompt, abortSignal)
    if (localCliText) {
      return {
        text: localCliText.trim(),
        transport: 'lm_studio_cli',
        attemptErrors,
      }
    }
    throw error
  }
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
  skillContext?: ReviewOptions['skillContext'],
  abortSignal?: AbortSignal
): Promise<ProviderCallResult> {
  if (provider.providerKind === 'builtin' || provider.config.model === 'rule-engine') {
    return {
      stream: await callRuleEngineProvider(contractText, orgId),
      transport: 'builtin_rule_engine',
    }
  }

  return callOpenAICompatibleProvider(provider, contractText, skillContext, abortSignal)
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
  transport: AITransport
  degraded: boolean
  attemptErrors: string[]
  inputStats?: ReviewInputStats
}> {
  const normalizedOptions = normalizeOptions(options)
  const { preferredProvider, orgId, skillContext } = normalizedOptions
  const errors: string[] = []
  const providers = buildProviderChain(await loadProviders(orgId), contractText, preferredProvider)

  for (const provider of providers) {
    if (!(await isProviderHealthy(provider))) {
      errors.push(`${provider.id}: health_check_failed`)
      continue
    }

    const abortController = new AbortController()
    try {
      const callResult = await withTimeout(
        callProvider(provider, contractText, orgId, skillContext, abortController.signal),
        provider.timeout,
        abortController
      )

      return {
        stream: callResult.stream,
        provider: provider.id,
        model: provider.config.model,
        providerKind: provider.providerKind,
        transport: callResult.transport,
        degraded: provider.providerKind === 'builtin' || Boolean(callResult.inputStats?.coverage_limited),
        attemptErrors: [...errors, ...(callResult.attemptErrors || [])],
        inputStats: callResult.inputStats,
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
    transport: 'manual_fallback',
    degraded: true,
    attemptErrors: [...errors],
  }
}

export async function reviewWithFailoverSync(
  contractText: string,
  options?: string | ReviewOptions,
  maxRetries: number = 3
): Promise<SyncReviewResult> {
  const normalizedOptions = normalizeOptions(options)
  let lastError: string | undefined
  let lastInputStats: ReviewInputStats | undefined
  const attemptedProviders = new Set<string>()
  const attemptErrors: string[] = []

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const effectivePreferredProvider = normalizedOptions.preferredProvider
      && hasAttemptedPreferredProvider(normalizedOptions.preferredProvider, attemptedProviders)
      ? undefined
      : normalizedOptions.preferredProvider

    const {
      stream,
      provider,
      model,
      providerKind,
      transport,
      degraded,
      attemptErrors: providerAttemptErrors,
      inputStats,
    } = await reviewWithFailover(contractText, {
      ...normalizedOptions,
      preferredProvider: effectivePreferredProvider,
    })

    attemptedProviders.add(provider)
    attemptErrors.push(...providerAttemptErrors)
    lastInputStats = inputStats

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

    const validation = validateAIOutput(fullText, {
      contractText,
      rules: normalizedOptions.skillContext?.rules,
      requireEvidenceInSource: Boolean(normalizedOptions.skillContext),
      requireRuleEvidenceHint: Boolean(normalizedOptions.skillContext),
      allowPartialRiskAcceptance: Boolean(normalizedOptions.skillContext),
    })
    if (validation.valid && validation.data) {
      return {
        risks: validation.data.risks,
        summary: validation.data.summary,
        provider,
        model,
        providerKind,
        transport,
        degraded,
        attemptErrors: [...attemptErrors],
        validationWarnings: validation.warnings || [],
        droppedRiskCount: validation.droppedRisks || 0,
        inputStats,
      }
    }

    lastError = validation.error
    if (lastError) {
      attemptErrors.push(`${provider}: output_validation_failed: ${lastError}`)
    }
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
    transport: 'manual_fallback',
    degraded: true,
    attemptErrors: [...attemptErrors],
    validationWarnings: lastError ? [lastError] : [],
    droppedRiskCount: 0,
    inputStats: lastInputStats,
  }
}

export async function generateTextWithFailover(
  prompt: string,
  options?: string | (ReviewOptions & { system?: string; timeoutMs?: number }),
  maxRetries: number = 1
): Promise<TextGenerationResult> {
  const normalizedOptions = normalizeOptions(options) as ReviewOptions & { timeoutMs?: number }
  const system = typeof options === 'object' && options.system
    ? options.system
    : '你是企业合同起草助手。请直接输出合同正文，不要输出解释、Markdown 或 JSON。'
  const providers = buildProviderChain(
    await loadProviders(normalizedOptions.orgId),
    prompt,
    normalizedOptions.preferredProvider
  ).filter((provider) => provider.providerKind === 'openai_compatible')

  const attemptedProviders = new Set<string>()
  let lastError: string | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    for (const provider of providers) {
      if (attemptedProviders.has(provider.id) && attempt === 0) {
        continue
      }
      if (!(await isProviderHealthy(provider))) {
        continue
      }

      const abortController = new AbortController()
      try {
        const result = await withTimeout(
          callTextGenerationProvider(provider, system, prompt, abortController.signal),
          Math.min(provider.timeout, normalizedOptions.timeoutMs || provider.timeout),
          abortController
        )

        if (result.text.length < 10) {
          throw new Error('模型返回内容为空')
        }

        return {
          text: result.text,
          provider: provider.id,
          model: provider.config.model,
          providerKind: 'openai_compatible',
          transport: result.transport,
          degraded: false,
          attemptErrors: result.attemptErrors,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = `${provider.id}: ${message}`
        attemptedProviders.add(provider.id)
        markProviderUnhealthy(provider.id)
      }
    }
  }

  throw new Error(lastError || '没有可用的文本生成模型')
}
