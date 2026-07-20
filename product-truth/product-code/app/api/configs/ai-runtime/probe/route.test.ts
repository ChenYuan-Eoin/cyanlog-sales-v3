/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  assessProviderRuntime: vi.fn(),
  fetchOpenAICompatibleModelIds: vi.fn(),
  probeOpenAICompatibleChatCompletion: vi.fn(),
}))

const transportMocks = vi.hoisted(() => ({
  createSafeProviderProbeTransport: vi.fn(),
  pinnedFetch: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
  userHasFreshOrgConfigAccess: vi.fn(),
}))

const orgMocks = vi.hoisted(() => ({
  getFreshDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)
vi.mock('@/lib/scoped-access', () => orgMocks)

vi.mock('@/lib/configs/ai-runtime-readiness', () => runtimeMocks)

vi.mock('@/lib/configs/provider-endpoint.server', () => ({
  createSafeProviderProbeTransport: transportMocks.createSafeProviderProbeTransport,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { POST } from './route'
import { supabaseAdmin } from '@/lib/supabase'
import { UnsafeProviderEndpointError } from '@/lib/configs/provider-endpoint'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

function jsonRequest(body: unknown): any {
  const normalizedBody = body && typeof body === 'object'
    && (body as { provider_kind?: unknown }).provider_kind === 'openai_compatible'
    ? {
        runtime_location: String((body as { base_url?: unknown }).base_url || '').includes('127.0.0.1')
          ? 'local'
          : 'cloud',
        auth_mode: (body as { api_key?: unknown }).api_key ? 'bearer' : 'none',
        ...body,
      }
    : body
  return {
    json: async () => normalizedBody,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/configs/ai-runtime/probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
    transportMocks.createSafeProviderProbeTransport.mockImplementation(async (baseUrl: string) => ({
      baseUrl,
      fetch: transportMocks.pinnedFetch,
      close: transportMocks.close,
      pinnedAddresses: [{ address: '203.0.113.10', family: 4 }],
    }))
    transportMocks.close.mockResolvedValue(undefined)
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
      probe_mode: 'model',
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
      transportMocks.pinnedFetch,
      120000
    )
  })

  it('没有 config:write 时返回 403 且不发起任何 Provider 请求', async () => {
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(false)

    const res = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      base_url: 'https://provider.example/v1',
      api_key: 'sk-do-not-use',
      model: 'provider-model',
    }))

    expect(res.status).toBe(403)
    expect(accessMocks.userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
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
      probe_mode: 'model',
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
      probe_mode: 'model',
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

  it('接受 240000ms 配置但连接测试不执行生成，并可安全复用未改变连接的已存密钥', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'remote_health_ok',
      runtime_reason: 'Provider /models 可达。',
      runtime_action: null,
      runtime_environment: 'preview',
      local_endpoint: false,
    })
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          status: 'DRAFT',
          value: {
            kind: 'provider_connection',
            provider_type: 'openai_compatible',
            runtime_location: 'cloud',
            auth_mode: 'bearer',
            base_url: 'https://provider.example/v1',
            api_key: 'stored-secret-token',
          },
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(storedQuery)

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      base_url: 'https://provider.example/v1',
      api_key: '****',
      config_id: 'provider-1',
      timeout_ms: 240000,
      probe_mode: 'connection',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.credential_checked).toBe('stored')
    expect(body.data.probe_scope).toBe('draft_provider_connection_check')
    expect(runtimeMocks.assessProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'stored-secret-token', healthCheckTimeoutMs: 60000 }),
      expect.objectContaining({ NODE_ENV: 'test' }),
      transportMocks.pinnedFetch,
    )
    expect(runtimeMocks.probeOpenAICompatibleChatCompletion).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('stored-secret-token')
    expect(storedQuery.in).toHaveBeenCalledWith('status', ['DRAFT', 'PUBLISHED'])
  })

  it('auth_mode none 即使携带 config_id 也不会读取或复用历史密钥', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'ready_to_call',
      runtime_reason: '无需认证。',
      runtime_action: null,
      runtime_environment: 'preview',
      local_endpoint: false,
    })

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://provider.example/v1',
      config_id: 'provider-with-old-key',
      probe_mode: 'connection',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.credential_checked).toBe('not_required')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(runtimeMocks.assessProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined, authMode: 'none' }),
      expect.any(Object),
      transportMocks.pinnedFetch,
    )
  })

  it('拒绝读取已归档 Provider 的历史密钥进行探测', async () => {
    const archivedSecret = 'sk-archived-probe-secret'
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          status: 'ARCHIVED',
          value: {
            kind: 'provider_connection',
            provider_type: 'openai_compatible',
            runtime_location: 'cloud',
            auth_mode: 'bearer',
            base_url: 'https://provider.example/v1',
            api_key: archivedSecret,
          },
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(storedQuery)

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: '****',
      config_id: 'provider-archived',
      probe_mode: 'connection',
    }))
    const responseText = await response.text()

    expect(response.status).toBe(400)
    expect(responseText).toContain('已归档版本不可作为凭据来源')
    expect(responseText).not.toContain(archivedSecret)
    expect(runtimeMocks.assessProviderRuntime).not.toHaveBeenCalled()
    expect(transportMocks.createSafeProviderProbeTransport).not.toHaveBeenCalled()
  })

  it('管理员输入新密钥时按新草稿探测，不读取旧 config_id 的密钥或身份', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'remote_health_ok',
      runtime_reason: '新连接可达。',
      runtime_action: null,
      runtime_environment: 'preview',
      local_endpoint: false,
    })

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: 'sk-new-real-probe-key',
      config_id: 'provider-other',
      probe_mode: 'connection',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.credential_checked).toBe('provided')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(runtimeMocks.assessProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-new-real-probe-key' }),
      expect.any(Object),
      transportMocks.pinnedFetch,
    )
  })

  it('没有新密钥时，config_id 指向不同连接会被拒绝复用', async () => {
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          status: 'DRAFT',
          value: {
            kind: 'provider_connection',
            provider_type: 'openai_compatible',
            runtime_location: 'cloud',
            auth_mode: 'bearer',
            base_url: 'https://other-provider.example/v1',
            api_key: 'sk-other-provider-secret',
          },
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(storedQuery)

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: '****',
      config_id: 'provider-other',
      probe_mode: 'connection',
    }))

    expect(response.status).toBe(400)
    expect(runtimeMocks.assessProviderRuntime).not.toHaveBeenCalled()
    expect(transportMocks.createSafeProviderProbeTransport).not.toHaveBeenCalled()
  })

  it('不会把数据库中的展示掩码当作真实 Provider 密钥', async () => {
    runtimeMocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'missing_credential',
      runtime_reason: '缺少真实密钥。',
      runtime_action: '请重新填写。',
      runtime_environment: 'preview',
      local_endpoint: false,
    })
    const storedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          status: 'DRAFT',
          value: {
            kind: 'provider_connection',
            provider_type: 'openai_compatible',
            runtime_location: 'cloud',
            auth_mode: 'bearer',
            base_url: 'https://provider.example/v1',
            api_key: '****',
          },
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(storedQuery)

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: '****',
      config_id: 'provider-masked',
      probe_mode: 'connection',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.credential_checked).toBe('missing')
    expect(runtimeMocks.assessProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
      expect.any(Object),
      transportMocks.pinnedFetch,
    )
  })

  it('Provider 地址未通过 SSRF 门禁时不调用任何模型接口', async () => {
    transportMocks.createSafeProviderProbeTransport.mockRejectedValueOnce(
      new UnsafeProviderEndpointError('云端 Provider 域名解析到非公网地址，已阻止探测。'),
    )

    const response = await POST(jsonRequest({
      provider_kind: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://metadata.example/v1',
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('非公网地址')
    expect(runtimeMocks.assessProviderRuntime).not.toHaveBeenCalled()
    expect(runtimeMocks.fetchOpenAICompatibleModelIds).not.toHaveBeenCalled()
    expect(runtimeMocks.probeOpenAICompatibleChatCompletion).not.toHaveBeenCalled()
  })
})
