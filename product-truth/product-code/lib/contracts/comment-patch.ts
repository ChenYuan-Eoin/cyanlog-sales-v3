export type RiskLevel = 'red' | 'yellow' | 'green' | 'white'

export type RiskCardCommentSource = {
  id: string
  level: RiskLevel
  rule_id?: string | null
  rule_code?: string | null
  rule_version?: number | null
  title: string
  description?: string | null
  suggestion?: string | null
  evidence?: unknown
  status?: string | null
  position_start?: number | null
  position_end?: number | null
}

export type ContractAnnotationDraft = {
  contract_id: string
  start_offset: number
  end_offset: number
  selected_text: string
  comment: string
  category: 'risk_finding'
  priority: 'high' | 'urgent'
  status: 'open'
}

export type CommentPatch = {
  risk_id: string
  annotation: ContractAnnotationDraft
}

type SelectedEvidenceAnchor = {
  text: string
  start: number | null
  end: number | null
}

type PatchLocation = {
  located: boolean
  start: number
  end: number
  reason: string
}

export function extractRiskFindingId(comment: string | null | undefined) {
  if (!comment) return null
  const match = comment.match(/\bRiskFinding:\s*([0-9a-fA-F-]{8,})\b/)
  return match?.[1] || null
}

function evidenceSnippets(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== 'object') return []
  const snippets = (evidence as { snippets?: unknown }).snippets
  if (!Array.isArray(snippets)) return []
  return snippets.filter((snippet): snippet is string => (
    typeof snippet === 'string' && snippet.trim().length > 0
  ))
}

function evidenceRecord(evidence: unknown): Record<string, unknown> {
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence as Record<string, unknown>
    : {}
}

function evidenceLocationStatus(evidence: unknown): string {
  const status = evidenceRecord(evidence).location_status
  return typeof status === 'string' ? status : ''
}

function evidenceRuleSnapshotId(evidence: unknown): string | null {
  const snapshotId = evidenceRecord(evidence).rule_snapshot_id
  return typeof snapshotId === 'string' && snapshotId.trim() ? snapshotId : null
}

function evidenceSourceRange(evidence: unknown): { start: number; end: number } | null {
  const sourceRange = evidenceRecord(evidence).source_range
  if (!sourceRange || typeof sourceRange !== 'object' || Array.isArray(sourceRange)) return null
  const record = sourceRange as Record<string, unknown>
  return typeof record.start === 'number' && typeof record.end === 'number' && record.end > record.start
    ? { start: record.start, end: record.end }
    : null
}

function isGenericEvidence(value: string) {
  const normalized = value.trim()
  if (normalized.length < 2) return true
  return ['ONES', '书面', '合同', '有效期', '6%', '0'].includes(normalized)
}

function normalizeForScore(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[，。；：、,.!?！？;:（）()【】\[\]《》"“”'‘’]/g, '')
    .toLowerCase()
}

function keywordTokens(risk: RiskCardCommentSource) {
  return [risk.title, risk.description, risk.suggestion]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(/[\s/|,，。；：:、()（）【】《》"'“”‘’-]+/))
    .map(normalizeForScore)
    .filter((value) => value.length >= 2 && value.length <= 12)
}

function evidenceSegments(snippet: string) {
  const segments: string[] = []
  for (const line of snippet.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sentenceParts = trimmed
      .split(/(?<=[。；;])/)
      .map((part) => part.trim())
      .filter(Boolean)
    segments.push(...(sentenceParts.length > 0 ? sentenceParts : [trimmed]))
  }
  return segments.filter((segment) => (
    segment.length >= 6
    && segment.length <= 120
    && !isGenericEvidence(segment)
  ))
}

function segmentScore(segment: string, tokens: string[]) {
  const normalizedSegment = normalizeForScore(segment)
  const tokenScore = tokens.reduce((score, token) => (
    normalizedSegment.includes(token) ? score + Math.min(token.length, 6) : score
  ), 0)
  const clauseSignal = /^第.+[条章节款项]/.test(segment.trim()) ? 4 : 0
  const lengthPenalty = Math.max(0, segment.length - 60) / 20
  return tokenScore + clauseSignal - lengthPenalty
}

function riskSelectedEvidence(risk: RiskCardCommentSource): SelectedEvidenceAnchor {
  const snippet = evidenceSnippets(risk.evidence)[0] || ''
  if (!snippet.trim()) return { text: '', start: null, end: null }

  const tokens = keywordTokens(risk)
  const segments = evidenceSegments(snippet)
  const selectedText = (segments.length > 0
    ? segments
      .map((segment) => ({ segment, score: segmentScore(segment, tokens) }))
      .sort((left, right) => right.score - left.score || left.segment.length - right.segment.length)[0]?.segment
    : null) || snippet.trim()

  const range = evidenceSourceRange(risk.evidence)
  const relativeStart = snippet.indexOf(selectedText)
  if (range && relativeStart >= 0) {
    return {
      text: selectedText,
      start: range.start + relativeStart,
      end: range.start + relativeStart + selectedText.length,
    }
  }

  return {
    text: selectedText,
    start: typeof risk.position_start === 'number' ? risk.position_start : null,
    end: typeof risk.position_end === 'number' ? risk.position_end : null,
  }
}

function sourceRangeTextMatches(
  selectedEvidence: SelectedEvidenceAnchor,
  sourceText?: string
): { matched: boolean; reason: string | null } {
  if (!sourceText) return { matched: true, reason: null }
  if (typeof selectedEvidence.start !== 'number' || typeof selectedEvidence.end !== 'number') {
    return { matched: false, reason: 'missing source range' }
  }

  const actualText = sourceText.slice(selectedEvidence.start, selectedEvidence.end)
  if (actualText === selectedEvidence.text) return { matched: true, reason: null }

  return { matched: false, reason: 'source range text mismatch' }
}

function patchLocation(
  selectedEvidence: SelectedEvidenceAnchor,
  evidence: unknown,
  sourceText?: string
): PatchLocation {
  const hasOffsets = typeof selectedEvidence.start === 'number'
    && typeof selectedEvidence.end === 'number'
    && selectedEvidence.start >= 0
    && selectedEvidence.end > selectedEvidence.start
  const hasEvidence = selectedEvidence.text.trim().length > 0 && !isGenericEvidence(selectedEvidence.text)
  const status = evidenceLocationStatus(evidence)
  const sourceRangeMatch = hasOffsets && hasEvidence && status !== 'manual_required'
    ? sourceRangeTextMatches(selectedEvidence, sourceText)
    : { matched: true, reason: null }
  const located = hasOffsets && hasEvidence && status !== 'manual_required' && sourceRangeMatch.matched

  return {
    located,
    start: located ? selectedEvidence.start as number : 0,
    end: located ? selectedEvidence.end as number : 0,
    reason: located
      ? 'located'
      : status === 'manual_required'
        ? 'source evidence could not be matched'
        : !hasEvidence
          ? 'missing or generic evidence_text'
          : sourceRangeMatch.reason || 'missing source range',
  }
}

export function buildCommentPatchesFromRiskCards(input: {
  contractId: string
  risks: RiskCardCommentSource[]
  existingRiskIds?: Set<string>
  sourceText?: string
}): CommentPatch[] {
  const existingRiskIds = input.existingRiskIds || new Set<string>()

  return input.risks
    .filter((risk) => (risk.level === 'red' || risk.level === 'yellow'))
    .filter((risk) => !risk.status || risk.status === 'open')
    .filter((risk) => !existingRiskIds.has(risk.id))
    .map((risk) => {
      const selectedEvidence = riskSelectedEvidence(risk)
      const selectedText = selectedEvidence.text
      const location = patchLocation(selectedEvidence, risk.evidence, input.sourceText)
      const isRed = risk.level === 'red'
      const ruleSnapshotId = evidenceRuleSnapshotId(risk.evidence)

      return {
        risk_id: risk.id,
        annotation: {
          contract_id: input.contractId,
          start_offset: location.start,
          end_offset: location.end,
          selected_text: location.located ? selectedText : '',
          comment: [
            `【${location.located ? (isRed ? '红线风险' : '需谈判风险') : '需人工定位'}】${risk.title}`,
            risk.description ? `问题：${risk.description}` : null,
            risk.suggestion ? `建议：${risk.suggestion}` : null,
            location.located ? `证据原文：${selectedText}` : `定位状态：需人工定位（${location.reason}）`,
            risk.rule_code ? `规则：${risk.rule_code}${risk.rule_version ? ` v${risk.rule_version}` : ''}` : null,
            ruleSnapshotId ? `RuleSnapshot: ${ruleSnapshotId}` : null,
            location.located ? `SourceRange: ${location.start}-${location.end}` : 'LocationStatus: manual_required',
            `RiskFinding: ${risk.id}`,
          ].filter(Boolean).join('\n'),
          category: 'risk_finding',
          priority: isRed ? 'urgent' : 'high',
          status: 'open',
        },
      }
    })
}
