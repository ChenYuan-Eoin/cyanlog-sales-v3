import { describe, expect, it } from 'vitest'
import { parseConfigValue, validateConfigValue } from './validation'

const base = {
  schema_version: 'ai-platform.v1',
  asset_id: 'asset.one',
  enabled: true,
}

describe('AI platform config validation', () => {
  it.each([
    {
      ...base,
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: 'https://provider.example/v1',
      connection_timeout_ms: 240000,
    },
    {
      ...base,
      kind: 'model_catalog_entry',
      provider_connection_id: 'provider.one',
      model_id: 'vendor/model-v2',
      capabilities: ['text_generation'],
    },
    { ...base, kind: 'ai_application', capabilities: ['text_generation'] },
    {
      ...base,
      kind: 'business_use_point',
      module_id: 'contract_review',
      required_capabilities: ['text_generation'],
    },
    {
      ...base,
      kind: 'application_binding',
      business_use_point_id: 'contract.review.chat',
      ai_application_id: 'review.assistant',
    },
    {
      ...base,
      kind: 'route_policy',
      ai_application_id: 'review.assistant',
      model_catalog_entry_ids: ['model.primary', 'model.backup'],
      strategy: 'ordered_fallback',
      timeout_ms: 120000,
      failure_action: 'manual_review',
    },
  ])('accepts a valid independent platform asset: $kind', (value) => {
    expect(validateConfigValue('AI_CONFIG', value)).toEqual({ valid: true })
  })

  it('rejects provider fields that mix a model or business stages into the connection', () => {
    const result = validateConfigValue('AI_CONFIG', {
      ...base,
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: 'https://provider.example/v1',
      connection_timeout_ms: 45000,
      model: 'gpt-hardcoded',
      stages: ['semantic_review'],
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Unrecognized')
  })

  it('rejects duplicate route candidates', () => {
    const result = validateConfigValue('AI_CONFIG', {
      ...base,
      kind: 'route_policy',
      ai_application_id: 'review.assistant',
      model_catalog_entry_ids: ['model.primary', 'model.primary'],
      strategy: 'ordered_fallback',
      timeout_ms: 120000,
      failure_action: 'manual_review',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('候选模型不能重复')
  })

  it('keeps runtime location consistent with the endpoint and auth mode', () => {
    const cloudLoopback = validateConfigValue('AI_CONFIG', {
      ...base,
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://127.0.0.1/v1',
      connection_timeout_ms: 45000,
    })
    const localPublic = validateConfigValue('AI_CONFIG', {
      ...base,
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'local',
      auth_mode: 'none',
      base_url: 'https://provider.example/v1',
      connection_timeout_ms: 45000,
    })
    const noneWithToken = validateConfigValue('AI_CONFIG', {
      ...base,
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://provider.example/v1',
      api_key: 'should-not-be-stored',
      connection_timeout_ms: 45000,
    })

    expect(cloudLoopback.error).toContain('不能指向')
    expect(localPublic.error).toContain('只允许 localhost')
    expect(noneWithToken.error).toContain('免认证连接')
  })

  it('returns canonical parsed values for persistence', () => {
    const parsed = parseConfigValue('AI_CONFIG', {
      ...base,
      asset_id: '  provider.one  ',
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: ' https://PROVIDER.example/ ',
      connection_timeout_ms: 45000,
    })

    expect(parsed).toMatchObject({
      valid: true,
      data: {
        asset_id: 'provider.one',
        auth_mode: 'none',
        base_url: 'https://provider.example/v1',
      },
    })
  })
})
