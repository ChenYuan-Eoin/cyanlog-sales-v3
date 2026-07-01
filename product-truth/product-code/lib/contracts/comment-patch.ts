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

function isGenericEvidence(value: string) {
  const normalized = value.trim()
  if (normalized.length < 2) return true
  return ['ONES', '书面', '合同', '有效期', '6%', '0'].includes(normalized)
}

function riskSelectedText(risk: RiskCardCommentSource) {
  return evidenceSnippets(risk.evidence)[0] || ''
}

function patchLocation(risk: RiskCardCommentSource, selectedText: string) {
  const hasOffsets = typeof risk.position_start === 'number'
    && typeof risk.position_end === 'number'
    && risk.position_start >= 0
    && risk.position_end > risk.position_start
  const hasEvidence = selectedText.trim().length > 0 && !isGenericEvidence(selectedText)
  const status = evidenceLocationStatus(risk.evidence)
  const located = hasOffsets && hasEvidence && status !== 'manual_required'

  return {
    located,
    start: located ? risk.position_start as number : 0,
    end: located ? risk.position_end as number : 0,
    reason: located
      ? 'located'
      : status === 'manual_required'
        ? 'source evidence could not be matched'
        : !hasEvidence
          ? 'missing or generic evidence_text'
          : 'missing source range',
  }
}

export function buildCommentPatchesFromRiskCards(input: {
  contractId: string
  risks: RiskCardCommentSource[]
  existingRiskIds?: Set<string>
}): CommentPatch[] {
  const existingRiskIds = input.existingRiskIds || new Set<string>()

  return input.risks
    .filter((risk) => (risk.level === 'red' || risk.level === 'yellow'))
    .filter((risk) => !risk.status || risk.status === 'open')
    .filter((risk) => !existingRiskIds.has(risk.id))
    .map((risk) => {
      const selectedText = riskSelectedText(risk)
      const location = patchLocation(risk, selectedText)
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
