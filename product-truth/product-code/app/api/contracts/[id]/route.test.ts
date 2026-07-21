/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(),
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

vi.mock('@/lib/observability', () => ({
  getRequestId: vi.fn(() => 'req-1'),
  logRouteDone: vi.fn(),
  logRouteFailure: vi.fn(),
  logRouteStart: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import {
  canAccessContractAction,
  getDefaultOrgId,
  listAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, PATCH } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('PATCH /api/contracts/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回参数错误且不查询组织和合同', async () => {
    const res = await PATCH(makeMalformedRequest(), {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_DATA')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe('GET /api/contracts/[id] permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    vi.mocked(getDefaultOrgId).mockResolvedValue('org-1')
    vi.mocked(listAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
  })

  it('没有合同查看能力时返回 403 且不查询合同与任务证据', async () => {
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const res = await GET({ headers: new Headers() } as any, {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('FORBIDDEN')
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'view')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
