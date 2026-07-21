import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

import {
  canAccessContractAction,
  listAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'

describe('GET /api/contracts/[id]/file permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
  })

  it('没有查看合同权限时不查询版本也不读取私有 Storage', async () => {
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const res = await GET({
      url: `https://app.example.test/api/contracts/${CONTRACT_ID}/file?path=org-1%2Fsource.docx`,
      headers: new Headers(),
    } as never, {
      params: Promise.resolve({ id: CONTRACT_ID }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'view')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })
})
