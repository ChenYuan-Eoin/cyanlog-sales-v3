// lib/rules/flexible-engine.ts
// 柔性化规则引擎（F005-derive.md §4）
// 支持 Level A/B/C 3级阈值区间判定
//
// 判定逻辑：
// - Level A (🟢): 通过区间 → auto_approve
// - Level B (🟡): 偏离区间 → suggest_counterparty（带对价建议）
// - Level C (🔴): 红线区间 → block
// - 未匹配: 无判定（可能是不适用的场景）

import { supabaseAdmin } from '@/lib/supabase'
import type {
  FlexibleRule,
  RuleCategory,
  LevelOperator,
  LevelMatchResult,
  RuleExecutionResult,
} from './types'
import {
  evaluateRuleContract,
  normalizeRuleContract,
} from './rule-contract'

// ═══════════════════════════════════════════════════════════════
// 1. 规则加载（从 contract_rules_v2 表）
// ═══════════════════════════════════════════════════════════════

export interface LoadRulesOptions {
  orgId: string
  category?: RuleCategory
  scenario?: string              // 按场景过滤（如 'subscription', 'buyout'）
  isActive?: boolean
  includeUnpublished?: boolean   // 配置中心草稿/测试可显式打开；正式审核默认只加载已发布规则
}

export interface LoadSnapshotRulesOptions {
  orgId: string
  snapshotIds: string[]
  category?: RuleCategory
  scenario?: string
}

interface RuleSnapshotRow {
  id: string
  rule_id: string
  version: number
  status: string
  released_at?: string | null
  created_at?: string | null
  config_snapshot: unknown
}

interface PublishedRuleSetSnapshotRow {
  id: string
  org_id: string
  rule_set_id: string
  version: number
  status: string
  rule_snapshot_ids: unknown
  released_at?: string | null
  created_at?: string | null
}

interface PublishedRuleSetPointerRow {
  id: string
  org_id: string
  current_snapshot_id: string | null
  published_at?: string | null
}

function parseExecutableSnapshotRules(
  snapshots: RuleSnapshotRow[],
  options: {
    orgId: string
    isActive?: boolean
    category?: RuleCategory
    scenario?: string
    acceptedStatuses: ReadonlySet<string>
    allowedSnapshotIds?: ReadonlySet<string>
    expectedRuleSetIdBySnapshotId?: ReadonlyMap<string, string>
  }
): FlexibleRule[] {
  const expectedActive = options.isActive ?? true
  const selectedRuleSnapshots = new Map<string, string>()
  const invalidSnapshotIds: string[] = []
  const rules: FlexibleRule[] = []

  // Snapshot membership is an execution contract. Invalid config or two
  // versions of one rule must fail closed instead of being silently skipped.
  for (const snapshot of snapshots) {
    if (
      !options.acceptedStatuses.has(snapshot.status)
      || (options.allowedSnapshotIds && !options.allowedSnapshotIds.has(snapshot.id))
    ) {
      invalidSnapshotIds.push(snapshot.id)
      continue
    }

    const config = snapshot.config_snapshot && typeof snapshot.config_snapshot === 'object'
      ? snapshot.config_snapshot as Record<string, unknown>
      : null

    const snapshotVersion = Number(snapshot.version)
    const configVersion = Number(config?.version)
    if (
      !snapshot.rule_id
      || !config
      || config.id !== snapshot.rule_id
      || config.org_id !== options.orgId
      || (
        options.expectedRuleSetIdBySnapshotId
        && config.rule_set_id !== options.expectedRuleSetIdBySnapshotId.get(snapshot.id)
      )
      || config.is_active !== expectedActive
      || !Number.isInteger(snapshotVersion)
      || snapshotVersion < 1
      || configVersion !== snapshotVersion
      || typeof config.code !== 'string'
      || config.code.trim().length === 0
      || typeof config.name !== 'string'
      || config.name.trim().length === 0
      || (config.rule_contract != null && !normalizeRuleContract(config.rule_contract))
    ) {
      invalidSnapshotIds.push(snapshot.id)
      continue
    }

    const previousSnapshotId = selectedRuleSnapshots.get(snapshot.rule_id)
    if (previousSnapshotId && previousSnapshotId !== snapshot.id) {
      throw new Error(
        `RULE_RUNTIME_RULE_VERSION_CONFLICT: rule ${snapshot.rule_id} is bound by ${previousSnapshotId},${snapshot.id}`
      )
    }
    if (previousSnapshotId === snapshot.id) continue
    selectedRuleSnapshots.set(snapshot.rule_id, snapshot.id)
    rules.push(parseFlexibleRule(config))
  }

  if (invalidSnapshotIds.length > 0) {
    throw new Error(`RULE_RUNTIME_RULE_SNAPSHOT_CONFIG_INVALID: ${invalidSnapshotIds.join(',')}`)
  }

  return filterApplicableRules(rules, options)
    .sort((left, right) => (
      right.priority - left.priority
      || left.code.localeCompare(right.code)
    ))
}

function collectCurrentRuleSnapshotIds(
  snapshots: PublishedRuleSetSnapshotRow[],
  orgId: string
): string[] {
  const snapshotIds = new Set<string>()

  // 上游已经按 RuleSet.current_snapshot_id 精确解析；这里不再猜“最新”。
  for (const snapshot of snapshots) {
    if (
      snapshot.status !== 'published'
      || snapshot.org_id !== orgId
      || !snapshot.rule_set_id
    ) {
      throw new Error(`RULE_RUNTIME_RULESET_MEMBERSHIP_INVALID: ${snapshot.rule_set_id || snapshot.id}`)
    }

    if (!Array.isArray(snapshot.rule_snapshot_ids) || snapshot.rule_snapshot_ids.length === 0) {
      throw new Error(`RULE_RUNTIME_RULESET_MEMBERSHIP_INVALID: ${snapshot.rule_set_id}`)
    }
    const memberIds = new Set<string>()
    for (const snapshotId of snapshot.rule_snapshot_ids) {
      if (typeof snapshotId !== 'string' || snapshotId.trim().length === 0 || memberIds.has(snapshotId)) {
        throw new Error(`RULE_RUNTIME_RULESET_MEMBERSHIP_INVALID: ${snapshot.rule_set_id}`)
      }
      memberIds.add(snapshotId)
      snapshotIds.add(snapshotId)
    }
  }

  return Array.from(snapshotIds)
}

async function loadPublishedSnapshotRules(
  options: Omit<LoadRulesOptions, 'includeUnpublished'>
): Promise<FlexibleRule[]> {
  const { orgId, isActive = true } = options
  const { data: ruleSetPointers, error: ruleSetPointerError } = await supabaseAdmin
    .from('contract_rule_sets')
    .select('id, org_id, current_snapshot_id, published_at')
    .eq('org_id', orgId)
    .eq('is_active', true)

  if (ruleSetPointerError) {
    throw new Error(`RULE_RUNTIME_RULESET_POINTER_QUERY_FAILED: ${ruleSetPointerError.message || String(ruleSetPointerError)}`)
  }

  const activeRuleSets = (ruleSetPointers || []) as PublishedRuleSetPointerRow[]
  const inconsistentPointers = activeRuleSets.filter((ruleSet) => (
    Boolean(ruleSet.current_snapshot_id) !== Boolean(ruleSet.published_at)
  ))
  if (inconsistentPointers.length > 0) {
    throw new Error(`RULE_RUNTIME_RULESET_POINTER_STATE_INVALID: ${inconsistentPointers.map((ruleSet) => ruleSet.id).join(',')}`)
  }
  const pointerRows = activeRuleSets.filter((ruleSet) => (
    Boolean(ruleSet.current_snapshot_id) && Boolean(ruleSet.published_at)
  ))
  if (pointerRows.length === 0) return []

  const currentRuleSetSnapshotIds = pointerRows.map((ruleSet) => ruleSet.current_snapshot_id as string)
  const { data: ruleSetSnapshots, error: ruleSetSnapshotError } = await supabaseAdmin
    .from('contract_rule_set_snapshots')
    .select('id, org_id, rule_set_id, version, status, rule_snapshot_ids, released_at, created_at')
    .in('id', currentRuleSetSnapshotIds)
    .eq('org_id', orgId)
    .eq('status', 'published')

  if (ruleSetSnapshotError) {
    throw new Error(`RULE_RUNTIME_RULESET_SNAPSHOT_QUERY_FAILED: ${ruleSetSnapshotError.message || String(ruleSetSnapshotError)}`)
  }

  const ruleSetSnapshotRows = (ruleSetSnapshots || []) as PublishedRuleSetSnapshotRow[]
  const snapshotsById = new Map(ruleSetSnapshotRows.map((snapshot) => [snapshot.id, snapshot]))
  const invalidPointers = pointerRows.filter((ruleSet) => {
    const snapshot = snapshotsById.get(ruleSet.current_snapshot_id as string)
    return !snapshot
      || snapshot.org_id !== orgId
      || snapshot.rule_set_id !== ruleSet.id
      || snapshot.status !== 'published'
  })
  if (invalidPointers.length > 0) {
    throw new Error(`RULE_RUNTIME_RULESET_POINTER_INVALID: ${invalidPointers.map((ruleSet) => ruleSet.id).join(',')}`)
  }

  const currentSnapshotIds = collectCurrentRuleSnapshotIds(
    pointerRows.map((ruleSet) => snapshotsById.get(ruleSet.current_snapshot_id as string) as PublishedRuleSetSnapshotRow),
    orgId
  )
  if (currentSnapshotIds.length === 0) {
    throw new Error('RULE_RUNTIME_RULESET_MEMBERSHIP_EMPTY: published RuleSet pointers contain no rule snapshots')
  }

  const expectedRuleSetIdBySnapshotId = new Map<string, string>()
  for (const ruleSet of pointerRows) {
    const snapshot = snapshotsById.get(ruleSet.current_snapshot_id as string) as PublishedRuleSetSnapshotRow
    for (const ruleSnapshotId of snapshot.rule_snapshot_ids as string[]) {
      const previousRuleSetId = expectedRuleSetIdBySnapshotId.get(ruleSnapshotId)
      if (previousRuleSetId && previousRuleSetId !== ruleSet.id) {
        throw new Error(`RULE_RUNTIME_RULESET_MEMBERSHIP_CONFLICT: snapshot ${ruleSnapshotId} belongs to ${previousRuleSetId},${ruleSet.id}`)
      }
      expectedRuleSetIdBySnapshotId.set(ruleSnapshotId, ruleSet.id)
    }
  }

  const allowedSnapshotIds = new Set(currentSnapshotIds)
  const query = supabaseAdmin
    .from('contract_rule_snapshots')
    .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
    .in('id', currentSnapshotIds)
    .eq('status', 'published')
    .eq('config_snapshot->>org_id', orgId)
    .eq('config_snapshot->>is_active', String(isActive))
    .order('released_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  const { data: snapshots, error } = await query
  if (error) {
    throw new Error(`RULE_RUNTIME_RULE_SNAPSHOT_QUERY_FAILED: ${error.message || String(error)}`)
  }

  const snapshotRows = (snapshots || []) as RuleSnapshotRow[]
  const resolvedSnapshotIds = new Set(snapshotRows.map((snapshot) => snapshot.id))
  const unresolvedSnapshotIds = currentSnapshotIds.filter((snapshotId) => !resolvedSnapshotIds.has(snapshotId))
  if (unresolvedSnapshotIds.length > 0) {
    throw new Error(`RULE_RUNTIME_RULE_SNAPSHOTS_MISSING: unresolved published pointers ${unresolvedSnapshotIds.join(',')}`)
  }

  const parsed = parseExecutableSnapshotRules(
    snapshotRows,
    {
      ...options,
      acceptedStatuses: new Set(['published']),
      allowedSnapshotIds,
      expectedRuleSetIdBySnapshotId,
    }
  )
  return parsed
}

/**
 * 加载柔性化规则（contract_rules_v2）
 */
export async function loadFlexibleRules(
  options: LoadRulesOptions
): Promise<FlexibleRule[]> {
  const {
    orgId,
    category,
    scenario,
    isActive = true,
    includeUnpublished = false,
  } = options

  // 正式运行只认 RuleSet.current_snapshot_id 指向的 published 快照。
  // 保存新草稿会改动 live row，但在原子切换指针前不能影响线上审核。
  if (!includeUnpublished) {
    return loadPublishedSnapshotRules({ orgId, category, scenario, isActive })
  }

  let query = supabaseAdmin
    .from('contract_rules_v2')
    .select(`
      *,
      problem_category:contract_rule_problem_categories(
        id,
        code,
        name,
        description,
        sort_order
      )
    `)
    .eq('org_id', orgId)
    .eq('is_active', isActive)
    .order('priority', { ascending: false })

  if (category) {
    query = query.eq('category', category)
  }

  const { data: rules, error } = await query

  if (error) {
    console.error('Failed to load flexible rules:', error)
    return []
  }

  // 按场景过滤（如果指定了场景）
  let filteredRules = rules || []
  if (scenario) {
    filteredRules = filteredRules.filter((r) =>
      r.applicable_scenarios?.includes(scenario) ||
      r.applicable_scenarios?.length === 0 ||
      r.applicable_scenarios?.includes('all')
    )
  }

  return filteredRules.map(parseFlexibleRule)
}

function filterApplicableRules(
  rules: FlexibleRule[],
  options: { category?: RuleCategory; scenario?: string }
): FlexibleRule[] {
  const { category, scenario } = options
  let filteredRules = rules
  if (category) {
    filteredRules = filteredRules.filter((rule) => rule.category === category)
  }
  if (scenario) {
    filteredRules = filteredRules.filter((rule) =>
      rule.applicable_scenarios?.includes(scenario) ||
      rule.applicable_scenarios?.length === 0 ||
      rule.applicable_scenarios?.includes('all')
    )
  }
  return filteredRules
}

/**
 * 从 SkillBundle / ReviewRun 绑定的显式快照加载规则。
 * 历史重放允许 rolled_back；draft 从未成为正式运行事实，始终拒绝。
 */
export async function loadFlexibleRulesFromSnapshots(
  options: LoadSnapshotRulesOptions
): Promise<FlexibleRule[]> {
  const { orgId, snapshotIds } = options
  const uniqueSnapshotIds = Array.from(new Set(snapshotIds.filter(Boolean)))
  if (uniqueSnapshotIds.length === 0) {
    return []
  }

  const { data: snapshots, error } = await supabaseAdmin
    .from('contract_rule_snapshots')
    .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
    .in('id', uniqueSnapshotIds)
    .in('status', ['published', 'rolled_back'])
    .eq('config_snapshot->>org_id', orgId)
    .eq('config_snapshot->>is_active', 'true')
    .order('released_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`RULE_RUNTIME_RULE_SNAPSHOT_QUERY_FAILED: ${error.message || String(error)}`)
  }

  const snapshotRows = (snapshots || []) as RuleSnapshotRow[]
  const resolvedSnapshotIds = new Set(snapshotRows.map((snapshot) => snapshot.id))
  const invalidSnapshotIds = snapshotRows
    .filter((snapshot) => !['published', 'rolled_back'].includes(snapshot.status))
    .map((snapshot) => snapshot.id)
  const unresolvedSnapshotIds = uniqueSnapshotIds.filter((snapshotId) => !resolvedSnapshotIds.has(snapshotId))
  if (invalidSnapshotIds.length > 0 || unresolvedSnapshotIds.length > 0) {
    throw new Error(
      `RULE_RUNTIME_EXPLICIT_SNAPSHOTS_UNRESOLVED: invalid=${invalidSnapshotIds.join(',') || 'none'} missing=${unresolvedSnapshotIds.join(',') || 'none'}`
    )
  }

  const parsed = parseExecutableSnapshotRules(
    snapshotRows,
    {
      ...options,
      isActive: true,
      acceptedStatuses: new Set(['published', 'rolled_back']),
      allowedSnapshotIds: new Set(uniqueSnapshotIds),
    }
  )
  if (parsed.length === 0) {
    throw new Error('RULE_RUNTIME_EXPLICIT_SNAPSHOTS_UNRESOLVED: supplied ruleSnapshotIds produced no executable rule')
  }
  return parsed
}

/**
 * 解析数据库规则为 FlexibleRule 对象
 */
function parseFlexibleRule(row: Record<string, unknown>): FlexibleRule {
  const rule: FlexibleRule = {
    id: row.id as string,
    org_id: row.org_id as string,
    code: row.code as string,
    name: row.name as string,
    description: row.description as string | null,
    problem_category_id: row.problem_category_id as string | null | undefined,
    problem_category: row.problem_category && typeof row.problem_category === 'object'
      ? row.problem_category as FlexibleRule['problem_category']
      : null,
    rule_contract: normalizeRuleContract(row.rule_contract),
    message_template: row.message_template,
    category: row.category as RuleCategory,
    engine_type: (row.engine_type as 'structured' | 'semantic' | 'hybrid') || 'structured',
    target_field: row.target_field as string | undefined,
    clause_category: row.clause_category as string | undefined,
    field_hints: (row.field_hints as string[]) || [],
    semantic_prompt: row.semantic_prompt as string | undefined,
    applicable_scenarios: (row.applicable_scenarios as string[]) || [],
    scope: (row.scope as 'org' | 'dept' | 'user') || 'org',

    level_a: {
      operator: row.level_a_operator as LevelOperator,
      threshold: Number(row.level_a_threshold) || 0,
      unit: (row.level_a_unit as string) || 'percent',
      action: (row.level_a_action as string) || 'auto_approve',
    },

    level_b: {
      operator: row.level_b_operator as LevelOperator,
      threshold: Number(row.level_b_threshold) || 0,
      unit: (row.level_b_unit as string) || 'percent',
      action: (row.level_b_action as string) || 'suggest_counterparty',
      counterparty: row.level_b_counterparty as string | undefined,
    },

    level_c: {
      operator: row.level_c_operator as LevelOperator,
      threshold: Number(row.level_c_threshold) || 0,
      unit: (row.level_c_unit as string) || 'percent',
      action: (row.level_c_action as string) || 'block',
      message: row.level_c_message as string | undefined,
    },

    approval_roles: (row.approval_roles as string[]) || [],
    script_id: row.script_id as string | undefined,

    version: Number(row.version) || 1,
    priority: Number(row.priority) || 100,
    is_active: row.is_active as boolean,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
  return rule
}

// ═══════════════════════════════════════════════════════════════
// 2. 旧字段读取兼容面（正式审核不走全文首值路径）
// ═══════════════════════════════════════════════════════════════

export interface ExtractedField {
  name: string
  value: number
  unit: string
  source: string          // 从哪段文本提取
  confidence: number      // 0-1 置信度
}

/**
 * 根据规则类别提取合同字段
 * @deprecated 仅供旧调用方兼容；正式审核由 evaluateRuleContract 先定位条款，
 * 再读取 rule_contract 中预先定义的属性。
 */
export function extractField(
  contractText: string,
  category: RuleCategory,
  fieldHints?: string[],
  targetField?: string
): ExtractedField | null {
  const text = contractText

  switch (category) {
    case 'ratio':
      return extractRatioField(text, fieldHints, targetField)
    case 'amount':
      return extractAmountField(text, fieldHints, targetField)
    case 'duration':
      return extractDurationField(text, fieldHints, targetField)
    case 'enum':
      return extractEnumField(text, fieldHints, targetField)
    case 'text':
      return extractTextField(text, fieldHints, targetField)
    default:
      return null
  }
}

function parseChineseNumber(raw: string): number {
  const value = raw.trim()
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric

  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }

  if (value === '十') return 10
  const hundredParts = value.split('百')
  if (hundredParts.length === 2) {
    const hundreds = digitMap[hundredParts[0]] || 1
    return hundreds * 100 + parseChineseNumber(hundredParts[1] || '零')
  }

  const tenParts = value.split('十')
  if (tenParts.length === 2) {
    const tens = tenParts[0] ? digitMap[tenParts[0]] || 1 : 1
    const ones = tenParts[1] ? digitMap[tenParts[1]] || 0 : 0
    return tens * 10 + ones
  }

  return digitMap[value] ?? 0
}

function contextSegmentForIndex(sourceText: string, index: number): string {
  const leftBoundaries = ['\n', '。', '；', ';']
  const rightBoundaries = ['\n', '。', '；', ';']
  const startBoundary = Math.max(
    -1,
    ...leftBoundaries.map((boundary) => sourceText.lastIndexOf(boundary, Math.max(0, index - 1)))
  )
  const rightIndexes = rightBoundaries
    .map((boundary) => {
      const found = sourceText.indexOf(boundary, index)
      return found >= 0 ? found + boundary.length : -1
    })
    .filter((found) => found >= 0)
  const endBoundary = rightIndexes.length > 0
    ? Math.min(...rightIndexes)
    : sourceText.length
  return sourceText.slice(startBoundary + 1, endBoundary).trim()
}

function contextForTermsInText(sourceText: string, terms: string[]): string {
  const lowerText = sourceText.toLowerCase()
  const normalizedTerms = terms
    .map((term) => term.trim())
    .filter(Boolean)
  const candidates = new Map<string, { segment: string; score: number; index: number }>()

  for (const term of normalizedTerms) {
    const normalizedTerm = term.toLowerCase()
    let startIndex = lowerText.indexOf(normalizedTerm)
    while (startIndex >= 0) {
      const segment = contextSegmentForIndex(sourceText, startIndex)
      if (segment) {
        const normalizedSegment = segment.toLowerCase()
        const score = normalizedTerms.reduce((total, candidateTerm) => (
          normalizedSegment.includes(candidateTerm.toLowerCase()) ? total + 1 : total
        ), 0)
        const existing = candidates.get(segment)
        if (!existing || score > existing.score) {
          candidates.set(segment, { segment, score, index: startIndex })
        }
      }
      startIndex = lowerText.indexOf(normalizedTerm, startIndex + Math.max(normalizedTerm.length, 1))
    }
  }

  return Array.from(candidates.values())
    .sort((left, right) => (
      right.score - left.score
      || left.segment.length - right.segment.length
      || left.index - right.index
    ))[0]?.segment || ''
}

/**
 * 提取比例字段（如：首期款比例 30%）
 */
function extractRatioField(
  text: string,
  hints?: string[],
  targetField?: string
): ExtractedField | null {
  const targetedPatterns: Record<string, RegExp[]> = {
    payment_schedule: [
      /(?:首付|首付款|首期款|首期|定金|预付款)[^0-9%]{0,40}(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:作为|为|的)?\s*(?:首付|首付款|首期款|首期|定金|预付款)/i,
    ],
    first_payment_rate: [
      /(?:首付|首付款|首期款|首期|定金|预付款)[^0-9%]{0,20}(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:作为|为|的)?\s*(?:首付|首付款|首期款|首期|定金|预付款)/i,
    ],
    tax_rate: [
      /(?:税率|增值税税率)[^0-9%]{0,20}(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:增值税|税率|专票|发票)/i,
    ],
    breach_penalty_cap: [
      /(?:违约金|赔偿上限|违约责任|日违约金)[^0-9%万]{0,40}(\d+(?:\.\d+)?)\s*%/i,
      /(?:违约金|逾期付款违约金|日违约金)[^万]{0,20}万分之([一二三四五六七八九十百0-9.]+)/i,
    ],
    liability_cap: [
      /(?:责任总额|责任上限|赔偿上限|赔偿责任)[^0-9%]{0,40}(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:作为|为|的)?\s*(?:责任上限|赔偿上限|责任总额)/i,
    ],
    warranty_deposit_rate: [
      /(?:质保金|质量保证金|保证金)[^0-9%]{0,20}(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:作为|为|的)?\s*(?:质保金|质量保证金|保证金)/i,
    ],
    penalty_rate: [
      /(?:违约金|赔偿上限|违约责任)[^0-9%]{0,30}(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:的)?\s*(?:违约金|赔偿上限)/i,
    ],
    late_fee_rate: [
      /(?:滞纳金|逾期付款违约金|逾期利息)[^0-9%万]{0,30}(\d+(?:\.\d+)?)\s*%/i,
      /(?:滞纳金|逾期付款违约金|逾期利息)[^万]{0,20}万分之([一二三四五六七八九十百0-9.]+)/i,
      /日万分之([一二三四五六七八九十百0-9.]+)/i,
    ],
  }

  const genericPatterns = [
    /(?:比例|费率|比率)[:：]?\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%/i,
  ]

  const patterns = targetField && targetedPatterns[targetField]
    ? targetedPatterns[targetField]
    : [
        ...Object.values(targetedPatterns).flat(),
        ...genericPatterns,
      ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const rawValue = parseChineseNumber(match[1])
      const value = targetField === 'late_fee_rate' && pattern.source.includes('万分之')
        ? rawValue / 100
        : rawValue
      return {
        name: targetField || 'ratio',
        value,
        unit: 'percent',
        source: match[0],
        confidence: 0.9,
      }
    }
  }

  return null
}

/**
 * 提取金额字段（如：合同总额 100万元）
 */
function extractAmountField(
  text: string,
  _hints?: string[],
  targetField?: string
): ExtractedField | null {
  const patterns = [
    // 合同总额/金额 XX万元/元
    /(?:合同总?额|合同金?额|总价|总金额)[:：]?\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万)?元?/i,
    // 人民币 XX万元
    /人民币\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万)?元?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      let value = parseFloat(match[1])
      // 如果是"万元"，转换为元
      if (match[2] === '万') {
        value = value * 10000
      }
      return {
        name: targetField || 'amount',
        value: Math.round(value),
        unit: 'cny',
        source: match[0],
        confidence: 0.85,
      }
    }
  }

  return null
}

/**
 * 提取时长字段（如：账期 90天）
 */
function extractDurationField(
  text: string,
  hints?: string[],
  targetField?: string
): ExtractedField | null {
  const targetedPatterns: Record<string, RegExp[]> = {
    acceptance_silent_days: [
      /(?:默示验收|视为验收|自动验收)[^0-9一二三四五六七八九十百。；\n]{0,30}([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(工作日?|自然日?|天|日)/i,
      /([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(工作日?|自然日?|天|日)\s*(?:内|后)?[^。；\n]{0,20}(?:默示验收|视为验收|自动验收)/i,
    ],
    payment_term_days: [
      /(?:账期|付款期限|付款周期|付款期)[^0-9一二三四五六七八九十百]{0,20}([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(工作日?|自然日?|天|日|月|年)?/i,
      /([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(工作日?|自然日?|天|日|月|年)\s*(?:内|后)?\s*(?:付款|支付)/i,
    ],
    warranty_days: [
      /(?:质保期|保修期|质量保证期|售后服务期)[^0-9一二三四五六七八九十百]{0,20}([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)?/i,
    ],
    auto_renew_notice_days: [
      /(?:自动续约|续期|续约)[^0-9一二三四五六七八九十百]{0,30}(?:提前)?([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)?\s*(?:通知|告知)/i,
      /(?:提前)?([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)\s*(?:通知|告知)[^。；\n]{0,30}(?:自动续约|续期|续约)/i,
    ],
    termination_notice_days: [
      /(?:单方解除|解除|终止)[^0-9一二三四五六七八九十百]{0,30}(?:提前)?([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)?\s*(?:通知|告知)/i,
      /(?:提前)?([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)\s*(?:通知|告知)[^。；\n]{0,30}(?:单方解除|解除|终止)/i,
    ],
    confidentiality_days: [
      /(?:保密期限|保密期|保密义务)[^0-9一二三四五六七八九十百]{0,20}([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)?/i,
    ],
    confidentiality_years: [
      /(?:保密期限|保密期|保密义务)[^0-9一二三四五六七八九十百永久]{0,30}(永久|[0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(年|月|天|日)?/i,
    ],
    non_compete_days: [
      /(?:竞业限制|竞业禁止|不竞争)[^0-9一二三四五六七八九十百]{0,20}([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)?/i,
    ],
    contract_term_days: [
      /(?:合同期限|有效期|合作期限|履行期限)[^0-9一二三四五六七八九十百]{0,20}([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(天|日|月|年)?/i,
    ],
  }

  const genericPatterns = [
    /([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(工作日?|自然日?|天|日|月|年)/i,
    /(?:账期|付款期|期限|周期)[:：]?\s*([0-9一二三四五六七八九十百]+)\s*(?:个)?\s*(工作日?|天|日|月|年)?/i,
  ]

  const patterns = targetField && targetedPatterns[targetField]
    ? targetedPatterns[targetField]
    : [
        ...Object.values(targetedPatterns).flat(),
        ...genericPatterns,
      ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = parseChineseNumber(match[1])
      const unit = match[2] || '天'
      // 统一转换为天
      let normalizedValue = match[1] === '永久' ? 36500 : value
      if (unit.includes('月')) normalizedValue = value * 30
      if (unit.includes('年')) normalizedValue = value * 365

      return {
        name: targetField || 'duration',
        value: normalizedValue,
        unit: 'day',
        source: match[0],
        confidence: 0.8,
      }
    }
  }

  return null
}

/**
 * 提取枚举字段
 */
function extractEnumField(
  text: string,
  hints?: string[],
  targetField?: string
): ExtractedField | null {
  if (targetField === 'sla_commitment') {
    const terms = ['SLA', '可用性', '99.5%', '99.9%', '7×24', '7x24', '营业损失', '服务费']
    const lower = text.toLowerCase()
    const term = terms.find((item) => lower.includes(item.toLowerCase()))
    if (!term) return null
    return {
      name: targetField,
      value: 1,
      unit: 'match',
      source: contextForTermsInText(text, terms),
      confidence: 0.85,
    }
  }

  // 枚举类型通常是匹配特定关键词
  if (hints && hints.length > 0) {
    for (const hint of hints) {
      if (text.includes(hint.toLowerCase())) {
        return {
          name: 'enum',
          value: 1,  // 匹配即命中
          unit: 'match',
          source: hint,
          confidence: 0.95,
        }
      }
    }
  }
  return null
}

/**
 * 提取文本字段（模糊匹配）
 */
function extractTextField(
  text: string,
  hints?: string[],
  _targetField?: string
): ExtractedField | null {
  // 文本类型：检查是否包含特定关键词
  if (hints && hints.length > 0) {
    let matchCount = 0
    for (const hint of hints) {
      if (text.includes(hint.toLowerCase())) {
        matchCount++
      }
    }
    const confidence = matchCount / hints.length
    return {
          name: 'text',
      value: confidence > 0.3 ? 1 : 0,  // 匹配率>30%认为命中
      unit: 'confidence',
      source: hints.join(', '),
      confidence,
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 3. Level A/B/C 判定逻辑
// ═══════════════════════════════════════════════════════════════

/**
 * 兼容旧返回结构的统一判定入口。业务判定只执行 canonical
 * rule_contract；Level A/B/C 仅是对旧调用方的结果映射。
 */
export function evaluateFlexibleRule(
  rule: FlexibleRule,
  contractText: string,
  _extractedFields?: Record<string, number>
): LevelMatchResult {
  const evaluation = evaluateRuleContract(rule, contractText)

  const decision = evaluation.decision
  const condition = decision?.conditions[0]
  const reading = condition
    ? evaluation.readings[condition.property_key]
    : Object.values(evaluation.readings).find((candidate) => candidate.status === 'read')
  const outcome = evaluation.outcome
  const level = outcome === 'block' ? 'C' : outcome === 'pass' ? 'A' : 'B'
  const riskLabel = outcome === 'block' ? 'red' : outcome === 'pass' ? 'green' : 'yellow'
  const operator = condition && ['>=', '<=', '=', '>', '<', 'contains', 'in'].includes(condition.operator)
    ? condition.operator as LevelOperator
    : '='
  const threshold = typeof condition?.value === 'number' ? condition.value : 0
  const actualValue = typeof reading?.value === 'number'
    ? reading.value
    : typeof reading?.value === 'boolean'
      ? reading.value ? 1 : 0
      : reading?.value ? 1 : 0
  const propertyReadings = Object.values(evaluation.readings).map((propertyReading) => ({
    propertyKey: propertyReading.property_key,
    status: propertyReading.status,
    confidence: propertyReading.confidence,
    ...(propertyReading.value !== undefined ? { value: propertyReading.value } : {}),
    ...(propertyReading.unit ? { unit: propertyReading.unit } : {}),
    ...(propertyReading.evidence ? { evidence: propertyReading.evidence } : {}),
  }))

  return {
    level,
    matched: true,
    evaluation_status: evaluation.status,
    outcome,
    decision_id: decision?.id,
    propertyReadings,
    missing_property_keys: evaluation.missing_property_keys,
    ambiguous_property_keys: evaluation.ambiguous_property_keys,
    unit_conflict_property_keys: evaluation.unit_conflict_property_keys,
    operator,
    threshold,
    actual_value: actualValue,
    unit: condition?.unit || reading?.unit || 'text',
    source: reading?.evidence || evaluation.evidence[0] || '',
    confidence: reading?.confidence || 0,
    action: decision?.action || outcome,
    message: decision?.message
      || decision?.label
      || (evaluation.status === 'decided' ? `${rule.name}完成判定` : `${rule.name}证据缺失，需人工复核`),
    counterparty: outcome === 'negotiate' ? rule.level_b.counterparty : undefined,
    risk_label: riskLabel,
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. 批量执行与结果转换
// ═══════════════════════════════════════════════════════════════

export interface FlexibleExecutionOptions {
  orgId: string
  scenario?: string              // 场景过滤
  category?: RuleCategory        // 类别过滤
  ruleSnapshotIds?: string[]      // 正式审核绑定 SkillBundle 发布快照
}

/**
 * 执行所有适用规则的判定
 */
export async function executeFlexibleRules(
  contractText: string,
  options: FlexibleExecutionOptions
): Promise<RuleExecutionResult[]> {
  const { orgId, scenario, category, ruleSnapshotIds } = options

  // 1. 加载规则
  const rules = Array.isArray(ruleSnapshotIds)
    ? ruleSnapshotIds.length === 0
      ? []
      : await loadFlexibleRulesFromSnapshots({ orgId, scenario, category, snapshotIds: ruleSnapshotIds })
    : await loadFlexibleRules({ orgId, scenario, category })

  if (rules.length === 0) {
    return []
  }

  // 2. 执行每条规则的判定
  const results: RuleExecutionResult[] = []

  for (const rule of rules) {
    const startTime = Date.now()
    const levelResult = evaluateFlexibleRule(rule, contractText)

    // 转换为标准 RuleExecutionResult 格式
    const result: RuleExecutionResult = {
      ruleId: rule.id,
      ruleVersion: rule.version,
      ruleType: rule.engine_type,
      ruleCode: rule.code,
      decisionId: levelResult.decision_id,
      propertyReadings: levelResult.propertyReadings,
      riskLevel: levelResult.risk_label === 'red'
        ? 'red'
        : levelResult.risk_label === 'yellow'
          ? 'yellow'
          : levelResult.risk_label === 'green'
            ? 'green'
            : 'green',
      title: rule.name,
      description: levelResult.message,
      suggestion: levelResult.action !== levelResult.outcome
        ? levelResult.action
        : levelResult.counterparty
          ? `建议换取：${levelResult.counterparty}`
          : levelResult.level === 'C'
            ? '必须修改合同条款'
            : levelResult.level === 'B'
              ? '建议协商调整'
              : '符合标准',
      triggered: levelResult.matched,
      executionTime: Date.now() - startTime,
      evidence: levelResult.source ? [levelResult.source] : undefined,
      details: levelResult.evaluation_status === 'decided'
        ? `规则 ${rule.code} v${rule.version}，判定 ${levelResult.decision_id || levelResult.outcome}，实际值 ${levelResult.actual_value}${levelResult.unit}`
        : `规则 ${rule.code} v${rule.version}，${levelResult.evaluation_status}，缺失属性 ${levelResult.missing_property_keys.join(', ') || '无'}，歧义属性 ${levelResult.ambiguous_property_keys.join(', ') || '无'}，单位冲突 ${levelResult.unit_conflict_property_keys.join(', ') || '无'}`,
      levelResult,
    }

    results.push(result)
  }

  // 3. 按风险等级排序：red > yellow > green
  return results.sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 }
    return order[a.riskLevel] - order[b.riskLevel]
  })
}

/**
 * 生成审核摘要
 */
export function generateFlexibleSummary(
  results: RuleExecutionResult[]
): string {
  if (results.length === 0) {
    return '未配置审核规则，建议联系管理员配置'
  }

  const redCount = results.filter((r) => r.levelResult?.level === 'C').length
  const yellowCount = results.filter((r) => r.levelResult?.level === 'B').length
  const greenCount = results.filter((r) => r.levelResult?.level === 'A').length
  const triggeredCount = results.filter((r) => r.triggered).length

  const parts: string[] = []

  if (redCount > 0) {
    parts.push(`发现 ${redCount} 项红线问题，必须修改`)
  }
  if (yellowCount > 0) {
    parts.push(`${yellowCount} 项偏离建议区间，可协商换取对价`)
  }
  if (greenCount > 0) {
    parts.push(`${greenCount} 项符合标准`)
  }

  if (triggeredCount === 0) {
    return '所有检查项均符合标准，合同条款合规'
  }

  return parts.join('；') + `。共执行 ${results.length} 条规则。`
}

// ═══════════════════════════════════════════════════════════════
// 5. 导出兼容接口（供 lib/ai/failover.ts 调用）
// ═══════════════════════════════════════════════════════════════

export interface FlexibleAnalysisResults {
  risks: Array<{
    ruleId?: string
    ruleCode?: string
    ruleVersion?: number
    decisionId?: string
    propertyReadings?: LevelMatchResult['propertyReadings']
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    counterparty?: string
    evidence?: string[]
  }>
  summary: string
  appliedRules: number
  matchedRules: number
  levelBreakdown: {
    A: number  // 通过
    B: number  // 偏离
    C: number  // 红线
    null: number  // 未匹配
  }
}

/**
 * 兼容旧接口 executeRules 的新实现
 */
export async function executeFlexibleRulesCompat(
  contractText: string,
  orgId?: string,
  options: { ruleSnapshotIds?: string[] } = {}
): Promise<FlexibleAnalysisResults> {
  if (!orgId) {
    return {
      risks: [],
      summary: '未提供组织ID，无法执行规则判定',
      appliedRules: 0,
      matchedRules: 0,
      levelBreakdown: { A: 0, B: 0, C: 0, null: 0 },
    }
  }

  const results = await executeFlexibleRules(contractText, {
    orgId,
    ruleSnapshotIds: options.ruleSnapshotIds,
  })

  const levelBreakdown = {
    A: results.filter((r) => r.levelResult?.level === 'A').length,
    B: results.filter((r) => r.levelResult?.level === 'B').length,
    C: results.filter((r) => r.levelResult?.level === 'C').length,
    null: results.filter((r) => r.levelResult?.level === null).length,
  }

  return {
    risks: results
      .filter((r) => r.triggered)
      .map((r) => ({
        ruleId: r.ruleId,
        ruleCode: r.ruleCode,
        ruleVersion: r.ruleVersion,
        decisionId: r.decisionId,
        propertyReadings: r.propertyReadings,
        level: r.riskLevel,
        title: r.title,
        description: r.description,
        suggestion: r.suggestion || '',
        counterparty: r.levelResult?.counterparty,
        evidence: r.evidence,
      })),
    summary: Array.isArray(options.ruleSnapshotIds) && options.ruleSnapshotIds.length === 0
      ? '未绑定已发布规则快照，正式规则判定已降级关闭'
      : generateFlexibleSummary(results),
    appliedRules: results.length,
    matchedRules: results.filter((r) => r.triggered).length,
    levelBreakdown,
  }
}
