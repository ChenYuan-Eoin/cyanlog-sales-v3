/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(),
  getAccessibleContract: vi.fn(),
  listFreshAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import {
  canAccessContractAction,
  getAccessibleContract,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET, PATCH } from './route'

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'

describe('/api/contracts/[id]/review permission gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET 统一要求当前组织 VIEW 权限', async () => {
    vi.mocked(getAccessibleContract).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
      contract: { id: CONTRACT_ID, contract_reviews: [] },
    })
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const response = await GET({
      nextUrl: new URL(`https://sales.example.test/api/contracts/${CONTRACT_ID}/review`),
    } as any, {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })

    expect(response.status).toBe(403)
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'view')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('PATCH 使用 fresh assignment，撤权后不读取或更新合同', async () => {
    vi.mocked(listFreshAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const response = await PATCH({
      json: async () => ({ conclusion: 'APPROVED' }),
    } as any, {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })

    expect(response.status).toBe(403)
    expect(listFreshAccessibleUserIds).toHaveBeenCalledWith('user-1', 'org-1')
    expect(getAccessibleContract).not.toHaveBeenCalled()
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'review')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
