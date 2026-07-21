import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { GET, POST } from './route'

describe('legacy /api/rules/[id]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it.each([GET, POST])('rejects per-rule version management', async (handler) => {
    const response = await handler({} as never)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.code).toBe('RULE_CONTROL_PLANE_MOVED')
    expect(body.error).toContain('单条版本发布')
    expect(body.canonicalEndpoint).toBe('/api/contract-policies/rule-sets')
  })
})
