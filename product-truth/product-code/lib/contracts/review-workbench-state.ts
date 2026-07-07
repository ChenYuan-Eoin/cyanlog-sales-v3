import { hasUsableWordCommentAnchor } from './word-comment-anchor'

export type WorkbenchRiskSeverity = 'red' | 'yellow' | 'green' | 'white'
export type WorkbenchContractStatus = 'DRAFT' | 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | string

export type WorkbenchRiskFindingLike = {
  severity: WorkbenchRiskSeverity
  evidence?: {
    snippets?: string[]
    location_status?: string | null
  } | null
  position: {
    start: number | null
    end: number | null
  }
}

export type WorkbenchAnnotationLike = {
  selected_text: string | null
  comment: string
}

export type WorkbenchReviewRunLike = {
  status?: string | null
  skill_bundle_id?: string | null
  evidence_status?: 'snapshot_bound' | 'partial_snapshot' | 'missing_snapshot' | null
  rule_snapshot_refs?: Array<unknown> | null
  skill_bundle?: {
    production_source: {
      source_of_truth: string | null
    }
    rule_translation_ready: boolean
    rule_translation_status: string | null
    rules: {
      expected: number | null
      actual: number
      missing: string[]
    }
    second_verification_required: boolean
    official_review_allowed: boolean
    eval_status: string | null
    runtime_eval_status: string | null
  } | null
  model_policy?: {
    degraded?: boolean | null
    provider?: string | null
    last_error?: string | null
  } | null
} | null

export type WorkbenchLatestJobLike = {
  provider?: string | null
  degraded?: boolean | null
  last_error?: string | null
} | null

export type WorkbenchReviewDataLike = {
  status: WorkbenchContractStatus
  reviewRun: WorkbenchReviewRunLike
  riskFindings: WorkbenchRiskFindingLike[]
  annotations: WorkbenchAnnotationLike[]
  latestJob?: WorkbenchLatestJobLike
}

export type ReviewHealth = {
  issues: string[]
  manualRiskCount: number
  manualAnnotationCount: number
  wordUnsafeAnnotationCount: number
  degraded: boolean
  exportBlocked: boolean
}

export const evidenceStatusLabel: Record<'snapshot_bound' | 'partial_snapshot' | 'missing_snapshot', string> = {
  snapshot_bound: '已绑定规则快照',
  partial_snapshot: '部分规则缺快照',
  missing_snapshot: '缺少规则快照',
}

export function firstEvidence(risk: WorkbenchRiskFindingLike | null) {
  return risk?.evidence?.snippets?.find((snippet) => snippet.trim().length > 0) || ''
}

export function needsManualRiskLocation(risk: WorkbenchRiskFindingLike) {
  const hasEvidence = Boolean(firstEvidence(risk))
  const hasOffsets = risk.position.start !== null && risk.position.end !== null
  return risk.severity !== 'green' && (
    risk.evidence?.location_status === 'manual_required'
    || !hasEvidence
    || !hasOffsets
  )
}

export function needsManualAnnotationLocation(annotation: WorkbenchAnnotationLike) {
  return (
    !annotation.selected_text?.trim()
    || annotation.comment.includes('LocationStatus: manual_required')
    || annotation.comment.includes('【需人工定位】')
  )
}

export function hasWordUnsafeAnnotationAnchor(annotation: WorkbenchAnnotationLike) {
  const selectedText = annotation.selected_text?.trim() || ''
  if (!selectedText) return false
  return !hasUsableWordCommentAnchor(selectedText)
}

export function buildReviewHealth(data: WorkbenchReviewDataLike): ReviewHealth {
  const issues: string[] = []
  const manualRiskCount = data.riskFindings.filter(needsManualRiskLocation).length
  const manualAnnotationCount = data.annotations.filter(needsManualAnnotationLocation).length
  const wordUnsafeAnnotationCount = data.annotations.filter(hasWordUnsafeAnnotationAnchor).length

  if ((data.status === 'COMPLETED' || data.riskFindings.length > 0) && !data.reviewRun?.skill_bundle_id) {
    issues.push('缺少规则发布包绑定，不能证明结果来自已发布审核规则。')
  }
  if ((data.status === 'COMPLETED' || data.riskFindings.length > 0) && !data.reviewRun?.rule_snapshot_refs?.length) {
    issues.push('缺少规则快照引用，风险项不能追溯到配置中心规则版本。')
  }
  if (data.reviewRun?.evidence_status && data.reviewRun.evidence_status !== 'snapshot_bound') {
    issues.push(`证据状态为 ${evidenceStatusLabel[data.reviewRun.evidence_status]}。`)
  }
  if (data.reviewRun?.skill_bundle) {
    const bundle = data.reviewRun.skill_bundle
    if (bundle.production_source.source_of_truth !== 'config_center_published_rules') {
      issues.push('规则发布包未声明配置中心发布规则为生产源，不能证明审核依据来自后台规则版本。')
    }
    if (!bundle.rule_translation_ready) {
      issues.push(`规则转译状态为 ${bundle.rule_translation_status || 'missing'}，不能视为正式审核引擎已就绪。`)
    }
    if (bundle.rules.missing.length > 0 || (bundle.rules.expected !== null && bundle.rules.actual < bundle.rules.expected)) {
      issues.push(`规则发布包不完整：缺少 ${bundle.rules.missing.join('、') || '未记录规则明细'}。`)
    }
    if (!bundle.second_verification_required) {
      issues.push('规则发布包未声明二次验证要求，模型输出不能直接作为有效审核结果。')
    }
    if (!bundle.official_review_allowed) {
      issues.push('规则发布包尚未满足正式审核发布门禁，本次结果只能作为降级/复核结果。')
    }
    if (bundle.eval_status && bundle.eval_status !== 'passed') {
      issues.push(`规则发布包质量评测状态为 ${bundle.eval_status}，不能视为模型质量已验收。`)
    }
    if (bundle.runtime_eval_status === 'model_quality_eval_not_run') {
      issues.push('模型质量评测尚未运行，本次结果必须结合模型调用记录和人工复核证据验收。')
    } else if (bundle.runtime_eval_status === 'latest_review_model_invocation_local_cli') {
      issues.push('最新语义模型通过本机 LM Studio CLI 完成，能证明本地模型运行，但不能证明 OpenAI-compatible HTTP 或线上模型链已验收。')
    } else if (bundle.runtime_eval_status === 'latest_review_model_invocation_partial') {
      issues.push('最新语义模型调用只达到部分通过：存在被剔除风险或校验警告，必须查看调用链。')
    } else if (bundle.runtime_eval_status === 'latest_review_model_invocation_not_passed') {
      issues.push('最新语义模型调用未通过运行质量门禁，不能视为 AI 审核完成。')
    }
  }
  if (data.reviewRun?.status === 'DEGRADED') {
    issues.push('审核运行状态为降级，本次结果不能作为无条件审核完成。')
  }
  if (data.latestJob?.degraded || data.reviewRun?.model_policy?.degraded) {
    issues.push(`审核执行发生降级：${data.latestJob?.provider || data.reviewRun?.model_policy?.provider || '未记录执行器'}。`)
  }
  if (data.latestJob?.last_error || data.reviewRun?.model_policy?.last_error) {
    issues.push(`最近审核错误：${data.latestJob?.last_error || data.reviewRun?.model_policy?.last_error}`)
  }
  if (manualRiskCount > 0) {
    issues.push(`${manualRiskCount} 个风险项没有可验证的原文定位，不能自动写入源文件批注。`)
  }
  if (manualAnnotationCount > 0) {
    issues.push(`${manualAnnotationCount} 条 Word 批注意图需要人工定位，导出前必须处理。`)
  }
  if (wordUnsafeAnnotationCount > 0) {
    issues.push(`${wordUnsafeAnnotationCount} 条 Word 批注意图疑似跨段或证据过短，不能稳定写入源文件批注。`)
  }

  return {
    issues,
    manualRiskCount,
    manualAnnotationCount,
    wordUnsafeAnnotationCount,
    degraded: issues.length > 0,
    exportBlocked: manualRiskCount > 0 || manualAnnotationCount > 0 || wordUnsafeAnnotationCount > 0,
  }
}

export function buildExportGateIssues(data: WorkbenchReviewDataLike, reviewHealth: ReviewHealth) {
  const issues: string[] = []
  if (data.status !== 'COMPLETED') {
    issues.push('审核运行尚未完成，不能生成源文件批注版。')
  }
  if (data.annotations.length === 0 && data.riskFindings.length === 0) {
    issues.push('当前没有可写入 Word 的风险项或批注意图。')
  }
  if (reviewHealth.exportBlocked) {
    if (reviewHealth.manualRiskCount > 0) {
      issues.push(`${reviewHealth.manualRiskCount} 个风险项没有可验证的原文定位，不能自动写入源文件批注。`)
    }
    if (reviewHealth.manualAnnotationCount > 0) {
      issues.push(`${reviewHealth.manualAnnotationCount} 条 Word 批注意图需要人工定位，导出前必须处理。`)
    }
    if (reviewHealth.wordUnsafeAnnotationCount > 0) {
      issues.push(`${reviewHealth.wordUnsafeAnnotationCount} 条 Word 批注意图疑似跨段或证据过短，不能稳定写入源文件批注。`)
    }
  }
  return Array.from(new Set(issues))
}
