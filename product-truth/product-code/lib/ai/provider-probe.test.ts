import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAIProviderModels, probeAIProvider } from './provider-probe'

describe('probeAIProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns builtin success for rule engine without network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeAIProvider({
      level: 3,
      name: '规则引擎',
      provider_kind: 'rule_engine',
      base_url: '',
      model: 'rule-engine',
      timeout_ms: 1000,
      enabled: true,
    })

    expect(result.ok).toBe(true)
    expect(result.model).toBe('rule-engine')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails fast when external provider has no base url', async () => {
    const result = await probeAIProvider({
      level: 1,
      name: 'LM Studio',
      provider_kind: 'lm_studio',
      base_url: '',
      model: 'gpt-oss-20b',
      timeout_ms: 1000,
      enabled: true,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('missing_base_url')
  })

  it('probes LM Studio with an OpenAI-compatible chat completions request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ usage: { total_tokens: 7 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeAIProvider({
      level: 1,
      name: 'LM Studio',
      provider_kind: 'lm_studio',
      api_format: 'lm_studio',
      base_url: 'http://127.0.0.1:1234',
      model: 'gpt-oss-20b',
      timeout_ms: 1000,
      enabled: true,
    })

    expect(result.ok).toBe(true)
    expect(result.base_url).toBe('http://127.0.0.1:1234/v1')
    expect(result.usage?.total_tokens).toBe(7)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"gpt-oss-20b"'),
      })
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ max_tokens: 8 })
  })

  it('uses the configured API key when probing providers that require auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeAIProvider({
      level: 1,
      name: 'LM Studio',
      provider_kind: 'lm_studio',
      api_format: 'lm_studio',
      base_url: 'http://127.0.0.1:1234/v1',
      api_key: 'sk-local-test',
      model: 'openai/gpt-oss-20b',
      timeout_ms: 45000,
      enabled: true,
    })

    expect(result.ok).toBe(true)
    expect(result.usage?.total_tokens).toBe(6)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-local-test',
        }),
      })
    )
  })

  it('lists OpenAI-compatible models and preserves auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          { id: 'openai/gpt-oss-20b', owned_by: 'lm-studio' },
          { id: 'qwen-long' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listAIProviderModels({
      level: 1,
      name: 'LM Studio',
      provider_kind: 'lm_studio',
      api_format: 'lm_studio',
      base_url: 'http://127.0.0.1:1234',
      api_key: 'sk-local-test',
      model: 'openai/gpt-oss-20b',
      timeout_ms: 1000,
      enabled: true,
    })

    expect(result.ok).toBe(true)
    expect(result.models.map((model) => model.id)).toEqual(['openai/gpt-oss-20b', 'qwen-long'])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-local-test',
        }),
      })
    )
  })

  it('falls back to LM Studio api/v1 model listing when v1/models is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ models: ['gpt-oss-20b'] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listAIProviderModels({
      level: 1,
      name: 'LM Studio',
      provider_kind: 'lm_studio',
      api_format: 'lm_studio',
      base_url: 'http://127.0.0.1:1234/v1',
      model: 'gpt-oss-20b',
      timeout_ms: 1000,
      enabled: true,
    })

    expect(result.ok).toBe(true)
    expect(result.models[0]?.id).toBe('gpt-oss-20b')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:1234/api/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })
})
