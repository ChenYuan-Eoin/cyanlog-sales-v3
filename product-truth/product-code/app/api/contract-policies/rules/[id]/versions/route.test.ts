/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  configAccess: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { GET } from './route'

const params = { params: Promise.resolve({ id: 'rule-1' }) }

function request(): NextRequest {
  return {} as NextRequest
}

function singleQuery(data: unknown, error: unknown = null) {
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data, error })
  return chain
}

function listQuery(data: unknown, error: unknown = null) {
  const result = { data, error }
  const chain: any = {}
  ;['select', 'eq', 'order'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return chain
}

describe('GET /api/contract-policies/rules/[id]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(true)
  })

  it('marks only the snapshot named by the RuleSet current pointer as current', async () => {
    const ruleQuery = singleQuery({
      id: 'rule-1', org_id: 'org-1', rule_set_id: 'set-1', version: 3,
      lifecycle_status: 'ready_to_publish', created_at: '2026-07-20T00:00:00.000Z',
    })
    const versionsQuery = listQuery([
      { id: 'draft-v3', rule_id: 'rule-1', version: 3, status: 'draft', created_at: '2026-07-20T03:00:00.000Z' },
      { id: 'published-v2', rule_id: 'rule-1', version: 2, status: 'published', created_at: '2026-07-20T02:00:00.000Z' },
      { id: 'published-v1', rule_id: 'rule-1', version: 1, status: 'published', created_at: '2026-07-20T01:00:00.000Z' },
    ])
    const ruleSetQuery = singleQuery({
      id: 'set-1', current_snapshot_id: 'set-snapshot-current', published_at: '2026-07-20T01:00:00.000Z',
    })
    const ruleSetSnapshotQuery = singleQuery({
      id: 'set-snapshot-current', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
      rule_snapshot_ids: ['published-v1'],
    })
    mocks.from.mockImplementation((table: string) => ({
      contract_rules_v2: ruleQuery,
      contract_rule_snapshots: versionsQuery,
      contract_rule_sets: ruleSetQuery,
      contract_rule_set_snapshots: ruleSetSnapshotQuery,
    })[table])

    const response = await GET(request(), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.current_binding_state).toBe('bound')
    expect(body.data.versions.map((version: any) => [version.id, version.is_current])).toEqual([
      ['draft-v3', false],
      ['published-v2', false],
      ['published-v1', true],
    ])
    expect(ruleSetSnapshotQuery.eq).toHaveBeenCalledWith('status', 'published')
  })

  it('does not guess a current version when a previously published RuleSet has no pointer', async () => {
    const ruleQuery = singleQuery({
      id: 'rule-1', org_id: 'org-1', rule_set_id: 'set-1', version: 2,
      lifecycle_status: 'published', created_at: '2026-07-20T00:00:00.000Z',
    })
    const versionsQuery = listQuery([
      { id: 'published-v2', rule_id: 'rule-1', version: 2, status: 'published', created_at: '2026-07-20T02:00:00.000Z' },
      { id: 'published-v1', rule_id: 'rule-1', version: 1, status: 'published', created_at: '2026-07-20T01:00:00.000Z' },
    ])
    const ruleSetQuery = singleQuery({
      id: 'set-1', current_snapshot_id: null, published_at: '2026-07-20T01:00:00.000Z',
    })
    mocks.from.mockImplementation((table: string) => ({
      contract_rules_v2: ruleQuery,
      contract_rule_snapshots: versionsQuery,
      contract_rule_sets: ruleSetQuery,
    })[table])

    const response = await GET(request(), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.current_binding_state).toBe('missing')
    expect(body.data.versions.every((version: any) => version.is_current === false)).toBe(true)
    expect(mocks.from).not.toHaveBeenCalledWith('contract_rule_set_snapshots')
  })
})
