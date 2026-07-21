import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { GET } from './route'

describe('legacy /api/rules/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it('fails closed instead of fabricating machine types and zero hit rates', async () => {
    const response = await GET({} as never)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body).toMatchObject({
      code: 'RULE_ANALYTICS_NOT_AVAILABLE',
      canonicalEndpoint: null,
    })
    expect(body.error).toContain('ReviewRun')
    expect(body.error).toContain('不能展示伪命中率')
    expect(body.replacementContract).toContain('RuleSetSnapshot')
    expect(body.replacementContract).toContain('persisted rule decisions')
  })

  it('still requires authentication', async () => {
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('expired'), { name: 'AuthError' }))
    const response = await GET({} as never)

    expect(response.status).toBe(401)
  })
})
