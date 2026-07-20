import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  configAccess: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'u1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { POST } from './route'

function makeRequest() {
  return {} as NextRequest
}

function makeParams(id = 'rule-1') {
  return { params: Promise.resolve({ id }) }
}

function setupRule(rule: Record<string, unknown> | null = { id: 'rule-1', code: 'R001', name: '付款节奏' }) {
  const chain = {
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(rule
      ? { data: rule, error: null }
      : { data: null, error: { message: 'not found' } }),
  }
  const select = vi.fn(() => chain)
  mocks.from.mockReturnValue({ select })
  return { select }
}

describe('POST /api/contract-policies/rules/[id]/translate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(true)
  })

  it('returns 403 before reading a rule without fresh config:write', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await POST(makeRequest(), makeParams())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('config:write')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('retires AI rule translation and points authors to the business rule editor', async () => {
    const { select } = setupRule()

    const response = await POST(makeRequest(), makeParams())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('不再使用 AI 转译')
    expect(body.error.details).toMatchObject({
      rule_id: 'rule-1',
      rule_code: 'R001',
      replacement: 'rule_contract_editor',
      ai_boundary: 'runtime_property_reading_only',
    })
    expect(select).toHaveBeenCalledWith('id, code, name')
  })

  it('returns 404 for an unknown rule', async () => {
    setupRule(null)

    const response = await POST(makeRequest(), makeParams('missing'))

    expect(response.status).toBe(404)
  })
})
