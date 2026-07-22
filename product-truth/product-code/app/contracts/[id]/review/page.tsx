'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CircleDotDashedIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  Loader2Icon,
  MessageSquareIcon,
  PaperclipIcon,
  PanelLeftIcon,
  RefreshCcwIcon,
  SendIcon,
  ShieldAlertIcon,
  Undo2Icon,
  XCircleIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { isBrowserWordPreview, isLegacyWordSource } from '@/lib/documents/browser-word-preview'
import { cn } from '@/lib/utils'
import { BrowserWordPreview } from './BrowserWordPreview'

type RiskLevel = 'red' | 'yellow' | 'green' | 'white'
type DecisionKind = 'customer_agreed' | 'customer_feedback' | 'exception_requested'
type ReviewStyle = 'lenient' | 'balanced' | 'strict'
type RightPanelTab = 'guide' | 'basis' | 'evolution'

const RIGHT_PANEL_TABS = [
  { id: 'guide', label: '谈判指南' },
  { id: 'basis', label: '依据' },
  { id: 'evolution', label: '条款演变' },
] as const satisfies ReadonlyArray<{ id: RightPanelTab; label: string }>

interface SourceAnchor {
  page: number
  start: number
  end: number
  excerpt: string
  exact_text?: string
  clause_ref?: string | null
  locator: 'rendered' | 'provisional'
  precision?: 'line' | 'page' | 'source_exact' | 'provisional'
  boxes?: Array<{ left: number; top: number; width: number; height: number; text?: string }>
  anchor_kind?: 'text' | 'point' | 'region'
  point?: { x: number; y: number }
  region?: { x: number; y: number; width: number; height: number }
}

interface ResolutionOption {
  id: string
  label: string
  description?: string | null
  action: string
  action_type?: string
  negotiation_guidance?: string | null
  bottom_line?: string | null
  comment_template?: string | null
  rule_code: string
  rule_name: string
  change_mode?: string | null
  revision_text?: string | null
}

interface RiskCardData {
  id: string
  review_id?: string | null
  level: RiskLevel
  title: string
  description?: string | null
  suggestion?: string | null
  clause_ref?: string | null
  status: string
  evidence_scope?: 'source_span' | 'document_coverage' | string | null
  customer_output_eligible?: boolean
  source_anchor: SourceAnchor | null
  evidence_anchors?: SourceAnchor[]
  resolution_options: ResolutionOption[]
  resolved_by_batch?: boolean
  review_outcome?: 'resolved' | 'still_open' | 'needs_revision' | null
  outcome_reason?: string | null
}

interface DecisionDraft {
  id: string
  risk_id: string
  status: 'draft_selected' | 'batch_submitted'
  decision_kind?: DecisionKind | null
  negotiation_result?: DecisionKind | null
  selected_option_id?: string | null
  resolution_strategy_id?: string | null
  feedback?: string | null
  comment_preview?: string | null
  customer_comment?: string | null
  revision_text?: string | null
  internal_note?: string | null
  optimistic_version: number
  workflow_state?: 'OPEN' | 'STRATEGY_SELECTED' | 'RESULT_RECORDED' | 'DRAFT_READY' | 'REVIEW_QUEUED' | 'REVIEW_PASSED' | 'NEEDS_REVISION'
  source_anchor?: SourceAnchor | null
}

interface ModelInvocation {
  id: string
  provider?: string | null
  model?: string | null
  status: string
  degraded?: boolean
  latency_ms?: number | null
}

interface ManualSourceAnnotation {
  id: string
  comment: string
  status: string
  source_anchor: {
    kind: 'point' | 'region'
    page: number
    point?: { x: number; y: number }
    region?: { x: number; y: number; width: number; height: number }
  }
}

interface ReviewData {
  id: string
  filename: string
  storage_path?: string | null
  status: string
  has_source_preview: boolean
  riskCards: RiskCardData[]
  stats: { total: number; red: number; yellow: number; green: number; open: number }
  riskReviewId?: string | null
  decisionDrafts: DecisionDraft[]
  sourcePageMap?: {
    page_count: number | null
    locator: 'rendered' | 'provisional'
    source_hash?: string | null
    source_text_hash?: string | null
  }
  sourcePreviewError?: string | null
  sourceReviewStale?: boolean
  latestReview?: {
    id: string
    status?: 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | null
    review_trigger?: 'direct' | 'decision_batch' | null
  } | null
  latestSubmissionBatch?: {
    id: string
    review_style?: ReviewStyle
    status: 'checking' | 'conflict' | 'review_running' | 'completed' | 'failed'
    new_review_id?: string | null
    analysis_job?: {
      id: string
      status: 'preparing' | 'queued' | 'running' | 'completed' | 'failed'
      last_error?: string | null
    } | null
  } | null
  publishedRuleBundle?: {
    id: string
    version: number
    published_at?: string | null
    rule_count: number
  } | null
  reviewStyles: Array<{ id: ReviewStyle; label: string; description: string }>
  modelInvocations?: ModelInvocation[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ConflictItem {
  code?: string
  risk_id?: string
  message?: string
  related_risk_ids?: string[]
}

type RiskFilter = 'all' | 'red' | 'todo' | 'drafted'

const decisionMeta: Record<DecisionKind, { label: string; hint: string }> = {
  customer_agreed: { label: '客户已同意', hint: '记录客户已接受的法务策略与参数。' },
  customer_feedback: { label: '客户有反馈', hint: '先如实记录客户意见；需要给出替代方案时，再补选法务策略。' },
  exception_requested: { label: '要求特批', hint: '保留风险事实，带原因进入特批审批。' },
}

function authHeaders(json = false) {
  const token = localStorage.getItem('token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

function responseError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: string | { message?: string } }).error
  if (typeof error === 'string') return error.trim() ? error : fallback
  return error?.message || fallback
}

function responseDownloadName(response: Response, fallback: string) {
  const disposition = response.headers.get('content-disposition') || ''
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (!utf8Match?.[1]) return fallback
  try {
    return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ''))
  } catch {
    return fallback
  }
}

export default function ContractReviewPage() {
  const params = useParams()
  const contractId = params.id as string
  const [contract, setContract] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [spotlight, setSpotlight] = useState(false)
  const [autoNext, setAutoNext] = useState(false)
  const [zoom, setZoom] = useState(110)
  const [currentSourcePage, setCurrentSourcePage] = useState(1)
  const [manualAnchorMode, setManualAnchorMode] = useState<'point' | 'region' | null>(null)
  const [manualPoint, setManualPoint] = useState<{ page: number; x: number; y: number } | null>(null)
  const [manualRegion, setManualRegion] = useState<{ page: number; x: number; y: number; width: number; height: number } | null>(null)
  const [manualComment, setManualComment] = useState('')
  const [manualAnnotations, setManualAnnotations] = useState<ManualSourceAnnotation[]>([])
  const [manualAnnotationSaving, setManualAnnotationSaving] = useState(false)
  const [annotationLoadError, setAnnotationLoadError] = useState('')
  const [annotationReloadNonce, setAnnotationReloadNonce] = useState(0)
  const [sourcePages, setSourcePages] = useState<Record<number, string>>({})
  const [sourceError, setSourceError] = useState('')
  const [sourceReloadNonce, setSourceReloadNonce] = useState(0)
  const [intent, setIntent] = useState<DecisionKind | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [reviewStyle, setReviewStyle] = useState<ReviewStyle>('balanced')
  const [submitting, setSubmitting] = useState(false)
  const [submissionMessage, setSubmissionMessage] = useState('')
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [exporting, setExporting] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('guide')
  const [copiedRiskId, setCopiedRiskId] = useState<string | null>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const sourceViewportRef = useRef<HTMLDivElement>(null)
  const sourceHighlightRef = useRef<HTMLDivElement>(null)
  const sourcePageUrlsRef = useRef<Record<number, string>>({})
  const sourceErrorIdentityRef = useRef('')
  const manualRegionStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const manualAnnotationSavingRef = useRef(false)
  const manualAnnotationRequestIdRef = useRef<string | null>(null)
  const annotationLoadGenerationRef = useRef(0)
  const jobPollStateRef = useRef<{ jobId: string; startedAt: number; attempt: number } | null>(null)
  const pendingManualAnnotationRef = useRef(false)
  const decisionDraftByRiskRef = useRef<Map<string, DecisionDraft>>(new Map())
  const decisionSaveChainRef = useRef<Promise<void>>(Promise.resolve())
  const decisionSavePendingCountRef = useRef<Map<string, number>>(new Map())
  const dirtyDecisionRiskIdsRef = useRef<Set<string>>(new Set())
  const decisionSaveErrorsRef = useRef<Map<string, string>>(new Map())
  const submissionLockedRef = useRef(false)
  const hydratedDecisionRiskRef = useRef<string | null>(null)
  const selectedRiskIdRef = useRef<string | null>(selectedRiskId)
  selectedRiskIdRef.current = selectedRiskId
  pendingManualAnnotationRef.current = Boolean(manualPoint || manualRegion || manualComment.trim())
  const sourceIdentityKey = [
    contractId,
    contract?.storage_path || '',
    contract?.sourcePageMap?.source_hash || '',
    contract?.sourcePageMap?.source_text_hash || '',
  ].join(':')
  const sourceIdentityKeyRef = useRef(sourceIdentityKey)
  sourceIdentityKeyRef.current = sourceIdentityKey
  const decisionContextKey = `${sourceIdentityKey}:${contract?.riskReviewId || ''}`
  const decisionContextKeyRef = useRef(decisionContextKey)
  decisionContextKeyRef.current = decisionContextKey
  const sourceIdentity = useMemo(() => (
    contract?.storage_path
      && contract.sourcePageMap?.source_hash
      && contract.sourcePageMap.source_text_hash
      ? {
        storage_path: contract.storage_path,
        source_hash: contract.sourcePageMap.source_hash,
        source_text_hash: contract.sourcePageMap.source_text_hash,
      }
      : null
  ), [contract?.sourcePageMap?.source_hash, contract?.sourcePageMap?.source_text_hash, contract?.storage_path])

  const loadReview = useCallback(async () => {
    try {
      const response = await fetch(`/api/contracts/${contractId}/review`, { headers: authHeaders() })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(responseError(payload, '审核任务加载失败'))
      const next = payload.data as ReviewData
      decisionDraftByRiskRef.current = new Map(next.decisionDrafts.map((draft) => [draft.risk_id, draft]))
      setContract(next)
      const nextSourceIdentityKey = [
        contractId,
        next.storage_path || '',
        next.sourcePageMap?.source_hash || '',
        next.sourcePageMap?.source_text_hash || '',
      ].join(':')
      const preservePageError = sourceErrorIdentityRef.current === nextSourceIdentityKey
      if (next.sourcePreviewError) {
        sourceErrorIdentityRef.current = ''
        setSourceError(next.sourcePreviewError)
      } else if (!preservePageError) {
        setSourceError('')
      }
      if (next.latestSubmissionBatch?.review_style) setReviewStyle(next.latestSubmissionBatch.review_style)
      setSelectedRiskId((current) => current && next.riskCards.some((risk) => risk.id === current)
        ? current
        : pendingManualAnnotationRef.current ? current : next.riskCards[0]?.id || null)
      setErrorMessage('')
      return next
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '审核任务加载失败')
      return null
    } finally {
      setLoading(false)
    }
  }, [contractId])

  useEffect(() => {
    void loadReview()
  }, [loadReview])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadReview()
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadReview])

  useEffect(() => {
    const jobStatus = contract?.latestSubmissionBatch?.analysis_job?.status
    const jobId = contract?.latestSubmissionBatch?.analysis_job?.id
    if (!jobId || (jobStatus !== 'preparing' && jobStatus !== 'queued' && jobStatus !== 'running')) {
      jobPollStateRef.current = null
      return
    }
    if (jobPollStateRef.current?.jobId !== jobId) {
      jobPollStateRef.current = { jobId, startedAt: Date.now(), attempt: 0 }
    }
    const pollState = jobPollStateRef.current
    let cancelled = false
    let timer: number | null = null

    function schedule() {
      if (cancelled) return
      if (pollState.attempt >= 8 || Date.now() - pollState.startedAt >= 120_000) {
        setSubmissionMessage('复审仍在后台处理；为避免无效轮询，自动刷新已停止。切回本页或手动刷新可继续查看。')
        return
      }
      const delay = Math.min(15_000, 2_000 * (2 ** pollState.attempt))
      timer = window.setTimeout(poll, delay)
    }

    async function poll() {
      if (cancelled) return
      pollState.attempt += 1
      try {
        const response = await fetch(`/api/contracts/${contractId}/review?view=status`, {
          headers: authHeaders(),
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) throw new Error(responseError(payload, '复审状态刷新失败'))
        const nextBatch = payload.data?.latestSubmissionBatch as ReviewData['latestSubmissionBatch']
        const nextStatus = nextBatch?.analysis_job?.status
        if (nextBatch?.analysis_job?.id !== jobId) {
          await loadReview()
          return
        }
        if (nextStatus === 'completed' || nextStatus === 'failed') {
          await loadReview()
          return
        }
        if (!cancelled) {
          setContract((current) => current ? { ...current, latestSubmissionBatch: nextBatch } : current)
          schedule()
        }
      } catch (error) {
        if (!cancelled) {
          if (pollState.attempt >= 8) {
            setSubmissionMessage(error instanceof Error ? `${error.message}；自动刷新已停止，可稍后手动刷新。` : '复审状态刷新失败；自动刷新已停止。')
          } else {
            schedule()
          }
        }
      }
    }

    schedule()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [contract?.latestSubmissionBatch?.analysis_job?.id, contract?.latestSubmissionBatch?.analysis_job?.status, contractId, loadReview])

  useEffect(() => {
    sourceErrorIdentityRef.current = ''
    Object.values(sourcePageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
    sourcePageUrlsRef.current = {}
    setSourcePages({})
    setManualAnnotations([])
    setAnnotationLoadError('')
    setCurrentSourcePage(1)
    setManualAnchorMode(null)
    setManualPoint(null)
    setManualRegion(null)
    setManualComment('')
    manualRegionStartRef.current = null
    manualAnnotationRequestIdRef.current = null
    dirtyDecisionRiskIdsRef.current.clear()
    decisionSaveErrorsRef.current.clear()
    decisionSavePendingCountRef.current.clear()
    decisionSaveChainRef.current = Promise.resolve()
    submissionLockedRef.current = false
    hydratedDecisionRiskRef.current = null
    return () => {
      Object.values(sourcePageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
      sourcePageUrlsRef.current = {}
    }
  }, [sourceIdentityKey])

  useEffect(() => {
    dirtyDecisionRiskIdsRef.current.clear()
    decisionSaveErrorsRef.current.clear()
    decisionSavePendingCountRef.current.clear()
    decisionSaveChainRef.current = Promise.resolve()
    submissionLockedRef.current = false
    hydratedDecisionRiskRef.current = null
  }, [decisionContextKey])

  const selectedRisk = useMemo(
    () => contract?.riskCards.find((risk) => risk.id === selectedRiskId) || null,
    [contract, selectedRiskId]
  )
  const selectedRiskIsDocumentLevel = Boolean(selectedRisk && !selectedRisk.source_anchor && (
    selectedRisk.evidence_scope === 'document_coverage'
    || selectedRisk.customer_output_eligible === false
  ))
  const isPdfSource = contract?.filename.toLowerCase().endsWith('.pdf') || false
  const isBrowserWordSource = isBrowserWordPreview(contract?.filename)
  const isLegacyDocSource = isLegacyWordSource(contract?.filename)
  const sourcePageCount = Math.max(1, contract?.sourcePageMap?.page_count || 1)
  const activeSourcePage = Math.min(sourcePageCount, Math.max(1, currentSourcePage))
  const draftMap = useMemo(
    () => new Map((contract?.decisionDrafts || []).map((draft) => [draft.risk_id, draft])),
    [contract]
  )
  decisionDraftByRiskRef.current = draftMap
  const selectedDraft = selectedRisk ? draftMap.get(selectedRisk.id) : undefined
  const persistedIntent = selectedDraft?.negotiation_result || selectedDraft?.decision_kind || null
  const persistedOptionId = selectedDraft?.resolution_strategy_id || selectedDraft?.selected_option_id || null
  const hasUnsavedSelectedDecision = Boolean(selectedRisk && (
    intent !== persistedIntent
    || selectedOptionId !== persistedOptionId
    || feedback.trim() !== (selectedDraft?.feedback || '').trim()
  ))
  const activeJobStatus = contract?.latestSubmissionBatch?.analysis_job?.status || null
  const reviewExecutionLocked = activeJobStatus === 'preparing' || activeJobStatus === 'queued' || activeJobStatus === 'running'
  const batchControlsLocked = submitting || reviewExecutionLocked
  const selectedRiskNeedsSourceLocation = Boolean(selectedRisk && (
    !selectedRisk.source_anchor
    || !selectedRisk.source_anchor.exact_text
    || selectedRisk.source_anchor.end <= selectedRisk.source_anchor.start
  ))
  const selectedRiskManualAnchor = selectedRiskNeedsSourceLocation
    && !selectedRiskIsDocumentLevel
    && contract?.filename.toLowerCase().endsWith('.pdf')
    ? manualRegion ? {
      kind: 'region' as const,
      page: manualRegion.page,
      region: { x: manualRegion.x, y: manualRegion.y, width: manualRegion.width, height: manualRegion.height },
    } : manualPoint ? {
      kind: 'point' as const,
      page: manualPoint.page,
      point: { x: manualPoint.x, y: manualPoint.y },
    } : null
    : null
  const decisionControlsLocked = batchControlsLocked
    || selectedRisk?.status !== 'open'
    || Boolean(selectedRisk?.resolved_by_batch)
    || selectedRiskIsDocumentLevel
    || (selectedRiskNeedsSourceLocation && !selectedRiskManualAnchor)
  const executionStatusMessage = activeJobStatus === 'preparing'
    ? '复审批次正在完成持久化绑定，尚未开放给 Worker；若超过 15 分钟，下一次队列领取会将其回收为失败态。'
    : activeJobStatus === 'queued'
      ? '复审批次已完成绑定，正在等待 Worker。'
      : activeJobStatus === 'running'
        ? '复审批次正在运行，当前决策已锁定。'
        : ''
  const directReviewExecutionMessage = contract?.latestReview?.review_trigger === 'direct'
    ? contract.latestReview.status === 'PARSING' || contract.latestReview.status === 'ANALYZING'
      ? '当前文件的直接审核仍在运行；风险事实只会在 ReviewRun 完整完成后显示。'
      : contract.latestReview.status === 'FAILED'
        ? '当前文件的直接审核失败，未把空风险列表当作审核通过；请查看运行记录后重试。'
        : ''
    : ''
  const sourceReviewStaleMessage = contract?.sourceReviewStale
    ? '最近 ReviewRun 未绑定当前源文件版本，历史风险已隔离。请先对当前文件重新审核；PDF 仍可直接做人工点位/区域批注。'
    : ''
  const visibleSubmissionMessage = submissionMessage || executionStatusMessage || directReviewExecutionMessage || sourceReviewStaleMessage
  const hasPendingDecisionChanges = hasUnsavedSelectedDecision
    || dirtyDecisionRiskIdsRef.current.size > 0
    || decisionSaveErrorsRef.current.size > 0
  const selectedOption = useMemo(
    () => selectedRisk?.resolution_options.find((option) => option.id === selectedOptionId) || null,
    [selectedOptionId, selectedRisk]
  )
  const negotiationCopy = selectedOption?.negotiation_guidance?.trim() || ''
  const customerFacingPreview = selectedDraft?.revision_text
    || selectedDraft?.customer_comment
    || selectedDraft?.comment_preview
    || selectedOption?.revision_text
    || selectedOption?.comment_template
    || null
  const selectedAnchorBoxes = useMemo(
    () => selectedRisk?.source_anchor?.boxes || [],
    [selectedRisk]
  )
  const selectedAnchorBounds = useMemo(() => {
    if (selectedAnchorBoxes.length === 0) return null
    const left = Math.min(...selectedAnchorBoxes.map((box) => box.left))
    const top = Math.min(...selectedAnchorBoxes.map((box) => box.top))
    const right = Math.max(...selectedAnchorBoxes.map((box) => box.left + box.width))
    const bottom = Math.max(...selectedAnchorBoxes.map((box) => box.top + box.height))
    return { left, top, width: right - left, height: bottom - top }
  }, [selectedAnchorBoxes])
  const isDraftComplete = useCallback((draft: DecisionDraft | undefined) => {
    if (!draft) return false
    const result = draft.negotiation_result || draft.decision_kind
    if (!result) return false
    if (result === 'customer_agreed') return Boolean(draft.resolution_strategy_id || draft.selected_option_id)
    return Boolean(draft.feedback?.trim())
  }, [])
  const filteredRisks = useMemo(() => (contract?.riskCards || []).filter((risk) => {
    if (riskFilter === 'red') return risk.level === 'red'
    if (riskFilter === 'drafted') return !risk.resolved_by_batch && isDraftComplete(draftMap.get(risk.id))
    if (riskFilter === 'todo') return !risk.resolved_by_batch && !isDraftComplete(draftMap.get(risk.id))
    return true
  }), [contract, draftMap, isDraftComplete, riskFilter])
  const showOptionDescriptions = useMemo(() => {
    const descriptions = new Set(
      (selectedRisk?.resolution_options || [])
        .map((option) => option.description?.trim())
        .filter(Boolean)
    )
    return descriptions.size > 1
  }, [selectedRisk])

  useEffect(() => {
    if (!selectedRisk?.source_anchor?.page) return
    setCurrentSourcePage(Math.min(sourcePageCount, Math.max(1, selectedRisk.source_anchor.page)))
  }, [selectedRisk?.source_anchor?.page, selectedRiskId, sourcePageCount])

  useEffect(() => {
    setCurrentSourcePage((page) => Math.min(sourcePageCount, Math.max(1, page)))
  }, [sourcePageCount])

  useEffect(() => {
    if (!selectedRisk) return
    const riskChanged = hydratedDecisionRiskRef.current !== selectedRisk.id
    if (!riskChanged && dirtyDecisionRiskIdsRef.current.has(selectedRisk.id)) return
    hydratedDecisionRiskRef.current = selectedRisk.id
    setIntent(persistedIntent)
    setSelectedOptionId(persistedOptionId)
    setFeedback(selectedDraft?.feedback || '')
    const riskError = decisionSaveErrorsRef.current.get(selectedRisk.id) || ''
    setSaveState(riskError ? 'error' : selectedDraft ? 'saved' : 'idle')
    setSaveError(riskError)
  }, [persistedIntent, persistedOptionId, selectedDraft?.feedback, selectedDraft?.id, selectedDraft?.optimistic_version, selectedRisk])

  useEffect(() => {
    setManualPoint(null)
    setManualRegion(null)
    setManualComment('')
    setManualAnchorMode(null)
    manualRegionStartRef.current = null
    manualAnnotationRequestIdRef.current = null
  }, [selectedRiskId])

  useEffect(() => {
    setCopiedRiskId(null)
  }, [selectedRiskId, selectedOptionId])

  const copyNegotiationGuidance = useCallback(async () => {
    if (!selectedRisk || !negotiationCopy) return
    try {
      await navigator.clipboard.writeText(negotiationCopy)
      setCopiedRiskId(selectedRisk.id)
    } catch {
      setSubmissionMessage('浏览器未允许复制，请手动选择谈判话术。')
    }
  }, [negotiationCopy, selectedRisk])

  const normalizedPagePoint = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    }
  }, [])

  const setManualSourcePoint = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (manualAnchorMode !== 'point' || !contract?.filename.toLowerCase().endsWith('.pdf')) return
    const { x, y } = normalizedPagePoint(event)
    setManualRegion(null)
    manualAnnotationRequestIdRef.current = null
    setManualPoint({ page: activeSourcePage, x, y })
    setManualAnchorMode(null)
    setSaveState('idle')
  }, [activeSourcePage, contract?.filename, manualAnchorMode, normalizedPagePoint])

  const startManualRegion = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (manualAnchorMode !== 'region') return
    event.preventDefault()
    const start = normalizedPagePoint(event)
    manualRegionStartRef.current = { ...start, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [manualAnchorMode, normalizedPagePoint])

  const finishManualRegion = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (manualAnchorMode !== 'region' || !manualRegionStartRef.current || manualRegionStartRef.current.pointerId !== event.pointerId) return
    const end = normalizedPagePoint(event)
    const start = manualRegionStartRef.current
    manualRegionStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const region = {
      page: activeSourcePage,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
    if (region.width < 0.01 || region.height < 0.01) {
      setSaveError('框选区域太小，请拖动选择一个可见区域。')
      return
    }
    setManualPoint(null)
    manualAnnotationRequestIdRef.current = null
    setManualRegion(region)
    setManualAnchorMode(null)
    setSaveState('idle')
  }, [activeSourcePage, manualAnchorMode, normalizedPagePoint])

  const cancelManualRegionGesture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (manualRegionStartRef.current?.pointerId !== event.pointerId) return
    manualRegionStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  useEffect(() => {
    if (!isPdfSource) return
    const currentPage = activeSourcePage
    const pageCount = contract?.sourcePageMap?.page_count
    if (!currentPage || !pageCount) return
    let active = true
    const keepPages = new Set([currentPage - 1, currentPage, currentPage + 1]
      .filter((page) => page >= 1 && page <= pageCount))
    for (const [pageText, url] of Object.entries(sourcePageUrlsRef.current)) {
      const page = Number(pageText)
      if (keepPages.has(page)) continue
      URL.revokeObjectURL(url)
      delete sourcePageUrlsRef.current[page]
    }
    setSourcePages((current) => Object.entries(current).reduce<Record<number, string>>((retained, [page, url]) => {
      if (keepPages.has(Number(page))) retained[Number(page)] = url
      return retained
    }, {}))
    if (sourcePageUrlsRef.current[currentPage]) {
      sourceErrorIdentityRef.current = ''
      setSourceError('')
    }
    const pages = [currentPage, currentPage - 1, currentPage + 1]
      .filter((page) => page >= 1 && page <= pageCount && !sourcePageUrlsRef.current[page])

    async function loadPages() {
      for (const page of pages) {
        try {
          if (!sourceIdentity) throw new Error(contract?.sourcePreviewError || '源文件身份尚未生成，请重试')
          const identityQuery = new URLSearchParams(sourceIdentity)
          const response = await fetch(`/api/contracts/${contractId}/source/pages/${page}?${identityQuery.toString()}`, {
            headers: authHeaders(),
            cache: 'no-store',
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error(responseError(payload, `真实源文件第 ${page} 页加载失败`))
          }
          const url = URL.createObjectURL(await response.blob())
          if (!active) {
            URL.revokeObjectURL(url)
            return
          }
          sourcePageUrlsRef.current[page] = url
          setSourcePages((current) => ({ ...current, [page]: url }))
          if (page === currentPage) {
            sourceErrorIdentityRef.current = ''
            setSourceError('')
          }
        } catch (error) {
          if (active && page === currentPage) {
            sourceErrorIdentityRef.current = sourceIdentityKey
            setSourceError(error instanceof Error ? error.message : '真实源文件页加载失败')
          }
        }
      }
    }
    void loadPages()
    return () => { active = false }
  }, [activeSourcePage, contract?.sourcePageMap?.page_count, contract?.sourcePreviewError, contractId, isPdfSource, sourceIdentity, sourceIdentityKey, sourceReloadNonce])

  useEffect(() => {
    if (!isPdfSource) return
    let active = true
    const generation = annotationLoadGenerationRef.current + 1
    annotationLoadGenerationRef.current = generation
    setAnnotationLoadError('')
    if (!sourceIdentity) {
      if (contract?.sourcePreviewError) setAnnotationLoadError(contract.sourcePreviewError)
      return
    }
    const identityQuery = new URLSearchParams(sourceIdentity)
    void fetch(`/api/contracts/${contractId}/annotations?${identityQuery.toString()}`, { headers: authHeaders(), cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!active || generation !== annotationLoadGenerationRef.current) return
        if (!response.ok || !payload?.success) {
          setAnnotationLoadError(responseError(payload, 'PDF 批注加载失败'))
          return
        }
        setManualAnnotations(payload.data || [])
      })
      .catch((error) => {
        if (active && generation === annotationLoadGenerationRef.current) {
          setAnnotationLoadError(error instanceof Error ? error.message : 'PDF 批注加载失败')
        }
      })
    return () => { active = false }
  }, [annotationReloadNonce, contract?.sourcePreviewError, contractId, isPdfSource, sourceIdentity, sourceIdentityKey])

  const saveManualAnnotation = useCallback(async () => {
    const anchor = manualRegion ? {
      kind: 'region' as const,
      page: manualRegion.page,
      region: { x: manualRegion.x, y: manualRegion.y, width: manualRegion.width, height: manualRegion.height },
    } : manualPoint ? {
      kind: 'point' as const,
      page: manualPoint.page,
      point: { x: manualPoint.x, y: manualPoint.y },
    } : null
    if (!anchor || !manualComment.trim() || manualAnnotationSavingRef.current || !sourceIdentity) return
    const requestSourceIdentityKey = sourceIdentityKey
    const clientRequestId = manualAnnotationRequestIdRef.current || crypto.randomUUID()
    manualAnnotationRequestIdRef.current = clientRequestId
    manualAnnotationSavingRef.current = true
    setManualAnnotationSaving(true)
    setSaveError('')
    try {
      const response = await fetch(`/api/contracts/${contractId}/annotations`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          request_id: clientRequestId,
          comment: manualComment.trim(),
          anchor,
          source_identity: sourceIdentity,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) throw new Error(responseError(payload, 'PDF 批注保存失败'))
      if (sourceIdentityKeyRef.current !== requestSourceIdentityKey) return
      annotationLoadGenerationRef.current += 1
      setManualAnnotations((current) => {
        const saved = payload.data as ManualSourceAnnotation
        return current.some((annotation) => annotation.id === saved.id) ? current : [...current, saved]
      })
      setManualPoint(null)
      setManualRegion(null)
      setManualComment('')
      manualAnnotationRequestIdRef.current = null
      setSubmissionMessage('PDF 人工批注已绑定到当前源文件版本。')
    } catch (error) {
      if (sourceIdentityKeyRef.current !== requestSourceIdentityKey) return
      setSaveError(error instanceof Error ? error.message : 'PDF 批注保存失败')
    } finally {
      manualAnnotationSavingRef.current = false
      setManualAnnotationSaving(false)
    }
  }, [contractId, manualComment, manualPoint, manualRegion, sourceIdentity, sourceIdentityKey])

  const navigateSourcePage = useCallback((page: number) => {
    if (manualPoint || manualRegion || manualComment.trim()) {
      setSaveError('请先保存或取消当前 PDF 批注，再切换页面。')
      return
    }
    manualRegionStartRef.current = null
    setCurrentSourcePage(Math.min(sourcePageCount, Math.max(1, page)))
    setSaveError('')
  }, [manualComment, manualPoint, manualRegion, sourcePageCount])

  const selectRisk = useCallback((riskId: string, options?: { savedRiskId?: string }) => {
    const decisionGuardApplies = selectedRiskId !== options?.savedRiskId
    if (
      decisionGuardApplies && (
        hasUnsavedSelectedDecision
        || (selectedRiskId && decisionSaveErrorsRef.current.has(selectedRiskId))
        || (selectedRiskId && (decisionSavePendingCountRef.current.get(selectedRiskId) || 0) > 0)
      )
    ) {
      setSaveError('当前风险有未保存的决策，请先保存成功或恢复为已保存内容。')
      return
    }
    if (manualPoint || manualRegion || manualComment.trim()) {
      setSaveError('请先保存或取消当前 PDF 批注，再切换风险。')
      return
    }
    setSelectedRiskId(riskId)
    setRailOpen(false)
  }, [hasUnsavedSelectedDecision, manualComment, manualPoint, manualRegion, selectedRiskId])

  useEffect(() => {
    rightPanelRef.current?.scrollTo({ top: 0 })
  }, [selectedRiskId])

  const centerSourceHighlight = useCallback(() => {
    requestAnimationFrame(() => {
      const viewport = sourceViewportRef.current
      const highlight = sourceHighlightRef.current
      if (!viewport || !highlight) return
      const viewportRect = viewport.getBoundingClientRect()
      const highlightRect = highlight.getBoundingClientRect()
      const target = viewport.scrollTop + highlightRect.top - viewportRect.top
        - viewport.clientHeight / 2 + highlightRect.height / 2
      viewport.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    })
  }, [])

  useEffect(() => {
    if (!selectedAnchorBounds || !selectedRisk?.source_anchor || !sourcePages[selectedRisk.source_anchor.page]) return
    const timer = window.setTimeout(centerSourceHighlight, 80)
    return () => window.clearTimeout(timer)
  }, [centerSourceHighlight, selectedAnchorBounds, selectedRisk, sourcePages, zoom])

  useEffect(() => {
    let timer: number | null = null
    const onResize = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(centerSourceHighlight, 80)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) window.clearTimeout(timer)
    }
  }, [centerSourceHighlight])

  const moveRisk = useCallback((delta: number) => {
    if (!contract?.riskCards.length || !selectedRiskId) return
    const current = contract.riskCards.findIndex((risk) => risk.id === selectedRiskId)
    const target = Math.max(0, Math.min(contract.riskCards.length - 1, current + delta))
    selectRisk(contract.riskCards[target].id)
  }, [contract, selectRisk, selectedRiskId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        moveRisk(1)
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveRisk(-1)
      }
      if (event.key.toLowerCase() === 's') setSpotlight((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveRisk])

  const advanceIfNeeded = useCallback((savedRiskId?: string) => {
    if (!autoNext || !contract || !selectedRiskId) return
    const current = contract.riskCards.findIndex((risk) => risk.id === selectedRiskId)
    const needsDecision = (risk: RiskCardData) => risk.status === 'open'
      && !risk.resolved_by_batch
      && !isDraftComplete(draftMap.get(risk.id))
    const next = contract.riskCards.slice(current + 1).find(needsDecision)
      || contract.riskCards.find((risk) => needsDecision(risk) && risk.id !== selectedRiskId)
    if (next) selectRisk(next.id, { savedRiskId })
  }, [autoNext, contract, draftMap, isDraftComplete, selectRisk, selectedRiskId])

  const replaceDecisionDraft = useCallback((riskId: string, draft: DecisionDraft | null) => {
    const nextDrafts = new Map(decisionDraftByRiskRef.current)
    if (draft) nextDrafts.set(riskId, draft)
    else nextDrafts.delete(riskId)
    decisionDraftByRiskRef.current = nextDrafts
    setContract((current) => current ? {
      ...current,
      decisionDrafts: [
        ...current.decisionDrafts.filter((item) => item.risk_id !== riskId),
        ...(draft ? [draft] : []),
      ],
    } : current)
  }, [])

  const saveDecision = useCallback(({
    optionId = selectedOptionId,
    result = intent,
    enforceComplete = false,
    allowAdvance = false,
  }: {
    optionId?: string | null
    result?: DecisionKind | null
    enforceComplete?: boolean
    allowAdvance?: boolean
  } = {}) => {
    if (!selectedRisk) return Promise.resolve()
    const risk = selectedRisk
    if (risk.status !== 'open' || risk.resolved_by_batch) {
      setSaveState('error')
      setSaveError('该风险已通过复审或不再开放，只能查看，不能继续修改。')
      return Promise.resolve()
    }
    if (!sourceIdentity) {
      setSaveState('error')
      setSaveError(contract?.sourcePreviewError || '源文件身份尚未生成，不能保存决策。')
      return Promise.resolve()
    }
    if (submissionLockedRef.current || reviewExecutionLocked) {
      setSaveState('error')
      setSaveError('复审批次已锁定，不能再修改当前决策。')
      return Promise.resolve()
    }
    const riskAnchor = risk.source_anchor
    if (!riskAnchor) {
      setSaveState('error')
      setSaveError('该风险是文档级覆盖结论，未绑定原文；不能保存为原文决策或进入源文件批注导出。')
      return Promise.resolve()
    }
    const manualDecisionAnchor = (!riskAnchor.exact_text || riskAnchor.end <= riskAnchor.start)
      && contract?.filename.toLowerCase().endsWith('.pdf')
      ? manualRegion ? {
        kind: 'region' as const,
        page: manualRegion.page,
        region: { x: manualRegion.x, y: manualRegion.y, width: manualRegion.width, height: manualRegion.height },
      } : manualPoint ? {
        kind: 'point' as const,
        page: manualPoint.page,
        point: { x: manualPoint.x, y: manualPoint.y },
      } : null
      : null
    if ((!riskAnchor.exact_text || riskAnchor.end <= riskAnchor.start) && !manualDecisionAnchor) {
      const message = contract?.filename.toLowerCase().endsWith('.pdf')
        ? '该风险缺少唯一原文定位；请先使用“点批注”或“框选批注”设置人工位置。'
        : '该风险缺少唯一 Word 原文引用，不能伪造批注位置；请重新审核生成逐字原文引用。'
      setSaveState('error')
      setSaveError(message)
      return Promise.resolve()
    }
    const feedbackValue = feedback.trim()
    const requestDecisionContextKey = decisionContextKey
    if (enforceComplete && result === 'customer_agreed' && risk.resolution_options.length > 0 && !optionId) {
      dirtyDecisionRiskIdsRef.current.add(risk.id)
      decisionSaveErrorsRef.current.set(risk.id, '请先选择法务已发布的具体策略。')
      setSaveState('error')
      setSaveError('请先选择法务已发布的具体策略。')
      return Promise.resolve()
    }
    if (enforceComplete && !result) {
      dirtyDecisionRiskIdsRef.current.add(risk.id)
      decisionSaveErrorsRef.current.set(risk.id, '请选择并记录谈判结果。')
      setSaveState('error')
      setSaveError('请选择并记录谈判结果。')
      return Promise.resolve()
    }
    if (enforceComplete && result === 'customer_agreed' && risk.resolution_options.length === 0) {
      dirtyDecisionRiskIdsRef.current.add(risk.id)
      decisionSaveErrorsRef.current.set(risk.id, '当前风险没有匹配的已发布规则。')
      setSaveState('error')
      setSaveError('当前风险没有匹配的已发布规则，需法务补充后人工处理。')
      return Promise.resolve()
    }
    if (enforceComplete && (result === 'customer_feedback' || result === 'exception_requested') && !feedbackValue) {
      const message = result === 'customer_feedback' ? '请先录入客户反馈。' : '请填写特批原因。'
      dirtyDecisionRiskIdsRef.current.add(risk.id)
      decisionSaveErrorsRef.current.set(risk.id, message)
      setSaveState('error')
      setSaveError(message)
      return Promise.resolve()
    }

    dirtyDecisionRiskIdsRef.current.add(risk.id)
    decisionSaveErrorsRef.current.delete(risk.id)
    decisionSavePendingCountRef.current.set(
      risk.id,
      (decisionSavePendingCountRef.current.get(risk.id) || 0) + 1
    )

    const run = async () => {
      const previousDraft = decisionDraftByRiskRef.current.get(risk.id) || null
      let refreshedAfterConflict = false
      const optimistic: DecisionDraft = {
        id: previousDraft?.id || `optimistic-${risk.id}`,
        risk_id: risk.id,
        status: 'draft_selected',
        decision_kind: result,
        negotiation_result: result,
        selected_option_id: optionId,
        resolution_strategy_id: optionId,
        feedback: feedbackValue || null,
        comment_preview: previousDraft?.comment_preview || null,
        optimistic_version: (previousDraft?.optimistic_version || 0) + 1,
      }
      replaceDecisionDraft(risk.id, optimistic)
      setSaveState('saving')
      setSaveError('')

      try {
        const response = await fetch(`/api/contracts/${contractId}/review/decisions/${risk.id}`, {
          method: 'PUT',
          headers: authHeaders(true),
          body: JSON.stringify({
            resolution_strategy_id: optionId,
            negotiation_result: result,
            feedback: feedbackValue || null,
            expected_version: previousDraft?.optimistic_version || 0,
            source_anchor_override: manualDecisionAnchor,
            source_identity: sourceIdentity,
          }),
        })
        const payload = await response.json()
        if (!response.ok || !payload.success) {
          if (response.status === 409) {
            refreshedAfterConflict = true
            await loadReview()
          }
          throw new Error(responseError(payload, '决策暂存失败'))
        }
        const saved = payload.data as DecisionDraft
        if (decisionContextKeyRef.current !== requestDecisionContextKey) return
        replaceDecisionDraft(risk.id, saved)
        const remaining = Math.max(0, (decisionSavePendingCountRef.current.get(risk.id) || 1) - 1)
        if (remaining > 0) decisionSavePendingCountRef.current.set(risk.id, remaining)
        else {
          decisionSavePendingCountRef.current.delete(risk.id)
          dirtyDecisionRiskIdsRef.current.delete(risk.id)
          decisionSaveErrorsRef.current.delete(risk.id)
        }
        if (selectedRiskIdRef.current === risk.id && remaining === 0) {
          setSaveState('saved')
          setSaveError('')
        }
        if (allowAdvance && remaining === 0 && isDraftComplete(saved)) advanceIfNeeded(risk.id)
      } catch (error) {
        if (decisionContextKeyRef.current !== requestDecisionContextKey) return
        const message = error instanceof Error ? error.message : '决策暂存失败'
        const remaining = Math.max(0, (decisionSavePendingCountRef.current.get(risk.id) || 1) - 1)
        if (remaining > 0) decisionSavePendingCountRef.current.set(risk.id, remaining)
        else decisionSavePendingCountRef.current.delete(risk.id)
        if (!refreshedAfterConflict) replaceDecisionDraft(risk.id, previousDraft)
        dirtyDecisionRiskIdsRef.current.add(risk.id)
        decisionSaveErrorsRef.current.set(risk.id, message)
        if (selectedRiskIdRef.current === risk.id) {
          setSaveState('error')
          setSaveError(message)
        }
      }
    }
    const queued = decisionSaveChainRef.current.then(run, run)
    decisionSaveChainRef.current = queued.then(() => undefined, () => undefined)
    return queued
  }, [advanceIfNeeded, contract?.filename, contract?.sourcePreviewError, contractId, decisionContextKey, feedback, intent, isDraftComplete, loadReview, manualPoint, manualRegion, replaceDecisionDraft, reviewExecutionLocked, selectedOptionId, selectedRisk, sourceIdentity])

  const chooseOption = useCallback((optionId: string) => {
    if (decisionControlsLocked) return
    setSelectedOptionId(optionId)
    setSaveError('')
    void saveDecision({ optionId, result: intent })
  }, [decisionControlsLocked, intent, saveDecision])

  const chooseDecision = useCallback((kind: DecisionKind) => {
    if (decisionControlsLocked || !selectedRisk) return
    setIntent(kind)
    setSaveState('idle')
    setSaveError('')
    dirtyDecisionRiskIdsRef.current.add(selectedRisk.id)
    decisionSaveErrorsRef.current.delete(selectedRisk.id)
    if (kind === 'customer_agreed' && selectedOptionId) {
      void saveDecision({
        optionId: selectedOptionId,
        result: kind,
        enforceComplete: true,
        allowAdvance: true,
      })
    }
  }, [decisionControlsLocked, saveDecision, selectedOptionId, selectedRisk])

  const submitBatch = useCallback(async () => {
    if (!contract?.riskReviewId) return
    if (contract.stats.open === 0) {
      setSubmissionMessage('当前已无待处理风险，无需再次提交复审；PDF 人工批注和导出仍可继续。')
      return
    }
    if (!sourceIdentity) {
      setSubmissionMessage(contract.sourcePreviewError || '源文件身份尚未生成，不能提交复审。')
      return
    }
    if (submissionLockedRef.current || reviewExecutionLocked) return
    if (hasPendingDecisionChanges) {
      const savedError = [...decisionSaveErrorsRef.current.values()][0]
      setSubmissionMessage(savedError
        ? `仍有决策未保存：${savedError}`
        : '当前仍有未保存的决策，请先完成暂存后再提交复审。')
      return
    }
    submissionLockedRef.current = true
    setSubmitting(true)
    setConflicts([])
    setSubmissionMessage('正在等待当前决策保存并检查跨条款冲突…')
    try {
      await decisionSaveChainRef.current
      if (dirtyDecisionRiskIdsRef.current.size > 0 || decisionSaveErrorsRef.current.size > 0) {
        throw new Error(`仍有决策未保存：${[...decisionSaveErrorsRef.current.values()][0] || '请检查当前风险'}`)
      }
      const response = await fetch(`/api/contracts/${contractId}/review/submit`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          review_id: contract.riskReviewId,
          review_style: reviewStyle,
          source_identity: sourceIdentity,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        const details = payload?.error?.details as { conflicts?: ConflictItem[] } | undefined
        setConflicts(details?.conflicts || [])
        if (response.status === 409) await loadReview()
        throw new Error(responseError(payload, '提交前检查未通过'))
      }
      const executionStatus = payload.data.status as 'queued' | 'running' | 'completed' | 'failed'
      setSubmissionMessage(executionStatus === 'completed'
        ? `新 ReviewRun ${String(payload.data.review_id).slice(0, 8)} 已完成，正在刷新逐风险结果。`
        : executionStatus === 'failed'
          ? `新 ReviewRun ${String(payload.data.review_id).slice(0, 8)} 执行失败；失败态已记录，没有把空结果当作通过。`
          : `已创建新 ReviewRun ${String(payload.data.review_id).slice(0, 8)}，当前为 ${executionStatus === 'running' ? '运行中' : '队列等待'}；持久 Worker 将负责请求中断后的恢复。`)
      await loadReview()
    } catch (error) {
      setSubmissionMessage(error instanceof Error ? error.message : '批量提交失败')
    } finally {
      submissionLockedRef.current = false
      setSubmitting(false)
    }
  }, [contract, contractId, hasPendingDecisionChanges, loadReview, reviewExecutionLocked, reviewStyle, sourceIdentity, sourceIdentityKey])

  const exportAnnotatedSource = useCallback(async () => {
    if (!sourceIdentity) {
      setSubmissionMessage(contract?.sourcePreviewError || '源文件身份尚未生成，不能导出批注版。')
      return
    }
    setExporting(true)
    setSubmissionMessage('正在生成源文件批注版…')
    try {
      const response = await fetch(`/api/contracts/${contractId}/export`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          export_mode: 'source_annotated',
          source_identity: sourceIdentity,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(responseError(payload, '导出失败'))
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      const lowerFilename = contract?.filename?.toLowerCase() || ''
      const sourceExtension = lowerFilename.endsWith('.pdf') ? 'pdf' : lowerFilename.endsWith('.docm') ? 'docm' : 'docx'
      anchor.download = responseDownloadName(
        response,
        `${contract?.filename?.replace(/\.(doc|docx|docm|pdf)$/i, '') || '合同'}-ONES批注版.${sourceExtension}`
      )
      anchor.click()
      URL.revokeObjectURL(url)
      setSubmissionMessage('源文件批注版已生成。')
    } catch (error) {
      setSubmissionMessage(error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [contract, contractId, sourceIdentity])

  useEffect(() => {
    if (!chatOpen || chatMessages.length > 0) return
    async function loadChat() {
      const response = await fetch(`/api/contracts/${contractId}/ai-chat`, { headers: authHeaders() }).catch(() => null)
      if (!response?.ok) return
      const payload = await response.json()
      setChatMessages(payload.data || [])
    }
    void loadChat()
  }, [chatMessages.length, chatOpen, contractId])

  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return
    setChatLoading(true)
    try {
      const response = await fetch(`/api/contracts/${contractId}/ai-chat`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ message: chatInput.trim(), risk_id: selectedRiskId }),
      })
      const payload = await response.json()
      if (response.ok) {
        setChatMessages(payload.data?.messages || payload.data || [])
        setChatInput('')
      }
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, chatLoading, contractId, selectedRiskId])

  if (loading) {
    return <div className="flex min-h-[70vh] items-center justify-center text-sm text-slate-500"><Loader2Icon className="mr-2 size-5 animate-spin" />加载审核任务…</div>
  }
  if (!contract || errorMessage) {
    return (
      <div className="mx-auto mt-20 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <XCircleIcon className="mx-auto mb-3 size-8 text-red-500" />
        <p className="font-medium text-red-800">{errorMessage || '审核任务不存在'}</p>
        <Link href="/contracts" className="mt-5 inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">返回合同中心</Link>
      </div>
    )
  }

  const railContent = (
    <>
      <div className="border-b border-slate-200 p-2.5">
        <div className="flex items-center justify-between px-1 text-xs font-semibold text-slate-800">
          <span>风险项</span><span className="font-normal text-slate-400">{filteredRisks.length}/{contract.riskCards.length}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {([['all', '全部'], ['red', '红线'], ['todo', '未决策'], ['drafted', '待复审']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setRiskFilter(id)} className={cn('rounded-md px-2 py-1 text-[11px]', riskFilter === id ? 'bg-blue-50 font-semibold text-blue-700' : 'bg-slate-50 text-slate-500')}>{label}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-2" data-testid="risk-navigation" data-scroll-region="risk-list">
        {filteredRisks.map((risk) => {
          const index = contract.riskCards.findIndex((item) => item.id === risk.id)
          const active = risk.id === selectedRiskId
          const decision = draftMap.get(risk.id)
          return (
            <button
              key={risk.id}
              type="button"
              onClick={() => selectRisk(risk.id)}
              className={cn(
                'w-full border-b border-slate-100 px-2 py-2 text-left transition hover:bg-slate-50',
                active ? 'bg-blue-50 shadow-[inset_3px_0_0_0_rgb(37,99,235)]' : 'bg-white'
              )}
              data-risk-id={risk.id}
            >
              <div className="min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-slate-400">{index + 1} · {!risk.source_anchor
                      ? '文档级覆盖结论，未绑定原文'
                      : risk.source_anchor.locator === 'rendered'
                        ? `第 ${risk.source_anchor.page} 页`
                        : risk.source_anchor.precision === 'source_exact'
                          ? '原文精确定位'
                          : `估算第 ${risk.source_anchor.page} 页`}</span>
                    {risk.resolved_by_batch
                      ? <span className="flex items-center gap-1 text-[10px] text-emerald-700"><CheckCircle2Icon className="size-3.5" />已通过</span>
                      : isDraftComplete(decision)
                        ? <span className="flex items-center gap-1 text-[10px] text-blue-700"><CircleDotDashedIcon className="size-3.5" />待复审</span>
                        : risk.review_outcome === 'needs_revision' || risk.review_outcome === 'still_open'
                          ? <span className="flex items-center gap-1 text-[10px] text-red-700"><AlertTriangleIcon className="size-3.5" />未决策</span>
                          : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-5 text-slate-800">{risk.title}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="border-t border-slate-200 bg-white p-2.5">
        <Button className="w-full" onClick={submitBatch} disabled={submitting || hasPendingDecisionChanges || saveState === 'saving' || !contract.riskReviewId || reviewExecutionLocked || contract.stats.open === 0}>
          {submitting ? <Loader2Icon className="animate-spin" /> : <RefreshCcwIcon />}
          提交全部结论并复审
        </Button>
      </div>
    </>
  )

  return (
    <div className="flex h-[calc(100dvh-72px)] min-h-0 flex-col overflow-hidden bg-slate-100 text-slate-900 md:h-[calc(100dvh-88px)] lg:h-[calc(100dvh-1px)]">
      <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 md:px-5">
        <Link href="/contracts" aria-label="返回合同中心" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"><ArrowLeftIcon className="size-4" /></Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileTextIcon className="size-4 shrink-0 text-blue-600" /><h1 className="truncate text-sm font-semibold">{contract.filename}</h1>
        </div>
        <label className="hidden sm:block">
          <span className="sr-only">复审方式</span>
          <select value={reviewStyle} disabled={batchControlsLocked} onChange={(event) => setReviewStyle(event.target.value as ReviewStyle)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 disabled:opacity-50" aria-label="复审方式">
            {contract.reviewStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
          </select>
        </label>
        <Button className="hidden lg:inline-flex" onClick={submitBatch} disabled={submitting || hasPendingDecisionChanges || saveState === 'saving' || !contract.riskReviewId || reviewExecutionLocked || !sourceIdentity || contract.stats.open === 0}>
          {submitting ? <Loader2Icon className="animate-spin" /> : <RefreshCcwIcon />}
          提交结论并复审
        </Button>
        <Button variant="outline" onClick={exportAnnotatedSource} disabled={exporting || !sourceIdentity || manualAnnotationSaving || Boolean(manualPoint || manualRegion || manualComment.trim())}><DownloadIcon />{exporting ? '生成中' : '导出源文件批注版'}</Button>
      </header>

      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-px bg-slate-200 md:grid-rows-[minmax(360px,55fr)_minmax(280px,45fr)] lg:grid-cols-[minmax(148px,12fr)_minmax(0,58fr)_minmax(336px,30fr)] lg:grid-rows-1">
        <aside className="hidden min-h-0 flex-col bg-white lg:flex" aria-label="全局风险导航">{railContent}</aside>

        {railOpen && <div className="absolute inset-0 z-50 flex lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/30" onClick={() => setRailOpen(false)} aria-label="关闭风险导航" />
          <aside className="relative flex h-full w-[260px] flex-col bg-white shadow-2xl">{railContent}</aside>
        </div>}

        <main className={cn('relative flex min-h-0 min-w-0 flex-col bg-slate-200', spotlight && 'bg-slate-300')} aria-label="源文件主轴">
          <div className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3">
            <Button variant="outline" size="icon-sm" className="lg:hidden" onClick={() => setRailOpen(true)} aria-label="打开风险导航"><PanelLeftIcon /></Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{selectedRisk?.source_anchor?.clause_ref || selectedRisk?.clause_ref || '源文件原文'}</p>
              <p className="text-[11px] text-slate-500">{selectedRisk && !selectedRisk.source_anchor
                ? '文档级覆盖结论，未绑定原文'
                : isBrowserWordSource
                  ? 'Word 原文滚动预览 · 显示源文件已有修订与批注'
                  : isLegacyDocSource
                    ? '旧版 DOC 原件已保留 · 请另存为 DOCX 后进入原文批注链'
                    : selectedRisk?.source_anchor?.precision === 'line'
                      ? `第 ${selectedRisk.source_anchor.page} 页 · 条款行框已定位`
                      : selectedRisk?.source_anchor?.locator === 'rendered'
                        ? `第 ${selectedRisk.source_anchor.page} 页 · 页已定位、条款需人工定位`
                        : selectedRisk?.source_anchor
                          ? `估算第 ${selectedRisk.source_anchor.page} 页 · 待页级定位`
                          : `第 ${activeSourcePage}/${sourcePageCount} 页 · 可直接添加 PDF 批注`}</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => moveRisk(-1)} aria-label="上一风险"><ArrowUpIcon /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => moveRisk(1)} aria-label="下一风险"><ArrowDownIcon /></Button>
            {isPdfSource ? <div className="flex items-center rounded-md border border-slate-200" aria-label="源文件翻页">
              <Button variant="ghost" size="icon-sm" onClick={() => navigateSourcePage(activeSourcePage - 1)} disabled={activeSourcePage <= 1} aria-label="上一页"><ChevronLeftIcon /></Button>
              <span className="min-w-14 text-center text-[11px]">{activeSourcePage}/{sourcePageCount} 页</span>
              <Button variant="ghost" size="icon-sm" onClick={() => navigateSourcePage(activeSourcePage + 1)} disabled={activeSourcePage >= sourcePageCount} aria-label="下一页"><ChevronRightIcon /></Button>
            </div> : <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">原文滚动</span>}
            <div className="flex items-center rounded-md border border-slate-200">
              <Button variant="ghost" size="icon-sm" onClick={() => setZoom((value) => Math.max(60, value - 10))} aria-label="缩小"><ZoomOutIcon /></Button>
              <span className="w-10 text-center text-[11px]">{zoom}%</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setZoom((value) => Math.min(180, value + 10))} aria-label="放大"><ZoomInIcon /></Button>
            </div>
            {isPdfSource && <div className="flex items-center rounded-md border border-slate-200">
              <Button
                variant={manualAnchorMode === 'point' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setManualAnchorMode((value) => value === 'point' ? null : 'point')
                  setSaveError('')
                }}
                title="OCR 无法定位时，在 PDF 页上点击设置人工批注位置"
              ><CircleDotDashedIcon />{manualAnchorMode === 'point' ? '请点击页面' : '点批注'}</Button>
              <Button
                variant={manualAnchorMode === 'region' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setManualAnchorMode((value) => value === 'region' ? null : 'region')
                  setSaveError('')
                }}
                title="在 PDF 页上拖动框选人工批注区域"
              ><MessageSquareIcon />{manualAnchorMode === 'region' ? '请拖动框选' : '框选批注'}</Button>
            </div>}
            <Button variant="ghost" size="icon-sm" onClick={() => setSpotlight((value) => !value)} aria-label="切换聚光灯">{spotlight ? <EyeOffIcon /> : <EyeIcon />}</Button>
          </div>

          {selectedRisk && !selectedRisk.source_anchor ? <div className="mx-3 mt-2 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900" data-testid="document-coverage-status">
            文档级覆盖结论，未绑定原文；不会跳转到第 1 页，也不会进入原文批注导出。
          </div> : selectedRisk && !isBrowserWordSource && <div className="mx-3 mt-2 flex shrink-0 items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-900" data-testid="source-location-status">
            <span>{selectedRisk.source_anchor?.locator === 'rendered'
              ? `第 ${selectedRisk.source_anchor.page} 页已定位`
              : `当前为估算第 ${selectedRisk.source_anchor?.page} 页，待页级定位`}</span>
            <span>{isLegacyDocSource
                ? '旧版 DOC 不做静默转换，另存为 DOCX 后可原生批注'
                : manualPoint || manualRegion
                  ? '已设置 PDF 人工批注锚点，填写批注内容后单独保存'
                  : selectedRisk.source_anchor?.precision === 'line'
                    ? `页内条款已定位 · ${selectedAnchorBoxes.length} 个真实行框`
                    : '无可用行框：PDF 可使用点或框选批注'}</span>
          </div>}
          {saveError && <div className="mx-3 mt-2 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700" role="alert">{saveError}</div>}
          {annotationLoadError && <div className="mx-3 mt-2 flex shrink-0 items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800" role="alert"><span>{annotationLoadError}</span><Button size="sm" variant="outline" onClick={() => setAnnotationReloadNonce((value) => value + 1)}><RefreshCcwIcon />重试批注</Button></div>}

          <div ref={sourceViewportRef} className="relative min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain p-3" data-testid="source-page-viewport" data-scroll-region="source-document">
            {isBrowserWordSource ? (
              <BrowserWordPreview
                contractId={contractId}
                filename={contract.filename}
                sourceIdentity={sourceIdentity}
                zoom={zoom}
                selectedRiskId={selectedRisk?.id}
                selectedSourceText={selectedRisk?.source_anchor?.exact_text || selectedRisk?.source_anchor?.excerpt}
              />
            ) : isLegacyDocSource ? (
              <div className="flex h-full min-h-64 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900" data-testid="legacy-doc-preview-boundary">
                <div className="max-w-lg space-y-2">
                  <p className="font-semibold">旧版 DOC 原件已安全保留</p>
                  <p>为了避免高成本且失真的服务器转换，本期不伪造网页预览。请在 Word/WPS 中另存为 DOCX 后重新上传，即可直接查看原文、已有修订和批注，并导出原生批注版。</p>
                </div>
              </div>
            ) : sourcePages[activeSourcePage] ? (
              <div className="mx-auto flex min-h-full items-start justify-center py-4">
                <div
                  className={cn('relative h-fit overflow-hidden border border-slate-300 bg-white shadow-xl', manualAnchorMode && 'cursor-crosshair ring-2 ring-blue-500')}
                  style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none', touchAction: manualAnchorMode === 'region' ? 'none' : undefined }}
                  onClick={setManualSourcePoint}
                  onPointerDown={startManualRegion}
                  onPointerUp={finishManualRegion}
                  onPointerCancel={cancelManualRegionGesture}
                  role={manualAnchorMode ? 'button' : undefined}
                  aria-label={manualAnchorMode === 'point' ? '点击设置 PDF 人工批注位置' : manualAnchorMode === 'region' ? '拖动框选 PDF 人工批注区域' : undefined}
                >
                  <img
                    key={`${activeSourcePage}-${zoom}`}
                    src={sourcePages[activeSourcePage]}
                    alt={`合同真实源文件第 ${activeSourcePage} 页`}
                    className="block h-auto w-full max-w-none"
                    onLoad={centerSourceHighlight}
                    data-testid="source-rendered-page"
                  />
                  {selectedRisk?.source_anchor?.page === activeSourcePage && selectedAnchorBounds && <div
                    ref={sourceHighlightRef}
                    className="pointer-events-none absolute z-10 rounded-sm border-2 border-blue-600 bg-blue-300/15"
                    style={{
                      left: `${selectedAnchorBounds.left}%`,
                      top: `${selectedAnchorBounds.top}%`,
                      width: `${selectedAnchorBounds.width}%`,
                      height: `${selectedAnchorBounds.height}%`,
                      boxShadow: spotlight ? '0 0 0 9999px rgba(15, 23, 42, 0.10)' : undefined,
                    }}
                    data-testid="source-anchor-highlight"
                    aria-label={`当前风险页内条款高亮，共 ${selectedAnchorBoxes.length} 个行框`}
                  />}
                  {selectedRisk?.source_anchor?.page === activeSourcePage && selectedAnchorBoxes.map((box, index) => <div
                    key={`${box.left}-${box.top}-${index}`}
                    className="pointer-events-none absolute z-20 rounded-[2px] border border-blue-500 bg-blue-300/20"
                    style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
                  />)}
                  {manualAnnotations.filter((annotation) => annotation.source_anchor.page === activeSourcePage).map((annotation) => {
                    const anchor = annotation.source_anchor
                    if (anchor.kind === 'point' && anchor.point) return <div
                      key={annotation.id}
                      className="group absolute z-[25] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow ring-2 ring-amber-500/30"
                      style={{ left: `${anchor.point.x * 100}%`, top: `${anchor.point.y * 100}%` }}
                      title={annotation.comment}
                      aria-label={`已保存 PDF 批注：${annotation.comment}`}
                    />
                    if (anchor.kind === 'region' && anchor.region) return <div
                      key={annotation.id}
                      className="pointer-events-none absolute z-[25] border-2 border-amber-500 bg-amber-300/25 shadow-sm"
                      style={{ left: `${anchor.region.x * 100}%`, top: `${anchor.region.y * 100}%`, width: `${anchor.region.width * 100}%`, height: `${anchor.region.height * 100}%` }}
                      title={annotation.comment}
                      aria-label={`已保存 PDF 区域批注：${annotation.comment}`}
                    />
                    return null
                  })}
                  {manualPoint?.page === activeSourcePage && <div
                    className="pointer-events-none absolute z-30 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-lg ring-2 ring-blue-600/40"
                    style={{ left: `${manualPoint.x * 100}%`, top: `${manualPoint.y * 100}%` }}
                    data-testid="manual-pdf-anchor"
                    aria-label="人工 PDF 批注位置"
                  />}
                  {manualRegion?.page === activeSourcePage && <div
                    className="pointer-events-none absolute z-30 border-2 border-blue-600 bg-blue-300/25 shadow-lg"
                    style={{ left: `${manualRegion.x * 100}%`, top: `${manualRegion.y * 100}%`, width: `${manualRegion.width * 100}%`, height: `${manualRegion.height * 100}%` }}
                    data-testid="manual-pdf-region"
                    aria-label="人工 PDF 批注区域"
                  />}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                {sourceError
                  ? <div className="space-y-3"><p>{sourceError}</p><Button size="sm" variant="outline" onClick={() => {
                    Object.values(sourcePageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
                    sourcePageUrlsRef.current = {}
                    sourceErrorIdentityRef.current = ''
                    setSourcePages({})
                    setSourceError('')
                    setSourceReloadNonce((value) => value + 1)
                    void loadReview()
                  }}><RefreshCcwIcon />重新生成预览</Button></div>
                  : <><Loader2Icon className="mr-2 size-5 animate-spin" />正在生成真实源文件页级预览…</>}
              </div>
            )}
          </div>
          {isPdfSource && (manualPoint || manualRegion) && <div className="shrink-0 border-t border-blue-200 bg-blue-50 p-3">
            <div className="flex items-start gap-2">
              <Textarea
                value={manualComment}
                onChange={(event) => { manualAnnotationRequestIdRef.current = null; setManualComment(event.target.value) }}
                placeholder={`填写第 ${manualRegion?.page || manualPoint?.page} 页${manualRegion ? '框选区域' : '此位置'}的批注内容`}
                className="min-h-16 bg-white text-xs"
              />
              <div className="flex shrink-0 flex-col gap-2">
                <Button size="sm" onClick={() => void saveManualAnnotation()} disabled={!manualComment.trim() || manualAnnotationSaving}>
                  {manualAnnotationSaving ? <Loader2Icon className="animate-spin" /> : <MessageSquareIcon />}保存 PDF 批注
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { manualAnnotationRequestIdRef.current = null; setManualPoint(null); setManualRegion(null); setManualComment(''); setSaveError('') }}>取消定位</Button>
              </div>
            </div>
          </div>}
        </main>

        <aside className="flex min-h-0 flex-col overflow-hidden bg-white" aria-label="当前风险处理轨道">
          <div className="grid h-11 shrink-0 grid-cols-3 border-b border-slate-200 bg-white px-2" role="tablist" aria-label="当前风险信息">
            {RIGHT_PANEL_TABS.map(({ id: tab, label }, tabIndex) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`risk-panel-tab-${tab}`}
                aria-controls={`risk-panel-${tab}`}
                aria-selected={rightPanelTab === tab}
                tabIndex={rightPanelTab === tab ? 0 : -1}
                onClick={() => {
                  setRightPanelTab(tab)
                  rightPanelRef.current?.scrollTo({ top: 0 })
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                  event.preventDefault()
                  const direction = event.key === 'ArrowRight' ? 1 : -1
                  const targetIndex = (tabIndex + direction + RIGHT_PANEL_TABS.length) % RIGHT_PANEL_TABS.length
                  const targetTab = RIGHT_PANEL_TABS[targetIndex].id
                  setRightPanelTab(targetTab)
                  rightPanelRef.current?.scrollTo({ top: 0 })
                  window.requestAnimationFrame(() => document.getElementById(`risk-panel-tab-${targetTab}`)?.focus())
                }}
                className={cn(
                  'relative px-1 text-xs font-semibold transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full',
                  rightPanelTab === tab ? 'text-blue-700 after:bg-blue-600' : 'text-slate-500 after:bg-transparent hover:text-slate-800'
                )}
              >{label}</button>
            ))}
          </div>

          <div ref={rightPanelRef} className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain" data-scroll-region="risk-actions">
          {rightPanelTab === 'guide' && <div id="risk-panel-guide" role="tabpanel" aria-labelledby="risk-panel-tab-guide">
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
            <h2 className="text-sm font-semibold text-slate-900">处理待办</h2>
            <label className="flex items-center gap-2 text-[11px] text-slate-500"><input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />自动下一条</label>
          </div>

          {selectedRisk && <div className="space-y-2.5 p-3 pb-5">
            {selectedRiskNeedsSourceLocation && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900" role="alert">
              <AlertTriangleIcon className="mr-1 inline size-4" />
              {contract.filename.toLowerCase().endsWith('.pdf')
                ? selectedRiskManualAnchor
                  ? '已为该未定位风险设置人工 PDF 锚点；现在可以保存处理结论。'
                  : '模型未返回可唯一匹配的原文。请先在左侧使用“点批注”或“框选批注”定位；系统不会把它伪造到文首。'
                : '模型未返回可唯一匹配的 Word 原文。当前禁止保存决策和生成原生批注；请重新审核并要求逐字原文引用。'}
            </div>}
            <section className="border-b border-slate-200 pb-3" data-testid="decision-kind-actions">
              <h3 className="text-xs font-semibold text-slate-900">选择处理结果</h3>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {(Object.keys(decisionMeta) as DecisionKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => chooseDecision(kind)}
                    disabled={decisionControlsLocked || (kind === 'customer_agreed' && !selectedOptionId)}
                    title={kind === 'customer_agreed' && !selectedOptionId ? '先在下方选择客户同意的法务口径' : decisionMeta[kind].hint}
                    className={cn('min-h-12 rounded-lg border px-2 py-1.5 text-xs font-medium leading-4 transition disabled:cursor-not-allowed disabled:opacity-45', intent === kind ? 'border-blue-500 bg-blue-50 text-blue-800 ring-2 ring-blue-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
                    data-decision-kind={kind}
                  >{decisionMeta[kind].label}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">{intent ? decisionMeta[intent].hint : '先选实际谈判结果；客户已同意需先在下方绑定法务口径。'}</p>
            </section>

            {(intent === 'customer_feedback' || intent === 'exception_requested') && <section>
              <label className="text-xs font-semibold text-slate-900" htmlFor="decision-feedback">{intent === 'customer_feedback' ? '客户原始反馈（必填）' : '特批依据（必填）'}</label>
              <Textarea
                id="decision-feedback"
                className="mt-2 min-h-20 resize-y"
                value={feedback}
                disabled={decisionControlsLocked}
                onChange={(event) => {
                  setFeedback(event.target.value)
                  setSaveState('idle')
                  if (selectedRisk) {
                    dirtyDecisionRiskIdsRef.current.add(selectedRisk.id)
                    decisionSaveErrorsRef.current.delete(selectedRisk.id)
                  }
                }}
                placeholder={intent === 'customer_feedback' ? '如实记录客户的修改意见、参数或不能接受的原因…' : '说明保留风险仍需签署的业务背景和审批理由…'}
              />
            </section>}

            <section className="scroll-mt-16 border-b border-slate-200 pb-3" data-testid="solution-card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">谈判口径</h3>
                {selectedOptionId && <button type="button" disabled={decisionControlsLocked} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setSelectedOptionId(null); void saveDecision({ optionId: null, result: intent }) }}><Undo2Icon className="size-3" />撤销策略</button>}
              </div>
              {selectedRisk.resolution_options.length > 0 ? (
                <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                  {selectedRisk.resolution_options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => chooseOption(option.id)}
                      disabled={decisionControlsLocked}
                      className={cn('flex w-full items-start gap-2 bg-white px-1 py-2 text-left transition', selectedOptionId === option.id ? 'text-blue-900' : 'text-slate-700 hover:bg-slate-50')}
                      data-option-id={option.id}
                    >
                      <span className={cn('mt-0.5 size-3.5 shrink-0 rounded-full border', selectedOptionId === option.id ? 'border-[4px] border-blue-600' : 'border-slate-300')} />
                      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{option.label}</span>{showOptionDescriptions && option.description && <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-slate-500">{option.description}</span>}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  <AlertTriangleIcon className="mr-1 inline size-4" />没有匹配的已发布规则，不兜造 Option。需法务补充规则或转人工处理。
                </div>
              )}
              {selectedOption && <div className="mt-2.5 rounded-lg border border-blue-200 bg-blue-50 p-2.5" data-testid="negotiation-kit">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-blue-900">谈判锦囊 · {selectedOption.label}</p>
                  <button type="button" onClick={() => void copyNegotiationGuidance()} disabled={!negotiationCopy} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[10px] font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50">
                    <CopyIcon className="size-3" />{copiedRiskId === selectedRisk.id ? '已复制' : '复制话术'}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-blue-950"><span className="font-semibold">推荐口径：</span>{selectedOption.negotiation_guidance || '当前发布规则未配置谈判口径，请转法务补充后再对外沟通。'}</p>
                <p className="mt-1 text-xs leading-5 text-red-800"><span className="font-semibold">退让底线：</span>{selectedOption.bottom_line || '当前发布规则未配置退让底线，不能由销售自行推断。'}</p>
              </div>}
            </section>

            {customerFacingPreview && <section className="border-y border-blue-200 bg-blue-50 px-3 py-2.5" data-testid="comment-preview">
              <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-900"><FileTextIcon className="size-3.5" />{selectedDraft?.revision_text || selectedOption?.revision_text ? '受控修订预览' : '客户侧批注预览'}</h4>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-blue-950">{customerFacingPreview}</p>
              <p className="mt-1 text-[10px] text-blue-700">仅由原文证据、已发布 Option 与法务模板受控生成；internal_note 不进入客户侧内容。</p>
            </section>}

            {!customerFacingPreview && intent === 'customer_feedback' && <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-4 text-slate-600">
              客户反馈只作为复审输入，不会原样写进客户侧批注。需要形成修改口径时，请补选已发布的法务策略。
            </section>}

            <div className={cn('min-h-5 text-[11px]', saveState === 'error' ? 'text-red-600' : 'text-slate-500')} aria-live="polite">
              {saveState === 'saving' && '正在乐观暂存…'}
              {saveState === 'saved' && `草稿已暂存${(selectedDraft?.negotiation_result || selectedDraft?.decision_kind) ? ` · ${decisionMeta[(selectedDraft.negotiation_result || selectedDraft.decision_kind) as DecisionKind].label}` : ' · 谈判结果未选择'}`}
              {saveState === 'error' && saveError}
            </div>

            <section className="rounded-lg border border-slate-200">
              <button type="button" onClick={() => setChatOpen((value) => !value)} className="flex w-full items-center justify-between p-2.5 text-left text-xs font-semibold text-slate-800"><span className="flex items-center gap-2"><MessageSquareIcon className="size-4 text-violet-600" />AI 对话辅助</span><ChevronDownIcon className={cn('size-4 transition', chatOpen && 'rotate-180')} /></button>
              {chatOpen && <div className="border-t border-slate-200 p-3">
                <p className="mb-2 text-[10px] leading-4 text-slate-500">辅助解释当前风险，不代替三个销售动作，也不改变处理结论。</p>
                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {chatMessages.slice(-4).map((message) => <div key={message.id} className={cn('rounded-lg p-2 text-[11px] leading-4', message.role === 'assistant' ? 'bg-violet-50 text-violet-900' : 'bg-slate-100 text-slate-800')}>{message.content}</div>)}
                </div>
                <div className="mt-2 flex gap-2"><Textarea className="min-h-16 flex-1 text-xs" value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="询问当前风险…" /><Button size="icon" onClick={sendChat} disabled={chatLoading}><SendIcon /></Button></div>
              </div>}
            </section>

          </div>}

          {selectedRisk && <div className="sticky bottom-0 z-30 border-t border-slate-200 bg-white/98 p-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.12)]" data-testid="decision-action-dock">
            {(visibleSubmissionMessage || conflicts.length > 0) && <div className="mb-2 max-h-32 overflow-y-auto rounded-lg bg-slate-50 p-2">
              <p className={cn('text-[11px] font-medium', conflicts.length > 0 ? 'text-red-700' : 'text-slate-700')}>{visibleSubmissionMessage}</p>
              {conflicts.length > 0 && <div className="mt-2 space-y-1">{conflicts.slice(0, 8).map((conflict, index) => <div key={`${conflict.code}-${index}`} className="rounded border border-red-100 bg-white p-1.5 text-[10px] leading-4 text-red-700"><p>{conflict.message || conflict.code || '冲突未解决'}</p><div className="mt-1 flex flex-wrap gap-1">{Array.from(new Set([conflict.risk_id, ...(conflict.related_risk_ids || [])].filter(Boolean) as string[])).map((riskId) => <button key={riskId} type="button" onClick={() => selectRisk(riskId)} className="rounded bg-red-50 px-1.5 py-0.5 font-medium hover:bg-red-100">回到风险 {contract.riskCards.findIndex((risk) => risk.id === riskId) + 1}</button>)}</div></div>)}</div>}
            </div>}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => moveRisk(-1)} aria-label="上一条"><ArrowUpIcon /></Button>
              <Button className="min-w-0 flex-1" onClick={() => void saveDecision({ enforceComplete: true, allowAdvance: true })} disabled={decisionControlsLocked || saveState === 'saving' || !intent || (intent === 'customer_agreed' ? !selectedOptionId : !feedback.trim())}>
                {saveState === 'saving' ? <Loader2Icon className="animate-spin" /> : intent === 'customer_feedback' ? <MessageSquareIcon /> : intent === 'exception_requested' ? <ShieldAlertIcon /> : <CheckCircle2Icon />}
                暂存谈判结果
              </Button>
              <Button variant="outline" size="icon" onClick={() => moveRisk(1)} aria-label="下一条"><ArrowDownIcon /></Button>
            </div>
          </div>}
          </div>}

          {rightPanelTab === 'basis' && <div id="risk-panel-basis" className="space-y-3 p-3" role="tabpanel" aria-labelledby="risk-panel-tab-basis">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">法务风险说明</h2>
              <p className="mt-2 text-xs leading-5 text-slate-700">{selectedRisk?.description || '当前没有可展示的风险说明。'}</p>
              {selectedRisk?.suggestion && <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600"><span className="font-semibold text-slate-800">业务影响：</span>{selectedRisk.suggestion}</p>}
            </div>

            <section className="overflow-hidden rounded-lg border border-slate-200" data-testid="clause-basis-comparison">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">条款对照</div>
              <div className="grid divide-y divide-slate-200">
                <div className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">当前条款</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-800">{selectedRisk && !selectedRisk.source_anchor
                    ? '文档级覆盖结论，未绑定原文。该结论来自全篇覆盖检查，不对应某一页或某段文字。'
                    : selectedRisk?.source_anchor?.exact_text || selectedRisk?.source_anchor?.excerpt || '当前风险没有可唯一定位的原文。'}</p>
                </div>
                <div className="p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">标准条款</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">当前审核响应没有独立的标准条款字段；已发布策略的建议修订不能冒充标准条款。</p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-dashed border-slate-300 p-3" data-testid="risk-evidence-files-empty">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800"><PaperclipIcon className="size-4 text-slate-500" />关联证据文件</div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">{selectedRisk && !selectedRisk.source_anchor
                ? '该结论没有原文位置证据，不生成第 1 页占位锚点，也不提供原文跳转。'
                : '当前风险数据只有原文位置证据，没有图片/PDF附件关系，因此不展示伪造缩略图。'}</p>
              {selectedRisk?.source_anchor?.page && <button type="button" onClick={() => navigateSourcePage(selectedRisk.source_anchor!.page)} className="mt-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100">回到第 {selectedRisk.source_anchor.page} 页原文</button>}
            </section>
          </div>}

          {rightPanelTab === 'evolution' && <div id="risk-panel-evolution" className="p-3" role="tabpanel" aria-labelledby="risk-panel-tab-evolution">
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center" data-testid="clause-evolution-empty">
              <p className="text-sm font-semibold text-slate-800">暂无可验证的条款演变链</p>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">当前响应没有同一条款的逐版文本、修改人和修改时间。规则包版本与 ReviewRun 时间不能冒充条款版本，因此暂不生成时间线或红绿 Diff。</p>
              {selectedRisk?.source_anchor?.exact_text && <div className="mt-3 rounded-md bg-slate-50 p-3 text-left"><p className="text-[10px] font-semibold text-slate-400">当前可验证条款</p><p className="mt-1 text-xs leading-5 text-slate-700">{selectedRisk.source_anchor.exact_text}</p></div>}
            </div>
          </div>}
          </div>
        </aside>
      </div>
    </div>
  )
}
