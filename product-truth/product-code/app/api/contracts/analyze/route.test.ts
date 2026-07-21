import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  withAuthAndOrg: vi.fn(),
  executeRules: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: mocks.withAuthAndOrg,
}))

vi.mock('@/lib/rules/engine', () => ({
  executeRules: mocks.executeRules,
}))

import { POST } from './route'

describe('legacy POST /api/contracts/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withAuthAndOrg.mockImplementation(async (
      _req: NextRequest,
      handler: (user: { id: string }, orgId: string) => Promise<Response>
    ) => handler({ id: 'user-1' }, 'org-1'))
  })

  it('authenticates before closing text-only review and points to the contract-bound flow', async () => {
    const request = {} as NextRequest
    const response = await POST(request)
    const body = await response.json()

    expect(mocks.withAuthAndOrg).toHaveBeenCalledWith(request, expect.any(Function))
    expect(response.status).toBe(410)
    expect(body).toEqual(expect.objectContaining({
      code: 'CONTRACT_ANALYSIS_ENDPOINT_MOVED',
      canonicalEndpoint: '/api/contracts/:id/analyze',
    }))
    expect(body.requiredFlow).toEqual([
      'POST /api/contracts',
      'POST /api/contracts/:id/analyze',
    ])
    expect(mocks.executeRules).not.toHaveBeenCalled()
  })

  it('returns the authentication result without exposing endpoint migration details', async () => {
    mocks.withAuthAndOrg.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))

    const response = await POST({} as NextRequest)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'unauthorized' })
    expect(mocks.executeRules).not.toHaveBeenCalled()
  })
})
