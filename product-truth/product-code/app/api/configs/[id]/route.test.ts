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
}))

const orgMocks = vi.hoisted(() => ({
  getDefaultOrgId: vi.fn(),
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

function makeUpdateResult(data: unknown) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('PUT /api/configs/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getDefaultOrgId.mockResolvedValue('org-1')
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
    expect(body.error.message).toContain('当前只读')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('Provider 不能通过通用接口跨 kind 改成模型应用', async () => {
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
    expect(body.error.message).toContain('kind 不可')
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
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)
    const res = await handler(request, {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('更新 Provider 的响应不会返回真实 API Key', async () => {
    const provider = {
      id: 'provider-1',
      type: 'AI_CONFIG',
      value: {
        kind: 'provider',
        level: 1,
        name: 'Primary provider',
        profile: 'primary',
        provider_kind: 'openai_compatible',
        base_url: 'https://provider.example/v1',
        api_key: CANARY_SECRET,
        model: 'provider-model',
        timeout_ms: 45000,
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
  ])('已发布 Provider 的 %s 被阻断，不能绕过受控版本切换', async (_name, handler, request) => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeQueryResult({
      id: 'provider-1',
      type: 'AI_CONFIG',
      status: 'PUBLISHED',
      value: {
        kind: 'provider',
        level: 1,
        name: 'Published provider',
        profile: 'primary',
        provider_kind: 'openai_compatible',
        base_url: 'https://provider.example/v1',
        api_key: CANARY_SECRET,
        model: 'provider-model',
        timeout_ms: 45000,
        enabled: true,
      },
    }))

    const res = await handler(request, {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('已发布 Provider')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('草稿 Provider 更换网关但未提供新密钥时会清空旧密钥', async () => {
    const provider = {
      id: 'provider-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        kind: 'provider',
        level: 1,
        name: 'Draft provider',
        profile: 'primary',
        provider_kind: 'openai_compatible',
        base_url: 'https://old-provider.example/v1',
        api_key: CANARY_SECRET,
        model: 'provider-model',
        timeout_ms: 45000,
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
        api_key: 'sk-c***alue',
      },
    }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(200)
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.not.objectContaining({ api_key: expect.anything() }),
    }))
  })
})
