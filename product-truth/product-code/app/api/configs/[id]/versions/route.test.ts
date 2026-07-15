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
import { GET } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

function makeSelectSingle(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('GET /api/configs/[id]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    orgMocks.getDefaultOrgId.mockResolvedValue('org-1')
  })

  it('没有 config:read 时返回 403 且不读取版本历史', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await GET({ method: 'GET' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'read')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('AI 配置版本响应不会返回历史真实 API Key', async () => {
    const versionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          id: 'version-1',
          config_id: 'provider-1',
          version: 1,
          value: {
            kind: 'provider',
            api_key: CANARY_SECRET,
            access_token: 'unknown-version-secret',
          },
        }],
        error: null,
      }),
    }
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeSelectSingle({ id: 'provider-1', type: 'AI_CONFIG' }))
      .mockReturnValueOnce(versionQuery)

    const res = await GET({ method: 'GET' } as any, {
      params: Promise.resolve({ id: 'provider-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain(CANARY_SECRET)
    expect(JSON.stringify(body)).not.toContain('unknown-version-secret')
    expect(body.data[0].value.api_key).toContain('***')
  })
})
