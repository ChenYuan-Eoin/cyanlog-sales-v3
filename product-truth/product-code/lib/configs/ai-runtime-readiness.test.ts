import { describe, expect, it } from 'vitest'
import { assessProviderRuntime, isLoopbackAIBaseUrl } from './ai-runtime-readiness'

describe('AI runtime readiness', () => {
  it('detects loopback model URLs', () => {
    expect(isLoopbackAIBaseUrl('http://localhost:1234/v1')).toBe(true)
    expect(isLoopbackAIBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackAIBaseUrl('https://api.example.com/v1')).toBe(false)
  })

  it('marks builtin rule engine as ready fallback only', async () => {
    const result = await assessProviderRuntime({
      providerKind: 'builtin',
    })

    expect(result.runtime_state).toBe('builtin_ready')
    expect(result.runtime_reason).toContain('兜底规则审核')
  })

  it('marks localhost providers unreachable in Vercel runtime', async () => {
    const result = await assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'not-needed',
    }, { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production' })

    expect(result.runtime_state).toBe('unreachable_in_vercel')
    expect(result.local_endpoint).toBe(true)
  })

  it('checks local model health outside Vercel', async () => {
    const okFetch: typeof fetch = async () => new Response('{}', { status: 200 })
    const failedFetch: typeof fetch = async () => new Response('{}', { status: 503 })

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
    }, { NODE_ENV: 'development' }, okFetch)).resolves.toMatchObject({
      runtime_state: 'local_health_ok',
    })

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
    }, { NODE_ENV: 'development' }, failedFetch)).resolves.toMatchObject({
      runtime_state: 'local_health_failed',
    })
  })

  it('requires credentials for non-local model providers', async () => {
    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
    })).resolves.toMatchObject({
      runtime_state: 'missing_credential',
    })

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    })).resolves.toMatchObject({
      runtime_state: 'ready_to_call',
    })
  })
})
