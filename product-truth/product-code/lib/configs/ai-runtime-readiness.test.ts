import { describe, expect, it } from 'vitest'
import { assessProviderRuntime, fetchOpenAICompatibleModelIds, isLoopbackAIBaseUrl } from './ai-runtime-readiness'

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
    }, {
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_URL: 'sales.example.vercel.app',
    })

    expect(result.runtime_state).toBe('unreachable_in_vercel')
    expect(result.local_endpoint).toBe(true)
  })

  it('does not treat imported Vercel env files as deployed runtime', async () => {
    const okFetch: typeof fetch = async () => new Response('{}', { status: 200 })

    const result = await assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'not-needed',
    }, {
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_URL: '',
    }, okFetch)

    expect(result.runtime_state).toBe('local_health_ok')
    expect(result.runtime_environment).toBe('local-production')
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

  it('passes token headers to authenticated local model health checks', async () => {
    const requests: Array<RequestInfo | URL> = []
    const okFetch: typeof fetch = async (input, init) => {
      requests.push(input)
      expect(init?.headers).toEqual({ Authorization: 'Bearer lmstudio-token' })
      return new Response('{}', { status: 200 })
    }

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'lmstudio-token',
    }, { NODE_ENV: 'development' }, okFetch)).resolves.toMatchObject({
      runtime_state: 'local_health_ok',
    })

    expect(requests).toHaveLength(1)
  })

  it('reports local auth failures separately from connectivity failures', async () => {
    const authFailedFetch: typeof fetch = async () => new Response('{}', { status: 401 })

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
    }, { NODE_ENV: 'development' }, authFailedFetch)).resolves.toMatchObject({
      runtime_state: 'local_auth_failed',
      runtime_action: expect.stringContaining('Token'),
    })
  })

  it('reports local CLI readiness when LM Studio HTTP auth blocks the API', async () => {
    const authFailedFetch: typeof fetch = async () => new Response('{}', { status: 401 })
    const cliReady = async () => 'ready' as const

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
      model: 'gpt-oss-20b',
    }, { NODE_ENV: 'development' }, authFailedFetch, cliReady)).resolves.toMatchObject({
      runtime_state: 'local_cli_ready',
      runtime_reason: expect.stringContaining('LM Studio CLI'),
    })
  })

  it('can disable local CLI fallback for explicit HTTP token probes', async () => {
    const authFailedFetch: typeof fetch = async () => new Response('{}', { status: 401 })
    const cliReady = async () => 'ready' as const

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://localhost:1234/v1',
      model: 'gpt-oss-20b',
      allowLocalCliFallback: false,
    }, { NODE_ENV: 'development' }, authFailedFetch, cliReady)).resolves.toMatchObject({
      runtime_state: 'local_auth_failed',
      runtime_action: expect.stringContaining('Token'),
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

  it('checks remote provider health only when explicitly requested', async () => {
    const requests: Array<RequestInfo | URL> = []
    const okFetch: typeof fetch = async (input, init) => {
      requests.push(input)
      expect(String(input)).toBe('https://api.example.com/v1/models')
      expect(init?.headers).toEqual({ Authorization: 'Bearer sk-test' })
      return new Response('{}', { status: 200 })
    }

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      checkRemoteHealth: true,
    }, { NODE_ENV: 'development' }, okFetch)).resolves.toMatchObject({
      runtime_state: 'remote_health_ok',
      runtime_action: expect.stringContaining('ReviewRun'),
    })

    expect(requests).toHaveLength(1)
  })

  it('normalizes remote root base URLs when probing OpenAI-compatible providers', async () => {
    const requests: Array<RequestInfo | URL> = []
    const okFetch: typeof fetch = async (input, init) => {
      requests.push(input)
      expect(String(input)).toBe('https://cloud.yiyongai.cn/v1/models')
      expect(init?.headers).toEqual({ Authorization: 'Bearer sk-test' })
      return new Response('{}', { status: 200 })
    }

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://cloud.yiyongai.cn',
      apiKey: 'sk-test',
      checkRemoteHealth: true,
    }, { NODE_ENV: 'development' }, okFetch)).resolves.toMatchObject({
      runtime_state: 'remote_health_ok',
    })

    expect(requests).toHaveLength(1)
  })

  it('extracts model ids from OpenAI-compatible model listing', async () => {
    const okFetch: typeof fetch = async () => new Response(JSON.stringify({
      data: [
        { id: 'gpt-oss-20b' },
        { id: 'gpt-oss-20b' },
        { id: 'cloud-model' },
        { id: '' },
      ],
    }), { status: 200 })

    await expect(fetchOpenAICompatibleModelIds(
      'http://127.0.0.1:1234/v1',
      'lmstudio-token',
      okFetch
    )).resolves.toEqual(['gpt-oss-20b', 'cloud-model'])
  })

  it('reports remote auth failures separately from remote reachability failures', async () => {
    const authFailedFetch: typeof fetch = async () => new Response('{}', { status: 401 })
    const unavailableFetch: typeof fetch = async () => new Response('{}', { status: 503 })

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      checkRemoteHealth: true,
    }, { NODE_ENV: 'development' }, authFailedFetch)).resolves.toMatchObject({
      runtime_state: 'remote_auth_failed',
      runtime_action: expect.stringContaining('Token'),
    })

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      checkRemoteHealth: true,
    }, { NODE_ENV: 'development' }, unavailableFetch)).resolves.toMatchObject({
      runtime_state: 'remote_health_failed',
      runtime_action: expect.stringContaining('Base URL'),
    })
  })

  it('rejects non-HTTPS remote provider probes', async () => {
    const requests: Array<RequestInfo | URL> = []
    const okFetch: typeof fetch = async (input) => {
      requests.push(input)
      return new Response('{}', { status: 200 })
    }

    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://api.example.com/v1',
      apiKey: 'sk-test',
      checkRemoteHealth: true,
    }, { NODE_ENV: 'development' }, okFetch)).resolves.toMatchObject({
      runtime_state: 'remote_health_failed',
      runtime_reason: expect.stringContaining('HTTPS'),
    })

    expect(requests).toHaveLength(0)
  })

  it('marks cloud providers failed when the latest formal invocation degraded', async () => {
    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'cloud-model',
      latestInvocation: {
        id: 'inv-1',
        model: 'rule-engine',
        status: 'degraded',
        degraded: true,
        fallback_reason: 'semantic_review_degraded_to_rule_engine',
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
          attempt_errors: ['AI_LEVEL_2: Failed after 3 attempts. Last error: Too Many Requests'],
        },
      },
    })).resolves.toMatchObject({
      runtime_state: 'recent_invocation_failed',
      runtime_reason: expect.stringContaining('Too Many Requests'),
      runtime_action: expect.stringContaining('Token'),
    })
  })

  it('marks external providers passed when the latest formal invocation completed through a model transport', async () => {
    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'cloud-model',
      latestInvocation: {
        id: 'inv-2',
        model: 'cloud-model',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'openai_compatible_http',
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      },
    })).resolves.toMatchObject({
      runtime_state: 'recent_invocation_passed',
      runtime_reason: expect.stringContaining('正式调用已通过'),
      runtime_action: null,
    })
  })

  it('can assess tender long-document invocation evidence with the correct phase label', async () => {
    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://cloud.yiyongai.cn',
      apiKey: 'sk-test',
      model: 'cloud-model',
      phaseLabel: 'tender_long_document_parse',
      readyAction: '上传真实标书或长 PDF，确认 model_invocations 中 tender_long_document_parse 为 completed。',
      latestInvocation: {
        id: 'inv-tender',
        model: 'cloud-model',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'openai_compatible_http',
          dropped_risk_count: 0,
          validation_warnings: [],
          text_length: 48000,
          selected_chunk_count: 8,
          analyzed_chunk_count: 8,
          character_coverage_ratio: 0.95,
          business_signal_count: 12,
          business_signal_domains: 4,
        },
      },
    })).resolves.toMatchObject({
      runtime_state: 'recent_invocation_passed',
      runtime_reason: expect.stringContaining('tender_long_document_parse'),
      runtime_action: null,
    })
  })

  it('does not pass tender long-document readiness when coverage or business signals are weak', async () => {
    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'https://cloud.yiyongai.cn',
      apiKey: 'sk-test',
      model: 'cloud-model',
      phaseLabel: 'tender_long_document_parse',
      latestInvocation: {
        id: 'inv-tender-weak',
        model: 'cloud-model',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'openai_compatible_http',
          text_length: 60000,
          selected_chunk_count: 10,
          analyzed_chunk_count: 6,
          character_coverage_ratio: 0.6,
          business_signal_count: 0,
          business_signal_domains: 0,
        },
      },
    })).resolves.toMatchObject({
      runtime_state: 'recent_invocation_failed',
      runtime_reason: expect.stringContaining('长文档验收门禁'),
      runtime_action: expect.stringContaining('真实标书或长 PDF'),
    })
  })

  it('does not treat LM Studio CLI invocation as OpenAI-compatible HTTP completion', async () => {
    await expect(assessProviderRuntime({
      providerKind: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'gpt-oss-20b',
      latestInvocation: {
        id: 'inv-local-cli',
        model: 'gpt-oss-20b',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'lm_studio_cli',
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      },
    }, { NODE_ENV: 'development' }, async () => new Response('{}', { status: 401 }), async () => 'ready')).resolves.toMatchObject({
      runtime_state: 'recent_invocation_partial',
      runtime_reason: expect.stringContaining('LM Studio CLI'),
      runtime_action: expect.stringContaining('OpenAI-compatible HTTP'),
    })
  })
})
