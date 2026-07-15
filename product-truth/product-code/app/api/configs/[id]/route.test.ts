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

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, PUT } from './route'

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

describe('PUT /api/configs/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回参数错误且不执行配置更新', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({ org_id: 'org-1' }))
      .mockReturnValueOnce(makeQueryResult({ id: 'config-1', type: 'UI_THEME', value: {} }))

    const res = await PUT(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'config-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('config_versions')
  })

  it('模型应用不能通过通用 Provider 接口修改', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({ org_id: 'org-1' }))
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
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('Provider 不能通过通用接口跨 kind 改成模型应用', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({ org_id: 'org-1' }))
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
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('工具消费策略不能通过通用接口删除', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({ org_id: 'org-1' }))
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
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })
})
