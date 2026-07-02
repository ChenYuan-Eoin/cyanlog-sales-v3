import { probeLmStudioCliModel } from '@/lib/ai/lm-studio-cli'
import { normalizeOpenAICompatibleBaseUrl, openAICompatibleModelsUrl } from '@/lib/ai/openai-compatible'

export type AIRuntimeState =
  | 'builtin_ready'
  | 'missing_base_url'
  | 'missing_credential'
  | 'unreachable_in_vercel'
  | 'local_health_ok'
  | 'local_cli_ready'
  | 'local_auth_failed'
  | 'local_health_failed'
  | 'remote_health_ok'
  | 'remote_auth_failed'
  | 'remote_health_failed'
  | 'ready_to_call'
  | 'recent_invocation_passed'
  | 'recent_invocation_partial'
  | 'recent_invocation_failed'

export type AIRuntimeAssessment = {
  runtime_state: AIRuntimeState
  runtime_reason: string
  runtime_action: string | null
  runtime_environment: string
  local_endpoint: boolean
}

export type RuntimeInvocationEvidence = {
  id?: string
  provider?: string | null
  model?: string | null
  status?: string | null
  degraded?: boolean | null
  fallback_reason?: string | null
  error_message?: string | null
  response_meta?: Record<string, unknown> | null
  created_at?: string | null
}

type AssessmentMessageOptions = {
  phaseLabel?: string
  readyAction?: string
}

function runtimeEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (isActualVercelRuntime(env)) return env.VERCEL_ENV || 'vercel'
  return env.NODE_ENV === 'production' ? 'local-production' : 'local-dev'
}

function isActualVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1' && Boolean(env.VERCEL_URL || env.VERCEL_REGION)
}

export function isLoopbackAIBaseUrl(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false
  try {
    const parsed = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

type HealthResult = 'ok' | 'auth_failed' | 'failed'

async function checkLocalModelHealth(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch
): Promise<HealthResult> {
  return checkOpenAICompatibleModelsEndpoint(baseUrl, apiKey, fetchImpl, 1200)
}

async function checkOpenAICompatibleModelsEndpoint(
  baseUrl: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<HealthResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetchImpl(openAICompatibleModelsUrl(baseUrl), {
      signal: controller.signal,
      headers: authHeaders(apiKey),
    })
    clearTimeout(timeout)
    if (response.ok) return 'ok'
    if (response.status === 401 || response.status === 403) return 'auth_failed'
    return 'failed'
  } catch {
    return 'failed'
  }
}

function canProbeRemoteProvider(baseUrl: string): { ok: true } | { ok: false; reason: string } {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') {
      return { ok: false, reason: '云端 Provider 连接测试只允许 HTTPS 地址。' }
    }
    if (isLoopbackAIBaseUrl(baseUrl)) {
      return { ok: false, reason: '本地端点应走本地模型探测，不应作为云端 Provider。' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'Base URL 格式无效。' }
  }
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const ids = data
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const id = (item as { id?: unknown }).id
      return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null
    })
    .filter((id): id is string => Boolean(id))

  return Array.from(new Set(ids)).slice(0, 50)
}

export async function fetchOpenAICompatibleModelIds(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000
): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetchImpl(openAICompatibleModelsUrl(baseUrl), {
      signal: controller.signal,
      headers: authHeaders(apiKey),
    })
    clearTimeout(timeout)
    if (!response.ok) return []
    return extractModelIds(await response.json().catch(() => null))
  } catch {
    return []
  }
}

function authHeaders(apiKey?: string): HeadersInit | undefined {
  if (!apiKey || apiKey === 'not-needed') {
    return undefined
  }
  return { Authorization: `Bearer ${apiKey}` }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function latestInvocationMessage(invocation: RuntimeInvocationEvidence): string {
  const responseMeta = invocation.response_meta || {}
  const attemptError = stringList(responseMeta.attempt_errors)[0]
  return attemptError
    || invocation.error_message
    || invocation.fallback_reason
    || '未记录具体错误'
}

function numberValue(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function tenderLongDocumentQualityIssues(responseMeta: Record<string, unknown>): string[] {
  const issues: string[] = []
  const selectedChunkCount = numberValue(responseMeta.selected_chunk_count)
  const analyzedChunkCount = numberValue(responseMeta.analyzed_chunk_count)
  const textLength = numberValue(responseMeta.text_length)
  const characterCoverageRatio = numberValue(responseMeta.character_coverage_ratio)
  const businessSignalCount = numberValue(responseMeta.business_signal_count)
  const businessSignalDomains = numberValue(responseMeta.business_signal_domains)

  if (selectedChunkCount !== null && analyzedChunkCount !== null && analyzedChunkCount < selectedChunkCount) {
    issues.push(`仅解析 ${analyzedChunkCount}/${selectedChunkCount} 个已选片段`)
  }
  if (textLength !== null && textLength >= 20_000 && (characterCoverageRatio === null || characterCoverageRatio < 0.9)) {
    issues.push(`长文档覆盖率不足 ${Math.round((characterCoverageRatio || 0) * 100)}%`)
  }
  if (businessSignalCount === null || businessSignalCount <= 0) {
    issues.push('未记录业务字段提取信号')
  }
  if (textLength !== null && textLength >= 20_000 && (businessSignalDomains === null || businessSignalDomains < 2)) {
    issues.push(`长文档业务信号领域不足 ${businessSignalDomains ?? 0}/2`)
  }

  return issues
}

function assessLatestInvocation(
  invocation: RuntimeInvocationEvidence | undefined,
  environment: string,
  localEndpoint: boolean,
  messageOptions: AssessmentMessageOptions = {}
): AIRuntimeAssessment | null {
  if (!invocation) return null

  const phaseLabel = messageOptions.phaseLabel || 'semantic_review'
  const responseMeta = invocation.response_meta || {}
  const status = invocation.status || 'unknown'
  const transport = typeof responseMeta.transport === 'string' ? responseMeta.transport : null
  const providerKind = typeof responseMeta.provider_kind === 'string' ? responseMeta.provider_kind : null
  const droppedRiskCount = Number(responseMeta.dropped_risk_count || 0)
  const validationWarnings = stringList(responseMeta.validation_warnings)
  const isOpenAICompatibleHttp = transport === 'openai_compatible_http'
  const isLocalCliTransport = transport === 'lm_studio_cli'
  const isExternalTransport = isOpenAICompatibleHttp || isLocalCliTransport
  const completed = status === 'completed' && !invocation.degraded
  const tenderQualityIssues = phaseLabel === 'tender_long_document_parse'
    ? tenderLongDocumentQualityIssues(responseMeta)
    : []

  if (completed && isExternalTransport && tenderQualityIssues.length > 0) {
    return {
      runtime_state: 'recent_invocation_failed',
      runtime_reason: `最近 ${phaseLabel} 调用未达到长文档验收门禁：${tenderQualityIssues.join('；')}。`,
      runtime_action: '请使用真实标书或长 PDF 重新触发解析，并确认覆盖率、业务字段和分片完整度全部达标。',
      runtime_environment: environment,
      local_endpoint: localEndpoint,
    }
  }

  if (
    completed
    && isOpenAICompatibleHttp
    && providerKind !== 'builtin'
    && droppedRiskCount === 0
    && validationWarnings.length === 0
  ) {
    return {
      runtime_state: 'recent_invocation_passed',
      runtime_reason: `最近 ${phaseLabel} 正式调用已通过：${invocation.model || 'unknown model'} / ${transport}。`,
      runtime_action: null,
      runtime_environment: environment,
      local_endpoint: localEndpoint,
    }
  }

  if (
    completed
    && isLocalCliTransport
    && providerKind !== 'builtin'
    && droppedRiskCount === 0
    && validationWarnings.length === 0
  ) {
    return {
      runtime_state: 'recent_invocation_partial',
      runtime_reason: `最近 ${phaseLabel} 通过本机 LM Studio CLI 完成：${invocation.model || 'unknown model'}。`,
      runtime_action: '这是真实本地模型调用，但不是 OpenAI-compatible HTTP 通道；请保存 LM Studio Token 后再做 HTTP 验收。',
      runtime_environment: environment,
      local_endpoint: localEndpoint,
    }
  }

  if (completed && isExternalTransport) {
    return {
      runtime_state: 'recent_invocation_partial',
      runtime_reason: `最近 ${phaseLabel} 调用完成但存在质量告警：丢弃 ${droppedRiskCount} 项，告警 ${validationWarnings.length} 条。`,
      runtime_action: '请查看 ReviewRun 证据，修正规则转译或模型输出后再验收。',
      runtime_environment: environment,
      local_endpoint: localEndpoint,
    }
  }

  if (status === 'failed' || status === 'degraded' || invocation.degraded || stringList(responseMeta.attempt_errors).length > 0) {
    return {
      runtime_state: 'recent_invocation_failed',
      runtime_reason: `最近 ${phaseLabel} 正式调用未通过：${latestInvocationMessage(invocation)}`,
      runtime_action: '请更换可用 Token/模型网关，或等待供应商限流恢复后重新触发 ReviewRun。',
      runtime_environment: environment,
      local_endpoint: localEndpoint,
    }
  }

  return null
}

export async function assessProviderRuntime(
  input: {
    providerKind: 'openai_compatible' | 'builtin'
    baseUrl?: string
    apiKey?: string
    model?: string
    latestInvocation?: RuntimeInvocationEvidence
    allowLocalCliFallback?: boolean
    checkRemoteHealth?: boolean
    phaseLabel?: string
    readyAction?: string
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  localCliProbe: typeof probeLmStudioCliModel = probeLmStudioCliModel
): Promise<AIRuntimeAssessment> {
  const environment = runtimeEnvironment(env)
  if (input.providerKind === 'builtin') {
    return {
      runtime_state: 'builtin_ready',
      runtime_reason: '内置规则引擎可用，但只代表兜底规则审核。',
      runtime_action: null,
      runtime_environment: environment,
      local_endpoint: false,
    }
  }

  const baseUrl = normalizeOpenAICompatibleBaseUrl(input.baseUrl)
  if (!baseUrl) {
    return {
      runtime_state: 'missing_base_url',
      runtime_reason: 'OpenAI-compatible Provider 缺少 base URL。',
      runtime_action: '在 AI 模型配置中补齐模型服务地址并重新发布。',
      runtime_environment: environment,
      local_endpoint: false,
    }
  }

  const localEndpoint = isLoopbackAIBaseUrl(baseUrl)
  if (localEndpoint && isActualVercelRuntime(env)) {
    return {
      runtime_state: 'unreachable_in_vercel',
      runtime_reason: 'localhost 在 Vercel 函数内指向部署容器，不是用户本机模型服务。',
      runtime_action: '生产环境请改用可公网访问的模型网关；本地模型只可用于本机开发验收。',
      runtime_environment: environment,
      local_endpoint: true,
    }
  }

  if (localEndpoint) {
    const health = await checkLocalModelHealth(baseUrl, input.apiKey, fetchImpl)
    if (health !== 'ok' && input.model && input.allowLocalCliFallback !== false) {
      const cliStatus = await localCliProbe(input.model, { env })
      if (cliStatus === 'ready') {
        return assessLatestInvocation(input.latestInvocation, environment, true, input) || {
          runtime_state: 'local_cli_ready',
          runtime_reason: '本地模型 HTTP 接口未通过，但 LM Studio CLI 可调用已加载模型。',
          runtime_action: '建议补齐 LM Studio Token 以统一 HTTP 调用；当前本机运行可使用 CLI 通道。',
          runtime_environment: environment,
          local_endpoint: true,
        }
      }
    }

    if (health === 'ok') {
      const invocationAssessment = assessLatestInvocation(input.latestInvocation, environment, true, input)
      if (invocationAssessment) return invocationAssessment
    }

    return {
      runtime_state: health === 'ok'
        ? 'local_health_ok'
        : health === 'auth_failed'
          ? 'local_auth_failed'
          : 'local_health_failed',
      runtime_reason: health === 'ok'
        ? '本地模型 /models 健康检查通过。'
        : health === 'auth_failed'
          ? '本地模型服务要求 Bearer Token，当前配置未通过认证。'
          : '本地模型 /models 健康检查失败或超时。',
      runtime_action: health === 'ok'
        ? null
        : health === 'auth_failed'
          ? '在 AI 模型配置中保存 LM Studio Token，或关闭本地服务认证后重新发布。'
          : '请确认 LM Studio/Ollama/OpenAI-compatible 服务已在该地址启动。',
      runtime_environment: environment,
      local_endpoint: true,
    }
  }

  if (!input.apiKey) {
    return {
      runtime_state: 'missing_credential',
      runtime_reason: '云端或公网模型 Provider 缺少 API Key。',
      runtime_action: '在 AI 模型配置中保存密钥，或配置 AI_GATEWAY_API_KEY 后重新发布。',
      runtime_environment: environment,
      local_endpoint: false,
    }
  }

  const invocationAssessment = assessLatestInvocation(input.latestInvocation, environment, false, input)
  if (invocationAssessment) return invocationAssessment

  if (input.checkRemoteHealth) {
    const remoteProbe = canProbeRemoteProvider(baseUrl)
    if (!remoteProbe.ok) {
      return {
        runtime_state: 'remote_health_failed',
        runtime_reason: remoteProbe.reason,
        runtime_action: '请填写供应商提供的 HTTPS OpenAI-compatible Base URL 后重新测试。',
        runtime_environment: environment,
        local_endpoint: false,
      }
    }

    const health = await checkOpenAICompatibleModelsEndpoint(baseUrl, input.apiKey, fetchImpl, 3000)
    return {
      runtime_state: health === 'ok'
        ? 'remote_health_ok'
        : health === 'auth_failed'
          ? 'remote_auth_failed'
          : 'remote_health_failed',
      runtime_reason: health === 'ok'
        ? '云端 Provider /models 连接测试通过。'
        : health === 'auth_failed'
          ? '云端 Provider 返回认证失败，Token 或权限不可用。'
          : '云端 Provider /models 连接测试失败或超时。',
      runtime_action: health === 'ok'
        ? input.readyAction || '保存并发布此模型配置后，用真实合同触发 ReviewRun 验证 semantic_review 调用证据。'
        : health === 'auth_failed'
          ? '请检查 Token 是否来自正确控制台、是否具备模型访问权限，或更换模型网关。'
          : '请检查 Base URL、网络可达性和供应商服务状态。',
      runtime_environment: environment,
      local_endpoint: false,
    }
  }

  return {
    runtime_state: 'ready_to_call',
    runtime_reason: `模型地址与密钥已具备调用条件；仍需用真实 ${input.phaseLabel || 'semantic_review'} 验证一次调用证据。`,
    runtime_action: input.readyAction || '触发一次合同再审核，确认 model_invocations 中 semantic_review 为 completed。',
    runtime_environment: environment,
    local_endpoint: false,
  }
}
