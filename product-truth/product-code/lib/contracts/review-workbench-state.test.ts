import { describe, expect, it } from 'vitest'
import {
  buildExportGateIssues,
  buildReviewHealth,
  firstEvidence,
  hasWordUnsafeAnnotationAnchor,
  needsManualAnnotationLocation,
  needsManualRiskLocation,
  type WorkbenchReviewDataLike,
} from './review-workbench-state'

function baseReviewData(overrides: Partial<WorkbenchReviewDataLike> = {}): WorkbenchReviewDataLike {
  return {
    status: 'COMPLETED',
    reviewRun: {
      status: 'COMPLETED',
      skill_bundle_id: 'bundle-1',
      evidence_status: 'snapshot_bound',
      rule_snapshot_refs: [{ id: 'snapshot-1' }],
      runtime_source: 'runtime_plan',
      runtime_plan: { integrity: { valid: true, errors: [] } },
      skill_bundle: {
        production_source: {
          source_of_truth: 'config_center_published_rules',
        },
        rule_translation_ready: true,
        rule_translation_status: 'ready',
        rules: {
          expected: 1,
          actual: 1,
          missing: [],
        },
        second_verification_required: true,
        official_review_allowed: true,
        rule_acceptance_status: 'passed',
        model_quality_eval_status: 'passed',
        runtime_invocation_status: 'latest_review_model_invocation_passed',
      },
      model_policy: {
        degraded: false,
        provider: 'AI_LEVEL_1',
        last_error: null,
      },
    },
    riskFindings: [
      {
        severity: 'red',
        evidence: {
          snippets: ['付款期限为 60 日'],
          location_status: 'exact',
        },
        position: {
          start: 24,
          end: 35,
        },
      },
    ],
    annotations: [
      {
        selected_text: '付款期限为 60 日',
        comment: '建议改为 30 日内完成付款。',
      },
    ],
    latestJob: {
      provider: 'AI_LEVEL_1',
      degraded: false,
      last_error: null,
    },
    ...overrides,
  }
}

describe('review workbench state', () => {
  it('allows native Word export only when rules, snapshots, evidence and anchors are healthy', () => {
    const data = baseReviewData()
    const health = buildReviewHealth(data)
    const gateIssues = buildExportGateIssues(data, health)

    expect(health.degraded).toBe(false)
    expect(health.exportBlocked).toBe(false)
    expect(gateIssues).toEqual([])
  })

  it('blocks export when a risk finding cannot be located in source text', () => {
    const data = baseReviewData({
      riskFindings: [
        {
          severity: 'red',
          evidence: {
            snippets: [],
            location_status: 'manual_required',
          },
          position: {
            start: null,
            end: null,
          },
        },
      ],
    })

    const risk = data.riskFindings[0]
    const health = buildReviewHealth(data)
    const gateIssues = buildExportGateIssues(data, health)

    expect(firstEvidence(risk)).toBe('')
    expect(needsManualRiskLocation(risk)).toBe(true)
    expect(health.manualRiskCount).toBe(1)
    expect(gateIssues.join('\n')).toContain('风险项没有可验证的原文定位')
  })

  it('blocks export when comment intent needs manual location', () => {
    const data = baseReviewData({
      annotations: [
        {
          selected_text: '',
          comment: '【需人工定位】请人工确认证据范围后再写入 Word 批注。',
        },
      ],
    })

    const annotation = data.annotations[0]
    const health = buildReviewHealth(data)
    const gateIssues = buildExportGateIssues(data, health)

    expect(needsManualAnnotationLocation(annotation)).toBe(true)
    expect(health.manualAnnotationCount).toBe(1)
    expect(gateIssues.join('\n')).toContain('Word 批注意图需要人工定位')
  })

  it('allows multiline evidence when it contains a stable Word comment anchor', () => {
    const data = baseReviewData({
      annotations: [
        {
          selected_text: '若提前解除合同，则合同费用按照实际服务时间进行结算。\n客户口头确认。',
          comment: '跨段文本可以用稳定片段锚定。',
        },
      ],
    })

    const health = buildReviewHealth(data)

    expect(data.annotations.some(hasWordUnsafeAnnotationAnchor)).toBe(false)
    expect(health.wordUnsafeAnnotationCount).toBe(0)
    expect(buildExportGateIssues(data, health)).toEqual([])
  })

  it('blocks export when Word comment anchor is too short', () => {
    const data = baseReviewData({
      annotations: [
        {
          selected_text: '付款',
          comment: '证据过短，容易错位。',
        },
      ],
    })

    const health = buildReviewHealth(data)

    expect(data.annotations.every(hasWordUnsafeAnnotationAnchor)).toBe(true)
    expect(health.wordUnsafeAnnotationCount).toBe(1)
    expect(buildExportGateIssues(data, health).join('\n')).toContain('疑似跨段或证据过短')
  })

  it('marks rule-engine-only or missing snapshots as degraded but does not block safe source-comment export', () => {
    const data = baseReviewData({
      reviewRun: {
        status: 'DEGRADED',
        skill_bundle_id: null,
        evidence_status: 'missing_snapshot',
        rule_snapshot_refs: [],
        skill_bundle: null,
        model_policy: {
          degraded: true,
          provider: 'rule-engine',
          last_error: 'semantic model unavailable',
        },
      },
      latestJob: {
        provider: 'rule-engine',
        degraded: true,
        last_error: null,
      },
    })

    const health = buildReviewHealth(data)
    const gateIssues = buildExportGateIssues(data, health)

    expect(health.degraded).toBe(true)
    expect(health.issues.join('\n')).toContain('缺少规则发布包绑定')
    expect(health.issues.join('\n')).toContain('缺少规则快照引用')
    expect(health.issues.join('\n')).toContain('审核执行发生降级：rule-engine')
    expect(health.exportBlocked).toBe(false)
    expect(gateIssues).toEqual([])
  })

  it('keeps rule acceptance, model-quality gold and runtime invocation independent', () => {
    const base = baseReviewData()
    if (!base.reviewRun?.skill_bundle) throw new Error('base review must include a skill bundle')
    const data = baseReviewData({
      reviewRun: {
        ...base.reviewRun,
        skill_bundle: {
          ...base.reviewRun.skill_bundle,
          rule_acceptance_status: 'passed',
          model_quality_eval_status: 'blocked_without_independent_gold',
          runtime_invocation_status: 'latest_review_model_invocation_passed',
        },
      },
    })

    const health = buildReviewHealth(data)

    expect(health.issues.join('\n')).toContain('模型质量金标评测状态为 blocked_without_independent_gold')
    expect(health.issues.join('\n')).not.toContain('规则验收状态')
    expect(health.issues.join('\n')).not.toContain('语义模型调用未通过')
  })

  it('rejects a nominally passed invocation when the bound runtime plan fails integrity', () => {
    const base = baseReviewData()
    if (!base.reviewRun) throw new Error('base review must include a ReviewRun')
    const data = baseReviewData({
      reviewRun: {
        ...base.reviewRun,
        runtime_source: 'runtime_plan',
        runtime_plan: { integrity: { valid: false, errors: ['runtime_plan_sha256_mismatch'] } },
      },
    })

    const health = buildReviewHealth(data)

    expect(health.degraded).toBe(true)
    expect(health.issues.join('\n')).toContain('运行计划快照或模型调用绑定未通过完整性校验')
  })

  it('reports missing rule acceptance and missing semantic invocation as separate blockers', () => {
    const base = baseReviewData()
    if (!base.reviewRun?.skill_bundle) throw new Error('base review must include a skill bundle')
    const data = baseReviewData({
      reviewRun: {
        ...base.reviewRun,
        skill_bundle: {
          ...base.reviewRun.skill_bundle,
          rule_acceptance_status: null,
          model_quality_eval_status: 'passed',
          runtime_invocation_status: 'semantic_invocation_not_recorded',
        },
      },
    })

    const issues = buildReviewHealth(data).issues.join('\n')

    expect(issues).toContain('规则验收状态为 missing')
    expect(issues).toContain('本次 ReviewRun 未记录语义模型调用')
  })

  it.each([null, 'unexpected_runtime_state'])('fails closed for an absent or unknown runtime invocation status: %s', (runtimeStatus) => {
    const base = baseReviewData()
    if (!base.reviewRun?.skill_bundle) throw new Error('base review must include a skill bundle')
    const data = baseReviewData({
      reviewRun: {
        ...base.reviewRun,
        skill_bundle: {
          ...base.reviewRun.skill_bundle,
          rule_acceptance_status: 'passed',
          model_quality_eval_status: 'passed',
          runtime_invocation_status: runtimeStatus,
        },
      },
    })

    const health = buildReviewHealth(data)

    expect(health.degraded).toBe(true)
    expect(health.issues.join('\n')).toContain(`语义模型调用状态为 ${runtimeStatus || 'missing'}`)
  })
})
