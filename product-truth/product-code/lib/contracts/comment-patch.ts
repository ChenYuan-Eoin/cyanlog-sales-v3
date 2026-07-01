export type RiskLevel = 'red' | 'yellow' | 'green' | 'white'

export type RiskCardCommentSource = {
  id: string
  level: RiskLevel
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

function riskSelectedText(risk: RiskCardCommentSource) {
  return evidenceSnippets(risk.evidence)[0] || risk.title
}

function patchOffsets(risk: RiskCardCommentSource, selectedText: string) {
  const start = typeof risk.position_start === 'number' && risk.position_start >= 0
    ? risk.position_start
    : 0
  const end = typeof risk.position_end === 'number' && risk.position_end > start
    ? risk.position_end
    : start + Math.max(selectedText.length, 1)

  return { start, end }
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
      const { start, end } = patchOffsets(risk, selectedText)
      const isRed = risk.level === 'red'

      return {
        risk_id: risk.id,
        annotation: {
          contract_id: input.contractId,
          start_offset: start,
          end_offset: end,
          selected_text: selectedText,
          comment: [
            `【${isRed ? '红线风险' : '需谈判风险'}】${risk.title}`,
            risk.description ? `问题：${risk.description}` : null,
            risk.suggestion ? `建议：${risk.suggestion}` : null,
            `RiskFinding: ${risk.id}`,
          ].filter(Boolean).join('\n'),
          category: 'risk_finding',
          priority: isRed ? 'urgent' : 'high',
          status: 'open',
        },
      }
    })
}
