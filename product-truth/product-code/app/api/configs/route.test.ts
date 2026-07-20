/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
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

import { supabaseAdmin } from '@/lib/supabase'
import { GET, POST } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/configs validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getFreshDefaultOrgId.mockResolvedValue('org-1')
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(makeMalformedJsonRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有 config:read 时列表接口返回 403 且不查询配置', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await GET({ url: 'http://localhost/api/configs' } as any)

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'read')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有 config:write 时创建接口返回 403 且不解析或写入配置', async () => {
    accessMocks.userHasFreshOrgConfigAccess.mockResolvedValue(false)

    const res = await POST(makeMalformedJsonRequest())

    expect(res.status).toBe(403)
    expect(accessMocks.userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('旧 Provider 只读兼容，不能通过通用接口继续新建', async () => {
    const res = await POST({
      json: async () => ({
        key: 'AI_PROVIDER_PRIMARY',
        name: 'Primary provider',
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
      }),
    } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toContain('旧 Provider')
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('列表响应会同时清除规范密钥和未知敏感字段', async () => {
    const listQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{
          id: 'provider-1',
          type: 'AI_CONFIG',
          value: {
            api_key: CANARY_SECRET,
            authorization: 'unknown-authorization-canary',
          },
        }],
        error: null,
        count: 1,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(listQuery)

    const res = await GET({ url: 'http://localhost/api/configs' } as any)
    const responseText = await res.text()

    expect(res.status).toBe(200)
    expect(responseText).not.toContain(CANARY_SECRET)
    expect(responseText).not.toContain('unknown-authorization-canary')
  })

  it('拒绝 Provider 值中的未知凭据字段，避免绕过唯一 api_key 边界', async () => {
    const res = await POST({
      json: async () => ({
        key: 'AI_PROVIDER_UNSAFE',
        name: 'Unsafe provider',
        type: 'AI_CONFIG',
        value: {
          kind: 'provider',
          level: 1,
          name: 'Unsafe provider',
          profile: 'unsafe',
          provider_kind: 'openai_compatible',
          base_url: 'https://provider.example/v1',
          api_key: CANARY_SECRET,
          access_token: 'bypass-secret',
          model: 'provider-model',
          timeout_ms: 45000,
          enabled: true,
        },
      }),
    } as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('创建独立 ProviderConnection 时不会注入模型或业务阶段', async () => {
    const existingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const inserted = {
      id: 'connection-1',
      type: 'AI_CONFIG',
      status: 'DRAFT',
      value: {
        schema_version: 'ai-platform.v1',
        kind: 'provider_connection',
        asset_id: 'provider.cloud',
        provider_type: 'openai_compatible',
        runtime_location: 'cloud',
        base_url: 'https://provider.example/v1',
        connection_timeout_ms: 240000,
        enabled: true,
      },
    }
    const insertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(insertQuery)

    const response = await POST({
      json: async () => ({
        key: 'AI_PROVIDER_CLOUD',
        name: '云模型服务',
        type: 'AI_CONFIG',
        value: inserted.value,
      }),
    } as any)

    expect(response.status).toBe(201)
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.not.objectContaining({ model: expect.anything(), stages: expect.anything() }),
    }))
  })

  it('Provider 修订通过服务端来源复用同一连接的密钥，响应仍只返回掩码', async () => {
    const sourceValue = {
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
    }
    const sourceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'source-1',
          type: 'AI_CONFIG',
          org_id: 'org-1',
          status: 'PUBLISHED',
          value: sourceValue,
        },
        error: null,
      }),
    }
    const existingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const insertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'revision-1', type: 'AI_CONFIG', value: sourceValue },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(sourceQuery)
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(insertQuery)

    const response = await POST({
      json: async () => ({
        key: 'AI_PROVIDER_CLOUD_R2',
        name: 'Cloud provider revision',
        type: 'AI_CONFIG',
        revision_source_id: 'source-1',
        credential_action: 'reuse',
        value: { ...sourceValue, api_key: undefined },
      }),
    } as any)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.objectContaining({ api_key: CANARY_SECRET }),
    }))
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(body.data.value.api_key).toContain('***')
  })

  it.each([
    ['端点', { base_url: 'https://other.example/v1' }],
    ['位置', { runtime_location: 'local', base_url: 'http://127.0.0.1:1234/v1' }],
    ['认证方式', { auth_mode: 'none' }],
  ])('Provider 修订改变%s时拒绝复用旧密钥', async (_label, patch) => {
    const sourceValue = {
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
    }
    const sourceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'source-1',
          type: 'AI_CONFIG',
          org_id: 'org-1',
          status: 'PUBLISHED',
          value: sourceValue,
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(sourceQuery)

    const response = await POST({
      json: async () => ({
        key: 'AI_PROVIDER_CLOUD_R2',
        name: 'Unsafe revision',
        type: 'AI_CONFIG',
        revision_source_id: 'source-1',
        credential_action: 'reuse',
        value: { ...sourceValue, api_key: undefined, ...patch },
      }),
    } as any)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toMatch(/不能复用|只有 Bearer/)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('拒绝从已归档 Provider 修订或复用历史密钥', async () => {
    const archivedSecret = 'sk-archived-must-never-be-reused'
    const sourceValue = {
      schema_version: 'ai-platform.v1',
      kind: 'provider_connection',
      asset_id: 'provider.cloud',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: archivedSecret,
      connection_timeout_ms: 45000,
      enabled: true,
    }
    const sourceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'source-archived',
          type: 'AI_CONFIG',
          org_id: 'org-1',
          status: 'ARCHIVED',
          value: sourceValue,
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any).mockReturnValueOnce(sourceQuery)

    const response = await POST({
      json: async () => ({
        key: 'AI_PROVIDER_CLOUD_R2',
        name: 'Archived source revision',
        type: 'AI_CONFIG',
        revision_source_id: 'source-archived',
        credential_action: 'reuse',
        value: { ...sourceValue, api_key: undefined },
      }),
    } as any)
    const responseText = await response.text()

    expect(response.status).toBe(404)
    expect(responseText).toContain('当前已发布')
    expect(responseText).not.toContain(archivedSecret)
    expect(sourceQuery.eq).toHaveBeenCalledWith('status', 'PUBLISHED')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
})
