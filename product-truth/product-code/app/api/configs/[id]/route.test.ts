/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
  userHasFreshOrgConfigAccess: vi.fn(),
}))

const orgMocks = vi.hoisted(() => ({
  getDefaultOrgId: vi.fn(),
  getFreshDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)
vi.mock('@/lib/scoped-access', () => orgMocks)

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, GET, PUT } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PUT',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown, method = 'PUT'): any {
  return {
    json: async () => body,
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeQueryResult(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

function makeUpdateResult(data: unknown, error: unknown = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function makeDeleteResult(data: unknown, error: unknown = null) {
  return {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

describe('PUT /api/configs/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getDefaultOrgId.mockResolvedValue('org-1')
    orgMocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
  })

  it('无效 JSON 返回参数错误且不执行配置更新', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({ id: 'config-1', type: 'UI_THEME', value: {} }))

    const res = await PUT(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'config-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('config_versions')
  })

  it('模型应用不能通过通用 Provider 接口修改', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({
        id: 'app-1',
        type: 'AI_CONFIG',
        value: { kind: 'application', application_id: 'contract_review' },
      }))

    const res = await PUT(makeJsonRequest({ name: '误改应用' }), {
      params: Promise.resolve({ id: 'app-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('保持只读')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('旧 Provider 保持只读，不能通过通用接口继续修改', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({
        id: 'provider-1',
        type: 'AI_CONFIG',
        value: {
          kind: 'provider',
          level: 1,
          name: '本地模型',
          profile: 'local_primary',
          provider_kind: 'openai_compatible',
          base_url: 'http://127.0.0.1:1234/v1',
          model: 'local-model',
          timeout_ms: 45000,
          enabled: true,
        },
      }))

    const res = await PUT(makeJsonRequest({ value: { kind: 'application' } }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('旧 Provider')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('工具消费策略不能通过通用接口删除', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({
        id: 'policy-1',
        type: 'AI_CONFIG',
        value: { kind: 'tool_policy', tool: 'contract_review' },
      }))

    const res = await DELETE(makeJsonRequest(null, 'DELETE'), {
      params: Promise.resolve({ id: 'policy-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('禁止删除')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('没有 config:read 时详情接口返回 403 且不读取配置', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)
    const res = await GET({ method: 'GET' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'read')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it.each([
    ['PUT', PUT, makeJsonRequest({ description: 'blocked' })],
    ['DELETE', DELETE, makeJsonRequest(null, 'DELETE')],
  ])('没有 config:write 时 %s 接口返回 403 且不读取配置', async (_name, handler, request) => {
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(false)
    const res = await handler(request, {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('更新 ProviderConnection 的响应不会返回真实 API Key', async () => {
    const provider = {
      id: 'provider-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.primary',
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        auth_mode: 'bearer',
        base_url: 'https://provider.example/v1',
        api_key: CANARY_SECRET,
        connection_timeout_ms: 45000,
        enabled: true,
      },
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(provider))
      .mockReturnValueOnce(makeUpdateResult({ ...provider, description: 'updated' }))

    const res = await PUT(makeJsonRequest({ description: 'updated' }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(body.data.value.api_key).toContain('***')
  })

  it('详情响应会同时清除规范密钥和未知敏感字段', async () => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeQueryResult({
      id: 'provider-1',
      type: 'AI_CONFIG',
      value: {
        api_key: CANARY_SECRET,
        access_token: 'unknown-sensitive-canary',
      },
    }))

    const res = await GET({ method: 'GET' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const responseText = await res.text()

    expect(res.status).toBe(200)
    expect(responseText).not.toContain(CANARY_SECRET)
    expect(responseText).not.toContain('unknown-sensitive-canary')
  })

  it.each([
    ['PUT', PUT, makeJsonRequest({ description: 'blocked' })],
    ['DELETE', DELETE, makeJsonRequest(null, 'DELETE')],
  ])('已发布 ProviderConnection 的 %s 被阻断，不能绕过受控版本切换', async (_name, handler, request) => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeQueryResult({
      id: 'provider-1',
      type: 'AI_CONFIG',
      status: 'PUBLISHED',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.primary',
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        auth_mode: 'bearer',
        base_url: 'https://provider.example/v1',
        api_key: CANARY_SECRET,
        connection_timeout_ms: 45000,
        enabled: true,
      },
    }))

    const res = await handler(request, {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('不可')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('草稿 ProviderConnection 更换网关但提交掩码时会清空旧密钥', async () => {
    const provider = {
      id: 'provider-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.primary',
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        auth_mode: 'bearer',
        base_url: 'https://old-provider.example/v1',
        api_key: CANARY_SECRET,
        connection_timeout_ms: 45000,
        enabled: true,
      },
    }
    const updateQuery = makeUpdateResult({
      ...provider,
      value: {
        ...provider.value,
        base_url: 'https://new-provider.example/v1',
        api_key: undefined,
      },
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(provider))
      .mockReturnValueOnce(updateQuery)

    const res = await PUT(makeJsonRequest({
      value: {
        base_url: 'https://new-provider.example/v1',
        api_key: '****',
      },
    }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(200)
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.not.objectContaining({ api_key: expect.anything() }),
    }))
  })

  it('草稿 ProviderConnection 更换端点且完全省略 api_key 时不会回绑旧密钥', async () => {
    const provider = {
      id: 'provider-platform-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.cloud',
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        auth_mode: 'bearer',
        base_url: 'https://old-provider.example/v1',
        api_key: CANARY_SECRET,
        connection_timeout_ms: 45000,
        enabled: true,
      },
    }
    const updateQuery = makeUpdateResult({
      ...provider,
      value: { ...provider.value, base_url: 'https://new-provider.example/v1', api_key: undefined },
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(provider))
      .mockReturnValueOnce(updateQuery)

    const response = await PUT(makeJsonRequest({
      value: { base_url: 'https://new-provider.example/v1' },
    }), { params: Promise.resolve({ id: provider.id }) })

    expect(response.status).toBe(200)
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.not.objectContaining({ api_key: expect.anything() }),
    }))
  })

  it('草稿 ProviderConnection 切换为免认证时清除旧密钥', async () => {
    const provider = {
      id: 'provider-platform-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.cloud',
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        auth_mode: 'bearer',
        base_url: 'https://provider.example/v1',
        api_key: CANARY_SECRET,
        connection_timeout_ms: 45000,
        enabled: true,
      },
    }
    const updateQuery = makeUpdateResult({
      ...provider,
      value: { ...provider.value, auth_mode: 'none', api_key: undefined },
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(provider))
      .mockReturnValueOnce(updateQuery)

    const response = await PUT(makeJsonRequest({ value: { auth_mode: 'none' } }), {
      params: Promise.resolve({ id: provider.id }),
    })

    expect(response.status).toBe(200)
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.objectContaining({ auth_mode: 'none' }),
    }))
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.not.objectContaining({ api_key: expect.anything() }),
    }))
  })

  it('允许编辑草稿 AI 应用，但禁止改变稳定 asset_id', async () => {
    const application = {
      id: 'app-platform-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'ai_application',
        asset_id: 'review.assistant',
        capabilities: ['text_generation'],
        enabled: true,
      },
    }
    const updateQuery = makeUpdateResult({
      ...application,
      value: { ...application.value, capabilities: ['text_generation', 'structured_output'] },
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(application))
      .mockReturnValueOnce(updateQuery)

    const okResponse = await PUT(makeJsonRequest({
      value: { capabilities: ['text_generation', 'structured_output'] },
    }), { params: Promise.resolve({ id: application.id }) })
    expect(okResponse.status).toBe(200)

    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getDefaultOrgId.mockResolvedValue('org-1')
    orgMocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeQueryResult(application))
    const blockedResponse = await PUT(makeJsonRequest({
      value: { asset_id: 'review.changed' },
    }), { params: Promise.resolve({ id: application.id }) })
    const blockedBody = await blockedResponse.json()

    expect(blockedResponse.status).toBe(400)
    expect(blockedBody.error.message).toContain('asset_id')
  })

  it('草稿在读取后被并发发布时，PUT 的状态 CAS 会阻止覆盖已发布版本', async () => {
    const application = {
      id: 'app-cas-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'ai_application',
        asset_id: 'review.cas',
        capabilities: ['text_generation'],
        enabled: true,
      },
    }
    const updateQuery = makeUpdateResult(null, { code: 'PGRST116', message: '0 rows' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(application))
      .mockReturnValueOnce(updateQuery)

    const response = await PUT(makeJsonRequest({ description: 'late writer' }), {
      params: Promise.resolve({ id: application.id }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('状态已变化')
    expect(updateQuery.eq).toHaveBeenCalledWith('status', 'DRAFT')
  })

  it('草稿在读取后被并发发布时，DELETE 的状态 CAS 会阻止删除已发布版本', async () => {
    const application = {
      id: 'app-cas-delete',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'ai_application',
        asset_id: 'review.cas-delete',
        capabilities: ['text_generation'],
        enabled: true,
      },
    }
    const deleteQuery = makeDeleteResult(null, { code: 'PGRST116', message: '0 rows' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult(application))
      .mockReturnValueOnce(deleteQuery)

    const response = await DELETE(makeJsonRequest(null, 'DELETE'), {
      params: Promise.resolve({ id: application.id }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('状态已变化')
    expect(deleteQuery.eq).toHaveBeenCalledWith('status', 'DRAFT')
  })
})
