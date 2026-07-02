/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

function makeRequest(url: string): any {
  return new Request(url)
}

function makeRulesQuery(data: unknown[]) {
  const result = { data, error: null }
  const chain: any = {}
  ;['select', 'eq', 'order'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

describe('GET /api/rules/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
  })

  it('默认只统计 active contract_rules_v2 规则，避免旧 RULE-01 归档规则进入当前统计', async () => {
    const query = makeRulesQuery([
      {
        id: 'rule-r001',
        code: 'R001',
        name: '付款期限',
        category: 'duration',
        is_active: true,
        lifecycle_status: 'published',
        translation_status: 'ready',
        published_at: '2026-07-02T00:00:00.000Z',
        priority: 100,
      },
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest('https://example.test/api/rules/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('contract_rules_v2')
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.eq).toHaveBeenCalledWith('is_active', true)
    expect(body.summary.total_rules).toBe(1)
    expect(body.summary.active_rules).toBe(1)
    expect(body.summary.published_rules).toBe(1)
    expect(body.summary.draft_rules).toBe(0)
    expect(body.summary.translation_pending_rules).toBe(0)
    expect(body.rules).toHaveLength(1)
    expect(body.rules[0].rule_code).toBe('R001')
    expect(body.rules[0].status).toBe('published')
  })

  it('active 但未完成发布闭环的规则不应被统计为正式发布', async () => {
    const query = makeRulesQuery([
      {
        id: 'rule-r001',
        code: 'R001',
        name: '付款期限',
        category: 'duration',
        is_active: true,
        lifecycle_status: 'published',
        translation_status: 'ready',
        published_at: '2026-07-02T00:00:00.000Z',
        priority: 100,
      },
      {
        id: 'rule-draft',
        code: 'R002',
        name: '草稿规则',
        category: 'text',
        is_active: true,
        lifecycle_status: 'draft',
        translation_status: 'needs_ai_translation',
        published_at: null,
        priority: 90,
      },
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest('https://example.test/api/rules/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.summary.total_rules).toBe(2)
    expect(body.summary.active_rules).toBe(2)
    expect(body.summary.published_rules).toBe(1)
    expect(body.summary.draft_rules).toBe(1)
    expect(body.summary.translation_pending_rules).toBe(1)
    expect(body.rules.map((rule: any) => [rule.rule_code, rule.status])).toEqual([
      ['R001', 'published'],
      ['R002', 'translation_pending'],
    ])
  })

  it('include_archived=true 时保留归档规则统计能力', async () => {
    const query = makeRulesQuery([
      {
        id: 'rule-r001',
        code: 'R001',
        name: '付款期限',
        category: 'duration',
        is_active: true,
        lifecycle_status: 'published',
        translation_status: 'ready',
        published_at: '2026-07-02T00:00:00.000Z',
        priority: 100,
      },
      {
        id: 'legacy-rule',
        code: 'RULE-01-01',
        name: '旧版付款期限',
        category: 'duration',
        is_active: false,
        lifecycle_status: 'archived',
        translation_status: 'ready',
        published_at: '2026-06-01T00:00:00.000Z',
        priority: 100,
      },
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest('https://example.test/api/rules/stats?include_archived=true'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.eq).not.toHaveBeenCalledWith('is_active', true)
    expect(body.summary.total_rules).toBe(2)
    expect(body.summary.active_rules).toBe(1)
    expect(body.summary.published_rules).toBe(1)
    expect(body.rules.map((rule: any) => rule.rule_code)).toEqual(['R001', 'RULE-01-01'])
    expect(body.rules.map((rule: any) => rule.status)).toEqual(['published', 'archived'])
  })
})
