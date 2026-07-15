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

const CANARY_SECRET = 'sk-canary-never-return-this-value'

function makeSelectSingle(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

function makeArchiveQuery() {
  return {
    error: null,
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
  }
}

function makePublishUpdate(data: unknown) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('POST /api/configs/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getDefaultOrgId.mockResolvedValue('org-1')
  })

  it('发布 UI_THEME 时按类型归档同组织其他已发布主题，保证唯一 active BrandProfile', async () => {
    const archiveQuery = makeArchiveQuery()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'theme-2' }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'theme-2',
        org_id: 'org-1',
        type: 'UI_THEME',
        key: 'UI_THEME_ALT',
        status: 'DRAFT',
      }))
      .mockReturnValueOnce(archiveQuery)
      .mockReturnValueOnce(makePublishUpdate({ id: 'theme-2', status: 'PUBLISHED' }))

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'theme-2' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('PUBLISHED')
    expect(archiveQuery.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(archiveQuery.eq).toHaveBeenCalledWith('type', 'UI_THEME')
    expect(archiveQuery.eq).toHaveBeenCalledWith('status', 'PUBLISHED')
    expect(archiveQuery.eq).not.toHaveBeenCalledWith('key', 'UI_THEME_ALT')
    expect(archiveQuery.neq).toHaveBeenCalledWith('id', 'theme-2')
  })

  it('工具消费策略不能通过通用配置接口发布', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'policy-1' }))
      .mockReturnValueOnce(makeSelectSingle({
        id: 'policy-1',
        org_id: 'org-1',
        type: 'AI_CONFIG',
        key: 'POLICY_CONTRACT_REVIEW',
        status: 'DRAFT',
        value: { kind: 'tool_policy', tool: 'contract_review' },
      }))

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'policy-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('B001')
    expect(body.error.message).toContain('专用校验和发布流程尚未验收')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('没有 config:publish 时返回 403 且不读取或发布配置', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'publish')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('发布 Provider 的响应不会返回真实 API Key', async () => {
    const provider = {
      id: 'provider-1',
      org_id: 'org-1',
      type: 'AI_CONFIG',
      key: 'AI_PROVIDER_PRIMARY',
      status: 'DRAFT',
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
    const archiveQuery = makeArchiveQuery()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'provider-1' }))
      .mockReturnValueOnce(makeSelectSingle(provider))
      .mockReturnValueOnce(archiveQuery)
      .mockReturnValueOnce(makePublishUpdate({ ...provider, status: 'PUBLISHED' }))

    const res = await POST({ method: 'POST' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(body.data.value.api_key).toContain('***')
  })
})
