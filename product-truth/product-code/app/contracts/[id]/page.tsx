'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BotIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
  UploadIcon,
  WorkflowIcon,
  XCircleIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { buildCustomerFacingWordComment } from '@/lib/contracts/comment-patch'
import { deriveReviewWorkflowState } from '@/lib/contracts/review-state-machine'
import {
  buildExportGateIssues,
  buildReviewHealth,
  evidenceStatusLabel,
  firstEvidence,
  needsManualAnnotationLocation,
  needsManualRiskLocation,
} from '@/lib/contracts/review-workbench-state'
import { reviewStyleStrategy, type ReviewStyle } from '@/lib/contracts/review-style'
import {
  buildContractWorkbenchPanelHref,
  normalizeContractWorkbenchPanel,
  type ContractWorkbenchPanel,
} from '@/lib/contracts/review-navigation'
import { SourceDocumentPreview, type SourceDocumentPreviewFile } from '@/components/contracts/source-document-preview'
import { error as toastError, success as toastSuccess } from '@/lib/toast'

type ContractStatus = 'DRAFT' | 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED'
type RiskSeverity = 'red' | 'yellow' | 'green' | 'white'
type SidePanelMode = ContractWorkbenchPanel
type RiskFilter = 'all' | RiskSeverity
type CustomerFeedbackStatus = 'needs_customer_confirmation' | 'accepted' | 'rejected' | 'special_approval'
type ExportDownload = {
  url: string
  filename: string
  createdAt: string
  reused: boolean
  versionNumber: string
} | null
type ExportPhase = 'idle' | 'checking' | 'generating' | 'downloading'

type ContractVersion = {
  id: string
  version_number: number
  source: 'original' | 'review_revision' | 'manual_revision'
  storage_path: string
  file_url?: string | null
  file_size: number | null
  mime_type: string | null
  parent_version_id: string | null
  change_summary: string | null
  review_id: string | null
  created_at: string | null
}

type ReviewRun = {
  id: string
  status: string
  contract_version_id: string | null
  skill_bundle_id: string
  rule_snapshot_id: string
  model_policy_id: string
  started_at: string | null
  completed_at: string | null
  evidence_status?: 'snapshot_bound' | 'partial_snapshot' | 'missing_snapshot'
  rule_snapshot_refs?: Array<{
    id: string
    rule_id: string
    rule_code: string | null
    version: number | null
    engine_type: string | null
    released_at: string | null
    source: 'published_snapshot'
  }>
  skill_bundle?: {
    id: string
    version: number | null
    status: string | null
    published_at: string | null
    compiled_hash: string | null
    production_source: {
      owner: string | null
      source_of_truth: string | null
      rules_table: string | null
      snapshot_table: string | null
      precedence: string | null
    }
    external_source: {
      repo: string | null
      commit: string | null
      version: string | null
      product_override: string | null
    }
    rules: {
      expected: number | null
      actual: number
      missing: string[]
    }
    references: string[]
    output_schema_version: string | null
    second_verification_required: boolean
    comment_author: string | null
    rule_translation_status: string | null
    rule_translation_ready: boolean
    rule_translation_blocking_reasons: string[]
    official_review_allowed: boolean
    rule_acceptance_status: string | null
    model_quality_eval_status: string | null
    runtime_invocation_status: string | null
    eval_gate: string | null
    eval_note: string | null
    eval_total_cases: number | null
    eval_passed_cases: number | null
    eval_failed_cases: string[]
  } | null
  model_policy?: {
    id: string
    provider: string
    source: 'model_policies' | 'analysis_job.provider' | 'fallback'
    model?: string | null
    phase?: string | null
    provider_kind?: string | null
    transport?: string | null
    latency_ms?: number | null
    actual_provider_profile?: string | null
    actual_provider_model?: string | null
    intended_provider_profile?: string | null
    intended_provider_model?: string | null
    requested_provider_profile?: string | null
    requested_provider_model?: string | null
    requested_provider_accepted?: boolean | null
    attempt_error_count?: number | null
    degraded: boolean
    status: string | null
    last_error: string | null
    invocation_id?: string | null
    fallback_reason?: string | null
  }
  model_invocations?: Array<{
    id: string
    phase: string | null
    provider: string | null
    model: string | null
    status: string | null
    degraded: boolean
    transport: string | null
    provider_kind: string | null
    latency_ms: number | null
    actual_provider_profile: string | null
    actual_provider_model: string | null
    intended_provider_profile: string | null
    intended_provider_model: string | null
    requested_provider_profile: string | null
    requested_provider_model: string | null
    requested_provider_accepted: boolean | null
    dropped_risk_count: number | null
    validation_warning_count: number | null
    attempt_error_count: number | null
    attempt_errors: string[]
    fallback_reason: string | null
    error_message: string | null
    created_at: string | null
  }>
}

type RiskFinding = {
  id: string
  rule_id: string | null
  rule_code: string | null
  rule_version: number | null
  severity: RiskSeverity
  title: string
  description: string
  suggestion: string
  evidence?: {
    snippets?: string[]
    counterparty?: string | null
    source_range?: {
      start?: number | null
      end?: number | null
    } | null
    location_status?: string | null
    location_reason?: string | null
    rule_snapshot_id?: string | null
  }
  fix_action?: {
    control_note?: string | null
    proposed_value?: string | null
    control_status?: string | null
    customer_feedback_status?: CustomerFeedbackStatus | string | null
  } | null
  status: string
  clause_ref: string | null
  position: {
    start: number | null
    end: number | null
  }
}

type Annotation = {
  id: string
  start_offset: number
  end_offset: number
  selected_text: string | null
  comment: string
  category: string | null
  priority: string | null
  status: string
  created_at: string | null
}

type NegotiationTask = {
  id: string
  source: 'ask' | 'risk_card_suggestion'
  ask_code: string | null
  risk_id: string | null
  required: boolean
  owner_role: string
  status: string
  title: string
  objective: string
  standard: string | null
  response: {
    responder_name: string
    responder_role: string
    response_text: string
    created_at: string | null
  } | null
  closed_reason: string | null
}

type ReportVersion = {
  id: string
  version: number
  trigger_event: string
  trigger_ask_id: string | null
  report_data: {
    summary?: {
      total?: number
      pending?: number
      responded?: number
      closed?: number
    }
  } | null
  report_file_url: string | null
  is_current: boolean
  created_at: string | null
}

type WorkbenchData = {
  id: string
  filename: string
  title?: string | null
  status: ContractStatus
  storage_path?: string
  file_url?: string | null
  size?: number
  mime_type?: string
  parsed_text?: string | null
  created_at?: string
  updated_at?: string
  stats?: {
    total: number
    red: number
    yellow: number
    green: number
    open: number
  }
  reviewRun: ReviewRun | null
  riskFindings: RiskFinding[]
  negotiationTasks: NegotiationTask[]
  annotations: Annotation[]
  versions: ContractVersion[]
  outputs: ContractVersion[]
  currentReport?: ReportVersion | null
  reportVersions?: ReportVersion[]
  latestReview?: {
    results?: {
      summary?: string
    }
  } | null
  latestJob?: {
    status?: string
    provider?: string | null
    degraded?: boolean
    last_error?: string | null
  } | null
  payload_scope?: 'summary' | 'full'
}

const statusMap: Record<ContractStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: '草稿', variant: 'secondary' },
  PENDING: { label: '待审核', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}

const riskTone: Record<RiskSeverity, { label: string; className: string; badge: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  red: { label: '红线', className: 'border-red-200 bg-red-50 text-red-900', badge: 'destructive' },
  yellow: { label: '需谈判', className: 'border-amber-200 bg-amber-50 text-amber-900', badge: 'secondary' },
  green: { label: '通过', className: 'border-emerald-200 bg-emerald-50 text-emerald-900', badge: 'outline' },
  white: { label: '提示', className: 'border-slate-200 bg-slate-50 text-slate-800', badge: 'outline' },
}

const modelPolicySourceLabel: Record<NonNullable<ReviewRun['model_policy']>['source'], string> = {
  model_policies: '已发布模型策略',
  'analysis_job.provider': '分析任务记录',
  fallback: '规则兜底',
}

function reviewVersionSourceLabel(source: ContractVersion['source']) {
  if (source === 'original') return '源文件'
  if (source === 'manual_revision') return '客户/人工版本'
  return '批注版'
}

function pickReviewSourcePreviewFile(data: WorkbenchData): SourceDocumentPreviewFile | null {
  const sourceVersion = [...data.versions]
    .filter((version) => version.source === 'original' || version.source === 'manual_revision')
    .sort((a, b) => b.version_number - a.version_number)[0]

  if (sourceVersion) {
    return {
      label: `v${sourceVersion.version_number} · ${reviewVersionSourceLabel(sourceVersion.source)} · ${data.filename}`,
      fileUrl: sourceVersion.file_url || null,
      mimeType: sourceVersion.mime_type || data.mime_type || null,
      storagePath: sourceVersion.storage_path || null,
    }
  }

  if (data.file_url || data.storage_path) {
    return {
      label: data.filename || data.title || '合同源文件',
      fileUrl: data.file_url || null,
      mimeType: data.mime_type || null,
      storagePath: data.storage_path || null,
    }
  }

  return null
}

const modelTransportLabel: Record<string, string> = {
  openai_compatible_http: 'OpenAI-compatible HTTP',
  lm_studio_cli: 'LM Studio CLI',
  builtin_rule_engine: '规则引擎',
  manual_fallback: '人工兜底',
}

const ruleSourceLabel: Record<string, string> = {
  config_center_published_rules: '配置中心发布规则',
}

const lifecycleLabel: Record<string, string> = {
  ready: '已就绪',
  passed: '已通过',
  completed: '已完成',
  running: '执行中',
  failed: '失败',
  pending: '等待中',
  latest_review_model_invocation_passed: '最近模型复核已通过',
  latest_review_model_invocation_partial: '最近模型复核部分通过',
  latest_review_model_invocation_not_passed: '最近模型复核未通过',
  latest_review_model_invocation_local_cli: '最近由本地模型完成',
  semantic_invocation_not_recorded: '本次未记录语义模型调用',
  blocked_without_independent_gold: '缺少独立金标，尚未验收',
}

const invocationPhaseLabel: Record<string, string> = {
  structured_rules: '结构化规则扫描',
  semantic_review: '语义模型复核',
}

const providerTargetLabel: Record<string, string> = {
  local_primary: '本地模型优先',
  sales_cloud_backup: '云端增强模型',
  AI_LEVEL_1: '本地模型',
  AI_LEVEL_2: '云端增强模型',
  'rule-engine': '规则引擎',
}

const reportTriggerLabel: Record<string, string> = {
  initial_generate: '初始报告',
  ask_responded: 'ASK 回应',
  ask_reopened: 'ASK 重开',
  ask_closed: 'ASK 关闭',
  standard_marked: '标准合同标记',
  customer_version_received: '客户回传版本再审核',
}

function formatTime(value?: string | null) {
  if (!value) return '未记录'
  return new Date(value).toLocaleString('zh-CN')
}

function formatSize(value?: number | null) {
  if (!value) return '未记录'
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function formatLatency(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未记录'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function formatTransport(value?: string | null) {
  if (!value) return '未记录'
  return modelTransportLabel[value] || value
}

function formatBooleanState(value?: boolean | null) {
  if (value === true) return '是'
  if (value === false) return '否'
  return '未记录'
}

function formatLifecycle(value?: string | null) {
  if (!value) return '未记录'
  return lifecycleLabel[value] || value
}

function formatRuleSource(value?: string | null) {
  if (!value) return '未记录'
  return ruleSourceLabel[value] || value
}

function formatInvocationPhase(value?: string | null) {
  if (!value) return '未记录'
  return invocationPhaseLabel[value] || value
}

function formatProviderTarget(value?: string | null) {
  if (!value) return '未记录'
  return providerTargetLabel[value] || value
}

function formatExecutor(value?: string | null) {
  if (!value) return '未记录'
  return value.split('+').map((part) => formatProviderTarget(part)).join(' + ')
}

function extractApiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const source = payload as { error?: unknown }
    if (typeof source.error === 'string') return source.error
    if (source.error && typeof source.error === 'object') {
      const detail = source.error as { message?: unknown }
      if (typeof detail.message === 'string') return detail.message
    }
  }
  return fallback
}

function riskControlNoteValue(risk: RiskFinding | null) {
  return risk?.fix_action?.control_note?.trim() || ''
}

function riskFeedbackStatusValue(risk: RiskFinding | null): CustomerFeedbackStatus {
  const status = risk?.fix_action?.customer_feedback_status
  if (status === 'accepted' || status === 'rejected' || status === 'special_approval') return status
  return 'needs_customer_confirmation'
}

function riskTaskStatus(risk: RiskFinding) {
  const feedbackStatus = riskFeedbackStatusValue(risk)
  if (feedbackStatus === 'accepted') return { label: '已采纳', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  if (feedbackStatus === 'rejected') return { label: '已反驳', className: 'border-rose-200 bg-rose-50 text-rose-700' }
  if (feedbackStatus === 'special_approval') return { label: '需特批', className: 'border-violet-200 bg-violet-50 text-violet-700' }
  if (riskControlNoteValue(risk)) return { label: '已反馈', className: 'border-blue-200 bg-blue-50 text-blue-700' }
  if (risk.severity === 'green') return { label: '已通过', className: 'border-emerald-200 bg-white text-emerald-700' }
  return { label: risk.severity === 'red' ? '待强谈' : '待谈判', className: 'border-amber-200 bg-amber-50 text-amber-700' }
}

function negotiationImpact(risk: RiskFinding) {
  if (risk.description?.trim()) return risk.description.trim()
  if (/付款|回款|收款|账期|批次|比例|尾款|验收|结算/.test(`${risk.title}\n${risk.suggestion}`)) {
    return '如果不明确付款比例、账期或验收节点，回款责任会变成不可执行或难追责。'
  }
  return '如果不处理该条款，后续履约、回款或责任边界可能无法落到可执行文本。'
}

function negotiationScript(risk: RiskFinding) {
  const suggestion = risk.suggestion?.trim()
  if (suggestion) {
    return `关于“${risk.title}”，这条需要调整成可执行、双方可确认的口径：${suggestion}`
  }
  return `关于“${risk.title}”，这条目前存在风险，需要客户确认是否按我方合规口径修订后回传。`
}

function negotiationBottomLine(risk: RiskFinding) {
  const text = `${risk.title}\n${risk.description}\n${risk.suggestion}`
  if (/付款|回款|收款|账期|批次|比例|尾款|验收|结算/.test(text)) {
    return '底线：必须明确金额/比例、触发节点和付款期限；不能只保留“双方另行协商”。'
  }
  if (/知识产权|IP|源代码|源码|著作权/.test(text)) {
    return '底线：保留我方既有 IP 和通用技术资产，不接受笼统转让或排他授权。'
  }
  if (/违约|赔偿|责任|SLA|可用性/.test(text)) {
    return '底线：责任上限、违约金和服务承诺必须对等、可计算、可追溯。'
  }
  return '底线：客户可以补充业务原因，但必须回传明确文本，不能停留在口头确认。'
}

export default function ContractWorkbenchPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const contractId = params.id as string
  const [data, setData] = useState<WorkbenchData | null>(null)
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle')
  const [exportNotice, setExportNotice] = useState('')
  const [exportDownload, setExportDownload] = useState<ExportDownload>(null)
  const [evidenceRefreshing, setEvidenceRefreshing] = useState(false)
  const [riskControlNote, setRiskControlNote] = useState('')
  const [riskFeedbackStatus, setRiskFeedbackStatus] = useState<CustomerFeedbackStatus>('needs_customer_confirmation')
  const [riskControlSaving, setRiskControlSaving] = useState(false)
  const [reviewStyle, setReviewStyle] = useState<ReviewStyle>('balanced')
  const returnHref = '/contracts'
  const compareReturnHref = `/contracts/${contractId}/compare?from=workbench`
  const showCompareReturn = searchParams.get('from') === 'compare'
  const requestedPanel = searchParams.get('panel')
  const sidePanelMode = normalizeContractWorkbenchPanel(requestedPanel)

  const handleSidePanelModeChange = useCallback((nextPanel: SidePanelMode) => {
    const currentSearch = searchParams.toString()
    const nextHref = buildContractWorkbenchPanelHref(contractId, currentSearch, nextPanel)
    const currentHref = `/contracts/${contractId}${currentSearch ? `?${currentSearch}` : ''}`
    if (nextHref === currentHref) return
    router.push(nextHref, { scroll: false })
  }, [contractId, router, searchParams])

  useEffect(() => () => {
    if (exportDownload?.url) {
      window.URL.revokeObjectURL(exportDownload.url)
    }
  }, [exportDownload?.url])

  const selectedRisk = useMemo(() => {
    if (!data) return null
    return data.riskFindings.find((risk) => risk.id === selectedRiskId) || data.riskFindings[0] || null
  }, [data, selectedRiskId])

  useEffect(() => {
    setRiskControlNote(riskControlNoteValue(selectedRisk))
    setRiskFeedbackStatus(riskFeedbackStatusValue(selectedRisk))
  }, [selectedRisk])

  const fetchWorkbench = useCallback(async ({
    silent = false,
    scope = 'full',
  }: {
    silent?: boolean
    scope?: 'summary' | 'full'
  } = {}) => {
    try {
      const token = localStorage.getItem('token')
      const endpoint = scope === 'summary'
        ? `/api/contracts/${contractId}/review?view=summary`
        : `/api/contracts/${contractId}/review`
      const response = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (!silent) setPageError(extractApiError(payload, '获取合同审核工作台失败'))
        return
      }

      const nextData = ((payload as { data?: WorkbenchData }).data || payload) as WorkbenchData
      setData(nextData)
      setSelectedRiskId((current) => (
        current && nextData.riskFindings.some((risk) => risk.id === current)
          ? current
          : nextData.riskFindings[0]?.id || null
      ))
      if (!silent) setPageError('')
      return nextData
    } catch {
      if (!silent) setPageError('网络错误，请稍后重试')
      return null
    } finally {
      if (!silent) setLoading(false)
    }
  }, [contractId])

  useEffect(() => {
    let cancelled = false

    async function loadWorkbench() {
      const summaryLoaded = await fetchWorkbench({ scope: 'summary' })
      if (cancelled || !summaryLoaded) return

      setEvidenceRefreshing(true)
      await fetchWorkbench({ silent: true, scope: 'full' })
      if (!cancelled) {
        setEvidenceRefreshing(false)
      }
    }

    void loadWorkbench()
    return () => {
      cancelled = true
      setEvidenceRefreshing(false)
    }
  }, [fetchWorkbench])

  useEffect(() => {
    if (!data || (data.status !== 'PARSING' && data.status !== 'ANALYZING')) return
    const timer = window.setInterval(() => {
      void fetchWorkbench({ silent: true, scope: 'summary' })
    }, 3000)
    return () => window.clearInterval(timer)
  }, [data, fetchWorkbench])

  async function handleStartReview() {
    if (!data) return

    setAnalyzing(true)
    try {
      const token = localStorage.getItem('token')
      const isRerun = data.status === 'COMPLETED' || data.status === 'FAILED' || Boolean(data.reviewRun?.id)
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await fetch(
        isRerun ? `/api/contracts/${contractId}/review-runs` : `/api/contracts/${contractId}/analyze`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: isRerun
            ? JSON.stringify({ trigger_event: 'manual_rerun', strategy: reviewStyleStrategy(reviewStyle) })
            : JSON.stringify({ strategy: reviewStyleStrategy(reviewStyle) }),
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(extractApiError(payload, isRerun ? '启动再审核失败' : '启动审核失败'))
        return
      }
      toastSuccess(isRerun ? '已启动合同再审核，工作台会持续刷新进度' : '已启动合同审核，工作台会持续刷新进度')
      await fetchWorkbench({ scope: 'summary' })
    } catch {
      toastError('网络错误，启动审核失败')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleExportForData(currentData: WorkbenchData) {
    const currentReviewHealth = buildReviewHealth(currentData)
    if (currentData.payload_scope === 'summary') {
      setExportNotice('正在补齐规则快照、SkillBundle、模型调用和批注意图门禁。补齐完成后会自动继续导出，不需要重复点击。')
      setEvidenceRefreshing(true)
      const hydrated = await fetchWorkbench({ silent: true, scope: 'full' })
      setEvidenceRefreshing(false)
      if (hydrated) {
        await handleExportForData(hydrated)
      } else {
        toastError('审核证据包补齐失败，请稍后重试')
      }
      return
    }
    if (currentData.status !== 'COMPLETED') {
      setExportNotice('当前合同还没有完成审核运行，暂不能生成源文件批注版。')
      toastError('当前合同还没有完成审核运行，暂不能导出批注版')
      return
    }
    if (currentData.annotations.length === 0 && currentData.riskFindings.length === 0) {
      setExportNotice('当前合同还没有可写入 Word 的风险项或批注意图，请先完成审核或重新审查。')
      handleSidePanelModeChange('review')
      toastError('当前合同还没有可写入 Word 的风险项或批注意图')
      return
    }
    const blockingExportIssues = buildExportGateIssues(currentData, currentReviewHealth)
    if (blockingExportIssues.length > 0) {
      setExportNotice(blockingExportIssues.slice(0, 3).join('；') || '当前结果还没有通过源文件批注导出门禁。')
      handleSidePanelModeChange('review')
      toastError(`暂不能导出源文件批注版：${blockingExportIssues.slice(0, 2).join('；') || '当前结果还没有通过源文件批注导出门禁'}`)
      return
    }
    setExporting(true)
    setExportNotice('')
    setExportPhase('checking')
    try {
      const token = localStorage.getItem('token')
      setExportPhase('generating')
      const response = await fetch(`/api/contracts/${contractId}/export`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const message = extractApiError(payload, '导出批注版本失败')
        setExportNotice(message)
        toastError(message)
        return
      }

      setExportPhase('downloading')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const filename = `${currentData.filename}-ONES批注版.docx`
      const reused = response.headers.get('x-export-reused') === 'true'
      const versionNumber = response.headers.get('x-contract-version-number') || ''
      setExportDownload((current) => {
        if (current?.url) {
          window.URL.revokeObjectURL(current.url)
        }
        return {
          url,
          filename,
          createdAt: new Date().toLocaleTimeString('zh-CN'),
          reused,
          versionNumber,
        }
      })
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      toastSuccess(reused
        ? '已复用当前 ReviewRun 的源文件 Word 批注版，若浏览器未自动下载，可使用页面中的重新下载入口'
        : '已生成源文件 Word 批注版，若浏览器未自动下载，可使用页面中的重新下载入口')
      await fetchWorkbench({ silent: true, scope: 'full' })
    } catch {
      setExportNotice('网络错误或导出服务超时，请稍后重试。')
      toastError('网络错误，导出批注版本失败')
    } finally {
      setExporting(false)
      setExportPhase('idle')
    }
  }

  async function handleExport() {
    if (!data) return
    await handleExportForData(data)
  }

  async function handleSaveRiskControlNote(note: string, feedbackStatus: CustomerFeedbackStatus) {
    if (!selectedRisk) return
    const trimmed = note.trim()
    if (!trimmed && feedbackStatus === 'needs_customer_confirmation') {
      toastError('请先补充客户反馈或选择处理状态')
      return
    }

    setRiskControlSaving(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contracts/${contractId}/risk-cards/${selectedRisk.id}/fix`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'control_note',
          note: trimmed,
          feedback_status: feedbackStatus,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(extractApiError(payload, '保存风险可控说明失败'))
        return
      }
      toastSuccess('已保存谈判反馈，后续导出批注版会按客户侧口径写入')
      await fetchWorkbench({ silent: true, scope: 'full' })
    } catch {
      toastError('网络错误，保存风险可控说明失败')
    } finally {
      setRiskControlSaving(false)
    }
  }

  if (loading) {
    return <ReviewWorkbenchLoadingPanel />
  }

  if (pageError || !data) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
            <AlertTriangleIcon className="h-9 w-9 text-red-500" />
            <div>
              <p className="text-base font-medium text-slate-900">{pageError || '合同不存在'}</p>
              <p className="mt-1 text-sm text-slate-500">请返回合同中心重新选择合同。</p>
            </div>
            <Link href={returnHref}>
              <Button variant="outline">
                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                返回合同中心
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isBusy = data.status === 'PARSING' || data.status === 'ANALYZING'
  const selectedSnippet = firstEvidence(selectedRisk)
  const evidenceSourceRange = selectedRisk?.evidence?.source_range
  const selectedSourceRange = selectedRisk
    ? evidenceSourceRange?.start != null && evidenceSourceRange?.end != null
      ? evidenceSourceRange
      : selectedRisk.position
    : null
  const redCount = data.stats?.red || data.riskFindings.filter((risk) => risk.severity === 'red').length
  const yellowCount = data.stats?.yellow || data.riskFindings.filter((risk) => risk.severity === 'yellow').length
  const displayName = data.filename?.trim() || data.title?.trim() || '未命名合同审核'
  const hasSourceAsset = Boolean(data.parsed_text?.trim()) || data.versions.length > 0 || Boolean(data.storage_path)
	  const isSummaryPayload = data.payload_scope === 'summary'
	  const reviewHealth = buildReviewHealth(data)
	  const displayReviewHealth = isSummaryPayload
	    ? { ...reviewHealth, degraded: false, issues: [] }
	    : reviewHealth
	  const exportGateIssues = isSummaryPayload
	    ? ['规则快照、SkillBundle 和模型调用证据正在后台补齐，完成后再判断源文件批注导出门禁。']
	    : buildExportGateIssues(data, reviewHealth)
	  const canExport = !isSummaryPayload && exportGateIssues.length === 0
  const hasReviewArtifacts = data.annotations.length > 0 || data.riskFindings.length > 0
  const workflowState = deriveReviewWorkflowState({
    status: data.status,
    hasSourceAsset,
    hasReviewArtifacts,
    exportReady: canExport,
    exportBlockedReasons: exportGateIssues,
    payloadScope: data.payload_scope,
    reviewRunId: data.reviewRun?.id,
  })
  const canStartReview = hasSourceAsset && !isBusy && workflowState.canStartReview
  const versionActionLabel = hasSourceAsset ? '导入客户回传件' : '补充审核源文件'
  const openRiskCount = data.stats?.open || data.riskFindings.filter((risk) => risk.status === 'open').length
  const reviewActionLabel = data.status === 'COMPLETED'
    ? '重新审查'
    : data.status === 'FAILED'
      ? workflowState.primaryButtonLabel
      : workflowState.primaryButtonLabel
  const exportActionLabel = exporting
    ? '生成批注版'
    : workflowState.primaryAction === 'export_comments' || workflowState.primaryAction === 'inspect_export_gate'
      ? workflowState.primaryButtonLabel
      : canExport
        ? '导出批注版'
        : '查看导出原因'
  const statusMeta = statusMap[data.status] || { label: data.status, variant: 'secondary' as const }
	  const statusLabel = data.status === 'COMPLETED' && displayReviewHealth.degraded
	    ? '审核降级（需复核）'
	    : statusMeta.label
	  const statusVariant = data.status === 'COMPLETED' && displayReviewHealth.degraded
	    ? 'destructive'
	    : statusMeta.variant
  const sourcePreviewFile = pickReviewSourcePreviewFile(data)

  return (
    <div className="space-y-5 p-4 md:p-5 xl:p-8">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
            <Link href="/contracts" className="hover:text-slate-900">合同审核</Link>
            <span>/</span>
            <span>审核工作台</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="max-w-[760px] truncate text-2xl font-bold text-slate-950">{displayName}</h1>
            <Badge variant={statusVariant}>
              {statusLabel}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            ONES 业务运营按后台发布规则和模型策略生成风险定位、谈判任务和源文件 Word 原生批注版本。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={returnHref}>
            <Button variant="outline">
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              返回合同中心
            </Button>
          </Link>
          {showCompareReturn && (
            <Link href={compareReturnHref}>
              <Button variant="outline">
                <WorkflowIcon className="mr-2 h-4 w-4" />
                回到文档比对
              </Button>
            </Link>
          )}
          {data.status !== 'DRAFT' && (
            <Button onClick={handleStartReview} disabled={!canStartReview || analyzing}>
              {analyzing ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <BotIcon className="mr-2 h-4 w-4" />}
              {isBusy ? '审核中' : reviewActionLabel}
            </Button>
          )}
          {data.status === 'DRAFT' && !hasSourceAsset && (
            <Link href={`/contracts/${contractId}/edit`}>
              <Button className="gap-1.5">
                <UploadIcon className="h-4 w-4" />
                补充审核源文件
              </Button>
            </Link>
          )}
          {hasSourceAsset && (
            <Link href={`/contracts/${contractId}/compare?from=workbench`}>
              <Button variant="outline">
                <WorkflowIcon className="mr-2 h-4 w-4" />
                文档比对
              </Button>
            </Link>
          )}
	          <Button
	            onClick={handleExport}
	            disabled={exporting}
	            variant={canExport ? 'default' : 'outline'}
	            title={!canExport ? exportGateIssues.slice(0, 2).join('；') : undefined}
	            aria-label="导出源文件 Word 原生批注版"
	          >
	            {exporting ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <DownloadIcon className="mr-2 h-4 w-4" />}
	            {exportActionLabel}
	          </Button>
        </div>
      </div>

      <SourceAnnotationDeliveryPanel
        data={data}
        canExport={canExport}
        exportGateIssues={exportGateIssues}
        exportDownload={exportDownload}
        redCount={redCount}
        yellowCount={yellowCount}
        openRiskCount={openRiskCount}
        annotationCount={data.annotations.length}
        reviewStyle={reviewStyle}
        onReviewStyleChange={setReviewStyle}
      />

	      {(evidenceRefreshing || isSummaryPayload) && (
	        <EvidenceHydrationPanel />
	      )}

      {(isBusy || analyzing) && (
        <ReviewProgressPanel data={data} analyzing={analyzing} />
      )}

      {exportDownload && (
        <ExportDownloadPanel exportDownload={exportDownload} />
      )}

      {(exporting || exportNotice) && (
        <ExportStatusPanel
          phase={exportPhase}
          notice={exportNotice}
          canExport={canExport}
          reviewHealth={displayReviewHealth}
          onOpenReview={() => handleSidePanelModeChange('review')}
        />
      )}

      {reviewHealth.degraded && !isSummaryPayload && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <p className="font-medium">审核降级，需复核后交付</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5">
                {reviewHealth.issues.slice(0, 4).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <CompactReviewDock
        data={data}
        redCount={redCount}
        yellowCount={yellowCount}
        openRiskCount={openRiskCount}
        selectedRisk={selectedRisk}
        onModeChange={handleSidePanelModeChange}
      />

      <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[150px_280px_minmax(0,1fr)] 2xl:grid-cols-[160px_300px_minmax(0,1fr)]">
        <ReviewNavigationRail
          data={data}
          selectedRiskId={selectedRisk?.id || null}
          onSelectRisk={setSelectedRiskId}
        />

        <aside className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          <Card>
            <CardHeader className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">谈判跟进</CardTitle>
                <Badge variant="outline">{data.reviewRun?.status || '未开始'}</Badge>
              </div>
              <SidePanelTabs value={sidePanelMode} onChange={handleSidePanelModeChange} />
            </CardHeader>
            <CardContent className="pt-4">
              {sidePanelMode === 'review' && (
                <>
                  <RiskDecisionPanel
                    selectedRisk={selectedRisk}
                    negotiationTasks={data.negotiationTasks}
                    controlNote={riskControlNote}
                    feedbackStatus={riskFeedbackStatus}
                    controlSaving={riskControlSaving}
                    onControlNoteChange={setRiskControlNote}
                    onFeedbackStatusChange={setRiskFeedbackStatus}
                    onSaveControlNote={handleSaveRiskControlNote}
                    canStartReview={canStartReview}
                    analyzing={analyzing}
                    onStartReview={handleStartReview}
                    canExport={canExport}
                    exporting={exporting}
                    onExport={handleExport}
                    exportGateIssues={exportGateIssues}
                  />
                  <div className="mt-4 xl:hidden">
                    <ReviewPanel
                      risks={data.riskFindings}
                      selectedRiskId={selectedRisk?.id || null}
                      onSelectRisk={setSelectedRiskId}
                      negotiationTasks={data.negotiationTasks}
                    />
                  </div>
                </>
              )}
              {sidePanelMode === 'summary' && (
                <SummaryPanel
                  data={data}
                  redCount={redCount}
                  yellowCount={yellowCount}
                  openRiskCount={openRiskCount}
                />
              )}
              {sidePanelMode === 'assistant' && (
                <AssistantPanel
                  selectedRisk={selectedRisk}
                  reviewRun={data.reviewRun}
                  latestSummary={data.latestReview?.results?.summary}
                />
              )}
              {sidePanelMode === 'evidence' && (
                <EvidencePanel reviewRun={data.reviewRun} latestJob={data.latestJob} />
              )}
            </CardContent>
          </Card>
          <VersionOutputPanel data={data} contractId={contractId} actionLabel={versionActionLabel} />
        </aside>

        <section className="space-y-3">
          <Card className="min-h-[calc(100dvh-180px)]">
            <CardHeader className="border-b border-slate-100 pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileTextIcon className="h-4 w-4" />
                    源文件与批注预览
                  </CardTitle>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    主画布只服务两件事：定位原文证据，预览客户侧批注将如何写入源 Word。
                  </p>
                </div>
                <Badge variant="outline">
                  当前版本用于审核定位
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.versions.length === 0 ? (
                  <Badge variant="outline">暂无版本</Badge>
                ) : data.versions.slice(0, 4).map((version) => (
                  <Badge key={version.id} variant={version.source === 'review_revision' ? 'default' : 'outline'}>
                    v{version.version_number} · {version.source === 'original' ? '源文件' : version.source === 'manual_revision' ? '客户/人工版本' : '批注版'}
                  </Badge>
                ))}
                {data.outputs.length > 0 && <Badge variant="secondary">批注版 {data.outputs.length}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {selectedRisk && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-sm text-blue-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{selectedRisk.title}</div>
                    <div className="flex flex-wrap gap-2">
                      {needsManualRiskLocation(selectedRisk) && (
                        <Badge variant="destructive">需人工定位</Badge>
                      )}
                      <Badge variant={riskTone[selectedRisk.severity].badge}>
                        {riskTone[selectedRisk.severity].label}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 xl:grid-cols-[1fr_1fr_0.85fr]">
                    <div className="rounded border border-slate-200 bg-white/80 p-2">
                      <div className="text-[11px] font-medium text-slate-500">原文证据</div>
                      <p className="mt-1 line-clamp-4 leading-5 text-slate-800">
                        {selectedSnippet || '未记录原文片段，需人工定位后再导出正式批注。'}
                      </p>
                    </div>
                    <div className="rounded border border-emerald-200 bg-emerald-50/60 p-2">
                      <div className="text-[11px] font-medium text-emerald-700">客户侧建议</div>
                      <p className="mt-1 line-clamp-4 leading-5 text-emerald-950">
                        {selectedRisk.suggestion || riskControlNoteValue(selectedRisk) || '待补充可直接写入客户侧批注的修改口径。'}
                      </p>
                    </div>
                    <div className="rounded bg-white/70 p-2">
                      <div className="text-[11px] font-medium text-blue-700">谈判目的</div>
                      <p className="mt-1 line-clamp-4 leading-5">{negotiationImpact(selectedRisk)}</p>
                    </div>
                  </div>
                </div>
              )}
              <SourceDocumentPreview
                file={sourcePreviewFile}
                title="源文件原件与批注定位预览"
                selectedText={selectedSnippet}
                sourceText={data.parsed_text}
                sourceRange={selectedSourceRange}
                fallbackLabel="未绑定可渲染源文件"
                minHeightClassName="min-h-[calc(100dvh-260px)]"
              />
            </CardContent>
          </Card>

          <AnnotationsPanel annotations={data.annotations} />
        </section>
      </div>
    </div>
  )
}

function SourceAnnotationDeliveryPanel({
  data,
  canExport,
  exportGateIssues,
  exportDownload,
  redCount,
  yellowCount,
  openRiskCount,
  annotationCount,
  reviewStyle,
  onReviewStyleChange,
}: {
  data: WorkbenchData
  canExport: boolean
  exportGateIssues: string[]
  exportDownload: ExportDownload
  redCount: number
  yellowCount: number
  openRiskCount: number
  annotationCount: number
  reviewStyle: ReviewStyle
  onReviewStyleChange: (style: ReviewStyle) => void
}) {
  const latestOriginal = data.versions.find((version) => version.source === 'original')
  const latestAnnotated = data.outputs[0]
  const blockedReason = exportGateIssues.slice(0, 2).join('；')
  const styles: Array<{ value: ReviewStyle; label: string }> = [
    { value: 'strict', label: '严审' },
    { value: 'balanced', label: '均衡' },
    { value: 'business', label: '商务' },
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">源文件批注</span>
          <span className="truncate text-sm text-slate-600">
            {latestOriginal ? `v${latestOriginal.version_number} 源文件` : data.storage_path ? '已绑定源文件' : '未绑定源文件'}
            <span className="mx-2 text-slate-300">|</span>
            {data.mime_type || '文件类型未记录'} · {formatSize(data.size)}
          </span>
          <span className="hidden text-sm text-slate-400 md:inline">风险 → 谈判 → 批注 → 回传</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrafficLightPill label="红线" value={redCount} tone="red" />
          <TrafficLightPill label="谈判" value={yellowCount} tone="amber" />
          <TrafficLightPill label="开放" value={openRiskCount} tone="slate" />
          <TrafficLightPill label="批注" value={annotationCount} tone={canExport ? 'emerald' : 'blue'} />
          <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {styles.map((style) => {
              const active = style.value === reviewStyle
              return (
                <button
                  key={style.value}
                  type="button"
                  onClick={() => onReviewStyleChange(style.value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {style.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
        <span>{latestAnnotated ? `最近批注版 v${latestAnnotated.version_number}` : canExport ? '可生成批注版' : '批注导出待满足门禁'}</span>
        <span className="text-slate-300">|</span>
        <span>{exportDownload ? `本次已生成：${exportDownload.createdAt}` : blockedReason || '交付只写入源 DOCX 原生批注，不重新排版。'}</span>
      </div>
    </div>
  )
}

function TrafficLightPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'red' | 'amber' | 'emerald' | 'blue' | 'slate'
}) {
  const toneClass = {
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  }[tone]

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  )
}

function CompactReviewDock({
  data,
  redCount,
  yellowCount,
  openRiskCount,
  selectedRisk,
  onModeChange,
}: {
  data: WorkbenchData
  redCount: number
  yellowCount: number
  openRiskCount: number
  selectedRisk: RiskFinding | null
  onModeChange: (mode: SidePanelMode) => void
}) {
  return (
    <div className="sm:hidden rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">移动审查区</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-950">
            {selectedRisk ? selectedRisk.title : '选择风险后会同步证据、批注和谈判动作'}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:w-64">
          <MiniStat label="红线" value={redCount} />
          <MiniStat label="谈判" value={yellowCount} />
          <MiniStat label="开放" value={openRiskCount} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { value: 'review' as const, label: `风险 ${data.riskFindings.length}` },
          { value: 'summary' as const, label: '概览' },
          { value: 'assistant' as const, label: '建议' },
          { value: 'evidence' as const, label: '证据' },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onModeChange(item.value)}
            className="rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-slate-950"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ReviewWorkbenchLoadingPanel() {
  const steps = [
    '读取合同源文件与版本流',
    '装载最近一次 ReviewRun',
    '绑定规则发布包与模型调用证据',
    '整理风险定位、谈判任务和批注意图',
  ]

  return (
    <div className="p-4 md:p-6 xl:p-8">
      <div className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Loader2Icon className="h-4 w-4 animate-spin text-blue-600" />
              正在打开合同审核工作台
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              工作台会同时读取合同版本、规则快照、模型调用和批注意图。长合同首次打开可能需要数秒，但每一步都应能解释正在处理什么。
            </p>
          </div>
          <Badge variant="outline">ReviewRun 装载中</Badge>
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-4">
          {steps.map((step, index) => (
            <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold text-slate-900">{step}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-500" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EvidenceHydrationPanel() {
  const steps = ['规则快照', 'SkillBundle', '模型调用', '质量门禁']

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3" aria-live="polite">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold text-blue-950">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            正在补齐审核证据包
          </div>
          <p className="mt-1 text-sm leading-6 text-blue-800">
            首屏已先打开。系统正在后台读取规则发布包、模型调用和质量门禁，完成后才会判断正式审核与批注导出状态。
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          {steps.map((step, index) => (
            <div key={step} className="rounded-md bg-white px-2 py-2 text-blue-800">
              <div className="font-semibold">{index + 1}</div>
              <div className="mt-0.5 whitespace-nowrap">{step}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExportStatusPanel({
  phase,
  notice,
  canExport,
  reviewHealth,
  onOpenReview,
}: {
  phase: ExportPhase
  notice: string
  canExport: boolean
  reviewHealth: ReturnType<typeof buildReviewHealth>
  onOpenReview: () => void
}) {
  if (notice) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" aria-live="polite">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-semibold text-amber-950">批注版导出未完成</p>
            <p className="mt-1 text-sm leading-6 text-amber-800">{notice}</p>
            {reviewHealth.issues.length > 0 && (
              <p className="mt-1 text-xs leading-5 text-amber-700">
                当前门禁：{reviewHealth.issues.slice(0, 3).join('；')}
              </p>
            )}
          </div>
          <Button type="button" variant="outline" className="shrink-0 border-amber-300 bg-white" onClick={onOpenReview}>
            查看风险定位
          </Button>
        </div>
      </div>
    )
  }

  const phaseText: Record<ExportPhase, string> = {
    idle: '等待导出',
    checking: '检查风险定位与批注意图',
    generating: '正在基于源 Word 生成原生批注版',
    downloading: '批注版已生成，正在交给浏览器下载',
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3" aria-live="polite">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold text-blue-950">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            {phaseText[phase]}
          </div>
          <p className="mt-1 text-sm leading-6 text-blue-800">
            这一步会下载源文件、写入 Word 原生批注、上传批注版并登记合同版本。请不要重复点击。
          </p>
        </div>
        <Badge variant={canExport ? 'default' : 'outline'} className="w-fit bg-white text-blue-700">
          源文件批注版
        </Badge>
      </div>
    </div>
  )
}

function ReviewProgressPanel({
  data,
  analyzing,
}: {
  data: WorkbenchData
  analyzing: boolean
}) {
  const steps = [
    {
      key: 'version',
      label: '合同版本',
      description: data.versions.length > 0 ? `已读取 ${data.versions.length} 个版本` : '等待源文件版本',
      done: data.versions.length > 0,
    },
    {
      key: 'rules',
      label: '规则发布包',
      description: data.reviewRun?.skill_bundle_id ? `已绑定 ${data.reviewRun.skill_bundle_id.slice(0, 8)}` : '等待发布规则与审核包',
      done: Boolean(data.reviewRun?.skill_bundle_id),
    },
    {
      key: 'model',
      label: '模型与引擎',
      description: data.reviewRun?.model_policy?.model
        ? `${data.reviewRun.model_policy.provider} / ${data.reviewRun.model_policy.model}`
        : data.latestJob?.provider || '等待模型或规则引擎结果',
      done: Boolean(data.reviewRun?.model_policy?.model || data.latestJob?.provider),
    },
    {
      key: 'risks',
      label: '风险定位',
      description: data.riskFindings.length > 0 ? `已生成 ${data.riskFindings.length} 个风险项` : '正在生成风险项和证据定位',
      done: data.riskFindings.length > 0,
    },
    {
      key: 'annotations',
      label: '批注意图',
      description: data.annotations.length > 0 ? `已生成 ${data.annotations.length} 条批注意图` : '等待可写入源文件的批注意图',
      done: data.annotations.length > 0,
    },
  ]

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3" aria-live="polite">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-indigo-950">{analyzing ? '正在启动审核运行' : '审核运行处理中'}</p>
          <p className="mt-1 text-sm text-indigo-800">长任务会持续刷新；请等待风险定位、模型调用和批注意图完成。</p>
        </div>
        <Badge variant="outline" className="w-fit border-indigo-300 bg-white text-indigo-700">
          {data.latestJob?.status || data.status}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step.key} className="rounded-md bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                step.done ? 'bg-emerald-600 text-white' : 'bg-indigo-100 text-indigo-700'
              }`}>
                {step.done ? '✓' : index + 1}
              </span>
              <span className="text-xs font-semibold text-slate-950">{step.label}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExportDownloadPanel({ exportDownload }: { exportDownload: NonNullable<ExportDownload> }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-emerald-950">源文件批注版已生成</p>
          <p className="mt-1 text-sm text-emerald-800">
            已触发浏览器下载；如果没有看到下载，请使用右侧入口重新下载本次生成文件。
          </p>
          <p className="mt-1 truncate text-xs text-emerald-700">
            {exportDownload.filename} · {exportDownload.reused ? '复用已有批注版' : '新生成批注版'}
            {exportDownload.versionNumber ? ` v${exportDownload.versionNumber}` : ''} · {exportDownload.createdAt}
          </p>
        </div>
        <a
          href={exportDownload.url}
          download={exportDownload.filename}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
          重新下载批注版
        </a>
      </div>
    </div>
  )
}

function ReviewNavigationRail({
  data,
  selectedRiskId,
  onSelectRisk,
}: {
  data: WorkbenchData
  selectedRiskId: string | null
  onSelectRisk: (riskId: string) => void
}) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const visibleRisks = riskFilter === 'all'
    ? data.riskFindings
    : data.riskFindings.filter((risk) => risk.severity === riskFilter)
  const redRiskCount = data.riskFindings.filter((risk) => risk.severity === 'red').length
  const yellowRiskCount = data.riskFindings.filter((risk) => risk.severity === 'yellow').length
  const filters: Array<{ value: RiskFilter; label: string; count: number }> = [
    { value: 'all', label: '全部', count: data.riskFindings.length },
    { value: 'red', label: '红线', count: redRiskCount },
    { value: 'yellow', label: '谈判', count: yellowRiskCount },
    { value: 'green', label: '通过', count: data.riskFindings.filter((risk) => risk.severity === 'green').length },
  ]

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pr-1">
        <Card>
          <CardHeader className="border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">风险导航</CardTitle>
                <p className="mt-1 text-xs text-slate-500">只负责定位。</p>
              </div>
              <Badge variant="outline">{visibleRisks.length}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-1.5">
              {filters.map((filter) => {
                const active = filter.value === riskFilter
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setRiskFilter(filter.value)}
                    className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs transition ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-medium">{filter.label}</span>
                    <span className="text-slate-400">{filter.count}</span>
                  </button>
                )
              })}
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {visibleRisks.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
                当前分类暂无风险项。
              </div>
            ) : (
              <div className="space-y-2">
                {visibleRisks.map((risk) => {
                  const tone = riskTone[risk.severity]
                  const active = risk.id === selectedRiskId
                  const manualLocation = needsManualRiskLocation(risk)
                  const taskStatus = riskTaskStatus(risk)
                  return (
                    <button
                      key={risk.id}
                      type="button"
                      onClick={() => onSelectRisk(risk.id)}
                      className={`w-full rounded-md border p-2 text-left transition ${tone.className} ${
                        active ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs font-semibold">{risk.title}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${taskStatus.className}`}>
                          {taskStatus.label}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 opacity-80">
                        {risk.description || risk.suggestion || '等待客户反馈或回传版本。'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] opacity-80">
                        <span>{tone.label}</span>
                        <span>{manualLocation ? '需人工定位' : '已定位原文'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </aside>
  )
}

function RiskDecisionPanel({
  selectedRisk,
  negotiationTasks,
  controlNote,
  feedbackStatus,
  controlSaving,
  onControlNoteChange,
  onFeedbackStatusChange,
  onSaveControlNote,
  canStartReview,
  analyzing,
  onStartReview,
  canExport,
  exporting,
  onExport,
  exportGateIssues,
}: {
  selectedRisk: RiskFinding | null
  negotiationTasks: NegotiationTask[]
  controlNote: string
  feedbackStatus: CustomerFeedbackStatus
  controlSaving: boolean
  onControlNoteChange: (value: string) => void
  onFeedbackStatusChange: (value: CustomerFeedbackStatus) => void
  onSaveControlNote: (value: string, feedbackStatus: CustomerFeedbackStatus) => Promise<void>
  canStartReview: boolean
  analyzing: boolean
  onStartReview: () => void
  canExport: boolean
  exporting: boolean
  onExport: () => void
  exportGateIssues: string[]
}) {
  const relatedTasks = selectedRisk
    ? negotiationTasks.filter((task) => task.risk_id === selectedRisk.id)
    : []

  if (!selectedRisk) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
        从左侧谈判任务队列选择一条风险后，这里会显示问题解释、谈判口径和客户反馈填回。
      </div>
    )
  }

  const tone = riskTone[selectedRisk.severity]
  const manualLocation = needsManualRiskLocation(selectedRisk)
  const savedControlNote = riskControlNoteValue(selectedRisk)
  const taskStatus = riskTaskStatus(selectedRisk)
  const script = negotiationScript(selectedRisk)
  const bottomLine = negotiationBottomLine(selectedRisk)
  const impact = negotiationImpact(selectedRisk)
  const isPaymentRisk = /付款|回款|收款|账期|批次|比例|尾款|验收|结算/.test(
    `${selectedRisk.title}\n${selectedRisk.description}\n${selectedRisk.suggestion}`
  )
  const feedbackOptions: Array<{
    value: CustomerFeedbackStatus
    label: string
    description: string
    icon: ComponentType<{ className?: string }>
  }> = [
    { value: 'accepted', label: '客户已同意', description: '准备再审核并导出最终批注版', icon: CheckCircleIcon },
    { value: 'rejected', label: '客户有反馈', description: '记录原因，等待回传版本再判断', icon: MessageSquareTextIcon },
    { value: 'special_approval', label: '要求特批', description: '保留风险，转人工审批裁决', icon: XCircleIcon },
  ]

  async function handleCopyScript() {
    try {
      await navigator.clipboard.writeText(script)
      toastSuccess('谈判口径已复制')
    } catch {
      toastError('复制失败，请手动选择文本')
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <section className={`rounded-md border p-3 ${tone.className}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-medium opacity-75">第一步：看懂问题</div>
            <h3 className="mt-1 text-base font-semibold">{selectedRisk.title}</h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant={tone.badge}>{tone.label}</Badge>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${taskStatus.className}`}>
              {taskStatus.label}
            </span>
            {manualLocation ? <Badge variant="destructive">需人工定位</Badge> : null}
          </div>
        </div>
        <p className="mt-3 leading-6">{impact}</p>
      </section>

      <section className="rounded-md border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-950">第二步：谈判口径</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyScript()}>
            <CopyIcon className="mr-2 h-4 w-4" />
            复制
          </Button>
        </div>
        <p className="mt-3 rounded-md bg-blue-50 p-3 leading-6 text-blue-950">
          {script}
        </p>
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          {bottomLine}
        </p>
        {relatedTasks.length > 0 && (
          <div className="mt-3 space-y-2">
            {relatedTasks.length === 0 ? (
              <p className="rounded-md bg-slate-50 p-3 text-slate-500">
                当前风险没有绑定销售谈判任务。红线或需谈判风险后续应在这里完成客户反馈闭环。
              </p>
            ) : relatedTasks.map((task) => (
            <div key={task.id} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{task.title}</span>
                <Badge variant={task.required ? 'destructive' : 'secondary'}>
                {task.required ? '强制' : '建议'}
              </Badge>
            </div>
            <p className="mt-1 leading-6">{task.objective}</p>
              <p className="mt-1 text-xs text-amber-800">状态：{task.status === 'responded' ? '已回应' : task.status === 'closed' ? '已关闭' : '待处理'}</p>
            </div>
          ))}
          </div>
        )}
      </section>

      <section className="rounded-md border border-amber-200 bg-amber-50/70 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-amber-950">第三步：谈判记录与反馈</h3>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              产品不在页面里直接替你改合同；这里记录客户反馈和可控化参数，后续写入客户侧批注版，并进入回传版本再审核。
            </p>
          </div>
          {savedControlNote && <Badge variant="outline" className="border-amber-300 bg-white">已保存</Badge>}
        </div>
        <div className="mt-3 grid gap-2">
          {feedbackOptions.map((option) => {
            const active = feedbackStatus === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onFeedbackStatusChange(option.value)}
                className={`flex items-start gap-2 rounded-md border bg-white p-2 text-left transition ${
                  active ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <option.icon className={`mt-0.5 h-4 w-4 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>
                  <span className="block font-medium text-slate-950">{option.label}</span>
                  <span className="text-xs leading-5 text-slate-500">{option.description}</span>
                </span>
              </button>
            )
          })}
        </div>
        <Textarea
          className="mt-3 min-h-24 bg-white"
          value={controlNote}
          onChange={(event) => onControlNoteChange(event.target.value)}
          placeholder={isPaymentRisk
            ? '例如：客户确认回款按 3/3/4 分三期，首期验收后 15 个工作日内支付；回传版需明确比例和账期。'
            : '例如：客户同意改为双方书面确认后生效；如果不同意，请写清原因或特批依据。'}
          maxLength={1200}
        />
        <div className="sticky bottom-0 -mx-3 mt-3 border-t border-amber-200 bg-amber-50/95 px-3 py-3 backdrop-blur">
          <p className="mb-2 text-xs leading-5 text-amber-800">
            保存后不会直接关闭风险；客户回传后应再审核，导出时只写客户能理解的修改口径。
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              type="button"
              size="sm"
              onClick={() => void onSaveControlNote(controlNote, feedbackStatus)}
              disabled={controlSaving || (!controlNote.trim() && feedbackStatus === 'needs_customer_confirmation')}
            >
              {controlSaving ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquareTextIcon className="mr-2 h-4 w-4" />}
              保存反馈
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onStartReview}
              disabled={!canStartReview || analyzing}
            >
              {analyzing ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <BotIcon className="mr-2 h-4 w-4" />}
              重新审核
            </Button>
            <Button
              type="button"
              size="sm"
              variant={canExport ? 'default' : 'outline'}
              onClick={onExport}
              disabled={exporting}
              title={!canExport ? exportGateIssues.slice(0, 2).join('；') : undefined}
            >
              {exporting ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <DownloadIcon className="mr-2 h-4 w-4" />}
              导出批注
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function SidePanelTabs({
  value,
  onChange,
}: {
  value: SidePanelMode
  onChange: (value: SidePanelMode) => void
}) {
  const tabs: Array<{ value: SidePanelMode; label: string; icon: ComponentType<{ className?: string }> }> = [
    { value: 'review', label: '审查', icon: AlertTriangleIcon },
    { value: 'summary', label: '摘要', icon: FileTextIcon },
    { value: 'assistant', label: '对话', icon: MessageSquareTextIcon },
    { value: 'evidence', label: '证据', icon: ShieldCheckIcon },
  ]

  return (
    <div className="mt-3 grid grid-cols-4 gap-1 rounded-md bg-slate-100 p-1">
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`flex min-h-9 items-center justify-center gap-1 rounded px-2 text-xs font-medium transition ${
              active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function ReviewPanel({
  risks,
  selectedRiskId,
  onSelectRisk,
  negotiationTasks,
}: {
  risks: RiskFinding[]
  selectedRiskId: string | null
  onSelectRisk: (riskId: string) => void
  negotiationTasks: NegotiationTask[]
}) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const riskFilters: Array<{ value: RiskFilter; label: string; count: number }> = [
    { value: 'all', label: '全部', count: risks.length },
    { value: 'red', label: '红线', count: risks.filter((risk) => risk.severity === 'red').length },
    { value: 'yellow', label: '需谈判', count: risks.filter((risk) => risk.severity === 'yellow').length },
    { value: 'green', label: '通过', count: risks.filter((risk) => risk.severity === 'green').length },
    { value: 'white', label: '提示', count: risks.filter((risk) => risk.severity === 'white').length },
  ]
  const visibleRisks = riskFilter === 'all'
    ? risks
    : risks.filter((risk) => risk.severity === riskFilter)

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-950">谈判任务队列</h3>
          <Badge variant="outline">{risks.length}</Badge>
        </div>
        {risks.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {riskFilters.map((filter) => {
              const active = filter.value === riskFilter
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setRiskFilter(filter.value)}
                  className={`rounded-md border px-2.5 py-2 text-left text-xs transition ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="font-medium">{filter.label}</span>
                  <span className="ml-1 text-slate-400">{filter.count}</span>
                </button>
              )
            })}
          </div>
        )}
        {risks.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
            暂无风险项。上传源文件并发起审核后会生成风险定位。
          </div>
        ) : visibleRisks.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
            当前分类暂无风险项。
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRisks.map((risk) => {
              const tone = riskTone[risk.severity]
              const active = selectedRiskId === risk.id
              const manualLocation = needsManualRiskLocation(risk)
              const taskStatus = riskTaskStatus(risk)
              return (
                <button
                  key={risk.id}
                  type="button"
                  onClick={() => onSelectRisk(risk.id)}
                  className={`w-full rounded-md border p-3 text-left transition ${tone.className} ${
                    active ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold">{risk.title}</span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {manualLocation && <Badge variant="destructive">需定位</Badge>}
                      <Badge variant={tone.badge}>{tone.label}</Badge>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${taskStatus.className}`}>
                      {taskStatus.label}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 opacity-80">
                    {risk.description || risk.suggestion || '未记录风险描述'}
                  </p>
                  {risk.suggestion && (
                    <div className="mt-2 rounded bg-white/70 p-2 text-[11px] leading-5 opacity-90">
                      <span className="font-medium">批注建议：</span>
                      <span>{risk.suggestion}</span>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] opacity-70">
                    <span>{manualLocation ? '未完成原文定位' : '已绑定原文定位'}</span>
                    {riskControlNoteValue(risk) && <span>已有反馈</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-950">销售谈判任务</h3>
          <Badge variant="outline">{negotiationTasks.length}</Badge>
        </div>
        {negotiationTasks.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
            当前没有必须谈判的开放风险项。
          </p>
        ) : (
          <div className="space-y-3">
            {negotiationTasks.map((task) => (
              <div key={task.id} className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{task.title}</span>
                  <Badge variant={task.required ? 'destructive' : 'secondary'}>
                    {task.required ? '强制' : '建议'}
                  </Badge>
                </div>
                <p className="leading-6 text-slate-600">{task.objective}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>责任角色：{task.owner_role}</span>
                  {task.ask_code && <span>编号：{task.ask_code}</span>}
                  <span>状态：{task.status === 'responded' ? '已回应' : task.status === 'closed' ? '已关闭' : '待处理'}</span>
                </div>
                {task.standard && (
                  <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-600">
                    合格标准：{task.standard}
                  </p>
                )}
                {task.response && (
                  <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 p-2 text-xs leading-5 text-emerald-900">
                    <div className="font-medium">
                      {task.response.responder_name}（{task.response.responder_role}）
                    </div>
                    <div>{task.response.response_text}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryPanel({
  data,
  redCount,
  yellowCount,
  openRiskCount,
}: {
  data: WorkbenchData
  redCount: number
  yellowCount: number
  openRiskCount: number
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="红线" value={redCount} />
        <MiniStat label="谈判" value={yellowCount} />
        <MiniStat label="开放" value={openRiskCount} />
      </div>
      <div className="rounded-md border border-slate-200 p-3">
        <h3 className="mb-2 font-semibold text-slate-950">审核摘要</h3>
        <p className="leading-6 text-slate-600">
          {data.latestReview?.results?.summary || '暂无报告摘要。审核完成后，这里展示辅助报告摘要；主产物仍是 Word 批注版。'}
        </p>
      </div>
      <div className="rounded-md border border-slate-200 p-3">
        <h3 className="mb-2 font-semibold text-slate-950">报告版本</h3>
        {!data.currentReport ? (
          <p className="text-slate-500">尚未生成审核报告版本。</p>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-900">报告 v{data.currentReport.version}</span>
              <Badge variant="outline">
                {reportTriggerLabel[data.currentReport.trigger_event] || data.currentReport.trigger_event}
              </Badge>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <span>ASK 总数：{data.currentReport.report_data?.summary?.total ?? 0}</span>
              <span>已回应：{data.currentReport.report_data?.summary?.responded ?? 0}</span>
              <span>待处理：{data.currentReport.report_data?.summary?.pending ?? 0}</span>
              <span>已关闭：{data.currentReport.report_data?.summary?.closed ?? 0}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">{formatTime(data.currentReport.created_at)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantPanel({
  selectedRisk,
  reviewRun,
  latestSummary,
}: {
  selectedRisk: RiskFinding | null
  reviewRun: ReviewRun | null
  latestSummary?: string
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-indigo-950">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <BotIcon className="h-4 w-4" />
          ONES 业务运营
        </div>
        <p className="leading-6">
          只基于当前合同、规则版本、模型策略和已生成证据辅助解释，不作为规则事实来源。
        </p>
      </div>

      {selectedRisk ? (
        <div className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-2 font-semibold text-slate-950">当前风险解释</h3>
          <p className="leading-6 text-slate-600">{selectedRisk.description || selectedRisk.title}</p>
          {selectedRisk.suggestion && (
            <p className="mt-2 rounded-md bg-slate-50 p-2 leading-6 text-slate-700">
              建议：{selectedRisk.suggestion}
            </p>
          )}
          {selectedRisk.rule_code && (
            <p className="mt-2 font-mono text-xs text-slate-500">
              依据：{selectedRisk.rule_code}
              {selectedRisk.rule_version ? ` · v${selectedRisk.rule_version}` : ''}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 p-3 text-slate-500">
          选择一个风险项后展示解释、谈判依据和批注文案来源。
        </p>
      )}

      <div className="rounded-md border border-slate-200 p-3">
        <h3 className="mb-2 font-semibold text-slate-950">上下文边界</h3>
        <div className="space-y-2 text-slate-600">
          <InfoLine label="审核运行" value={reviewRun?.id || '未绑定'} />
          <InfoLine label="规则发布包" value={reviewRun?.skill_bundle_id || '未生成'} />
          <InfoLine label="规则快照" value={reviewRun?.rule_snapshot_id || '未绑定'} />
          <InfoLine label="模型策略" value={reviewRun?.model_policy_id || 'rule-engine'} />
        </div>
      </div>

      {latestSummary && (
        <div className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-2 font-semibold text-slate-950">报告辅助摘要</h3>
          <p className="leading-6 text-slate-600">{latestSummary}</p>
        </div>
      )}
    </div>
  )
}

function EvidencePanel({
  reviewRun,
  latestJob,
}: {
  reviewRun: ReviewRun | null
  latestJob: WorkbenchData['latestJob']
}) {
  return (
    <div className="space-y-3 text-sm">
      <InfoLine label="运行状态" value={reviewRun?.status || '未开始'} />
      <InfoLine label="运行编号" value={reviewRun?.id || '未绑定'} />
      <InfoLine
        label="证据状态"
        value={reviewRun?.evidence_status ? evidenceStatusLabel[reviewRun.evidence_status] : '未绑定'}
      />
      <InfoLine label="规则快照" value={reviewRun?.rule_snapshot_id || '未绑定'} />
      <InfoLine label="快照数量" value={String(reviewRun?.rule_snapshot_refs?.length ?? 0)} />
      <InfoLine label="规则发布包" value={reviewRun?.skill_bundle_id || '未生成'} />
      <InfoLine
        label="规则源"
        value={formatRuleSource(reviewRun?.skill_bundle?.production_source.source_of_truth)}
      />
      <InfoLine
        label="转译状态"
        value={formatLifecycle(reviewRun?.skill_bundle?.rule_translation_status)}
      />
      <InfoLine
        label="规则完整性"
        value={reviewRun?.skill_bundle
          ? `${reviewRun.skill_bundle.rules.actual}/${reviewRun.skill_bundle.rules.expected ?? '未知'}`
          : '未记录'}
      />
      <InfoLine label="规则验收" value={formatLifecycle(reviewRun?.skill_bundle?.rule_acceptance_status)} />
      <InfoLine label="模型质量金标" value={formatLifecycle(reviewRun?.skill_bundle?.model_quality_eval_status)} />
      <InfoLine label="本次语义模型调用" value={formatLifecycle(reviewRun?.skill_bundle?.runtime_invocation_status)} />
      <InfoLine label="模型策略" value={reviewRun?.model_policy_id || 'rule-engine'} />
      <InfoLine
        label="模型来源"
        value={reviewRun?.model_policy?.source ? modelPolicySourceLabel[reviewRun.model_policy.source] : '未记录'}
      />
      <InfoLine label="语义模型" value={reviewRun?.model_policy?.model || '未记录'} />
      <InfoLine label="调用阶段" value={formatInvocationPhase(reviewRun?.model_policy?.phase)} />
      <InfoLine label="调用通道" value={formatTransport(reviewRun?.model_policy?.transport)} />
      <InfoLine label="调用耗时" value={formatLatency(reviewRun?.model_policy?.latency_ms)} />
      <InfoLine label="调用记录" value={reviewRun?.model_policy?.invocation_id || '未记录'} />
      <InfoLine
        label="实际档位"
        value={formatProviderTarget(reviewRun?.model_policy?.actual_provider_profile || reviewRun?.model_policy?.provider)}
      />
      <InfoLine label="实际模型" value={reviewRun?.model_policy?.actual_provider_model || reviewRun?.model_policy?.model || '未记录'} />
      <InfoLine
        label="目标档位"
        value={formatProviderTarget(reviewRun?.model_policy?.intended_provider_profile || reviewRun?.model_policy?.provider)}
      />
      <InfoLine label="目标模型" value={reviewRun?.model_policy?.intended_provider_model || '未记录'} />
      <InfoLine
        label="请求档位"
        value={formatProviderTarget(reviewRun?.model_policy?.requested_provider_profile)}
      />
      <InfoLine label="请求模型" value={reviewRun?.model_policy?.requested_provider_model || '未记录'} />
      <InfoLine label="请求被接受" value={formatBooleanState(reviewRun?.model_policy?.requested_provider_accepted)} />
      <InfoLine
        label="尝试错误"
        value={typeof reviewRun?.model_policy?.attempt_error_count === 'number'
          ? String(reviewRun.model_policy.attempt_error_count)
          : '未记录'}
      />
      <InfoLine label="开始时间" value={formatTime(reviewRun?.started_at)} />
      <InfoLine label="完成时间" value={formatTime(reviewRun?.completed_at)} />
      <div className="border-t border-slate-200 pt-3">
        <InfoLine label="最近执行器" value={formatExecutor(latestJob?.provider)} />
        <InfoLine label="执行状态" value={formatLifecycle(latestJob?.status)} />
        <InfoLine label="降级" value={latestJob?.degraded ? '是' : '否'} />
      </div>
      {reviewRun?.model_invocations && reviewRun.model_invocations.length > 0 && (
        <div className="border-t border-slate-200 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">调用链</p>
          <div className="space-y-2">
            {reviewRun.model_invocations.map((invocation) => (
              <div key={invocation.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{formatInvocationPhase(invocation.phase)}</span>
                  <Badge variant={invocation.degraded ? 'secondary' : 'outline'}>
                    {formatLifecycle(invocation.status)}
                  </Badge>
                </div>
                <div className="mt-1 truncate">
                  {formatProviderTarget(invocation.actual_provider_profile || invocation.provider)} / {invocation.actual_provider_model || invocation.model || '模型未记录'} / {formatTransport(invocation.transport)}
                </div>
                {(invocation.intended_provider_profile || invocation.requested_provider_profile) && (
                  <div className="mt-1 grid gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-slate-500 sm:grid-cols-3">
                    <span>目标: {formatProviderTarget(invocation.intended_provider_profile)} / {invocation.intended_provider_model || '未记录'}</span>
                    <span>请求: {formatProviderTarget(invocation.requested_provider_profile)} / {invocation.requested_provider_model || '未记录'}</span>
                    <span>接受: {formatBooleanState(invocation.requested_provider_accepted)}</span>
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
                  <span>{formatLatency(invocation.latency_ms)}</span>
                  <span className="font-mono">{invocation.id.slice(0, 8)}</span>
                  {typeof invocation.dropped_risk_count === 'number' && invocation.dropped_risk_count > 0 && (
                    <span>剔除风险 {invocation.dropped_risk_count}</span>
                  )}
                  {typeof invocation.validation_warning_count === 'number' && invocation.validation_warning_count > 0 && (
                    <span>校验警告 {invocation.validation_warning_count}</span>
                  )}
                  {typeof invocation.attempt_error_count === 'number' && invocation.attempt_error_count > 0 && (
                    <span>尝试错误 {invocation.attempt_error_count}</span>
                  )}
                  {invocation.fallback_reason && <span>{invocation.fallback_reason}</span>}
                </div>
                {(invocation.attempt_errors || []).length > 0 && (
                  <div className="mt-2 space-y-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                    {(invocation.attempt_errors || []).map((message) => (
                      <p key={message} className="break-words font-mono">
                        {message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {latestJob?.last_error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {latestJob.last_error}
        </p>
      )}
      {reviewRun?.model_policy?.last_error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {reviewRun.model_policy.last_error}
        </p>
      )}
      {reviewRun?.model_policy?.fallback_reason && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-700">
          {reviewRun.model_policy.fallback_reason}
        </p>
      )}
    </div>
  )
}

function VersionOutputPanel({
  data,
  contractId,
  actionLabel,
}: {
  data: WorkbenchData
  contractId: string
  actionLabel: string
}) {
  const visibleVersions = data.versions.slice(0, 6)
  const hiddenVersionCount = Math.max(0, data.versions.length - visibleVersions.length)
  const visibleOutputs = data.outputs.slice(0, 5)
  const hiddenOutputCount = Math.max(0, data.outputs.length - visibleOutputs.length)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <WorkflowIcon className="h-4 w-4" />
              版本与产物
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              客户谈判后的回传文件会形成新的合同版本，不作为发起审核入口。
            </p>
          </div>
          <Link href={`/contracts/${contractId}/edit`}>
            <Button size="sm" variant="outline" className="gap-1.5">
              <UploadIcon className="h-4 w-4" />
              {actionLabel}
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <InfoLine label="文件大小" value={formatSize(data.size)} />
        <InfoLine label="文件类型" value={data.mime_type || '未记录'} />
        <InfoLine label="创建时间" value={formatTime(data.created_at)} />
        <InfoLine label="更新时间" value={formatTime(data.updated_at)} />
        <div className="border-t border-slate-200 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">版本记录</p>
          <div className="space-y-2">
            {data.versions.length === 0 ? (
              <p className="text-slate-500">暂无版本记录。</p>
            ) : visibleVersions.map((version) => (
              <div key={version.id} className="rounded-md bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">v{version.version_number}</span>
                  <Badge variant={version.source === 'review_revision' ? 'default' : 'outline'}>
                    {version.source === 'original' ? '源文件' : version.source === 'manual_revision' ? '客户/人工版本' : '批注版'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{version.change_summary || formatTime(version.created_at)}</p>
              </div>
            ))}
            {hiddenVersionCount > 0 && (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                已收起 {hiddenVersionCount} 个更早版本。版本流需要保持可追溯，但默认只展示最近记录，避免批注产物污染主视图。
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-slate-200 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">源文件批注产物</p>
          {data.outputs.length === 0 ? (
            <p className="text-slate-500">尚未生成 ONES 批注版本。</p>
          ) : (
            <div className="space-y-2">
              {visibleOutputs.map((output, index) => (
                <div key={output.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-900">批注版 v{output.version_number}</div>
                    {index === 0 ? <Badge variant="default">最新</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatTime(output.created_at)}</div>
                </div>
              ))}
              {hiddenOutputCount > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  另有 {hiddenOutputCount} 个历史批注产物已折叠。后续应通过导出幂等和版本归档治理，避免同一 ReviewRun 重复生成大量批注版。
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AnnotationsPanel({ annotations }: { annotations: Annotation[] }) {
  const manualCount = annotations.filter((annotation) => needsManualAnnotationLocation(annotation)).length
  const urgentCount = annotations.filter((annotation) => annotation.priority === 'urgent').length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareTextIcon className="h-4 w-4" />
            客户侧批注预览
          </CardTitle>
          {annotations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <TrafficLightPill label="可写入" value={annotations.length - manualCount} tone="emerald" />
              <TrafficLightPill label="待定位" value={manualCount} tone={manualCount > 0 ? 'amber' : 'slate'} />
              <TrafficLightPill label="紧急" value={urgentCount} tone={urgentCount > 0 ? 'red' : 'slate'} />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {annotations.length === 0 ? (
          <p className="text-sm text-slate-500">审核完成后会在这里展示可写入 Word 的批注。</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {annotations.slice(0, 6).map((annotation) => {
              const manualLocation = needsManualAnnotationLocation(annotation)
              const customerComment = buildCustomerFacingWordComment(annotation.comment) || annotation.comment
              return (
                <div
                  key={annotation.id}
                  className={`p-3 text-sm ${manualLocation ? 'bg-amber-50/70' : 'bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{annotation.selected_text || '未定位批注'}</div>
                      <p className="mt-1 line-clamp-2 leading-5 text-slate-600">{customerComment}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {manualLocation && <Badge variant="destructive">需人工定位</Badge>}
                      <Badge variant={annotation.priority === 'urgent' ? 'destructive' : 'secondary'}>
                        {annotation.priority || 'normal'}
                      </Badge>
                    </div>
                  </div>
                </div>
              )
            })}
            {annotations.length > 6 && (
              <div className="bg-slate-50 px-3 py-2 text-xs text-slate-500">
                另有 {annotations.length - 6} 条批注意图已折叠，导出时仍会写入源文件。
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-slate-900">{value}</span>
    </div>
  )
}
