import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { GET, POST } from './route'

const request = {} as never

describe('legacy /api/rules control plane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it.each([
    ['GET', GET],
    ['POST', POST],
  ])('%s fails closed and names the only canonical endpoint', async (_method, handler) => {
    const response = await handler(request)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body).toMatchObject({
      code: 'RULE_CONTROL_PLANE_MOVED',
      canonicalEndpoint: '/api/contract-policies/rules',
    })
    expect(body.error).toContain('规则集')
    expect(body.error).not.toContain('Prompt')
  })

  it('still requires authentication before disclosing the moved endpoint', async () => {
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('expired'), { name: 'AuthError' }))
    const response = await POST(request)

    expect(response.status).toBe(401)
  })
})
