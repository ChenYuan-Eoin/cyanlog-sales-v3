// GET /api/contract-policies/rule-sets
// POST /api/contract-policies/rule-sets
// F009 RuleSet assets. Rule sets are the first-class container for rules and
// documents; individual rules remain in contract_rules_v2.

import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { normalizeRuleContract } from '@/lib/rules/rule-contract'
import {
  RULE_CONTRACT_EVALUATOR_REVISION,
  ruleContractSha256,
  ruleReleaseReadiness,
  type RuleAcceptanceRun,
} from '@/lib/rules/rule-release-readiness'
import { supabaseAdmin } from '@/lib/supabase'

const ruleSetSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  applicable_scenario: z.string().trim().max(120).optional().nullable(),
  priority: z.number().int().optional().default(100),
  is_default: z.boolean().optional().default(false),
})

type RuleSetRow = {
  id: string
  org_id: string
  code: string
  name: string
  description: string | null
  applicable_scenario: string | null
  priority: number | null
  is_default: boolean | null
  is_active: boolean
  version: number
  lifecycle_status: string
  translation_status: string
  published_at: string | null
  published_by: string | null
  current_snapshot_id: string | null
  release_note: string | null
  metadata: unknown
  created_by: string | null
  created_at: string
  updated_at: string
}

type RuleSetDocumentRow = {
  id: string
  org_id: string
  rule_set_id: string
  title: string
  source_type: string
  source_uri: string | null
  content_markdown: string
  content_hash: string
  version: number
  status: string
  translation_status: string
  translation_diff: unknown
  translation_summary: unknown
  last_translation_invocation_id: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

type RuleRow = {
  id: string
  code: string
  rule_set_id: string | null
  problem_category_id: string | null
  rule_contract: unknown
  version: number
  lifecycle_status: string | null
  translation_status: string | null
  is_active: boolean | null
  published_at: string | null
}

type RuleTestRunRow = {
  id: string
  rule_id: string
  rule_version: number
  case_kind: RuleAcceptanceRun['case_kind']
  expected_status: string
  expected_outcome: RuleAcceptanceRun['expected_outcome']
  expected_decision_id: string | null
  assertion_passed: boolean
  rule_snapshot_id: string | null
  rule_contract_sha256: string | null
  evaluator_revision: string | null
  created_at: string
}

type RuleSetSnapshotRow = {
  id: string
  org_id: string
  rule_set_id: string
  status: string
  rule_snapshot_ids: unknown
}

type RuleSnapshotRefRow = { id: string; rule_id: string; version: number }
type RuleSnapshotBindingRow = RuleSnapshotRefRow & {
  status: 'draft' | 'published'
  created_at: string
}

function hashContent(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isPublishedRule(rule: RuleRow) {
  return Boolean(
    rule.is_active
    && rule.lifecycle_status === 'published'
    && rule.translation_status === 'ready'
    && rule.published_at
  )
}

function isReadyRule(rule: RuleRow) {
  return rule.translation_status === 'ready'
}

function isBlockedRule(rule: RuleRow) {
  return !isPublishedRule(rule)
}

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

    const [setsResult, docsResult, rulesResult, testRunsResult] = await Promise.all([
      supabaseAdmin
        .from('contract_rule_sets')
        .select('id, org_id, code, name, description, applicable_scenario, priority, is_default, is_active, version, lifecycle_status, translation_status, published_at, published_by, current_snapshot_id, release_note, metadata, created_by, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('code', { ascending: true }),
      supabaseAdmin
        .from('contract_rule_set_documents')
        .select('id, org_id, rule_set_id, title, source_type, source_uri, content_markdown, content_hash, version, status, translation_status, translation_diff, translation_summary, last_translation_invocation_id, created_by, updated_by, created_at, updated_at')
        .eq('org_id', orgId)
        .neq('status', 'archived')
        .order('version', { ascending: false }),
      supabaseAdmin
        .from('contract_rules_v2')
        .select('id, code, rule_set_id, problem_category_id, rule_contract, version, lifecycle_status, translation_status, is_active, published_at')
        .eq('org_id', orgId)
        .neq('lifecycle_status', 'archived'),
      supabaseAdmin
        .from('contract_rule_test_runs')
        .select('id, rule_id, rule_version, case_kind, expected_status, expected_outcome, expected_decision_id, assertion_passed, rule_snapshot_id, rule_contract_sha256, evaluator_revision, created_at')
        .eq('org_id', orgId),
    ])

    if (setsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则集失败'))
    }
    if (docsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则集文档失败'))
    }
    if (rulesResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则统计失败'))
    }
    if (testRunsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则测试证据失败'))
    }
    const ruleSetRows = (setsResult.data || []) as RuleSetRow[]
    const inconsistentPointers = ruleSetRows.filter((set) => (
      Boolean(set.published_at) !== Boolean(set.current_snapshot_id)
    ))
    if (inconsistentPointers.length > 0) {
      return errorResponse(createApiError('DB_ERROR', '规则集当前发布指针缺失或状态不一致'))
    }

    const currentSetSnapshotIds = ruleSetRows
      .map((set) => set.current_snapshot_id)
      .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
    const setSnapshotsResult = currentSetSnapshotIds.length > 0
      ? await supabaseAdmin
        .from('contract_rule_set_snapshots')
        .select('id, org_id, rule_set_id, status, rule_snapshot_ids')
        .in('id', currentSetSnapshotIds)
        .eq('org_id', orgId)
        .eq('status', 'published')
      : { data: [], error: null }
    if (setSnapshotsResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则集当前发布快照失败'))
    }

    const setSnapshotsById = new Map(
      ((setSnapshotsResult.data || []) as RuleSetSnapshotRow[]).map((snapshot) => [snapshot.id, snapshot])
    )
    const currentSetSnapshots = new Map<string, RuleSetSnapshotRow>()
    for (const set of ruleSetRows) {
      if (!set.current_snapshot_id) continue
      const snapshot = setSnapshotsById.get(set.current_snapshot_id)
      if (
        !snapshot
        || snapshot.org_id !== orgId
        || snapshot.rule_set_id !== set.id
        || snapshot.status !== 'published'
      ) {
        return errorResponse(createApiError('DB_ERROR', '规则集当前发布指针无效'))
      }
      currentSetSnapshots.set(set.id, snapshot)
    }
    const currentRuleSnapshotIdsBySet = new Map<string, string[]>()
    for (const [ruleSetId, snapshot] of currentSetSnapshots) {
      const memberIds = snapshot.rule_snapshot_ids
      if (
        !Array.isArray(memberIds)
        || memberIds.length === 0
        || memberIds.some((memberId) => typeof memberId !== 'string' || memberId.trim().length === 0)
        || new Set(memberIds).size !== memberIds.length
      ) {
        return errorResponse(createApiError('DB_ERROR', '规则集当前发布成员清单无效'))
      }
      currentRuleSnapshotIdsBySet.set(ruleSetId, memberIds as string[])
    }
    const activeSnapshotIds = Array.from(new Set(
      Array.from(currentRuleSnapshotIdsBySet.values()).flat()
    ))
    const currentRuleIds = ((rulesResult.data || []) as RuleRow[])
      .filter((rule) => rule.is_active)
      .map((rule) => rule.id)
    const [ruleSnapshotResult, ruleBindingSnapshotResult] = await Promise.all([
      activeSnapshotIds.length > 0
        ? supabaseAdmin
          .from('contract_rule_snapshots')
          .select('id, rule_id, version')
          .in('id', activeSnapshotIds)
          .eq('status', 'published')
        : Promise.resolve({ data: [], error: null }),
      currentRuleIds.length > 0
        ? supabaseAdmin
          .from('contract_rule_snapshots')
          .select('id, rule_id, version, status, created_at')
          .in('rule_id', currentRuleIds)
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])
    if (ruleSnapshotResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取线上规则版本失败'))
    }
    if (ruleBindingSnapshotResult.error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则验收绑定失败'))
    }
    const snapshotRefs = new Map(
      ((ruleSnapshotResult.data || []) as RuleSnapshotRefRow[]).map((snapshot) => [snapshot.id, snapshot])
    )
    const unresolvedCurrentRuleSnapshotIds = activeSnapshotIds.filter((snapshotId) => !snapshotRefs.has(snapshotId))
    if (unresolvedCurrentRuleSnapshotIds.length > 0) {
      return errorResponse(createApiError('DB_ERROR', '规则集当前发布成员快照无效'))
    }
    const testRuns = (testRunsResult.data || []) as RuleTestRunRow[]
    const ruleBindings = new Map<string, RuleSnapshotBindingRow>()
    for (const snapshot of (ruleBindingSnapshotResult.data || []) as RuleSnapshotBindingRow[]) {
      const key = `${snapshot.rule_id}:${snapshot.version}:${snapshot.status}`
      if (!ruleBindings.has(key)) ruleBindings.set(key, snapshot)
    }

    const docsBySetId = new Map<string, RuleSetDocumentRow>()
    for (const doc of (docsResult.data || []) as RuleSetDocumentRow[]) {
      if (!docsBySetId.has(doc.rule_set_id)) {
        docsBySetId.set(doc.rule_set_id, doc)
      }
    }

    const rulesBySetId = new Map<string, RuleRow[]>()
    const rulesById = new Map<string, RuleRow>()
    for (const rule of (rulesResult.data || []) as RuleRow[]) {
      rulesById.set(rule.id, rule)
      if (!rule.rule_set_id) continue
      rulesBySetId.set(rule.rule_set_id, [...(rulesBySetId.get(rule.rule_set_id) || []), rule])
    }

    for (const [ruleSetId] of currentSetSnapshots) {
      const hasForeignMember = (currentRuleSnapshotIdsBySet.get(ruleSetId) || []).some((snapshotId) => {
        const ruleSnapshot = snapshotRefs.get(snapshotId)
        const rule = ruleSnapshot ? rulesById.get(ruleSnapshot.rule_id) : null
        return !rule || rule.rule_set_id !== ruleSetId
      })
      if (hasForeignMember) {
        return errorResponse(createApiError('DB_ERROR', '规则集当前发布成员与规则集不一致'))
      }
    }

    const ruleSets = ruleSetRows.map((set) => {
      const setRules = rulesBySetId.get(set.id) || []
      const currentPublishedBindings = new Map<string, RuleSnapshotBindingRow>()
      for (const snapshotId of currentRuleSnapshotIdsBySet.get(set.id) || []) {
        const snapshot = snapshotRefs.get(snapshotId)
        if (!snapshot) continue
        currentPublishedBindings.set(`${snapshot.rule_id}:${snapshot.version}:published`, {
          ...snapshot,
          status: 'published',
          created_at: '',
        })
      }
      const activeRules = setRules.filter((rule) => rule.is_active)
      const pendingRemovalRules = setRules.filter((rule) => !rule.is_active)
      const unpublishedRules = activeRules.filter((rule) => !isPublishedRule(rule))
      const notReadyRules = activeRules.filter((rule) => !(
        rule.translation_status === 'ready' && rule.problem_category_id && rule.rule_contract
      ))
      const bindingForRule = (rule: RuleRow) => {
        const status = rule.lifecycle_status === 'ready_to_publish' ? 'draft' : 'published'
        const key = `${rule.id}:${rule.version}:${status}`
        return status === 'draft' ? ruleBindings.get(key) : currentPublishedBindings.get(key)
      }
      const missingSnapshotRules = activeRules.filter((rule) => !bindingForRule(rule))
      const readiness = new Map(activeRules.map((rule) => [
        rule.id,
        (() => {
          const contract = normalizeRuleContract(rule.rule_contract)
          return ruleReleaseReadiness({
            ruleId: rule.id,
            ruleVersion: rule.version,
            ruleContract: rule.rule_contract,
            runs: testRuns,
            ruleSnapshotId: bindingForRule(rule)?.id || null,
            ruleContractSha256: contract ? ruleContractSha256(contract) : null,
            evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
          })
        })(),
      ]))
      const missingTestRules = activeRules.filter((rule) => !readiness.get(rule.id)?.complete)
      const publishBlockers = [
        ...notReadyRules.map((rule) => `${rule.code} 尚未形成可发布规则详情`),
        ...missingSnapshotRules.map((rule) => `${rule.code} 当前版本尚未形成可发布快照`),
        ...missingTestRules.map((rule) => `${rule.code} 尚缺：${readiness.get(rule.id)?.missingLabels.join('、') || '验收矩阵'}`),
        ...(activeRules.length === 0 ? ['规则集至少需要保留一条启用规则'] : []),
      ]
      const hasPendingVersion = set.lifecycle_status !== 'published'
        || unpublishedRules.length > 0
        || pendingRemovalRules.length > 0
      const activeRuleVersions: Record<string, number> = {}
      const activeRuleSnapshotIds: Record<string, string> = {}
      for (const snapshotId of currentRuleSnapshotIdsBySet.get(set.id) || []) {
        const snapshot = snapshotRefs.get(snapshotId)
        if (!snapshot) continue
        activeRuleVersions[snapshot.rule_id] = snapshot.version
        activeRuleSnapshotIds[snapshot.rule_id] = snapshot.id
      }
      const requiredTestCaseCount = activeRules.reduce((sum, rule) => sum + (readiness.get(rule.id)?.requiredCount || 0), 0)
      const passedTestCaseCount = activeRules.reduce((sum, rule) => sum + (readiness.get(rule.id)?.passedCount || 0), 0)
      return {
        ...set,
        latest_document: docsBySetId.get(set.id) || null,
        rule_count: activeRules.length,
        published_rule_count: Object.keys(activeRuleVersions).length,
        ready_rule_count: activeRules.filter(isReadyRule).length,
        blocked_rule_count: activeRules.filter(isBlockedRule).length,
        pending_rule_count: unpublishedRules.length + pendingRemovalRules.length,
        test_evidence_ready_rule_count: activeRules.length - missingTestRules.length,
        required_test_case_count: requiredTestCaseCount,
        passed_test_case_count: passedTestCaseCount,
        can_publish: activeRules.length > 0 && hasPendingVersion && publishBlockers.length === 0,
        publish_blockers: publishBlockers,
        active_rule_versions: activeRuleVersions,
        active_rule_snapshot_ids: activeRuleSnapshotIds,
      }
    })

    return successResponse(ruleSets)
  })
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const parsed = ruleSetSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '规则集参数无效'))
    }

    const payload = parsed.data
    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .insert({
        org_id: orgId,
        created_by: user.id,
        code: payload.code,
        name: payload.name,
        description: payload.description || null,
        applicable_scenario: 'contract_review',
        priority: payload.priority,
        is_default: payload.is_default,
        is_active: true,
        lifecycle_status: 'draft',
        translation_status: 'not_started',
        metadata: {
          created_from: 'config_center_ruleset_api',
          content_hash: hashContent(`${payload.code}:${payload.name}:${payload.description || ''}`),
        },
      })
      .select()
      .single()

    if (error || !data) {
      return errorResponse(createApiError('DB_ERROR', '创建规则集失败'))
    }

    return createdResponse(data)
  })
}
