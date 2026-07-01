export type AIRuntimeState =
  | 'builtin_ready'
  | 'missing_base_url'
  | 'missing_credential'
  | 'unreachable_in_vercel'
  | 'local_health_ok'
  | 'local_health_failed'
  | 'ready_to_call'

export type AIRuntimeAssessment = {
  runtime_state: AIRuntimeState
  runtime_reason: string
  runtime_action: string | null
  runtime_environment: string
  local_endpoint: boolean
}

function runtimeEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV) return env.VERCEL_ENV
  if (env.VERCEL === '1') return 'vercel'
  return env.NODE_ENV === 'production' ? 'local-production' : 'local-dev'
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

async function checkLocalModelHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1200)
    const response = await fetchImpl(new URL('models', base), { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

export async function assessProviderRuntime(
  input: {
    providerKind: 'openai_compatible' | 'builtin'
    baseUrl?: string
    apiKey?: string
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
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

  const baseUrl = input.baseUrl?.trim() || ''
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
  if (localEndpoint && (env.VERCEL === '1' || Boolean(env.VERCEL_ENV))) {
    return {
      runtime_state: 'unreachable_in_vercel',
      runtime_reason: 'localhost 在 Vercel 函数内指向部署容器，不是用户本机模型服务。',
      runtime_action: '生产环境请改用可公网访问的模型网关；本地模型只可用于本机开发验收。',
      runtime_environment: environment,
      local_endpoint: true,
    }
  }

  if (localEndpoint) {
    const healthy = await checkLocalModelHealth(baseUrl, fetchImpl)
    return {
      runtime_state: healthy ? 'local_health_ok' : 'local_health_failed',
      runtime_reason: healthy
        ? '本地模型 /models 健康检查通过。'
        : '本地模型 /models 健康检查失败或超时。',
      runtime_action: healthy
        ? null
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

  return {
    runtime_state: 'ready_to_call',
    runtime_reason: '模型地址与密钥已具备调用条件；仍需用真实 ReviewRun 验证一次调用证据。',
    runtime_action: '触发一次合同再审核，确认 model_invocations 中 semantic_review 为 completed。',
    runtime_environment: environment,
    local_endpoint: false,
  }
}
