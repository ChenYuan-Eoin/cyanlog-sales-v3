import { describe, expect, it } from 'vitest'
import {
  applyProviderRevisionCredential,
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
  it('uses a schema-valid fixed mask for short credentials', () => {
    expect(maskApiKey('short-key')).toBe('****')
  })

  it('redacts AI config API keys before returning config rows', () => {
    const row = sanitizeConfigRow({
      type: 'AI_CONFIG',
      value: {
        api_key: 'lmstudio-token-1234567890',
        model: 'gpt-oss-20b',
      },
    })

    expect(row.value?.api_key).toBe('****')
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
    expect(masked).toBe('****')
    expect(isMaskedApiKey(masked)).toBe(true)
    expect(isMaskedApiKey('abcd***wxyz')).toBe(true)
    expect(isMaskedApiKey('real***token-with-stars')).toBe(false)

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
      api_key: '****',
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

  it('keeps a ProviderConnection credential only while its connection identity is unchanged', () => {
    const unchanged = mergeStoredAIProviderValue({
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: 'https://provider.example/v1',
      api_key: 'stored-token',
    }, {
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: 'https://provider.example/v1',
      api_key: '****',
      connection_timeout_ms: 120000,
    })
    const relocated = mergeStoredAIProviderValue(unchanged, {
      ...unchanged,
      runtime_location: 'local',
      api_key: '****',
    })

    expect(unchanged.api_key).toBe('stored-token')
    expect(relocated).not.toHaveProperty('api_key')
  })

  it('canonicalizes a legacy ProviderConnection auth mode without dropping its existing key', () => {
    const merged = mergeStoredAIProviderValue({
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: 'https://provider.example/v1',
      api_key: 'stored-token',
      connection_timeout_ms: 45000,
    }, {
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      base_url: 'https://provider.example/v1',
      connection_timeout_ms: 120000,
    })

    expect(merged).toMatchObject({ auth_mode: 'bearer', api_key: 'stored-token' })
  })

  it('clears an existing credential when a Provider switches to auth_mode none', () => {
    const merged = mergeStoredAIProviderValue({
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: 'stored-token',
    }, {
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://provider.example/v1',
    })

    expect(merged).not.toHaveProperty('api_key')
  })

  it('reuses revision credentials only for the same canonical connection identity', () => {
    const source = {
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1/',
      api_key: 'stored-token',
    }
    const same = applyProviderRevisionCredential(source, {
      ...source,
      base_url: 'https://provider.example/v1',
      api_key: undefined,
    }, 'reuse')
    const moved = applyProviderRevisionCredential(source, {
      ...source,
      base_url: 'https://other.example/v1',
      api_key: undefined,
    }, 'reuse')
    const relocated = applyProviderRevisionCredential(source, {
      ...source,
      runtime_location: 'local',
      base_url: 'http://127.0.0.1:1234/v1',
      api_key: undefined,
    }, 'reuse')
    const changedAuth = applyProviderRevisionCredential(source, {
      ...source,
      auth_mode: 'none',
      api_key: undefined,
    }, 'reuse')

    expect(same).toMatchObject({ ok: true, value: { api_key: 'stored-token' } })
    expect(moved).toMatchObject({ ok: false })
    expect(relocated).toMatchObject({ ok: false })
    expect(changedAuth).toMatchObject({ ok: false })
  })

  it('requires a real token for replace and always strips it for clear', () => {
    const source = {
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: 'stored-token',
    }
    expect(applyProviderRevisionCredential(source, {
      ...source,
      api_key: '****',
    }, 'replace')).toMatchObject({ ok: false })
    expect(applyProviderRevisionCredential(source, {
      ...source,
      api_key: 'replacement-token',
    }, 'replace')).toMatchObject({ ok: true, value: { api_key: 'replacement-token' } })
    expect(applyProviderRevisionCredential(source, source, 'clear'))
      .toMatchObject({ ok: true, value: expect.not.objectContaining({ api_key: expect.anything() }) })
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
