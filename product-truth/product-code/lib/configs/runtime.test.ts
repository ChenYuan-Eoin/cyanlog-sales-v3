import { describe, expect, it } from 'vitest'
import {
  isMaskedApiKey,
  isPublishedAIProviderValue,
  maskApiKey,
  mergeStoredAIConfigValue,
  mergeStoredAIProviderValue,
  sanitizeConfigRow,
  sanitizeConfigValue,
  sanitizeConfigVersionRow,
  withoutStoredApiKey,
} from './runtime'

describe('config runtime helpers', () => {
  it('redacts AI config API keys before returning config rows', () => {
    const row = sanitizeConfigRow({
      type: 'AI_CONFIG',
      value: {
        api_key: 'lmstudio-token-1234567890',
        model: 'gpt-oss-20b',
      },
    })

    expect(row.value?.api_key).toBe('lmst***7890')
  })

  it('redacts canary secrets in both direct values and version rows', () => {
    const secret = 'sk-canary-never-return-this-value'

    const value = sanitizeConfigValue('AI_CONFIG', { api_key: secret })
    const version = sanitizeConfigVersionRow('AI_CONFIG', {
      id: 'version-1',
      value: { api_key: secret },
    })

    expect(JSON.stringify(value)).not.toContain(secret)
    expect(JSON.stringify(version)).not.toContain(secret)
    expect(value.api_key).toContain('***')
    expect(version.value?.api_key).toContain('***')
  })

  it('redacts unsupported credential-shaped fields in legacy AI values', () => {
    const value = sanitizeConfigValue('AI_CONFIG', {
      access_token: 'legacy-access-secret',
      clientSecret: 'legacy-client-secret',
      model: 'provider-model',
    })

    expect(JSON.stringify(value)).not.toContain('legacy-access-secret')
    expect(JSON.stringify(value)).not.toContain('legacy-client-secret')
    expect(value.model).toBe('provider-model')
  })

  it('preserves stored API keys when update payload leaves token blank', () => {
    const merged = mergeStoredAIConfigValue({
      api_key: 'stored-local-token',
      model: 'gpt-oss-20b',
      timeout_ms: 45000,
    }, {
      api_key: '',
      timeout_ms: 120000,
    })

    expect(merged).toMatchObject({
      api_key: 'stored-local-token',
      model: 'gpt-oss-20b',
      timeout_ms: 120000,
    })
  })

  it('preserves stored API keys when update payload contains a masked token', () => {
    const masked = maskApiKey('cloud-token-1234567890')
    expect(isMaskedApiKey(masked)).toBe(true)

    const merged = mergeStoredAIConfigValue({
      api_key: 'stored-cloud-token',
      model: 'cloud-model',
    }, {
      api_key: masked,
      model: 'cloud-model-v2',
    })

    expect(merged).toMatchObject({
      api_key: 'stored-cloud-token',
      model: 'cloud-model-v2',
    })
  })

  it('replaces stored API keys only when a real new token is provided', () => {
    const merged = mergeStoredAIConfigValue({
      api_key: 'old-token',
      model: 'gpt-oss-20b',
    }, {
      api_key: 'new-token',
    })

    expect(merged.api_key).toBe('new-token')
  })

  it('clears a stored API key when the Provider credential binding changes', () => {
    const merged = mergeStoredAIProviderValue({
      provider_kind: 'openai_compatible',
      base_url: 'https://old-provider.example/v1',
      profile: 'primary',
      api_key: 'old-token',
    }, {
      base_url: 'https://new-provider.example/v1',
      api_key: 'old-***-oken',
    })

    expect(merged).not.toHaveProperty('api_key')
  })

  it('accepts a new API key supplied together with a new Provider binding', () => {
    const merged = mergeStoredAIProviderValue({
      provider_kind: 'openai_compatible',
      base_url: 'https://old-provider.example/v1',
      profile: 'primary',
      api_key: 'old-token',
    }, {
      base_url: 'https://new-provider.example/v1',
      api_key: 'new-provider-token',
    })

    expect(merged.api_key).toBe('new-provider-token')
  })

  it.each([
    ['masked history', { api_key: 'sk-h***alue', model: 'old-model' }],
    ['history without a key', { model: 'old-model' }],
  ])('removes api_key from %s before rollback merge', (_label, historicalValue) => {
    expect(withoutStoredApiKey(historicalValue)).toEqual({ model: 'old-model' })
  })

  it('keeps applications and tool policies out of the provider chain', () => {
    expect(isPublishedAIProviderValue({ kind: 'provider', model: 'gpt-5.5', profile: 'sales_cloud' })).toBe(true)
    expect(isPublishedAIProviderValue({ kind: 'application', model: 'gpt-5.5' })).toBe(false)
    expect(isPublishedAIProviderValue({ kind: 'tool_policy', model: 'gpt-5.5' })).toBe(false)
    expect(isPublishedAIProviderValue({ kind: 'provider', model: '   ', profile: 'blank' })).toBe(false)
    expect(isPublishedAIProviderValue({ kind: 'future_kind', model: 'gpt-5.5', profile: 'unknown' })).toBe(false)
  })

  it('accepts only provider-shaped legacy rows without an explicit kind', () => {
    expect(isPublishedAIProviderValue({ model: 'gpt-oss-20b', base_url: 'http://127.0.0.1:1234/v1' })).toBe(true)
    expect(isPublishedAIProviderValue({ model: 'gpt-oss-20b', profile: 'local_primary' })).toBe(true)
    expect(isPublishedAIProviderValue({ model: 'gpt-oss-20b' })).toBe(false)
    expect(isPublishedAIProviderValue({ application: 'contract_review' })).toBe(false)
  })
})
