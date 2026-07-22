import { describe, expect, it } from 'vitest'
import {
  buildDecisionNotes,
  buildDecisionReviewModelInput,
  buildPublishedResolutionOptions,
  buildSourceAnchor,
  decisionWorkflowState,
  evaluateDecisionReviewOutcome,
  inspectDecisionConflicts,
  normalizePublishedReviewRuleSnapshot,
  resolveFrozenChunkSourceQuote,
  resolveFrozenRuleBinding,
  resolveReviewBundleExecutionContract,
  resolveReviewSourceAnchor,
  reviewStyleToStrategyCode,
  sanitizeCustomerFacingText,
  shouldExposeRiskSourceAnchor,
  shouldMaterializeReviewRiskCard,
  splitReviewTextIntoChunks,
  type PublishedReviewRule,
  type ReviewRiskLike,
} from './review-workbench'

const risk: ReviewRiskLike = {
  id: 'risk-payment',
  level: 'red',
  title: '付款周期',
  description: '首期付款比例过低',
  clause_ref: '第二条',
  position_start: 2300,
  position_end: 2350,
  rule_code: 'R001',
  rule_snapshot_id: 'snapshot-payment',
}

const publishedRule: PublishedReviewRule = {
  snapshot_id: 'snapshot-payment',
  code: 'R001',
  name: '付款节奏',
  clause_category: 'payment',
  level_a_action: 'auto_accept',
  level_b_action: 'negotiate_with_counterparty',
  level_c_action: 'block_or_escalate',
  message_template: {
    levels: { level_a: '首期不低于30%', level_b: '首期15-29%', level_c: '首期低于15%' },
    comment: '请将首期付款调整到双方可执行的比例。',
    bottom_line: '首期不得低于15%。',
    negotiation_action: '与客户确认付款节奏。',
  },
  consistency_key: null,
  conflict_group: null,
  mutually_exclusive_with: [],
}

describe('review workbench domain', () => {
  it('keeps document-coverage conclusions out of source-anchor and customer-output flows', () => {
    expect(shouldExposeRiskSourceAnchor(
      { position_start: null, position_end: null },
      { evidence_scope: 'document_coverage', customer_output_eligible: false }
    )).toBe(false)
    expect(shouldExposeRiskSourceAnchor(
      { position_start: null, position_end: null },
      { evidence_scope: 'source_span', customer_output_eligible: false }
    )).toBe(false)
    expect(shouldExposeRiskSourceAnchor(
      { position_start: 12, position_end: 18 },
      { evidence_scope: 'source_span', customer_output_eligible: true }
    )).toBe(true)
  })

  it('requires an explicit facts_v1 contract for candidates and never silently falls back to current', () => {
    expect(resolveReviewBundleExecutionContract({
      output_schema: {},
      release_meta: {},
    })).toBe('legacy_risk_v1')
    expect(resolveReviewBundleExecutionContract({
      output_schema: { contract: 'contract_review_facts_v1', version: 1 },
      release_meta: {
        stage: 'candidate',
        release_eligible: false,
        criteria_schema_version: 1,
      },
    })).toBe('facts_v1')
    expect(resolveReviewBundleExecutionContract({
      output_schema: {},
      release_meta: {
        stage: 'candidate',
        release_eligible: false,
        criteria_schema_version: 1,
      },
    })).toBeNull()
  })

  it('hydrates nested deterministic criteria without falling back to mutable live fields', () => {
    const criteria = {
      schema_version: 1,
      fact_schema: { refund_scope: { type: 'string', enum: ['none', 'full'] } },
      level_a: { eq: { fact: 'refund_scope', value: 'none' } },
      level_b: { all: [] },
      level_c: { eq: { fact: 'refund_scope', value: 'full' } },
    }
    expect(normalizePublishedReviewRuleSnapshot({
      snapshot_id: 'snapshot-r002-v22',
      version: 22,
      execution_contract: 'facts_v1',
      config_snapshot: {
        id: 'rule-r002',
        code: 'R002',
        name: '终止退款',
        review_criteria: criteria,
        criteria_schema_version: 1,
        conflict_group: 'refund_remedy',
        mutually_exclusive_with: ['R005'],
        specificity: 140,
        default_unknown: 'yellow_review',
        message_template: { comment_template: '请复核退款范围。' },
        // A candidate must use the nested immutable DSL, not these legacy
        // values copied alongside it for backward-compatible UI display.
        level_a_threshold: 999,
      },
    })).toMatchObject({
      snapshot_id: 'snapshot-r002-v22',
      rule_id: 'rule-r002',
      rule_version: 22,
      code: 'R002',
      review_criteria: criteria,
      criteria_schema_version: 1,
      conflict_group: 'refund_remedy',
      mutually_exclusive_with: ['R005'],
      specificity: 140,
      default_unknown: 'yellow_review',
    })
  })

  it('keeps the legacy compact rule catalogue readable without fabricating deterministic metadata', () => {
    expect(normalizePublishedReviewRuleSnapshot({
      snapshot_id: 'snapshot-r001-v21',
      version: 21,
      config_snapshot: {
        code: 'R001',
        name: '付款节奏',
        category: 'ratio',
        target_field: 'first_payment_pct',
        level_a_threshold: 30,
        field_hints: [],
      },
    })).toMatchObject({
      code: 'R001',
      review_criteria: {
        category: 'ratio',
        target_field: 'first_payment_pct',
        level_a_threshold: 30,
      },
      specificity: null,
      default_unknown: null,
      criteria_schema_version: null,
    })
    expect(normalizePublishedReviewRuleSnapshot({
      snapshot_id: 'invalid',
      config_snapshot: { name: '没有 code' },
    })).toBeNull()

    expect(normalizePublishedReviewRuleSnapshot({
      snapshot_id: 'legacy-with-untrusted-nested-field',
      version: 21,
      execution_contract: 'legacy_risk_v1',
      config_snapshot: {
        code: 'R099',
        name: '旧包不得启用 nested DSL',
        target_field: 'legacy_field',
        review_criteria: {
          schema_version: 1,
          fact_schema: { injected: { type: 'boolean' } },
          level_a: { present: { fact: 'injected' } },
          level_b: { present: { fact: 'injected' } },
          level_c: { present: { fact: 'injected' } },
        },
      },
    })?.review_criteria).toEqual({ target_field: 'legacy_field' })
  })

  it('materializes only actionable red and yellow findings as customer risk cards', () => {
    expect(shouldMaterializeReviewRiskCard('red')).toBe(true)
    expect(shouldMaterializeReviewRiskCard('yellow')).toBe(true)
    expect(shouldMaterializeReviewRiskCard('green')).toBe(false)
    expect(shouldMaterializeReviewRiskCard('white')).toBe(false)
  })

  it('derives the frozen snapshot from one unique rule code', () => {
    expect(resolveFrozenRuleBinding(risk, [publishedRule])).toEqual(publishedRule)
    expect(resolveFrozenRuleBinding({ ...risk, rule_snapshot_id: null }, [publishedRule])).toEqual(publishedRule)
    expect(resolveFrozenRuleBinding({ ...risk, rule_snapshot_id: 'snapshot-stale' }, [publishedRule])).toEqual(publishedRule)
    expect(resolveFrozenRuleBinding({ ...risk, rule_code: 'R999' }, [publishedRule])).toBeNull()
    expect(resolveFrozenRuleBinding(risk, [publishedRule, { ...publishedRule }])).toBeNull()
  })

  it('repairs only one unambiguous whitespace-only quote inside a frozen chunk', () => {
    const source = '违约责任：乙方每日承担合同金额5%的违约金且无上限。'
    expect(resolveFrozenChunkSourceQuote(source, '违约责任：乙方每日承担合同金额 5% 的违约金且无上限。')).toEqual({
      start: 0,
      end: source.length,
      exactText: source,
      candidateText: '违约责任：乙方每日承担合同金额 5% 的违约金且无上限。',
      normalization: 'whitespace_only',
    })
    expect(resolveFrozenChunkSourceQuote(`${source}\n${source}`, '违约责任：乙方每日承担合同金额 5% 的违约金且无上限。')).toBeNull()
    expect(resolveFrozenChunkSourceQuote(source, '违约责任：乙方每日承担合同金额6%的违约金且无上限。')).toBeNull()
  })

  it('covers the complete source with bounded overlapping page chunks', () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({
      page: index + 1,
      start: index * 100,
      end: index * 100 + 99,
    }))
    const text = '甲'.repeat(2000)
    const chunks = splitReviewTextIntoChunks(text, pages, {
      maxChars: 1000,
      maxPages: 8,
      overlapPages: 1,
    })

    expect(chunks.map((chunk) => [chunk.page_start, chunk.page_end])).toEqual([
      [1, 8],
      [8, 15],
      [15, 20],
    ])
    expect(chunks[0].start).toBe(0)
    expect(chunks.at(-1)?.end).toBe(text.length)
    expect(chunks.every((chunk) => chunk.text === text.slice(chunk.start, chunk.end))).toBe(true)
  })

  it('falls back to overlapping character chunks for provisional Word sources', () => {
    const text = `${'甲'.repeat(1800)}\n${'乙'.repeat(1800)}\n${'丙'.repeat(800)}`
    const chunks = splitReviewTextIntoChunks(text, [{ page: 1, start: 0, end: text.length - 1 }], {
      maxChars: 2000,
      overlapChars: 200,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].start).toBe(0)
    expect(chunks.at(-1)?.end).toBe(text.length)
    expect(chunks[1].start).toBeLessThan(chunks[0].end)
    expect(chunks.every((chunk) => chunk.text.length <= 2000)).toBe(true)
  })

  it('keeps recurring Word clauses 2700 characters apart out of the same default chunk', () => {
    const repeated = '客户应在交付后45个工作日内完成验收；逾期未反馈不视为验收通过。'
    const text = `${repeated}${'甲'.repeat(2700 - repeated.length)}${repeated}${'乙'.repeat(800)}`
    const chunks = splitReviewTextIntoChunks(text, [{ page: 1, start: 0, end: text.length - 1 }])

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.text.length <= 1500)).toBe(true)
    expect(chunks.every((chunk) => {
      const first = chunk.text.indexOf(repeated)
      return first < 0 || chunk.text.lastIndexOf(repeated) === first
    })).toBe(true)
  })

  it('anchors repeated source text only through one exact frozen chunk occurrence', () => {
    const repeated = '付款节奏：首付款为6%，验收后支付尾款，账期90个工作日。'
    const sourceText = `${repeated}${'甲'.repeat(1500)}${repeated}`
    const secondStart = sourceText.lastIndexOf(repeated)
    const chunk = {
      index: 2,
      total: 2,
      start: secondStart - 100,
      end: sourceText.length,
      hash: 'a'.repeat(64),
    }

    expect(resolveReviewSourceAnchor({
      sourceText,
      sourceQuote: repeated,
      sourceStart: secondStart,
      sourceEnd: secondStart + repeated.length,
      chunk,
    })).toMatchObject({
      start: secondStart,
      end: secondStart + repeated.length,
      status: 'exact_frozen_chunk',
      chunk,
    })
    expect(resolveReviewSourceAnchor({
      sourceText,
      sourceQuote: repeated,
      sourceStart: 0,
      sourceEnd: repeated.length,
      chunk,
    })).toBeNull()
    expect(resolveReviewSourceAnchor({ sourceText, sourceQuote: repeated })).toBeNull()
  })

  it('anchors globally unique source text without a chunk proof', () => {
    const sourceText = '第一条 普通约定。第二条 数据可跨境长期留存。第三条 其他约定。'
    const sourceQuote = '第二条 数据可跨境长期留存。'
    expect(resolveReviewSourceAnchor({ sourceText, sourceQuote })).toMatchObject({
      start: sourceText.indexOf(sourceQuote),
      end: sourceText.indexOf(sourceQuote) + sourceQuote.length,
      status: 'exact_unique_text',
      chunk: null,
    })
  })

  it('builds page/source anchors from immutable source offsets', () => {
    const text = `${'甲'.repeat(2290)}第二条 付款安排${'乙'.repeat(200)}`
    expect(buildSourceAnchor(text, risk)).toMatchObject({
      page: 2,
      start: 2300,
      end: 2350,
      clause_ref: '第二条',
      exact_text: expect.any(String),
    })
  })

  it('returns rendered line boxes for precise in-page risk positioning', () => {
    const text = '第一条 其他内容\n第二条 付款安排：首付款为6%，账期90个工作日。\n第三条 其他内容'
    const start = text.indexOf('第二条')
    const anchored = buildSourceAnchor(text, {
      ...risk,
      position_start: start,
      position_end: start + 24,
    }, [{
      page: 1,
      start: 0,
      end: text.length - 1,
      locator: 'rendered',
      line_boxes: [{ start, end: start + 30, text: '第二条 付款安排：首付款为6%，账期90个工作日。', left: 12, top: 24, width: 70, height: 3 }],
    }])
    expect(anchored).toMatchObject({
      page: 1,
      locator: 'rendered',
      precision: 'line',
      boxes: [{ left: 12, top: 24, width: 70, height: 3 }],
    })
  })

  it('keeps Word pagination provisional while promoting verified text offsets to source-exact evidence', () => {
    const text = 'SLA 承诺为 7x24 小时，不含赔付责任。'
    expect(buildSourceAnchor(text, {
      ...risk,
      position_start: 0,
      position_end: text.length,
    }, [{
      page: 1,
      start: 0,
      end: text.length - 1,
      locator: 'provisional',
    }])).toMatchObject({
      page: 1,
      exact_text: text,
      locator: 'provisional',
      precision: 'source_exact',
    })
  })

  it('keeps missing offsets explicitly unresolved instead of highlighting the first line', () => {
    expect(buildSourceAnchor('第一条 真实合同原文', {
      ...risk,
      position_start: null,
      position_end: null,
    }, [{
      page: 1,
      start: 0,
      end: 10,
      locator: 'rendered',
      line_boxes: [{ start: 0, end: 10, text: '第一条 真实合同原文', left: 10, top: 10, width: 80, height: 4 }],
    }])).toMatchObject({
      page: 1,
      start: 0,
      end: 0,
      exact_text: '',
      locator: 'provisional',
      precision: 'provisional',
      boxes: [],
    })
  })

  it('only builds resolution options from published rule snapshots', () => {
    const options = buildPublishedResolutionOptions(risk, [publishedRule])
    expect(options).toHaveLength(3)
    expect(options[1]).toMatchObject({
      id: 'snapshot-payment:B',
      rule_code: 'R001',
      label: '首期15-29%',
      action: 'negotiate_with_counterparty',
      action_type: 'negotiate_with_counterparty',
      bottom_line: '首期不得低于15%。',
    })
    expect(buildPublishedResolutionOptions({ ...risk, title: '不可抗力', description: '商业风险范围过宽', rule_code: null, rule_snapshot_id: null }, [publishedRule])).toEqual([])
  })

  it('uses the productized comment_template field for customer-facing previews', () => {
    const configuredRule = {
      ...publishedRule,
      message_template: {
        ...publishedRule.message_template,
        comment: undefined,
        comment_template: '建议将首付款调整为合同额的30%，并明确尾款支付节点。',
        level_b_negotiation_guidance: '先确认客户的固定账期，再协商首付款比例。',
        level_b_bottom_line: '首付款不得低于15%。',
      },
    }
    const option = buildPublishedResolutionOptions(risk, [configuredRule])[1]

    expect(option).toMatchObject({
      comment_template: '建议将首付款调整为合同额的30%，并明确尾款支付节点。',
      negotiation_guidance: '先确认客户的固定账期，再协商首付款比例。',
      bottom_line: '首付款不得低于15%。',
    })
  })

  it('sanitizes technical ids from customer comment previews', () => {
    const option = buildPublishedResolutionOptions(risk, [publishedRule])[1]
    const notes = buildDecisionNotes({
      risk,
      decisionKind: 'customer_feedback',
      option,
      feedback: '客户希望保留；rule_id: 123e4567-e89b-12d3-a456-426614174000',
    })
    expect(notes.internal_note).toContain('客户希望保留')
    expect(notes.customer_comment).toBe('请将首期付款调整到双方可执行的比例。')
    expect(notes.customer_comment).not.toContain('客户希望保留')
  })

  it('drops internal skill and rule references from customer-facing comments', () => {
    const unsafeRule = {
      ...publishedRule,
      message_template: {
        ...publishedRule.message_template,
        comment: '请在 Word 文档中注明条款编号 R012，引用 suoyidev/ones-internal-skills 版本 2.2.2。',
      },
    }
    const option = buildPublishedResolutionOptions(risk, [unsafeRule])[0]
    const notes = buildDecisionNotes({ risk, decisionKind: 'exception_requested', option, feedback: '内部审批原因' })
    expect(notes.customer_comment).toBeNull()
    expect(notes.internal_note).toContain('内部审批原因')
  })

  it('drops Chinese rule snapshot and Level metadata from customer-facing comments', () => {
    const cleaned = sanitizeCustomerFacingText([
      '本评估基于规则源与快照 2026-06-16。',
      '对于 Level A 条款，保留原文。',
      '请与客户确认赔偿上限并形成书面结论。',
    ].join('\n'))
    expect(cleaned).toBe('请与客户确认赔偿上限并形成书面结论。')
    expect(cleaned).not.toMatch(/规则源|快照|Level/)
  })

  it('drops Word operating instructions and generic assessment meta text', () => {
    expect(sanitizeCustomerFacingText('请根据实际条款文本核对本评估结果，并在 Word 文档中标注相应的批注文案。')).toBe('')
  })

  it('drops unresolved template placeholders from customer-facing comments', () => {
    const unsafeRule = {
      ...publishedRule,
      message_template: {
        ...publishedRule.message_template,
        comment: '风险等级：{risk_level}；命中原文：{matched_text}；判断依据：{basis}',
      },
    }
    const notes = buildDecisionNotes({
      risk,
      decisionKind: 'customer_agreed',
      option: buildPublishedResolutionOptions(risk, [unsafeRule])[0],
    })
    expect(notes.customer_comment).toBeNull()
  })

  it('blocks unresolved risks and conflicting customer decisions before submit', () => {
    const option = buildPublishedResolutionOptions(risk, [publishedRule])[2]
    const conflicts = inspectDecisionConflicts(
      [risk, { ...risk, id: 'risk-two', title: '另一付款风险' }],
      [{
        risk_id: risk.id,
        risk_title: risk.title,
        decision_kind: 'customer_agreed',
        selected_option_id: option.id,
        selected_option_snapshot: option,
        source_anchor: { page: 2, start: 2300, end: 2350, clause_ref: '第二条', excerpt: '付款安排', exact_text: '付款安排', locator: 'rendered' },
      }]
    )
    expect(conflicts.map((item) => item.code)).toEqual(expect.arrayContaining([
      'BLOCKING_OPTION_AGREED',
      'UNRESOLVED_RISK',
    ]))
  })

  it('maps user-facing review styles to the existing runtime strategy contract', () => {
    expect(reviewStyleToStrategyCode('lenient')).toBe('CONSERVATIVE')
    expect(reviewStyleToStrategyCode('balanced')).toBe('BALANCED')
    expect(reviewStyleToStrategyCode('strict')).toBe('AGGRESSIVE')
  })

  it('does not infer a formal option without rule evidence binding', () => {
    const unboundRisk = { ...risk, rule_code: null, rule_snapshot_id: null }
    expect(buildPublishedResolutionOptions(unboundRisk, [publishedRule])).toEqual([])
    expect(buildPublishedResolutionOptions({ ...risk, rule_snapshot_id: null, rule_code: 'R001' }, [publishedRule])).toEqual([])
  })

  it('does not infer cross-clause conflicts when the published rule has no consistency config', () => {
    const optionA = buildPublishedResolutionOptions({ ...risk, rule_code: 'R001' }, [publishedRule])[0]
    const optionB = buildPublishedResolutionOptions({ ...risk, rule_code: 'R001' }, [publishedRule])[1]
    const conflicts = inspectDecisionConflicts([risk], [
      { risk_id: 'one', decision_kind: 'customer_feedback', feedback: 'A', selected_option_id: optionA.id, selected_option_snapshot: optionA },
      { risk_id: 'two', decision_kind: 'customer_feedback', feedback: 'B', selected_option_id: optionB.id, selected_option_snapshot: optionB },
    ])
    expect(conflicts.some((item) => item.code === 'RULE_LEVEL_CONFLICT')).toBe(false)
  })

  it('persists the legal strategy and negotiation result as separate decision layers', () => {
    const option = buildPublishedResolutionOptions(risk, [publishedRule])[0]
    const strategyOnly = inspectDecisionConflicts([risk], [{
      risk_id: risk.id,
      risk_title: risk.title,
      resolution_strategy_id: option.id,
      resolution_strategy_snapshot: option,
      negotiation_result: null,
    }])

    expect(strategyOnly.map((item) => item.code)).toContain('NEGOTIATION_RESULT_REQUIRED')
    expect(strategyOnly.map((item) => item.code)).not.toContain('STRATEGY_REQUIRED')

    const feedbackMissing = inspectDecisionConflicts([risk], [{
      risk_id: risk.id,
      risk_title: risk.title,
      resolution_strategy_id: option.id,
      resolution_strategy_snapshot: option,
      negotiation_result: 'customer_feedback',
      feedback: null,
    }])
    expect(feedbackMissing.map((item) => item.code)).toContain('FEEDBACK_REQUIRED')
    expect(decisionWorkflowState({
      risk_id: risk.id,
      resolution_strategy_id: option.id,
      negotiation_result: null,
    })).toBe('STRATEGY_SELECTED')
    expect(decisionWorkflowState({
      risk_id: risk.id,
      resolution_strategy_id: option.id,
      negotiation_result: 'customer_feedback',
      feedback: '客户要求将账期改为45日',
    })).toBe('DRAFT_READY')

    const feedbackBeforeStrategy = {
      risk_id: risk.id,
      risk_title: risk.title,
      resolution_strategy_id: null,
      negotiation_result: 'customer_feedback' as const,
      feedback: '客户要求将账期改为45日',
      source_anchor: { page: 2, start: 2300, end: 2350, clause_ref: '第二条', excerpt: '付款安排', exact_text: '付款安排', locator: 'rendered' as const },
    }
    expect(inspectDecisionConflicts([risk], [feedbackBeforeStrategy])).toEqual([])
    expect(decisionWorkflowState(feedbackBeforeStrategy)).toBe('DRAFT_READY')

    const agreedWithoutStrategy = { ...feedbackBeforeStrategy, negotiation_result: 'customer_agreed' as const, feedback: null }
    expect(inspectDecisionConflicts([risk], [agreedWithoutStrategy]).map((item) => item.code)).toContain('STRATEGY_REQUIRED')
    expect(decisionWorkflowState(agreedWithoutStrategy)).toBe('RESULT_RECORDED')
  })

  it('does not equate a completed worker with a passed per-risk review', () => {
    const option = buildPublishedResolutionOptions(risk, [publishedRule])[0]
    const baseDraft = {
      risk_id: risk.id,
      resolution_strategy_id: option.id,
      resolution_strategy_snapshot: option,
      negotiation_result: 'customer_agreed' as const,
      customer_comment: option.comment_template,
      source_anchor: { page: 2, start: 2300, end: 2350, clause_ref: '第二条', excerpt: '付款安排', exact_text: '第二条 付款安排', locator: 'rendered' as const },
    }

    expect(evaluateDecisionReviewOutcome({ draft: baseDraft, modelCompleted: true }).outcome).toBe('resolved')
    expect(evaluateDecisionReviewOutcome({
      draft: {
        ...baseDraft,
        source_anchor: { ...baseDraft.source_anchor, locator: 'provisional' as const, precision: 'source_exact' as const },
      },
      modelCompleted: true,
    }).outcome).toBe('resolved')
    expect(evaluateDecisionReviewOutcome({ draft: baseDraft, modelCompleted: true, modelDegraded: true })).toMatchObject({
      outcome: 'needs_revision',
      workflow_state: 'NEEDS_REVISION',
    })
    expect(evaluateDecisionReviewOutcome({ draft: baseDraft, modelCompleted: true, hasModelConflict: true })).toMatchObject({
      outcome: 'needs_revision',
      workflow_state: 'NEEDS_REVISION',
    })
    expect(evaluateDecisionReviewOutcome({ draft: baseDraft, modelCompleted: false })).toMatchObject({
      outcome: 'needs_revision',
      workflow_state: 'NEEDS_REVISION',
    })
    expect(evaluateDecisionReviewOutcome({
      draft: { ...baseDraft, negotiation_result: 'customer_feedback', feedback: '客户要求延长账期' },
      modelCompleted: true,
    }).outcome).toBe('still_open')
    expect(evaluateDecisionReviewOutcome({
      draft: { ...baseDraft, negotiation_result: 'exception_requested', feedback: '申请保留原条款' },
      modelCompleted: true,
    }).outcome).toBe('needs_revision')
    expect(evaluateDecisionReviewOutcome({ draft: { ...baseDraft, customer_comment: null }, modelCompleted: true }).outcome).toBe('needs_revision')
    expect(evaluateDecisionReviewOutcome({ draft: null, modelCompleted: true, priorOutcome: 'resolved' })).toMatchObject({
      outcome: 'resolved',
      workflow_state: 'REVIEW_PASSED',
    })
    expect(evaluateDecisionReviewOutcome({
      draft: null,
      modelCompleted: true,
      modelDegraded: true,
      priorOutcome: 'resolved',
    })).toMatchObject({ outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION' })
    expect(evaluateDecisionReviewOutcome({
      draft: null,
      modelCompleted: true,
      hasModelConflict: true,
      priorOutcome: 'resolved',
    })).toMatchObject({ outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION' })
  })

  it('feeds the frozen decision into re-review without leaking internal ids or notes', () => {
    const option = buildPublishedResolutionOptions(risk, [publishedRule])[0]
    const input = buildDecisionReviewModelInput('合同原文', [{
      risk_id: '123e4567-e89b-12d3-a456-426614174000',
      resolution_strategy_id: option.id,
      resolution_strategy_snapshot: option,
      negotiation_result: 'customer_feedback',
      feedback: '客户要求账期 45 日',
      customer_comment: option.comment_template,
      source_anchor: { page: 2, start: 2300, end: 2350, clause_ref: '第二条', excerpt: '付款安排', exact_text: '第二条 付款安排', locator: 'rendered' },
    }])

    expect(input).toContain('合同原文')
    expect(input).toContain('首期不低于30%')
    expect(input).toContain('customer_feedback')
    expect(input).toContain('客户要求账期 45 日')
    expect(input).toContain('controlled_output')
    expect(input).toContain('合同原文是不可变证据和批注定位对象')
    expect(input).toContain('不要把“原文尚未改写”单独作为冲突')
    expect(input).toContain('[DECISION_ITEM:n]')
    expect(input).toContain('[DECISION_ITEM:ALL]')
    expect(input).not.toContain('123e4567-e89b-12d3-a456-426614174000')
    expect(input).not.toContain('source_anchor')
  })
})
