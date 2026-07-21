import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { POST } from './route'

describe('legacy /api/rules/[id]/rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it('rejects independent rollback that would create a mixed release', async () => {
    const response = await POST({} as never)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.code).toBe('RULE_CONTROL_PLANE_MOVED')
    expect(body.error).toContain('单条回滚')
    expect(body.canonicalEndpoint).toBe('/api/contract-policies/rule-sets')
  })
})
