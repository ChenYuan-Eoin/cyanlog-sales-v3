// /api/rules/test - 规则测试沙箱 API
// 接收合同文本，立即显示所有规则的匹配结果

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  evaluateRuleContract,
  normalizeRuleContract,
  resolveRuleContract,
  ruleContractRequiresMissingEvidenceCase,
} from '@/lib/rules/rule-contract'
import {
  RULE_CONTRACT_EVALUATOR_REVISION,
  ruleContractSha256,
} from '@/lib/rules/rule-release-readiness'
import type { ContractRuleTestCaseKind } from '@/types/rules'
import { executeRules, loadFlexibleRules } from '@/lib/rules/engine'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

const schema = z.object({
  text: z.string().min(10).max(50000),
  rule_id: z.string().uuid().optional(),
  case_kind: z.enum(['risk', 'pass', 'missing_evidence', 'value_conflict', 'unit_conflict']).optional(),
  expected_decision_id: z.string().trim().min(1).max(80).optional(),
})

function resolveExpectedResult(input: {
  caseKind: ContractRuleTestCaseKind
  expectedDecisionId?: string
  contract: ReturnType<typeof resolveRuleContract>
}) {
  const { caseKind, expectedDecisionId, contract } = input
  if (caseKind === 'risk' || caseKind === 'pass') {
    const decision = contract.decisions.find((candidate) => candidate.id === expectedDecisionId)
    if (!decision) return { error: '请选择要验证的明确判定' } as const
    if (caseKind === 'pass' && decision.outcome !== 'pass') {
      return { error: '通过用例必须选择“通过”判定' } as const
    }
    if (caseKind === 'risk' && decision.outcome === 'pass') {
      return { error: '风险用例必须选择非“通过”判定' } as const
    }
    return {
      expectedStatus: 'decided' as const,
      expectedOutcome: decision.outcome,
      expectedDecisionId: decision.id,
    }
  }
  if (caseKind === 'missing_evidence' && !ruleContractRequiresMissingEvidenceCase(contract)) {
    return {
      error: '这条规则已用明确判定处理“未填写”，请检查对应的风险或通过判定',
    } as const
  }
  return {
    expectedStatus: 'missing_evidence' as const,
    expectedOutcome: contract.missing_evidence_outcome,
    expectedDecisionId: null,
  }
}

async function handleRuleTest(req: NextRequest, user: AuthUser, orgId: string) {
  try {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return NextResponse.json(
        { error: '缺少当前组织的 config:write 权限' },
        { status: 403 }
      )
    }

    const body = await req.json().catch(() => null)
    const result = schema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: '文本长度需在 10-50000 字符之间' }, { status: 400 })
    }
    if (!result.data.rule_id) {
      return NextResponse.json(await executeRules(result.data.text, orgId))
    }

    // 配置中心必须能测试尚未发布的草稿，但正式合同审核仍只读取已发布快照。
    const draftRules = await loadFlexibleRules({ orgId, includeUnpublished: true })
    const rule = draftRules.find((candidate) => candidate.id === result.data.rule_id)
    if (!rule) {
      return NextResponse.json({ error: '当前组织下未找到这条规则' }, { status: 404 })
    }

    const contract = resolveRuleContract(rule)
    // Runtime uses the normalized contract, but release evidence must hash the
    // exact persisted JSON. Optional empty fields are semantically harmless,
    // yet normalizing them away would produce a different hash from the atomic
    // database publish function and make a 5/5-tested rule impossible to ship.
    const { data: persistedRule, error: persistedRuleError } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('rule_contract')
      .eq('id', rule.id)
      .eq('org_id', orgId)
      .single()
    if (persistedRuleError || !persistedRule || !normalizeRuleContract(persistedRule.rule_contract)) {
      return NextResponse.json(
        { error: '当前规则详情无效，请重新保存后再测试' },
        { status: 409 }
      )
    }
    const contractSha256 = ruleContractSha256(persistedRule.rule_contract)
    const { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('id, status, config_snapshot')
      .eq('rule_id', rule.id)
      .eq('version', rule.version)
      .in('status', ['draft', 'published'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (snapshotError) {
      throw new Error(`规则测试快照读取失败: ${snapshotError.message}`)
    }
    const snapshotConfig = snapshot?.config_snapshot
      && typeof snapshot.config_snapshot === 'object'
      && !Array.isArray(snapshot.config_snapshot)
      ? snapshot.config_snapshot as Record<string, unknown>
      : null
    const snapshotContractSource = snapshotConfig?.rule_contract
    const snapshotContract = normalizeRuleContract(snapshotContractSource)
    if (!snapshot || !snapshotContract || ruleContractSha256(snapshotContractSource) !== contractSha256) {
      return NextResponse.json(
        { error: '当前规则详情尚未形成一致快照，请先保存后再测试' },
        { status: 409 }
      )
    }
    const caseKind = result.data.case_kind || 'risk'
    const expected = resolveExpectedResult({
      caseKind,
      expectedDecisionId: result.data.expected_decision_id,
      contract,
    })
    if ('error' in expected) {
      return NextResponse.json({ error: expected.error }, { status: 400 })
    }

    const evaluation = evaluateRuleContract(rule, result.data.text)
    const assertionPassed = evaluation.status === expected.expectedStatus
      && evaluation.outcome === expected.expectedOutcome
      && (caseKind === 'risk' || caseKind === 'pass'
        ? evaluation.decision?.id === expected.expectedDecisionId
        : caseKind === 'unit_conflict'
          ? evaluation.unit_conflict_property_keys.length > 0
          : caseKind === 'value_conflict'
            ? evaluation.ambiguous_property_keys.length > 0
            : evaluation.missing_property_keys.length > 0
              || Object.values(evaluation.readings).every((reading) => reading.status === 'missing'))
    const testResult = {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleVersion: rule.version,
      ruleName: rule.name,
      status: evaluation.status,
      outcome: evaluation.outcome,
      riskLevel: evaluation.risk_level,
      decision: evaluation.decision
        ? {
            id: evaluation.decision.id,
            label: evaluation.decision.label,
            match: evaluation.decision.match,
            outcome: evaluation.decision.outcome,
            action: evaluation.decision.action,
            message: evaluation.decision.message,
          }
        : null,
      readings: Object.values(evaluation.readings),
      evidence: evaluation.evidence,
      missingPropertyKeys: evaluation.missing_property_keys,
      ambiguousPropertyKeys: evaluation.ambiguous_property_keys,
      unitConflictPropertyKeys: evaluation.unit_conflict_property_keys,
      assertion: {
        caseKind,
        expectedStatus: expected.expectedStatus,
        expectedOutcome: expected.expectedOutcome,
        expectedDecisionId: expected.expectedDecisionId,
        passed: assertionPassed,
        ruleSnapshotId: snapshot.id,
        ruleContractSha256: contractSha256,
        evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
      },
    }
    const { data: testRun, error: testRunError } = await supabaseAdmin
      .from('contract_rule_test_runs')
      .insert({
        org_id: orgId,
        rule_id: rule.id,
        rule_version: rule.version,
        source_sha256: crypto.createHash('sha256').update(result.data.text).digest('hex'),
        case_kind: caseKind,
        expected_status: expected.expectedStatus,
        expected_outcome: expected.expectedOutcome,
        expected_decision_id: expected.expectedDecisionId,
        assertion_passed: assertionPassed,
        rule_snapshot_id: snapshot.id,
        rule_contract_sha256: contractSha256,
        evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
        result_status: evaluation.status,
        outcome: evaluation.outcome,
        result_json: {
          ...testResult,
          ruleContract: contract,
        },
        tested_by: user.id,
      })
      .select('id, created_at')
      .single()

    if (testRunError || !testRun) {
      throw new Error(`规则测试证据保存失败: ${testRunError?.message || 'unknown'}`)
    }

    return NextResponse.json({
      test: { ...testResult, testRunId: testRun.id, testedAt: testRun.created_at },
    })
  } catch (error) {
    console.error('Rule test error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, (user, orgId) => handleRuleTest(req, user, orgId))
}
