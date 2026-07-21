import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { DELETE, GET, PUT } from './route'

const request = {} as never

describe('legacy /api/rules/[id] control plane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it.each([
    ['GET', GET],
    ['PUT', PUT],
    ['DELETE', DELETE],
  ])('%s cannot read or mutate the obsolete rule model', async (_method, handler) => {
    const response = await handler(request)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.code).toBe('RULE_CONTROL_PLANE_MOVED')
    expect(body.canonicalEndpoint).toBe('/api/contract-policies/rules')
  })
})
