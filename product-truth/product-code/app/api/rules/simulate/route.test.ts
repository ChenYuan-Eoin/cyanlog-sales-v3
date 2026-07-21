import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { POST } from './route'

describe('legacy /api/rules/simulate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it('rejects the A/B/C facade and points to snapshot-backed rule testing', async () => {
    const response = await POST({} as never)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.code).toBe('RULE_CONTROL_PLANE_MOVED')
    expect(body.canonicalEndpoint).toBe('/api/rules/test')
    expect(body.error).toContain('旧模拟')
  })
})
