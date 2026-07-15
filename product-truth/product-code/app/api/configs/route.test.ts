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
}))

vi.mock('@/lib/configs/access', () => accessMocks)

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
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await POST(makeMalformedJsonRequest())

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('创建 Provider 的响应不会返回真实 API Key', async () => {
    const existingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const insertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'provider-1',
          type: 'AI_CONFIG',
          value: { api_key: CANARY_SECRET },
        },
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(insertQuery)

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

    expect(res.status).toBe(201)
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(body.data.value.api_key).toContain('***')
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
})
