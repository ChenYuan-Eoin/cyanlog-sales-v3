import { describe, expect, it } from 'vitest'
import { isMaskedApiKey, maskApiKey, mergeStoredAIConfigValue, sanitizeConfigRow } from './runtime'

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
})
