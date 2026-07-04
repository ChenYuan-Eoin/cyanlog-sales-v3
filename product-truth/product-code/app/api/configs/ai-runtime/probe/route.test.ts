/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  assessProviderRuntime: vi.fn(),
  fetchOpenAICompatibleModelIds: vi.fn(),
  probeOpenAICompatibleChatCompletion: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/configs/ai-runtime-readiness', () => runtimeMocks)

import { POST } from './route'

function jsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/configs/ai-runtime/probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeMocks.fetchOpenAICompatibleModelIds.mockResolvedValue(['gpt-oss-20b'])
    runtimeMocks.probeOpenAICompatibleChatCompletion.mockResolvedValue({
      ok: false,
      status: null,
      latency_ms: 15000,
      model: 'gpt-oss-20b',
      content_sample: null,
      error: 'The operation was aborted due to timeout',
    })
  })

  it('区分本地模型列表可达和最小生成失败，不能误报为本地服务不可达', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'local_health_ok',
      runtime_reason: '本地模型 /models 健康检查通过。',
      runtime_action: null,
      runtime_environment: 'local-dev',
      local_endpoint: true,
    })

    const res = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      base_url: 'http://127.0.0.1:1234/v1',
      api_key: 'sk-test',
      model: 'gpt-oss-20b',
      timeout_ms: 120000,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.runtime_state).toBe('local_generation_failed')
    expect(body.data.runtime_reason).toContain('最小生成测试失败')
    expect(body.data.runtime_action).toContain('本地服务可达')
    expect(body.data.available_models).toEqual(['gpt-oss-20b'])
    expect(runtimeMocks.probeOpenAICompatibleChatCompletion).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1',
      'sk-test',
      'gpt-oss-20b',
      undefined,
      120000
    )
  })

  it('区分云端模型列表可达和最小生成失败，不能误报为网关不可达', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'remote_health_ok',
      runtime_reason: '云端 Provider /models 连接测试通过。',
      runtime_action: null,
      runtime_environment: 'local-dev',
      local_endpoint: false,
    })

    const res = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      base_url: 'https://cloud.yiyongai.cn/v1',
      api_key: 'sk-test',
      model: 'gpt-5.5',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.runtime_state).toBe('remote_generation_failed')
    expect(body.data.runtime_reason).toContain('最小生成测试失败')
    expect(body.data.runtime_action).toContain('模型 ID')
  })
})
