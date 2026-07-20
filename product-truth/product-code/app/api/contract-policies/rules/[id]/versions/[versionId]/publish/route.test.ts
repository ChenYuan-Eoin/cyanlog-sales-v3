import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ configAccess: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/configs/access', () => ({ userHasFreshOrgConfigAccess: mocks.configAccess }))

import { POST } from './route'

function request() { return {} as NextRequest }
function params() { return { params: Promise.resolve({ id: 'rule-1', versionId: 'snapshot-2' }) } }

function setupRule() {
  const chain = { eq: vi.fn(() => chain), single: vi.fn().mockResolvedValue({
    data: { id: 'rule-1', code: 'R001', rule_set_id: 'set-1' }, error: null,
  }) }
  mocks.from.mockReturnValue({ select: vi.fn(() => chain) })
}

describe('single rule publish boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.configAccess.mockResolvedValue(true) })

  it('checks fresh publish permission before reading the rule', async () => {
    mocks.configAccess.mockResolvedValue(false)
    const response = await POST(request(), params())
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an existing rule and requires atomic RuleSet publication', async () => {
    setupRule()
    const response = await POST(request(), params())
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(body.error.message).toContain('单条规则发布已停用')
    expect(body.error.details).toMatchObject({ rule_set_id: 'set-1', version_id: 'snapshot-2' })
  })
})
