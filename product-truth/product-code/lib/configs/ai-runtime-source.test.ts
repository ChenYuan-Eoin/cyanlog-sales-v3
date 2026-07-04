import { describe, expect, it } from 'vitest'
import {
  buildRuntimeSourceSummary,
  configuredAIRuntimeEnvKeys,
  runtimeProviderSourceMeta,
} from './ai-runtime-source'

describe('AI runtime source summary', () => {
  it('reports environment keys as present but not consumed by the published policy', () => {
    const summary = buildRuntimeSourceSummary({
      AI_GATEWAY_API_KEY: 'secret',
      OPENAI_BASE_URL: 'https://example.com/v1',
    })

    expect(summary).toMatchObject({
      policy_source: 'database_model_policy',
      provider_config_source: 'database_configs',
      form_draft_source: 'browser_form_draft',
      environment_source: 'present_not_consumed_by_published_policy',
    })
    expect(summary.environment_keys_present).toEqual(['AI_GATEWAY_API_KEY', 'OPENAI_BASE_URL'])
  })

  it('does not expose unknown environment variables as model source evidence', () => {
    expect(configuredAIRuntimeEnvKeys({ RANDOM_TOKEN: 'secret' })).toEqual([])
    expect(buildRuntimeSourceSummary({}).environment_source).toBe('not_configured')
  })

  it('separates database providers, builtin fallback, and broken source references', () => {
    expect(runtimeProviderSourceMeta({
      providerKind: 'openai_compatible',
      sourceConfigPresent: true,
    })).toMatchObject({
      source_kind: 'database_config',
    })

    expect(runtimeProviderSourceMeta({
      providerKind: 'builtin',
      sourceConfigPresent: false,
    })).toMatchObject({
      source_kind: 'builtin_rule_engine',
    })

    expect(runtimeProviderSourceMeta({
      providerKind: 'openai_compatible',
      sourceConfigPresent: false,
    })).toMatchObject({
      source_kind: 'missing_database_config',
    })
  })
})
