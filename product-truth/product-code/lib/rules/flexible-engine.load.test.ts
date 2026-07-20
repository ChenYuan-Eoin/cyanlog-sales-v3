/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import {
  evaluateFlexibleRule,
  executeFlexibleRulesCompat,
  loadFlexibleRules,
  loadFlexibleRulesFromSnapshots,
} from './flexible-engine'

function makeRulesQuery(data: unknown[], error: { message: string } | null = null) {
  const result = { data, error }
  const chain: any = {}
  ;['select', 'eq', 'not', 'order', 'in'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

function makePublishedSnapshot(
  configSnapshot: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `snapshot-${String(configSnapshot.id)}-v${String(configSnapshot.version)}`,
    rule_id: configSnapshot.id,
    version: configSnapshot.version,
    status: 'published',
    released_at: '2026-07-02T00:00:00.000Z',
    created_at: '2026-07-02T00:00:00.000Z',
    config_snapshot: { rule_set_id: 'rule-set-1', ...configSnapshot },
    ...overrides,
  }
}

function makePublishedRuleSetSnapshot(
  ruleSnapshotIds: string[],
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'rule-set-snapshot-1',
    org_id: 'org-1',
    rule_set_id: 'rule-set-1',
    version: 2,
    status: 'published',
    rule_snapshot_ids: ruleSnapshotIds,
    released_at: '2026-07-02T00:00:00.000Z',
    created_at: '2026-07-02T00:00:00.000Z',
    ...overrides,
  }
}

function makePublishedRuleSetPointer(
  currentSnapshotId: string | null = 'rule-set-snapshot-1',
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'rule-set-1',
    org_id: 'org-1',
    current_snapshot_id: currentSnapshotId,
    published_at: '2026-07-02T00:00:00.000Z',
    ...overrides,
  }
}

function mockCurrentRuntimeSnapshots(
  ruleSnapshots: Array<Record<string, unknown>>,
  ruleSetSnapshots: Array<Record<string, unknown>> = [
    makePublishedRuleSetSnapshot(ruleSnapshots.map((snapshot) => String(snapshot.id))),
  ]
) {
  const ruleSetPointerQuery = makeRulesQuery([
    makePublishedRuleSetPointer(String(ruleSetSnapshots[0]?.id || 'rule-set-snapshot-1')),
  ])
  const ruleSetQuery = makeRulesQuery(ruleSetSnapshots)
  const ruleQuery = makeRulesQuery(ruleSnapshots)
  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    if (table === 'contract_rule_sets') return ruleSetPointerQuery
    if (table === 'contract_rule_set_snapshots') return ruleSetQuery
    if (table === 'contract_rule_snapshots') return ruleQuery
    throw new Error(`unexpected table: ${table}`)
  })
  return { ruleSetPointerQuery, ruleSetQuery, ruleQuery }
}

describe('loadFlexibleRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('保存已发布规则的新草稿后，正式审核仍只消费上一份 published 快照', async () => {
    const publishedRuleSnapshots = [
      makePublishedSnapshot({
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
      }),
    ]
    const { ruleSetPointerQuery, ruleSetQuery, ruleQuery } = mockCurrentRuntimeSnapshots(publishedRuleSnapshots)

    const rules = await loadFlexibleRules({ orgId: 'org-1' })

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3)
    expect(supabaseAdmin.from).toHaveBeenNthCalledWith(1, 'contract_rule_sets')
    expect(supabaseAdmin.from).toHaveBeenNthCalledWith(2, 'contract_rule_set_snapshots')
    expect(supabaseAdmin.from).toHaveBeenNthCalledWith(3, 'contract_rule_snapshots')
    expect(supabaseAdmin.from).toHaveBeenCalledWith('contract_rule_snapshots')
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('contract_rules_v2')
    expect(ruleSetPointerQuery.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(ruleSetPointerQuery.eq).toHaveBeenCalledWith('is_active', true)
    expect(ruleSetPointerQuery.not).not.toHaveBeenCalled()
    expect(ruleSetQuery.in).toHaveBeenCalledWith('id', ['rule-set-snapshot-1'])
    expect(ruleSetQuery.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(ruleSetQuery.eq).toHaveBeenCalledWith('status', 'published')
    expect(ruleQuery.in).toHaveBeenCalledWith('id', [publishedRuleSnapshots[0].id])
    expect(ruleQuery.eq).toHaveBeenCalledWith('status', 'published')
    expect(ruleQuery.eq).toHaveBeenCalledWith('config_snapshot->>org_id', 'org-1')
    expect(ruleQuery.eq).toHaveBeenCalledWith('config_snapshot->>is_active', 'true')
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

  it('确定性执行结果使用已发布 decision action，不生成通用建议覆盖业务动作', async () => {
    const snapshot = makePublishedSnapshot({
      id: 'rule-minimum-amount',
      org_id: 'org-1',
      code: 'MIN_AMOUNT',
      name: '合同金额下限',
      description: null,
      rule_contract: {
        schema_version: '1.0',
        properties: [{
          key: 'contract_amount',
          label: '合同金额',
          type: 'money',
          required: true,
          currency: 'CNY',
        }],
        decisions: [{
          id: 'below-minimum',
          label: '低于金额下限',
          outcome: 'block',
          priority: 20,
          match: 'all',
          conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000, unit: 'CNY' }],
          message: '合同金额不足五万元',
          action: '提交例外审批',
        }],
        missing_evidence_outcome: 'manual_review',
      },
      category: 'amount',
      engine_type: 'hybrid',
      applicable_scenarios: ['all'],
      scope: 'org',
      is_active: true,
      priority: 100,
      version: 1,
    })
    mockCurrentRuntimeSnapshots([snapshot])

    const result = await executeFlexibleRulesCompat('合同金额为4万元。', 'org-1')

    expect(result.risks[0]).toMatchObject({
      ruleCode: 'MIN_AMOUNT',
      decisionId: 'below-minimum',
      level: 'red',
      title: '合同金额下限',
      description: '合同金额不足五万元',
      suggestion: '提交例外审批',
      propertyReadings: [{
        propertyKey: 'contract_amount',
        status: 'read',
        value: 40000,
        unit: 'CNY',
      }],
    })
  })

  it('RuleSet current pointer 查询失败时正式审核 fail closed', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue(makeRulesQuery([], { message: 'ruleset unavailable' }))

    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULESET_POINTER_QUERY_FAILED: ruleset unavailable'
    )
  })

  it('current snapshot 与 published_at 只有一项存在时 fail closed，未发布草稿则忽略', async () => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeRulesQuery([
      makePublishedRuleSetPointer(null),
    ]))
    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULESET_POINTER_STATE_INVALID: rule-set-1'
    )

    vi.clearAllMocks()
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeRulesQuery([
      makePublishedRuleSetPointer('rule-set-snapshot-1', { published_at: null }),
    ]))
    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULESET_POINTER_STATE_INVALID: rule-set-1'
    )

    vi.clearAllMocks()
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeRulesQuery([
      makePublishedRuleSetPointer(null, { published_at: null }),
    ]))
    await expect(loadFlexibleRules({ orgId: 'org-1' })).resolves.toEqual([])
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('current RuleSetSnapshot 成员清单为空、含空 ID 或重复 ID 时逐套 fail closed', async () => {
    for (const memberIds of [
      [],
      ['snapshot-r001-v1', ''],
      ['snapshot-r001-v1', 'snapshot-r001-v1'],
    ]) {
      vi.clearAllMocks()
      mockCurrentRuntimeSnapshots([], [makePublishedRuleSetSnapshot(memberIds)])
      await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
        'RULE_RUNTIME_RULESET_MEMBERSHIP_INVALID: rule-set-1'
      )
    }
  })

  it('current snapshot 指向错误 RuleSet 时 fail closed', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeRulesQuery([makePublishedRuleSetPointer('rule-set-snapshot-wrong')]))
      .mockReturnValueOnce(makeRulesQuery([makePublishedRuleSetSnapshot([], {
        id: 'rule-set-snapshot-wrong',
        rule_set_id: 'different-rule-set',
      })]))
    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULESET_POINTER_INVALID: rule-set-1'
    )
  })

  it('RuleSetSnapshot 已绑定成员但 RuleSnapshot 查询失败或消失时 fail closed', async () => {
    const ruleSetPointerQuery = makeRulesQuery([makePublishedRuleSetPointer()])
    const ruleSetQuery = makeRulesQuery([makePublishedRuleSetSnapshot(['snapshot-r001-v1'])])
    const failedRuleQuery = makeRulesQuery([], { message: 'rule snapshots unavailable' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(ruleSetPointerQuery)
      .mockReturnValueOnce(ruleSetQuery)
      .mockReturnValueOnce(failedRuleQuery)

    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULE_SNAPSHOT_QUERY_FAILED: rule snapshots unavailable'
    )

    vi.clearAllMocks()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(ruleSetPointerQuery)
      .mockReturnValueOnce(ruleSetQuery)
      .mockReturnValueOnce(makeRulesQuery([]))
    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULE_SNAPSHOTS_MISSING'
    )
  })

  it('已停用规则的旧 published 快照不在当前规则集成员清单时不会运行', async () => {
    const currentSnapshot = makePublishedSnapshot({
      id: 'current-rule',
      org_id: 'org-1',
      code: 'CURRENT_RULE',
      name: '当前有效规则',
      category: 'text',
      applicable_scenarios: ['all'],
      scope: 'org',
      is_active: true,
      priority: 100,
      version: 2,
    })
    const removedSnapshot = makePublishedSnapshot({
      id: 'removed-rule',
      org_id: 'org-1',
      code: 'REMOVED_RULE',
      name: '已从当前规则集停用的规则',
      category: 'text',
      applicable_scenarios: ['all'],
      scope: 'org',
      is_active: true,
      priority: 90,
      version: 1,
    })
    const currentRuleSetSnapshot = makePublishedRuleSetSnapshot(
      [String(currentSnapshot.id)],
      { id: 'rule-set-snapshot-v3', version: 3, released_at: '2026-07-03T00:00:00.000Z' }
    )
    const staleRuleSetSnapshot = makePublishedRuleSetSnapshot(
      [String(currentSnapshot.id), String(removedSnapshot.id)],
      { id: 'rule-set-snapshot-v2', version: 2, released_at: '2026-07-02T00:00:00.000Z' }
    )
    const { ruleQuery } = mockCurrentRuntimeSnapshots(
      [currentSnapshot],
      [currentRuleSetSnapshot, staleRuleSetSnapshot]
    )

    const rules = await loadFlexibleRules({ orgId: 'org-1' })

    expect(ruleQuery.in).toHaveBeenCalledWith('id', [currentSnapshot.id])
    expect(rules.map((rule) => rule.code)).toEqual(['CURRENT_RULE'])
  })

  it('配置中心测试场景可显式加载未发布规则，但不会成为正式审核默认行为', async () => {
    const query = makeRulesQuery([])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    await loadFlexibleRules({ orgId: 'org-1', includeUnpublished: true })

    expect(supabaseAdmin.from).toHaveBeenCalledWith('contract_rules_v2')
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.eq).toHaveBeenCalledWith('is_active', true)
    expect(query.eq).not.toHaveBeenCalledWith('lifecycle_status', 'published')
    expect(query.eq).not.toHaveBeenCalledWith('translation_status', 'ready')
    expect(query.not).not.toHaveBeenCalled()
  })

  it('场景不适用时在加载阶段排除规则，不把未找到条款误当证据缺失', async () => {
    const ruleSnapshots = [makePublishedSnapshot({
      id: 'rule-subscription-only',
      org_id: 'org-1',
      code: 'SUBSCRIPTION_ONLY',
      name: '订阅合同专用规则',
      category: 'text',
      applicable_scenarios: ['subscription'],
      is_active: true,
      version: 1,
    })]
    mockCurrentRuntimeSnapshots(ruleSnapshots)

    const rules = await loadFlexibleRules({ orgId: 'org-1', scenario: 'buyout' })

    expect(rules).toEqual([])
  })

  it('正式快照在可信成员配置上继续按类别和场景过滤', async () => {
    const baseRule = {
      name: '付款比例',
      description: null,
      category: 'ratio',
      applicable_scenarios: ['all'],
      scope: 'org',
      priority: 100,
      created_by: 'u1',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z',
    }
    const ruleSnapshots = [
      makePublishedSnapshot({
        ...baseRule,
        id: 'wrong-category',
        org_id: 'org-1',
        code: 'WRONG_CATEGORY',
        category: 'amount',
        is_active: true,
        version: 1,
      }),
      makePublishedSnapshot({
        ...baseRule,
        id: 'wrong-scenario',
        org_id: 'org-1',
        code: 'WRONG_SCENARIO',
        applicable_scenarios: ['subscription'],
        is_active: true,
        version: 1,
      }),
      makePublishedSnapshot({
        ...baseRule,
        id: 'runtime-truth',
        org_id: 'org-1',
        code: 'RUNTIME_TRUTH',
        is_active: true,
        version: 2,
      }),
    ]
    const { ruleQuery } = mockCurrentRuntimeSnapshots(ruleSnapshots)

    const rules = await loadFlexibleRules({
      orgId: 'org-1',
      category: 'ratio',
      scenario: 'buyout',
    })

    expect(ruleQuery.eq).not.toHaveBeenCalledWith('config_snapshot->>category', 'ratio')
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ id: 'runtime-truth', code: 'RUNTIME_TRUTH', version: 2 })
  })

  it('当前成员配置无效或同一规则绑定多个版本时 fail closed', async () => {
    const invalidSnapshot = makePublishedSnapshot({
      id: 'version-mismatch',
      org_id: 'org-1',
      code: 'VERSION_MISMATCH',
      name: '版本不一致',
      category: 'text',
      applicable_scenarios: ['all'],
      is_active: true,
      version: 3,
    }, { version: 2 })
    mockCurrentRuntimeSnapshots([invalidSnapshot])
    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULE_SNAPSHOT_CONFIG_INVALID'
    )

    vi.clearAllMocks()
    const firstVersion = makePublishedSnapshot({
      id: 'same-rule', org_id: 'org-1', code: 'SAME_RULE', name: '同一规则',
      category: 'text', applicable_scenarios: ['all'], is_active: true, version: 1,
    }, { id: 'same-rule-v1' })
    const secondVersion = makePublishedSnapshot({
      id: 'same-rule', org_id: 'org-1', code: 'SAME_RULE', name: '同一规则',
      category: 'text', applicable_scenarios: ['all'], is_active: true, version: 2,
    }, { id: 'same-rule-v2' })
    mockCurrentRuntimeSnapshots([firstVersion, secondVersion])
    await expect(loadFlexibleRules({ orgId: 'org-1' })).rejects.toThrow(
      'RULE_RUNTIME_RULE_VERSION_CONFLICT'
    )
  })

  it('保留旧规则来源并在数据库加载后继续使用旧定位事实完成阻断判定', async () => {
    const ruleSnapshots = [makePublishedSnapshot({
      id: 'rule-data-security',
      org_id: 'org-1',
      code: 'R012',
      name: '数据安全',
      description: '禁止客户数据用于模型训练',
      rule_contract: null,
      message_template: null,
      category: 'enum',
      engine_type: 'hybrid',
      target_field: 'data_security_clause',
      clause_category: 'data_security',
      field_hints: ['客户数据', 'AI训练'],
      applicable_scenarios: ['all'],
      scope: 'org',
      level_a_operator: '=',
      level_a_threshold: 0,
      level_a_unit: 'text',
      level_a_action: 'auto_approve',
      level_b_operator: '=',
      level_b_threshold: 0,
      level_b_unit: 'text',
      level_b_action: 'manual_review',
      level_c_operator: '=',
      level_c_threshold: 1,
      level_c_unit: 'text',
      level_c_action: 'block',
      level_c_message: '不得将客户数据用于训练',
      approval_roles: [],
      is_active: true,
      lifecycle_status: 'published',
      translation_status: 'ready',
      published_at: '2026-07-02T00:00:00.000Z',
      priority: 100,
      version: 1,
      created_by: 'u1',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z',
    })]
    mockCurrentRuntimeSnapshots(ruleSnapshots)

    const [rule] = await loadFlexibleRules({ orgId: 'org-1' })
    const result = evaluateFlexibleRule(rule, '乙方可以将客户数据用于AI训练。')

    expect(rule.rule_contract).toBeNull()
    expect(result).toMatchObject({ matched: true, level: 'C', risk_label: 'red', action: 'block' })
    expect(result.source).toContain('客户数据用于AI训练')
  })

  it('旧规则证据缺失时按人工复核关闭，而不是返回白色未命中', async () => {
    const ruleSnapshots = [makePublishedSnapshot({
      id: 'rule-data-security',
      org_id: 'org-1',
      code: 'R012',
      name: '数据安全',
      description: '禁止客户数据用于模型训练',
      rule_contract: null,
      category: 'enum',
      engine_type: 'hybrid',
      target_field: 'data_security_clause',
      clause_category: 'data_security',
      field_hints: ['客户数据'],
      applicable_scenarios: ['all'],
      scope: 'org',
      level_a_operator: '=',
      level_a_threshold: 0,
      level_a_unit: 'text',
      level_a_action: 'auto_approve',
      level_b_operator: '=',
      level_b_threshold: 0,
      level_b_unit: 'text',
      level_b_action: 'manual_review',
      level_c_operator: '=',
      level_c_threshold: 1,
      level_c_unit: 'text',
      level_c_action: 'block',
      approval_roles: [],
      is_active: true,
      lifecycle_status: 'published',
      translation_status: 'ready',
      published_at: '2026-07-02T00:00:00.000Z',
      priority: 100,
      version: 1,
      created_by: 'u1',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z',
    })]
    mockCurrentRuntimeSnapshots(ruleSnapshots)

    const [rule] = await loadFlexibleRules({ orgId: 'org-1' })
    const result = evaluateFlexibleRule(rule, '本条只约定一般保密义务，未说明数据用途。')

    expect(result).toMatchObject({ matched: true, level: 'B', risk_label: 'yellow', action: 'manual_review' })
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

  it('历史 ReviewRun 可按显式 ID 重放 rolled_back 快照', async () => {
    const query = makeRulesQuery([
      makePublishedSnapshot({
        id: 'rule-r001',
        org_id: 'org-1',
        code: 'R001',
        name: '付款节奏历史版本',
        category: 'ratio',
        applicable_scenarios: ['all'],
        scope: 'org',
        is_active: true,
        priority: 100,
        version: 1,
      }, {
        id: 'snapshot-r001-v1',
        status: 'rolled_back',
      }),
    ])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const rules = await loadFlexibleRulesFromSnapshots({
      orgId: 'org-1',
      snapshotIds: ['snapshot-r001-v1'],
    })

    expect(query.in).toHaveBeenCalledWith('status', ['published', 'rolled_back'])
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ id: 'rule-r001', code: 'R001', version: 1 })
  })

  it('显式快照清单包含 draft 时整体拒绝，避免部分执行冒充完整审核', async () => {
    const query = makeRulesQuery([
      {
        id: 'snapshot-r001-draft',
        rule_id: 'rule-r001',
        version: 3,
        status: 'draft',
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

    await expect(loadFlexibleRulesFromSnapshots({
      orgId: 'org-1',
      snapshotIds: ['snapshot-r001-draft', 'snapshot-r002-v2'],
    })).rejects.toThrow('RULE_RUNTIME_EXPLICIT_SNAPSHOTS_UNRESOLVED')
  })

  it('显式 ruleSnapshotIds 非空但没有可执行规则时 fail closed', async () => {
    const query = makeRulesQuery([])
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    await expect(loadFlexibleRulesFromSnapshots({
      orgId: 'org-1',
      snapshotIds: ['snapshot-missing'],
    })).rejects.toThrow('RULE_RUNTIME_EXPLICIT_SNAPSHOTS_UNRESOLVED')
  })

  it('显式空 ruleSnapshotIds 不回退读取 current，并返回明确降级结果', async () => {
    const result = await executeFlexibleRulesCompat('合同金额为4万元。', 'org-1', {
      ruleSnapshotIds: [],
    })

    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      appliedRules: 0,
      matchedRules: 0,
      summary: '未绑定已发布规则快照，正式规则判定已降级关闭',
    })
  })
})
