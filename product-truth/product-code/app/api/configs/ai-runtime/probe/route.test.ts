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

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)

vi.mock('@/lib/configs/ai-runtime-readiness', () => runtimeMocks)

import { POST } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

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
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
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

  it('没有 config:write 时返回 403 且不发起任何 Provider 请求', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      base_url: 'https://provider.example/v1',
      api_key: 'sk-do-not-use',
      model: 'provider-model',
    }))

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(runtimeMocks.assessProviderRuntime).not.toHaveBeenCalled()
    expect(runtimeMocks.fetchOpenAICompatibleModelIds).not.toHaveBeenCalled()
    expect(runtimeMocks.probeOpenAICompatibleChatCompletion).not.toHaveBeenCalled()
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

  it('Provider 回显请求密钥时，探测响应也不会泄漏密钥', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'remote_health_ok',
      runtime_reason: `health response echoed ${CANARY_SECRET}`,
      runtime_action: null,
      runtime_environment: 'preview',
      local_endpoint: false,
    })
    runtimeMocks.probeOpenAICompatibleChatCompletion.mockResolvedValue({
      ok: false,
      status: 401,
      latency_ms: 20,
      model: 'provider-model',
      content_sample: null,
      error: `Authorization: Bearer ${CANARY_SECRET}`,
    })

    const res = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      base_url: 'https://provider.example/v1',
      api_key: CANARY_SECRET,
      model: 'provider-model',
    }))
    const responseText = await res.text()

    expect(res.status).toBe(200)
    expect(responseText).not.toContain(CANARY_SECRET)
    expect(responseText).toContain('[REDACTED]')
  })
})
