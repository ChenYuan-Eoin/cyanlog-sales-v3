import { describe, expect, it } from 'vitest'
import {
  extractTokenUsage,
  latestProviderProbeEvidence,
  type StoredModelInvocation,
} from './model-invocations'

describe('extractTokenUsage', () => {
  it('normalizes OpenAI-compatible usage fields', () => {
    const usage = extractTokenUsage({
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
      },
    })

    expect(usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })
  })

  it('normalizes camelCase AI SDK style usage fields', () => {
    const usage = extractTokenUsage({
      inputTokens: 5,
      outputTokens: 7,
    })

    expect(usage).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
    })
  })

  it('returns undefined when no token fields exist', () => {
    expect(extractTokenUsage({ usage: { latency: 10 } })).toBeUndefined()
  })
})

function invocation(overrides: Partial<StoredModelInvocation>): StoredModelInvocation {
  return {
    id: 'invocation-id',
    provider: 'AI_LEVEL_1',
    model: 'gpt-oss-20b',
    phase: 'provider_inference_probe',
    status: 'completed',
    degraded: false,
    request_meta: {
      metadata: {
        published_config: true,
        runtime_signature: 'signature-v1',
      },
    },
    response_meta: {
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    },
    created_at: '2026-07-13T08:00:00.000Z',
    completed_at: '2026-07-13T08:00:01.000Z',
    ...overrides,
  }
}

describe('latestProviderProbeEvidence', () => {
  it('keeps the newest published-config probe for each provider', () => {
    const evidence = latestProviderProbeEvidence([
      invocation({
        id: 'new',
        status: 'failed',
        error_message: 'model_load_failed',
        created_at: '2026-07-13T09:00:00.000Z',
        completed_at: '2026-07-13T09:00:01.000Z',
      }),
      invocation({ id: 'old' }),
    ])

    expect(evidence.get('AI_LEVEL_1')).toMatchObject({
      status: 'failed',
      error: 'model_load_failed',
    })
  })

  it('ignores draft-form probes that do not match a published config', () => {
    const evidence = latestProviderProbeEvidence([
      invocation({
        id: 'draft',
        request_meta: {
          metadata: {
            published_config: false,
            runtime_signature: 'draft-signature',
          },
        },
      }),
      invocation({ id: 'published' }),
    ])

    expect(evidence.get('AI_LEVEL_1')?.runtimeSignature).toBe('signature-v1')
  })
})
