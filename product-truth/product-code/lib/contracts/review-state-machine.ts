export type ContractReviewStatus = 'DRAFT' | 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | string

export type ReviewWorkflowPhase =
  | 'draft_missing_source'
  | 'uploaded_ready'
  | 'review_running'
  | 'review_failed'
  | 'review_completed_ready'
  | 'review_completed_blocked'
  | 'review_completed_hydrating'
  | 'unknown'

export type ReviewWorkflowAction =
  | 'supply_source'
  | 'start_review'
  | 'continue_review'
  | 'retry_review'
  | 'rerun_review'
  | 'export_comments'
  | 'inspect_export_gate'
  | 'open_workbench'

export type ReviewStateInput = {
  status: ContractReviewStatus
  hasSourceAsset?: boolean
  hasReviewArtifacts?: boolean
  exportReady?: boolean
  exportBlockedReasons?: string[]
  payloadScope?: 'summary' | 'full'
  reviewRunId?: string | null
}

export type ReviewWorkflowState = {
  phase: ReviewWorkflowPhase
  primaryAction: ReviewWorkflowAction
  statusLabel: string
  nextActionLabel: string
  nextActionDescription: string
  primaryButtonLabel: string
  detailPanel: 'review' | 'evidence'
  canStartReview: boolean
  canExportComments: boolean
  shouldShowProgress: boolean
  exportBlockedReasons: string[]
}

function normalizeReasons(reasons: string[] | undefined) {
  return Array.from(new Set((reasons || []).map((reason) => reason.trim()).filter(Boolean)))
}

export function deriveReviewWorkflowState(input: ReviewStateInput): ReviewWorkflowState {
  const status = input.status
  const hasSourceAsset = Boolean(input.hasSourceAsset)
  const hasReviewArtifacts = Boolean(input.hasReviewArtifacts)
  const exportBlockedReasons = normalizeReasons(input.exportBlockedReasons)
  const isSummaryPayload = input.payloadScope === 'summary'

  if (status === 'DRAFT' && !hasSourceAsset) {
    return {
      phase: 'draft_missing_source',
      primaryAction: 'supply_source',
      statusLabel: '缺少源文件',
      nextActionLabel: '补充审核源文件',
      nextActionDescription: '先上传合同源文件，再创建 ReviewRun。',
      primaryButtonLabel: '补充审核源文件',
      detailPanel: 'review',
      canStartReview: false,
      canExportComments: false,
      shouldShowProgress: false,
      exportBlockedReasons,
    }
  }

  if (status === 'PENDING' || (status === 'DRAFT' && hasSourceAsset)) {
    return {
      phase: 'uploaded_ready',
      primaryAction: 'start_review',
      statusLabel: '已上传',
      nextActionLabel: '发起审核',
      nextActionDescription: '源文件已登记，下一步创建 ReviewRun 并进入规则与模型审核。',
      primaryButtonLabel: '发起审核',
      detailPanel: 'review',
      canStartReview: hasSourceAsset,
      canExportComments: false,
      shouldShowProgress: false,
      exportBlockedReasons,
    }
  }

  if (status === 'PARSING' || status === 'ANALYZING') {
    return {
      phase: 'review_running',
      primaryAction: 'continue_review',
      statusLabel: status === 'PARSING' ? '解析中' : '审核中',
      nextActionLabel: '查看进度',
      nextActionDescription: '回到当前 ReviewRun，查看解析、模型调用、规则和批注意图进度。',
      primaryButtonLabel: '审核中',
      detailPanel: 'review',
      canStartReview: false,
      canExportComments: false,
      shouldShowProgress: true,
      exportBlockedReasons,
    }
  }

  if (status === 'FAILED') {
    return {
      phase: 'review_failed',
      primaryAction: 'retry_review',
      statusLabel: '审核失败',
      nextActionLabel: '问题复核',
      nextActionDescription: '查看失败原因、模型调用和规则证据后再次发起审核。',
      primaryButtonLabel: '再次审核',
      detailPanel: 'evidence',
      canStartReview: hasSourceAsset,
      canExportComments: false,
      shouldShowProgress: false,
      exportBlockedReasons,
    }
  }

  if (status === 'COMPLETED') {
    if (isSummaryPayload) {
      return {
        phase: 'review_completed_hydrating',
        primaryAction: 'inspect_export_gate',
        statusLabel: '审核完成',
        nextActionLabel: '检查批注准备',
        nextActionDescription: '正在补齐规则快照、SkillBundle、模型调用和批注导出门禁。',
        primaryButtonLabel: '检查导出准备',
        detailPanel: 'review',
        canStartReview: true,
        canExportComments: false,
        shouldShowProgress: false,
        exportBlockedReasons,
      }
    }

    if (input.exportReady) {
      return {
        phase: 'review_completed_ready',
        primaryAction: 'export_comments',
        statusLabel: '审核完成',
        nextActionLabel: '导出批注版',
        nextActionDescription: '审核证据和批注意图已满足门禁，可生成源文件 Word 原生批注版。',
        primaryButtonLabel: '导出批注版',
        detailPanel: 'review',
        canStartReview: true,
        canExportComments: true,
        shouldShowProgress: false,
        exportBlockedReasons,
      }
    }

    return {
      phase: 'review_completed_blocked',
      primaryAction: 'inspect_export_gate',
      statusLabel: exportBlockedReasons.length > 0 ? '审核完成（待复核）' : '审核完成',
      nextActionLabel: hasReviewArtifacts ? '处理批注门禁' : '查看审核结果',
      nextActionDescription: exportBlockedReasons[0] || '审核已完成，但还不能证明源文件批注版已可导出。',
      primaryButtonLabel: hasReviewArtifacts ? '查看导出原因' : '查看审核结果',
      detailPanel: 'review',
      canStartReview: true,
      canExportComments: false,
      shouldShowProgress: false,
      exportBlockedReasons,
    }
  }

  return {
    phase: 'unknown',
    primaryAction: 'open_workbench',
    statusLabel: String(status || '未知状态'),
    nextActionLabel: '打开工作台',
    nextActionDescription: '查看当前合同的版本、审核和输出状态。',
    primaryButtonLabel: '打开工作台',
    detailPanel: 'review',
    canStartReview: false,
    canExportComments: false,
    shouldShowProgress: false,
    exportBlockedReasons,
  }
}
