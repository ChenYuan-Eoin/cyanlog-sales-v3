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
import { POST } from './route'

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
  })

  it('发布 UI_THEME 时按类型归档同组织其他已发布主题，保证唯一 active BrandProfile', async () => {
    const archiveQuery = makeArchiveQuery()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ org_id: 'org-1' }))
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
      .mockReturnValueOnce(makeSelectSingle({ org_id: 'org-1' }))
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
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3)
  })
})
