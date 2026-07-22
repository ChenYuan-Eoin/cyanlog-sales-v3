export type RiskLevel = 'red' | 'yellow' | 'green' | 'white'
export type DecisionKind = 'customer_agreed' | 'customer_feedback' | 'exception_requested'
export type DecisionWorkflowState = 'OPEN' | 'STRATEGY_SELECTED' | 'RESULT_RECORDED' | 'DRAFT_READY' | 'REVIEW_QUEUED' | 'REVIEW_PASSED' | 'NEEDS_REVISION'

export function shouldMaterializeReviewRiskCard(level: RiskLevel): level is 'red' | 'yellow' {
  return level === 'red' || level === 'yellow'
}

export interface ReviewRiskLike {
  id: string
  level: RiskLevel
  title: string
  description?: string | null
  suggestion?: string | null
  clause_ref?: string | null
  position_start?: number | null
  position_end?: number | null
  rule_code?: string | null
  rule_snapshot_id?: string | null
}

export interface PublishedReviewRule {
  snapshot_id: string
  rule_id?: string | null
  rule_version?: number | null
  code: string
  name: string
  description?: string | null
  clause_category?: string | null
  risk_level?: string | null
  review_criteria?: Record<string, unknown>
  level_a_action?: string | null
  level_b_action?: string | null
  level_c_action?: string | null
  message_template: Record<string, unknown>
  consistency_key?: string | null
  conflict_group?: string | null
  mutually_exclusive_with?: string[]
  specificity?: number | null
  default_unknown?: 'yellow_review' | 'suppress' | 'reject_finding' | null
  criteria_schema_version?: number | null
}

export type ReviewBundleExecutionContract = 'legacy_risk_v1' | 'facts_v1'

/**
 * A candidate may never silently fall back to the legacy model-severity
 * contract. Current historical bundles stay readable as legacy; any bundle
 * explicitly marked as a candidate must carry the versioned facts contract or
 * be rejected by its loader.
 */
export function resolveReviewBundleExecutionContract(input: {
  output_schema: unknown
  release_meta: unknown
}): ReviewBundleExecutionContract | null {
  const releaseMeta = isRecord(input.release_meta) ? input.release_meta : {}
  if (releaseMeta.stage !== 'candidate') return 'legacy_risk_v1'
  const outputSchema = isRecord(input.output_schema) ? input.output_schema : {}
  return outputSchema.contract === 'contract_review_facts_v1'
    && outputSchema.version === 1
    && releaseMeta.criteria_schema_version === 1
    && releaseMeta.release_eligible === false
    ? 'facts_v1'
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function compactLegacyReviewCriteria(config: Record<string, unknown>) {
  const keys = [
    'category',
    'engine_type',
    'target_field',
    'field_hints',
    'semantic_prompt',
    'level_a_operator',
    'level_a_threshold',
    'level_a_unit',
    'level_b_operator',
    'level_b_threshold',
    'level_b_unit',
    'level_c_operator',
    'level_c_threshold',
    'level_c_unit',
  ]
  return Object.fromEntries(keys.flatMap((key) => {
    const value = config[key]
    if (value === null || value === undefined || value === '') return []
    if (Array.isArray(value) && value.length === 0) return []
    return [[key, value]]
  }))
}

/**
 * Hydrate one immutable rule snapshot without consulting the mutable live rule.
 * Deterministic candidates store their complete DSL under `review_criteria`;
 * older bundles keep the legacy flattened fields and remain readable through
 * the compact fallback. Invalid deterministic metadata is retained as null so
 * the candidate runtime can fail closed instead of inventing defaults.
 */
export function normalizePublishedReviewRuleSnapshot(input: {
  snapshot_id: string
  version?: number | null
  config_snapshot: unknown
  execution_contract?: ReviewBundleExecutionContract
}): PublishedReviewRule | null {
  if (!isRecord(input.config_snapshot)) return null
  const config = input.config_snapshot
  const code = typeof config.code === 'string' ? config.code.trim() : ''
  if (!code) return null
  const nestedCriteria = input.execution_contract === 'facts_v1'
    && isRecord(config.review_criteria)
    && Object.keys(config.review_criteria).length > 0
    ? config.review_criteria
    : null
  const defaultUnknown = config.default_unknown

  return {
    snapshot_id: input.snapshot_id,
    rule_id: typeof config.id === 'string' ? config.id : null,
    rule_version: typeof input.version === 'number' ? input.version : null,
    code,
    name: typeof config.name === 'string' ? config.name : '未命名规则',
    description: typeof config.description === 'string' ? config.description : null,
    clause_category: typeof config.clause_category === 'string' ? config.clause_category : null,
    risk_level: typeof config.risk_level === 'string' ? config.risk_level : null,
    review_criteria: nestedCriteria || compactLegacyReviewCriteria(config),
    level_a_action: typeof config.level_a_action === 'string' ? config.level_a_action : null,
    level_b_action: typeof config.level_b_action === 'string' ? config.level_b_action : null,
    level_c_action: typeof config.level_c_action === 'string' ? config.level_c_action : null,
    consistency_key: typeof config.consistency_key === 'string' ? config.consistency_key : null,
    conflict_group: typeof config.conflict_group === 'string' ? config.conflict_group : null,
    mutually_exclusive_with: Array.isArray(config.mutually_exclusive_with)
      ? config.mutually_exclusive_with.filter((item): item is string => typeof item === 'string')
      : [],
    specificity: typeof config.specificity === 'number' && Number.isSafeInteger(config.specificity)
      ? config.specificity
      : null,
    default_unknown: defaultUnknown === 'yellow_review'
      || defaultUnknown === 'suppress'
      || defaultUnknown === 'reject_finding'
      ? defaultUnknown
      : null,
    criteria_schema_version: typeof config.criteria_schema_version === 'number'
      && Number.isSafeInteger(config.criteria_schema_version)
      ? config.criteria_schema_version
      : null,
    message_template: isRecord(config.message_template) ? config.message_template : {},
  }
}

export interface ReviewTextPageRange {
  page: number
  start: number
  end: number
}

export interface ReviewTextChunk {
  index: number
  start: number
  end: number
  text: string
  page_start: number | null
  page_end: number | null
}

export interface FrozenReviewChunkProof {
  index: number
  total: number
  start: number
  end: number
  hash: string
}

export interface ResolvedReviewSourceAnchor {
  start: number
  end: number
  exactText: string
  matchField: 'source_quote'
  status: 'exact_unique_text' | 'exact_frozen_chunk'
  chunk: FrozenReviewChunkProof | null
}

export interface ResolvedFrozenChunkSourceQuote {
  start: number
  end: number
  exactText: string
  candidateText: string
  normalization: 'exact' | 'whitespace_only'
}

function projectWithoutWhitespace(value: string) {
  let projected = ''
  const projectedOffsetToSourceOffset: number[] = []
  let sourceOffset = 0

  for (const character of value) {
    const width = character.length
    if (!/\s/u.test(character)) {
      projected += character
      for (let index = 0; index < width; index += 1) {
        projectedOffsetToSourceOffset.push(sourceOffset + index)
      }
    }
    sourceOffset += width
  }

  return { projected, projectedOffsetToSourceOffset }
}

/**
 * Recover one model quote inside its immutable executor chunk. Exact text is
 * preferred. The only tolerated repair is whitespace insertion/removal, and
 * only when the projected quote occurs once in that chunk. The returned text
 * is always the real source slice, never the model's normalized rendition.
 */
export function resolveFrozenChunkSourceQuote(
  chunkText: string,
  candidateQuote?: string | null
): ResolvedFrozenChunkSourceQuote | null {
  const candidateText = candidateQuote?.trim() || ''
  if (candidateText.length < 4 || candidateText.length > 1000) return null

  const exactStart = chunkText.indexOf(candidateText)
  if (exactStart >= 0 && chunkText.lastIndexOf(candidateText) === exactStart) {
    return {
      start: exactStart,
      end: exactStart + candidateText.length,
      exactText: candidateText,
      candidateText,
      normalization: 'exact',
    }
  }

  const chunkProjection = projectWithoutWhitespace(chunkText)
  const candidateProjection = projectWithoutWhitespace(candidateText).projected
  if (candidateProjection.length < 4) return null
  const projectedStart = chunkProjection.projected.indexOf(candidateProjection)
  if (
    projectedStart < 0
    || chunkProjection.projected.lastIndexOf(candidateProjection) !== projectedStart
  ) return null

  const projectedEnd = projectedStart + candidateProjection.length
  const start = chunkProjection.projectedOffsetToSourceOffset[projectedStart]
  const finalSourceOffset = chunkProjection.projectedOffsetToSourceOffset[projectedEnd - 1]
  if (!Number.isInteger(start) || !Number.isInteger(finalSourceOffset)) return null
  const end = finalSourceOffset + 1
  const exactText = chunkText.slice(start, end)
  if (projectWithoutWhitespace(exactText).projected !== candidateProjection) return null

  return {
    start,
    end,
    exactText,
    candidateText,
    normalization: 'whitespace_only',
  }
}

/**
 * Resolve a provider quote without guessing which repeated occurrence it meant.
 * A globally unique quote is sufficient on its own. A repeated quote is only
 * accepted when the frozen executor chunk proves one exact occurrence and the
 * quote itself occurs exactly once inside that chunk. The server separately
 * verifies the chunk SHA-256 before persistence.
 */
export function resolveReviewSourceAnchor(input: {
  sourceText: string
  sourceQuote?: string | null
  sourceStart?: number | null
  sourceEnd?: number | null
  chunk?: FrozenReviewChunkProof | null
}): ResolvedReviewSourceAnchor | null {
  const exactText = input.sourceQuote?.trim() || ''
  if (exactText.length < 4 || exactText.length > 1000) return null

  const first = input.sourceText.indexOf(exactText)
  if (first < 0) return null
  if (input.sourceText.lastIndexOf(exactText) === first) {
    return {
      start: first,
      end: first + exactText.length,
      exactText,
      matchField: 'source_quote',
      status: 'exact_unique_text',
      chunk: null,
    }
  }

  const chunk = input.chunk
  if (
    !chunk
    || !Number.isInteger(chunk.index)
    || !Number.isInteger(chunk.total)
    || !Number.isInteger(chunk.start)
    || !Number.isInteger(chunk.end)
    || chunk.index < 1
    || chunk.total < chunk.index
    || chunk.start < 0
    || chunk.end <= chunk.start
    || chunk.end > input.sourceText.length
    || !/^[0-9a-f]{64}$/i.test(chunk.hash)
    || !Number.isInteger(input.sourceStart)
    || !Number.isInteger(input.sourceEnd)
    || typeof input.sourceStart !== 'number'
    || typeof input.sourceEnd !== 'number'
    || input.sourceStart < chunk.start
    || input.sourceEnd > chunk.end
    || input.sourceEnd <= input.sourceStart
    || input.sourceText.slice(input.sourceStart, input.sourceEnd) !== exactText
  ) return null

  const chunkText = input.sourceText.slice(chunk.start, chunk.end)
  const localStart = chunkText.indexOf(exactText)
  if (
    localStart < 0
    || chunkText.lastIndexOf(exactText) !== localStart
    || chunk.start + localStart !== input.sourceStart
  ) return null

  return {
    start: input.sourceStart,
    end: input.sourceEnd,
    exactText,
    matchField: 'source_quote',
    status: 'exact_frozen_chunk',
    chunk,
  }
}

/**
 * Bind a model finding by its stable rule code only inside this ReviewRun's
 * immutable frozen bundle. Snapshot UUIDs are transport provenance and are
 * derived by the server; asking a small model to copy them adds failure modes
 * without adding semantic trust. Unknown or duplicate codes remain unbound.
 */
export function resolveFrozenRuleBinding(
  risk: Pick<ReviewRiskLike, 'rule_code' | 'rule_snapshot_id'>,
  rules: PublishedReviewRule[]
): PublishedReviewRule | null {
  const ruleCode = risk.rule_code?.trim()
  if (!ruleCode) return null
  const matches = rules.filter((rule) => rule.code === ruleCode)
  return matches.length === 1 ? matches[0] : null
}

function chunkPagesForRange(
  pages: ReviewTextPageRange[],
  start: number,
  end: number
) {
  const covered = pages.filter((page) => page.end >= start && page.start < end)
  return {
    page_start: covered[0]?.page ?? null,
    page_end: covered[covered.length - 1]?.page ?? null,
  }
}

/**
 * Split long review text without silently dropping the tail. Rendered PDF page
 * boundaries are preferred; Word/provisional sources fall back to overlapping
 * character ranges. `end` is exclusive so executor offsets can be verified by
 * `sourceText.slice(start, end)`.
 */
export function splitReviewTextIntoChunks(
  sourceText: string,
  pageRanges: ReviewTextPageRange[] = [],
  options: {
    maxChars?: number
    maxPages?: number
    overlapChars?: number
    overlapPages?: number
  } = {}
): ReviewTextChunk[] {
  if (!sourceText) return []
  // v23 raised the measured Qwen envelope to 60s and the transport now drops
  // unanchored candidates before checkpointing. Restore the 1500-char bound so
  // a long Word contract does not pay the fixed 15-rule prompt cost in 22 tiny
  // calls; callers may still choose a larger bound for non-model workflows.
  const maxChars = Math.max(1000, options.maxChars ?? 1500)
  const maxPages = Math.max(1, options.maxPages ?? 8)
  const overlapChars = Math.min(maxChars - 1, Math.max(0, options.overlapChars ?? 200))
  const overlapPages = Math.min(maxPages - 1, Math.max(0, options.overlapPages ?? 1))
  const pages = pageRanges
    .filter((page) => (
      Number.isInteger(page.page)
      && Number.isInteger(page.start)
      && Number.isInteger(page.end)
      && page.start >= 0
      && page.end >= page.start
      && page.start < sourceText.length
    ))
    .map((page) => ({ ...page, end: Math.min(page.end, sourceText.length - 1) }))
    .sort((left, right) => left.start - right.start)

  const pagesAreUsable = pages.length > 1
    && pages.every((page, index) => index === 0 || page.start > pages[index - 1].start)
    && pages.every((page) => page.end - page.start + 1 <= maxChars)

  if (pagesAreUsable) {
    const chunks: ReviewTextChunk[] = []
    let pageIndex = 0
    while (pageIndex < pages.length) {
      const first = pageIndex
      let last = first
      while (last + 1 < pages.length && last - first + 1 < maxPages) {
        const candidateEnd = pages[last + 1].end + 1
        if (candidateEnd - pages[first].start > maxChars) break
        last += 1
      }
      const start = pages[first].start
      const end = pages[last].end + 1
      chunks.push({
        index: chunks.length + 1,
        start,
        end,
        text: sourceText.slice(start, end),
        page_start: pages[first].page,
        page_end: pages[last].page,
      })
      if (last >= pages.length - 1) break
      const next = Math.max(first + 1, last - overlapPages + 1)
      pageIndex = next
    }
    return chunks
  }

  const chunks: ReviewTextChunk[] = []
  let start = 0
  while (start < sourceText.length) {
    let end = Math.min(sourceText.length, start + maxChars)
    if (end < sourceText.length) {
      const boundary = sourceText.lastIndexOf('\n', end - 1)
      if (boundary >= start + Math.floor(maxChars / 2)) end = boundary + 1
    }
    const pageSpan = chunkPagesForRange(pages, start, end)
    chunks.push({
      index: chunks.length + 1,
      start,
      end,
      text: sourceText.slice(start, end),
      ...pageSpan,
    })
    if (end >= sourceText.length) break
    start = Math.max(start + 1, end - overlapChars)
  }
  return chunks
}

export interface SourceAnchor {
  page: number
  start: number
  end: number
  clause_ref: string | null
  excerpt: string
  exact_text: string
  locator: 'rendered' | 'provisional'
  precision?: 'line' | 'page' | 'source_exact' | 'provisional'
  boxes?: SourceAnchorBox[]
}

export interface SourceAnchorBox {
  left: number
  top: number
  width: number
  height: number
  text?: string
}

export interface RenderedSourcePage {
  page: number
  start: number
  end: number
  locator: 'rendered' | 'provisional'
  line_boxes?: Array<SourceAnchorBox & { start: number; end: number }>
}

export interface PublishedResolutionOption {
  id: string
  rule_snapshot_id: string
  rule_code: string
  rule_name: string
  level: 'A' | 'B' | 'C'
  label: string
  description: string | null
  action: string
  action_type: string
  comment_template: string | null
  negotiation_guidance: string | null
  bottom_line: string | null
  change_mode: 'comment' | 'tracked_revision'
  revision_text: string | null
  consistency_key: string | null
  conflict_group: string | null
  mutually_exclusive_with: string[]
}

export interface DecisionDraftLike {
  risk_id: string
  risk_title?: string | null
  decision_kind?: DecisionKind | null
  negotiation_result?: DecisionKind | null
  selected_option_id?: string | null
  selected_option_snapshot?: PublishedResolutionOption | null
  resolution_strategy_id?: string | null
  resolution_strategy_snapshot?: PublishedResolutionOption | null
  feedback?: string | null
  customer_comment?: string | null
  revision_text?: string | null
  source_anchor?: SourceAnchor | null
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
}

export type DecisionReviewOutcome = 'resolved' | 'still_open' | 'needs_revision'

export interface DecisionReviewEvaluation {
  outcome: DecisionReviewOutcome
  workflow_state: 'REVIEW_PASSED' | 'NEEDS_REVISION'
  reason: string
}

/**
 * Evaluate one immutable risk against its frozen sales decision. A completed
 * worker is only an execution fact; it is never treated as a passed review.
 */
export function evaluateDecisionReviewOutcome(input: {
  draft?: DecisionDraftLike | null
  modelCompleted: boolean
  modelDegraded?: boolean
  hasModelConflict?: boolean
  hasConfiguredConflict?: boolean
  priorOutcome?: DecisionReviewOutcome | null
}): DecisionReviewEvaluation {
  const draft = input.draft
  if (!input.modelCompleted) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '模型复审未完成，保留风险并允许重试。' }
  }
  if (input.modelDegraded) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '复审发生模型降级，不能作为逐风险通过证据。' }
  }
  if (input.hasModelConflict) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '模型逐风险复审仍发现未解决问题。' }
  }
  if (input.hasConfiguredConflict) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '发布规则配置检测到跨条款冲突。' }
  }
  if (!draft && input.priorOutcome === 'resolved') {
    return { outcome: 'resolved', workflow_state: 'REVIEW_PASSED', reason: '上一轮逐风险复审已通过，本轮未提交新的处理结论。' }
  }
  if (
    !draft?.source_anchor?.exact_text
    || !(
      draft.source_anchor.locator === 'rendered'
      || draft.source_anchor.precision === 'source_exact'
    )
  ) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '缺少可验证的原文精确证据，不能确认处理结论。' }
  }

  const strategy = draft.resolution_strategy_snapshot || draft.selected_option_snapshot || null
  const result = draft.negotiation_result || draft.decision_kind || null
  if (!result) return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '谈判结果未记录。' }
  if (result === 'exception_requested') {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '特批保留原风险，等待审批结论。' }
  }
  if (result === 'customer_feedback') {
    return { outcome: 'still_open', workflow_state: 'NEEDS_REVISION', reason: '客户反馈需要新一轮策略或文本确认。' }
  }
  if (!strategy) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '客户已同意，但缺少可执行的已发布法务策略。' }
  }
  if (/block|escalate|reject/i.test(strategy.action || '')) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '阻断或上报策略不能因任务完成而自动通过。' }
  }

  const hasControlledOutput = strategy.change_mode === 'tracked_revision'
    ? Boolean(draft.revision_text?.trim() && draft.source_anchor.exact_text.trim())
    : Boolean(sanitizeCustomerFacingText(draft.customer_comment))
  if (!hasControlledOutput) {
    return { outcome: 'needs_revision', workflow_state: 'NEEDS_REVISION', reason: '缺少受控修订或安全的客户侧批注。' }
  }

  return { outcome: 'resolved', workflow_state: 'REVIEW_PASSED', reason: '已发布策略、客户同意和受控对外内容均经复审确认。' }
}

/**
 * Build the decision-aware model input without leaking draft ids, UUIDs,
 * source offsets, internal notes or runtime logs into the prompt.
 */
export function buildDecisionReviewModelInput(sourceText: string, decisions: DecisionDraftLike[]) {
  const safeDecisions = decisions.map((draft, index) => {
    const option = draft.resolution_strategy_snapshot || draft.selected_option_snapshot || null
    const result = draft.negotiation_result || draft.decision_kind || null
    return {
      item: index + 1,
      source_evidence: draft.source_anchor?.exact_text || draft.source_anchor?.excerpt || '',
      clause: draft.source_anchor?.clause_ref || null,
      published_option: option ? {
        label: option.label,
        action: option.action,
        change_mode: option.change_mode,
        legal_template: option.comment_template,
        revision_text: option.revision_text,
        bottom_line: option.bottom_line,
      } : null,
      negotiation_result: result,
      customer_feedback: draft.feedback?.trim() || null,
      controlled_output: option?.change_mode === 'tracked_revision'
        ? { mode: 'tracked_revision', revision_text: draft.revision_text?.trim() || null }
        : { mode: 'comment', customer_comment: sanitizeCustomerFacingText(draft.customer_comment) || null },
    }
  })

  return [
    sourceText,
    '',
    '--- 已提交销售决策（仅用于逐风险复审，不得自行改变销售处理结论）---',
    JSON.stringify(safeDecisions),
    '',
    '复审语义：合同原文是不可变证据和批注定位对象，不要求它在复审前已经被改写。negotiation_result=customer_agreed 表示客户已接受 published_option；controlled_output 是本批次准备写入源文件副本的受控批注或修订。若 comment 模式的受控批注已明确要求按所选策略和 bottom_line 整改，不得仅因上方原文仍保留原始风险就判定未解决。',
    '仅在以下情况列为未解决：所选策略本身为 block/escalate/reject；受控输出缺失、偏离或违反 bottom_line；客户反馈尚未被策略覆盖；决策之间存在冲突；或所选策略即使执行后仍无法处理该风险。不要把“原文尚未改写”单独作为冲突。',
    '逐风险输出约束：risks 只列仍未解决的提交项；每条 risk.title 必须以 [DECISION_ITEM:n] 开头，n 为上方 item 编号。若发现无法归属到单项的全局冲突，使用 [DECISION_ITEM:ALL]。若全部处理结论可通过，risks 必须为空数组。',
  ].join('\n')
}

export function decisionWorkflowState(draft?: DecisionDraftLike | null): DecisionWorkflowState {
  if (!draft) return 'OPEN'
  const strategy = draft.resolution_strategy_id || draft.selected_option_id || null
  const result = draft.negotiation_result || draft.decision_kind || null
  if (strategy && !result) return 'STRATEGY_SELECTED'
  if (!result) return 'OPEN'
  if (
    (result === 'customer_feedback' || result === 'exception_requested')
    && !draft.feedback?.trim()
  ) return 'RESULT_RECORDED'
  if (result === 'customer_agreed' && !strategy) return 'RESULT_RECORDED'
  return 'DRAFT_READY'
}

export interface DecisionConflict {
  code: 'UNRESOLVED_RISK' | 'STRATEGY_REQUIRED' | 'NEGOTIATION_RESULT_REQUIRED' | 'FEEDBACK_REQUIRED' | 'BLOCKING_OPTION_AGREED' | 'RULE_LEVEL_CONFLICT'
  risk_id: string
  risk_title: string
  page: number | null
  message: string
  related_risk_ids?: string[]
}

export function reviewStyleToStrategyCode(style: 'lenient' | 'balanced' | 'strict') {
  if (style === 'strict') return 'AGGRESSIVE' as const
  if (style === 'lenient') return 'CONSERVATIVE' as const
  return 'BALANCED' as const
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function templateLevel(record: Record<string, unknown>, level: 'a' | 'b' | 'c') {
  const levels = record.levels
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return null
  return stringValue(levels as Record<string, unknown>, `level_${level}`)
}

export function estimateSourcePage(position: number | null | undefined, textLength: number, charsPerPage = 2200) {
  if (!position || position < 1 || textLength < 1) return 1
  return Math.max(1, Math.ceil(position / charsPerPage))
}

/**
 * Document-wide coverage findings prove that a rule was absent or could not be
 * observed across the reviewed document. They are not evidence of a source
 * span and must never inherit the generic unresolved-risk fallback at page 1.
 */
export function shouldExposeRiskSourceAnchor(
  risk: Pick<ReviewRiskLike, 'position_start' | 'position_end'>,
  evidence: unknown
) {
  const normalizedEvidence = isRecord(evidence) ? evidence : {}
  if (normalizedEvidence.evidence_scope === 'document_coverage') return false

  const hasNoOffsets = risk.position_start == null && risk.position_end == null
  return !(normalizedEvidence.customer_output_eligible === false && hasNoOffsets)
}

export function buildSourceAnchor(
  text: string,
  risk: ReviewRiskLike,
  renderedPages: RenderedSourcePage[] = []
): SourceAnchor {
  const hasExplicitRange = Number.isInteger(risk.position_start)
    && Number.isInteger(risk.position_end)
    && (risk.position_start as number) >= 0
    && (risk.position_end as number) > (risk.position_start as number)
    && (risk.position_end as number) <= text.length
  if (!hasExplicitRange) {
    // An unresolved AI finding is still a real risk fact, but it is not a text
    // location. Never turn a null offset into a convincing highlight at byte 0.
    return {
      page: 1,
      start: 0,
      end: 0,
      clause_ref: risk.clause_ref || null,
      excerpt: '',
      exact_text: '',
      locator: 'provisional',
      precision: 'provisional',
      boxes: [],
    }
  }
  const start = risk.position_start as number
  const end = risk.position_end as number
  const before = Math.max(0, start - 48)
  const after = Math.min(text.length, Math.max(end, start + 1) + 96)
  const excerpt = text.slice(before, after).replace(/\s+/g, ' ').trim()
  const exactText = text.slice(start, end).replace(/\s+/g, ' ').trim()

  const renderedPage = renderedPages.find((page) => start >= page.start && start <= page.end)
  const exactNormalized = exactText.replace(/\s+/g, '')
  const overlappingBoxes = renderedPage?.line_boxes?.filter((box) => (
    box.end >= start && box.start <= Math.max(start + 1, end)
  )) || []
  const textMatchedBoxes = overlappingBoxes.length > 0 || !exactNormalized
    ? []
    : (renderedPage?.line_boxes || []).filter((box) => {
      const line = (box.text || '').replace(/\s+/g, '')
      const signature = exactNormalized.slice(0, Math.min(24, exactNormalized.length))
      return Boolean(signature && (line.includes(signature) || exactNormalized.includes(line)))
    })
  const boxes = [...overlappingBoxes, ...textMatchedBoxes].slice(0, 8).map(({ left, top, width, height, text: lineText }) => ({
    left,
    top,
    width,
    height,
    text: lineText,
  }))

  const locator = renderedPage?.locator ?? 'provisional'

  return {
    page: renderedPage?.page ?? estimateSourcePage(start, text.length),
    start,
    end,
    clause_ref: risk.clause_ref || null,
    excerpt,
    exact_text: exactText,
    locator,
    precision: boxes.length > 0
      ? 'line'
      : locator === 'rendered'
        ? 'page'
        : renderedPage
          ? 'source_exact'
          : 'provisional',
    boxes,
  }
}

function buildOption(rule: PublishedReviewRule, level: 'A' | 'B' | 'C'): PublishedResolutionOption | null {
  const template = rule.message_template || {}
  const lower = level.toLowerCase() as 'a' | 'b' | 'c'
  const label = templateLevel(template, lower)
  const action = level === 'A'
    ? rule.level_a_action
    : level === 'B'
      ? rule.level_b_action
      : rule.level_c_action

  if (!label && !action) return null

  const revisionText = sanitizeCustomerFacingText(
    stringValue(template, `level_${lower}_replacement`)
      || (level === 'A' ? stringValue(template, 'replacement_text') : null)
  ) || null
  const commentTemplate = sanitizeCustomerFacingText(
    stringValue(template, `level_${lower}_comment_template`)
      || stringValue(template, 'comment_template')
      || stringValue(template, 'comment')
      || stringValue(template, 'suggestion')
  ) || null

  return {
    id: `${rule.snapshot_id}:${level}`,
    rule_snapshot_id: rule.snapshot_id,
    rule_code: rule.code,
    rule_name: rule.name,
    level,
    label: label || action || `${rule.name} ${level}`,
    description: stringValue(template, `level_${lower}_description`) || stringValue(template, 'description'),
    action: action || 'manual_review',
    action_type: action || 'manual_review',
    comment_template: commentTemplate,
    negotiation_guidance: stringValue(template, `level_${lower}_negotiation_guidance`)
      || stringValue(template, 'negotiation_guidance')
      || stringValue(template, 'negotiation_action'),
    bottom_line: stringValue(template, `level_${lower}_bottom_line`) || stringValue(template, 'bottom_line'),
    change_mode: revisionText ? 'tracked_revision' : 'comment',
    revision_text: revisionText,
    consistency_key: rule.consistency_key || null,
    conflict_group: rule.conflict_group || null,
    mutually_exclusive_with: rule.mutually_exclusive_with || [],
  }
}

export function buildPublishedResolutionOptions(
  risk: ReviewRiskLike,
  rules: PublishedReviewRule[]
): PublishedResolutionOption[] {
  // Formal options require an immutable evidence binding. Category/name guesses are
  // intentionally excluded: an unbound risk must go back to legal for confirmation.
  const matchingRules = rules.filter((rule) => (
    risk.rule_snapshot_id && risk.rule_snapshot_id === rule.snapshot_id
  ))
  return matchingRules.flatMap((rule) => (
    (['A', 'B', 'C'] as const)
      .map((level) => buildOption(rule, level))
      .filter((option): option is PublishedResolutionOption => Boolean(option))
  ))
}

export function sanitizeCustomerFacingText(text: string | null | undefined) {
  if (!text) return ''
  if (/\{(?:risk|rule|source|model|matched|basis|level|text|id)[^}]*\}/i.test(text)) return ''
  if (/(?:本模板|本批注文案)[^。；;]*(?:配置中心|规则集|AI翻译)/i.test(text)) return ''
  return text
    .split(/\r?\n/)
    .filter((line) => !/(?:规则源|规则快照|快照|source\s*range|model\s*log|risk\s*id|rule\s*id)/i.test(line))
    .filter((line) => !/(?:^|\s)Level\s*[ABC]\b/i.test(line))
    .filter((line) => !/(?:请在\s*)?Word\s*(?:文档|批注)?中[^。；;]*(?:插入|使用|标记|标注)[^。；;]*批注|请根据实际条款文本核对本评估结果|风险等级说明/i.test(line))
    .join('\n')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/(?:rule|risk|source|model|snapshot)[-_ ]?(?:id|range|log)?\s*[:：][^\n。；;]*/gi, '')
    .replace(/(?:请在\s*)?Word\s*文档中注明条款编号\s*[A-Z]+\d+[^。；;]*[。；;]?/gi, '')
    .replace(/(?:引用\s*)?[\w.-]+\/(?:[\w.-]+\/)*[\w.-]+\s*版本\s*v?\d+(?:\.\d+){1,3}[。；;]?/gi, '')
    .replace(/\b(?:R|RULE)[-_ ]?\d{2,}\b/gi, '')
    .replace(/\{(?:risk|rule|source|model|matched|basis|level|text|id)[^}]*\}/gi, '')
    .replace(/(?:本模板|本批注文案)[^。；;]*(?:配置中心|规则集|规则|AI翻译)[^。；;]*[。；;]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function buildCommentPreview(input: {
  risk: ReviewRiskLike
  decisionKind: DecisionKind | null
  option?: PublishedResolutionOption | null
  feedback?: string | null
}) {
  return buildDecisionNotes(input).customer_comment || ''
}

export function buildDecisionNotes(input: {
  risk: ReviewRiskLike
  decisionKind: DecisionKind | null
  option?: PublishedResolutionOption | null
  feedback?: string | null
}) {
  const option = input.option
  const feedback = sanitizeCustomerFacingText(input.feedback)
  const template = sanitizeCustomerFacingText(option?.comment_template)
  const intentLabel: Record<DecisionKind, string> = {
    customer_agreed: '客户已同意',
    customer_feedback: '客户有反馈',
    exception_requested: '要求特批',
  }
  const internalNote = [
    input.decisionKind ? `谈判结果：${intentLabel[input.decisionKind]}` : '谈判结果：待销售记录',
    option ? `法务策略：${option.label}` : '法务策略：待补充或人工处理',
    feedback ? `内部反馈上下文：${feedback}` : null,
  ].filter(Boolean).join('\n')

  return {
    internal_note: internalNote,
    // Customer feedback remains internal context. Only the published legal template
    // may become a customer-facing Word comment.
    customer_comment: template || null,
  }
}

function conflictsForDraft(draft: DecisionDraftLike): DecisionConflict[] {
  const page = draft.source_anchor?.page ?? null
  const title = draft.risk_title || '未命名风险'
  const conflicts: DecisionConflict[] = []
  const result = draft.negotiation_result || draft.decision_kind || null
  const strategy = draft.resolution_strategy_snapshot || draft.selected_option_snapshot || null

  if (result === 'customer_agreed' && !strategy) {
    conflicts.push({
      code: 'STRATEGY_REQUIRED',
      risk_id: draft.risk_id,
      risk_title: title,
      page,
      message: `第 ${page || '?'} 页「${title}」尚未选择已发布解决策略。`,
    })
  }

  if (!result) {
    conflicts.push({
      code: 'NEGOTIATION_RESULT_REQUIRED',
      risk_id: draft.risk_id,
      risk_title: title,
      page,
      message: `第 ${page || '?'} 页「${title}」尚未记录谈判结果。`,
    })
  }

  if (
    (result === 'customer_feedback' || result === 'exception_requested')
    && !draft.feedback?.trim()
  ) {
    conflicts.push({
      code: 'FEEDBACK_REQUIRED',
      risk_id: draft.risk_id,
      risk_title: title,
      page,
      message: `第 ${page || '?'} 页「${title}」需要补充客户反馈或特批原因。`,
    })
  }

  if (
    result === 'customer_agreed'
    && /block|escalate|reject/i.test(strategy?.action || '')
  ) {
    conflicts.push({
      code: 'BLOCKING_OPTION_AGREED',
      risk_id: draft.risk_id,
      risk_title: title,
      page,
      message: `第 ${page || '?'} 页「${title}」选择了阻断/上报策略，不能同时标记客户已同意。`,
    })
  }

  return conflicts
}

export function inspectDecisionConflicts(
  risks: ReviewRiskLike[],
  drafts: DecisionDraftLike[]
): DecisionConflict[] {
  const draftByRisk = new Map(drafts.map((draft) => [draft.risk_id, draft]))
  const conflicts: DecisionConflict[] = []

  for (const risk of risks) {
    const draft = draftByRisk.get(risk.id)
    if (!draft) {
      conflicts.push({
        code: 'UNRESOLVED_RISK',
        risk_id: risk.id,
        risk_title: risk.title,
        page: null,
        message: `「${risk.title}」尚未处理，不能静默视为通过。`,
      })
      continue
    }
    conflicts.push(...conflictsForDraft(draft))
  }

  const consistencySelections = new Map<string, DecisionDraftLike>()
  const conflictGroupSelections = new Map<string, DecisionDraftLike>()
  for (const draft of drafts) {
    const option = draft.resolution_strategy_snapshot || draft.selected_option_snapshot
    if (!option) continue
    const consistencyKey = option.consistency_key
    const previous = consistencyKey ? consistencySelections.get(consistencyKey) : undefined
    const previousOption = previous?.resolution_strategy_snapshot || previous?.selected_option_snapshot
    if (consistencyKey && previous && previousOption?.level !== option.level) {
      conflicts.push({
        code: 'RULE_LEVEL_CONFLICT',
        risk_id: draft.risk_id,
        risk_title: draft.risk_title || '未命名风险',
        page: draft.source_anchor?.page ?? null,
        message: `一致性约束 ${consistencyKey} 在不同条款选择了互斥等级 ${previousOption?.level} / ${option.level}，请统一处理口径。`,
        related_risk_ids: [previous.risk_id, draft.risk_id],
      })
    } else if (consistencyKey && !previous) {
      consistencySelections.set(consistencyKey, draft)
    }

    const group = option.conflict_group
    const groupPrevious = group ? conflictGroupSelections.get(group) : undefined
    const currentStrategyId = draft.resolution_strategy_id || draft.selected_option_id
    const previousStrategyId = groupPrevious?.resolution_strategy_id || groupPrevious?.selected_option_id
    if (group && groupPrevious && previousStrategyId !== currentStrategyId) {
      conflicts.push({
        code: 'RULE_LEVEL_CONFLICT',
        risk_id: draft.risk_id,
        risk_title: draft.risk_title || '未命名风险',
        page: draft.source_anchor?.page ?? null,
        message: `互斥策略组 ${group} 同时选择了多个策略，请保留一个处理口径。`,
        related_risk_ids: [groupPrevious.risk_id, draft.risk_id],
      })
    } else if (group && !groupPrevious) {
      conflictGroupSelections.set(group, draft)
    }

    for (const other of drafts) {
      const otherOption = other.resolution_strategy_snapshot || other.selected_option_snapshot
      if (other.risk_id === draft.risk_id || !otherOption) continue
      const excluded = option.mutually_exclusive_with || []
      const otherStrategyId = other.resolution_strategy_id || other.selected_option_id || ''
      if (excluded.includes(otherStrategyId) || excluded.includes(otherOption.rule_code)) {
        conflicts.push({
          code: 'RULE_LEVEL_CONFLICT',
          risk_id: draft.risk_id,
          risk_title: draft.risk_title || '未命名风险',
          page: draft.source_anchor?.page ?? null,
          message: `策略「${option.label}」与「${otherOption.label}」被发布规则配置为互斥。`,
          related_risk_ids: [draft.risk_id, other.risk_id],
        })
        break
      }
    }
  }

  return conflicts
}
