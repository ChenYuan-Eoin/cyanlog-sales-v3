/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { loadFlexibleRules, loadFlexibleRulesFromSnapshots } from './flexible-engine'

function makeRulesQuery(data: unknown[]) {
  const result = { data, error: null }
  const chain: any = {}
  ;['select', 'eq', 'not', 'order', 'in'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

describe('loadFlexibleRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('默认只加载正式发布且已转译的规则进入审核引擎', async () => {
    const query = makeRulesQuery([
      {
        id: 'rule-r001',
        org_id: 'org-1',
        code: 'R001',
        name: '付款节奏',
        description: null,
        problem_category_id: 'category-payment',
        problem_category: {
          id: 'category-payment',
          code: 'payment',
          name: '付款与结算',
        },
        rule_contract: {
          schema_version: '1.0',
          properties: [{
            key: 'first_payment_rate',
            label: '首付款比例',
            type: 'percentage',
            required: true,
            unit: 'percent',
          }],
          decisions: [{
            id: 'payment_block',
            label: '低于红线',
            outcome: 'block',
            priority: 30,
            match: 'all',
            conditions: [{ property_key: 'first_payment_rate', operator: '<', value: 15 }],
          }],
          missing_evidence_outcome: 'manual_review',
        },
        category: 'ratio',
        engine_type: 'hybrid',
        target_field: 'payment_schedule',
        field_hints: ['首付'],
        applicable_scenarios: [],
        scope: 'org',
        is_active: true,
        lifecycle_status: 'published',
        translation_status: 'ready',
        published_at: '2026-07-02T00:00:00.000Z',
        priority: 100,
        version: 2,
        created_by: 'u1',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-02T00:00:00.000Z',
      },
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const rules = await loadFlexibleRules({ orgId: 'org-1' })

    expect(supabaseAdmin.from).toHaveBeenCalledWith('contract_rules_v2')
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.eq).toHaveBeenCalledWith('is_active', true)
    expect(query.eq).toHaveBeenCalledWith('lifecycle_status', 'published')
    expect(query.eq).toHaveBeenCalledWith('translation_status', 'ready')
    expect(query.not).toHaveBeenCalledWith('published_at', 'is', null)
    expect(rules).toHaveLength(1)
    expect(rules[0].code).toBe('R001')
    expect(rules[0]).toMatchObject({
      problem_category: { code: 'payment', name: '付款与结算' },
      rule_contract: {
        schema_version: '1.0',
        properties: [{ key: 'first_payment_rate' }],
      },
    })
  })

  it('配置中心测试场景可显式加载未发布规则，但不会成为正式审核默认行为', async () => {
    const query = makeRulesQuery([])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    await loadFlexibleRules({ orgId: 'org-1', includeUnpublished: true })

    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.eq).toHaveBeenCalledWith('is_active', true)
    expect(query.eq).not.toHaveBeenCalledWith('lifecycle_status', 'published')
    expect(query.eq).not.toHaveBeenCalledWith('translation_status', 'ready')
    expect(query.not).not.toHaveBeenCalled()
  })

  it('正式审核可从 SkillBundle 绑定的发布快照加载规则，冻结执行输入', async () => {
    const query = makeRulesQuery([
      {
        id: 'snapshot-r001-v2',
        rule_id: 'rule-r001',
        version: 2,
        status: 'published',
        config_snapshot: {
          id: 'rule-r001',
          org_id: 'org-1',
          code: 'R001',
          name: '付款节奏',
          description: null,
          category: 'ratio',
          engine_type: 'hybrid',
          target_field: 'payment_schedule',
          field_hints: ['首付'],
          applicable_scenarios: ['all'],
          scope: 'org',
          is_active: true,
          priority: 100,
          version: 2,
          created_by: 'u1',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-02T00:00:00.000Z',
        },
      },
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const rules = await loadFlexibleRulesFromSnapshots({
      orgId: 'org-1',
      snapshotIds: ['snapshot-r001-v2'],
    })

    expect(supabaseAdmin.from).toHaveBeenCalledWith('contract_rule_snapshots')
    expect(query.in).toHaveBeenCalledWith('id', ['snapshot-r001-v2'])
    expect(query.eq).not.toHaveBeenCalledWith('lifecycle_status', 'published')
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'rule-r001',
      code: 'R001',
      version: 2,
      target_field: 'payment_schedule',
    })
  })

  it('正式审核忽略未发布的 compiled 快照，避免草稿规则进入运行引擎', async () => {
    const query = makeRulesQuery([
      {
        id: 'snapshot-r001-draft',
        rule_id: 'rule-r001',
        version: 3,
        status: 'compiled',
        config_snapshot: {
          id: 'rule-r001',
          org_id: 'org-1',
          code: 'R001',
          name: '付款节奏草稿',
          category: 'ratio',
          engine_type: 'hybrid',
          target_field: 'payment_schedule',
          field_hints: ['付款'],
          applicable_scenarios: ['all'],
          scope: 'org',
          is_active: true,
          priority: 200,
          version: 3,
        },
      },
      {
        id: 'snapshot-r002-v2',
        rule_id: 'rule-r002',
        version: 2,
        status: 'published',
        config_snapshot: {
          id: 'rule-r002',
          org_id: 'org-1',
          code: 'R002',
          name: '验收周期',
          category: 'timeline',
          engine_type: 'hybrid',
          target_field: 'acceptance_period',
          field_hints: ['验收'],
          applicable_scenarios: ['all'],
          scope: 'org',
          is_active: true,
          priority: 100,
          version: 2,
        },
      },
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const rules = await loadFlexibleRulesFromSnapshots({
      orgId: 'org-1',
      snapshotIds: ['snapshot-r001-draft', 'snapshot-r002-v2'],
    })

    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'rule-r002',
      code: 'R002',
      version: 2,
      target_field: 'acceptance_period',
    })
  })
})
