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
import { POST } from './route'

const CURRENT_SECRET = 'sk-current-canary-never-return'
const HISTORICAL_SECRET = 'sk-historical-canary-never-return'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeSelectSingle(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

function makeUpdate(data: unknown) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('POST /api/configs/[id]/rollback validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getDefaultOrgId.mockResolvedValue('org-1')
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'config-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有 config:write 时返回 403 且不读取版本或更新配置', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await POST(makeJsonRequest({ version: 1 }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('没有 config:write 时即使 JSON 畸形也稳定返回 403', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await POST(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('模型应用不能通过通用回滚接口恢复历史版本', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({
        id: 'application-1',
        type: 'AI_CONFIG',
        status: 'DRAFT',
        value: { kind: 'application', application_id: 'contract_review' },
      }))

    const res = await POST(makeJsonRequest({ version: 1 }), {
      params: Promise.resolve({ id: 'application-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('禁止回滚')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('已发布 Provider 不能原地回滚并绕过受控版本切换', async () => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeSelectSingle({
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
        api_key: CURRENT_SECRET,
        model: 'provider-model',
        timeout_ms: 45000,
        enabled: true,
      },
    }))

    const res = await POST(makeJsonRequest({ version: 1 }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('已发布 Provider')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('Provider 回滚丢弃历史密钥、保留当前密钥且响应不泄漏任何密钥', async () => {
    const currentValue = {
      kind: 'provider',
      level: 1,
      name: 'Current provider',
      profile: 'primary',
      provider_kind: 'openai_compatible',
      base_url: 'https://provider.example/v1',
      api_key: CURRENT_SECRET,
      model: 'current-model',
      timeout_ms: 45000,
      enabled: true,
    }
    const historicalValue = {
      ...currentValue,
      name: 'Historical provider',
      api_key: HISTORICAL_SECRET,
      model: 'historical-model',
    }
    const updateQuery = makeUpdate({
      id: 'provider-1',
      type: 'AI_CONFIG',
      value: { ...historicalValue, api_key: CURRENT_SECRET },
      status: 'DRAFT',
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({
        id: 'provider-1',
        type: 'AI_CONFIG',
        status: 'DRAFT',
        value: currentValue,
      }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'version-1',
        config_id: 'provider-1',
        version: 1,
        value: historicalValue,
      }))
      .mockReturnValueOnce(updateQuery)

    const res = await POST(makeJsonRequest({ version: 1 }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.objectContaining({
        api_key: CURRENT_SECRET,
        model: 'historical-model',
      }),
    }))
    expect(JSON.stringify(body)).not.toContain(CURRENT_SECRET)
    expect(JSON.stringify(body)).not.toContain(HISTORICAL_SECRET)
    expect(body.data.config.value.api_key).toContain('***')
    expect(body.data.rollbackFrom.value.api_key).toContain('***')
  })

  it('Provider 回滚到不同网关时清空当前密钥，防止凭据发送给错误第三方', async () => {
    const currentValue = {
      kind: 'provider',
      level: 1,
      name: 'Current provider',
      profile: 'primary',
      provider_kind: 'openai_compatible',
      base_url: 'https://current-provider.example/v1',
      api_key: CURRENT_SECRET,
      model: 'current-model',
      timeout_ms: 45000,
      enabled: true,
    }
    const historicalValue = {
      ...currentValue,
      base_url: 'https://historical-provider.example/v1',
      api_key: HISTORICAL_SECRET,
      model: 'historical-model',
    }
    const updateQuery = makeUpdate({
      id: 'provider-1',
      type: 'AI_CONFIG',
      value: historicalValue,
      status: 'DRAFT',
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({
        id: 'provider-1',
        type: 'AI_CONFIG',
        status: 'DRAFT',
        value: currentValue,
      }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'version-1',
        config_id: 'provider-1',
        version: 1,
        value: historicalValue,
      }))
      .mockReturnValueOnce(updateQuery)

    const res = await POST(makeJsonRequest({ version: 1 }), {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(200)
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.not.objectContaining({ api_key: expect.anything() }),
    }))
  })
})
