export type AIRuntimeEnvironmentSource =
  | 'not_configured'
  | 'present_not_consumed_by_published_policy'

export type RuntimeProviderSourceKind =
  | 'database_config'
  | 'builtin_rule_engine'
  | 'missing_database_config'

export type RuntimeSourceSummary = {
  policy_source: 'database_model_policy'
  provider_config_source: 'database_configs'
  form_draft_source: 'browser_form_draft'
  environment_source: AIRuntimeEnvironmentSource
  environment_keys_present: string[]
}

export type RuntimeProviderSourceMeta = {
  source_kind: RuntimeProviderSourceKind
  source_label: string
}

type RuntimeEnv = Record<string, string | undefined>

const AI_RUNTIME_ENV_KEYS = [
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_URL',
  'AI_GATEWAY_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'LM_STUDIO_API_KEY',
  'LM_STUDIO_BASE_URL',
]

export function configuredAIRuntimeEnvKeys(
  env: RuntimeEnv = process.env
): string[] {
  return AI_RUNTIME_ENV_KEYS.filter((key) => Boolean(env[key]))
}

export function buildRuntimeSourceSummary(
  env: RuntimeEnv = process.env
): RuntimeSourceSummary {
  const environmentKeysPresent = configuredAIRuntimeEnvKeys(env)

  return {
    policy_source: 'database_model_policy',
    provider_config_source: 'database_configs',
    form_draft_source: 'browser_form_draft',
    environment_source: environmentKeysPresent.length > 0
      ? 'present_not_consumed_by_published_policy'
      : 'not_configured',
    environment_keys_present: environmentKeysPresent,
  }
}

export function runtimeProviderSourceMeta(input: {
  providerKind: 'openai_compatible' | 'builtin'
  sourceConfigPresent: boolean
}): RuntimeProviderSourceMeta {
  if (input.providerKind === 'builtin') {
    return {
      source_kind: 'builtin_rule_engine',
      source_label: '内置规则引擎兜底',
    }
  }

  if (input.sourceConfigPresent) {
    return {
      source_kind: 'database_config',
      source_label: '配置中心数据库 AI_CONFIG',
    }
  }

  return {
    source_kind: 'missing_database_config',
    source_label: '发布策略引用的 AI_CONFIG 已缺失',
  }
}
