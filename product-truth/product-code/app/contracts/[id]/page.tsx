'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BotIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
  UploadIcon,
  WorkflowIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { error as toastError, success as toastSuccess } from '@/lib/toast'

type ContractStatus = 'DRAFT' | 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED'
type RiskSeverity = 'red' | 'yellow' | 'green' | 'white'
type SidePanelMode = 'review' | 'summary' | 'assistant' | 'evidence'
type RiskFilter = 'all' | RiskSeverity

type ContractVersion = {
  id: string
  version_number: number
  source: 'original' | 'review_revision' | 'manual_revision'
  storage_path: string
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
  model_policy?: {
    id: string
    provider: string
    source: 'model_policies' | 'analysis_job.provider' | 'fallback'
    model?: string | null
    degraded: boolean
    status: string | null
    last_error: string | null
    invocation_id?: string | null
    fallback_reason?: string | null
  }
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

const evidenceStatusLabel: Record<NonNullable<ReviewRun['evidence_status']>, string> = {
  snapshot_bound: '已绑定规则快照',
  partial_snapshot: '部分规则缺快照',
  missing_snapshot: '缺少规则快照',
}

const modelPolicySourceLabel: Record<NonNullable<ReviewRun['model_policy']>['source'], string> = {
  model_policies: '已发布模型策略',
  'analysis_job.provider': '分析任务记录',
  fallback: '规则兜底',
}

const reportTriggerLabel: Record<string, string> = {
  initial_generate: '初始报告',
  ask_responded: 'ASK 回应',
  ask_reopened: 'ASK 重开',
  ask_closed: 'ASK 关闭',
  standard_marked: '标准合同标记',
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

function firstEvidence(risk: RiskFinding | null) {
  return risk?.evidence?.snippets?.find((snippet) => snippet.trim().length > 0) || ''
}

function needsManualRiskLocation(risk: RiskFinding) {
  const hasEvidence = Boolean(firstEvidence(risk))
  const hasOffsets = risk.position.start !== null && risk.position.end !== null
  return risk.severity !== 'green' && (
    risk.evidence?.location_status === 'manual_required'
    || !hasEvidence
    || !hasOffsets
  )
}

function needsManualAnnotationLocation(annotation: Annotation) {
  return (
    !annotation.selected_text?.trim()
    || annotation.comment.includes('LocationStatus: manual_required')
    || annotation.comment.includes('【需人工定位】')
  )
}

function buildReviewHealth(data: WorkbenchData) {
  const issues: string[] = []
  const manualRiskCount = data.riskFindings.filter(needsManualRiskLocation).length
  const manualAnnotationCount = data.annotations.filter(needsManualAnnotationLocation).length

  if ((data.status === 'COMPLETED' || data.riskFindings.length > 0) && !data.reviewRun?.skill_bundle_id) {
    issues.push('缺少 SkillBundle 绑定，不能证明结果来自已发布审核规则。')
  }
  if ((data.status === 'COMPLETED' || data.riskFindings.length > 0) && !data.reviewRun?.rule_snapshot_refs?.length) {
    issues.push('缺少规则快照引用，风险项不能追溯到配置中心规则版本。')
  }
  if (data.reviewRun?.evidence_status && data.reviewRun.evidence_status !== 'snapshot_bound') {
    issues.push(`证据状态为 ${evidenceStatusLabel[data.reviewRun.evidence_status]}。`)
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

  return {
    issues,
    manualRiskCount,
    manualAnnotationCount,
    degraded: issues.length > 0,
    exportBlocked: manualRiskCount > 0 || manualAnnotationCount > 0,
  }
}

function SourceTextPreview({
  text,
  selectedText,
}: {
  text: string
  selectedText: string
}) {
  const normalized = text.trim() || '当前还没有可展示的合同正文。请先上传可解析的 docx、pdf 或文本文件。'
  const index = selectedText ? normalized.indexOf(selectedText) : -1
  const contentClassName = 'whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-800'
  const pageClassName = 'mx-auto min-h-[640px] max-w-[760px] rounded-sm bg-white px-6 py-8 shadow-sm ring-1 ring-slate-200 md:px-10 md:py-12'

  if (index < 0) {
    return (
      <div className="max-h-[760px] overflow-auto rounded-lg bg-slate-100 p-3 md:p-6">
        <div className={pageClassName}>
          <pre className={contentClassName}>{normalized}</pre>
        </div>
      </div>
    )
  }

  const before = normalized.slice(0, index)
  const matched = normalized.slice(index, index + selectedText.length)
  const after = normalized.slice(index + selectedText.length)

  return (
    <div className="max-h-[760px] overflow-auto rounded-lg bg-slate-100 p-3 md:p-6">
      <div className={pageClassName}>
        <pre className={contentClassName}>
          {before}
          <mark className="rounded bg-amber-200 px-1 text-slate-950">{matched}</mark>
          {after}
        </pre>
      </div>
    </div>
  )
}

export default function ContractWorkbenchPage() {
  const params = useParams()
  const contractId = params.id as string
  const [data, setData] = useState<WorkbenchData | null>(null)
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>('review')

  const selectedRisk = useMemo(() => {
    if (!data) return null
    return data.riskFindings.find((risk) => risk.id === selectedRiskId) || data.riskFindings[0] || null
  }, [data, selectedRiskId])

  const fetchWorkbench = useCallback(async (silent = false) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contracts/${contractId}/review`, {
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
    } catch {
      if (!silent) setPageError('网络错误，请稍后重试')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [contractId])

  useEffect(() => {
    void fetchWorkbench()
  }, [fetchWorkbench])

  useEffect(() => {
    if (!data || (data.status !== 'PARSING' && data.status !== 'ANALYZING')) return
    const timer = window.setInterval(() => {
      void fetchWorkbench(true)
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
          headers: isRerun
            ? { ...headers, 'Content-Type': 'application/json' }
            : headers,
          body: isRerun ? JSON.stringify({ trigger_event: 'manual_rerun' }) : undefined,
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toastError(extractApiError(payload, isRerun ? '启动再审核失败' : '启动审核失败'))
        return
      }
      toastSuccess(isRerun ? '已启动合同再审核' : '已启动合同审核')
      await fetchWorkbench()
    } catch {
      toastError('网络错误，启动审核失败')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleExport() {
    if (!data) return
    setExporting(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contracts/${contractId}/export`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        toastError(extractApiError(payload, '导出批注版本失败'))
        return
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${data.filename}-ONES批注版.docx`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      window.URL.revokeObjectURL(url)
      toastSuccess('已生成 ONES 批注版本')
      await fetchWorkbench(true)
    } catch {
      toastError('网络错误，导出批注版本失败')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[480px] items-center justify-center text-slate-500">
        <Loader2Icon className="mr-2 h-5 w-5 animate-spin" />
        加载合同审核工作台...
      </div>
    )
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
            <Link href="/contracts">
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
  const redCount = data.stats?.red || data.riskFindings.filter((risk) => risk.severity === 'red').length
  const yellowCount = data.stats?.yellow || data.riskFindings.filter((risk) => risk.severity === 'yellow').length
  const displayName = data.filename?.trim() || data.title?.trim() || '未命名合同审核'
  const hasSourceAsset = Boolean(data.parsed_text?.trim()) || data.versions.length > 0 || Boolean(data.storage_path)
  const canStartReview = hasSourceAsset && !isBusy && (
    data.status === 'PENDING' || data.status === 'FAILED' || data.status === 'COMPLETED'
  )
  const reviewHealth = buildReviewHealth(data)
  const canExport = data.status === 'COMPLETED'
    && (data.annotations.length > 0 || data.riskFindings.length > 0)
    && !reviewHealth.exportBlocked
  const versionActionLabel = hasSourceAsset ? '导入客户回传件' : '补充审核源文件'
  const openRiskCount = data.stats?.open || data.riskFindings.filter((risk) => risk.status === 'open').length
  const reviewActionLabel = data.status === 'COMPLETED'
    ? '重新审查'
    : data.status === 'FAILED'
      ? '再次审核'
      : '发起审核'
  const statusMeta = statusMap[data.status] || { label: data.status, variant: 'secondary' as const }
  const statusLabel = data.status === 'COMPLETED' && reviewHealth.degraded
    ? '审核完成（需复核）'
    : statusMeta.label
  const statusVariant = data.status === 'COMPLETED' && reviewHealth.degraded
    ? 'destructive'
    : statusMeta.variant

  return (
    <div className="space-y-6 p-6 xl:p-8">
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
            ONES 业务运营按后台规则生成风险定位、谈判任务和 Word 批注版本。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/contracts">
            <Button variant="outline">
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              返回
            </Button>
          </Link>
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
          <Button
            onClick={handleExport}
            disabled={!canExport || exporting}
            variant="outline"
            title={reviewHealth.exportBlocked ? '存在未定位批注，不能导出源文件批注版' : undefined}
          >
            {exporting ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <DownloadIcon className="mr-2 h-4 w-4" />}
            导出批注版
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="红线风险" value={redCount} tone="text-red-600" />
        <MetricCard label="需谈判风险" value={yellowCount} tone="text-amber-600" />
        <MetricCard label="开放风险" value={openRiskCount} tone="text-slate-900" />
        <MetricCard label="批注数量" value={data.annotations.length} tone="text-blue-600" />
      </div>

      {reviewHealth.degraded && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <p className="font-medium">当前审核结果未达到正式验收状态</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {reviewHealth.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-4">
          <Card>
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileTextIcon className="h-4 w-4" />
                    原文与批注意图
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    以合同源文件为主画布，风险定位、批注意图和客户回传版本都围绕当前版本展示。
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
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
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
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <div className="rounded bg-white/70 p-2">
                      <div className="text-[11px] font-medium text-blue-700">原文内容</div>
                      <p className="mt-1 line-clamp-4 leading-5">{selectedSnippet || '未记录原文片段'}</p>
                    </div>
                    <div className="rounded bg-white/70 p-2">
                      <div className="text-[11px] font-medium text-blue-700">批注建议</div>
                      <p className="mt-1 line-clamp-4 leading-5">{selectedRisk.suggestion || '暂未生成修改建议'}</p>
                    </div>
                    <div className="rounded bg-white/70 p-2">
                      <div className="text-[11px] font-medium text-blue-700">风险说明</div>
                      <p className="mt-1 line-clamp-4 leading-5">{selectedRisk.description || '未记录风险说明'}</p>
                    </div>
                  </div>
                  {selectedRisk.rule_code && (
                    <div className="mt-2 font-mono text-xs text-blue-700">
                      {selectedRisk.rule_code}
                      {selectedRisk.rule_version ? ` · v${selectedRisk.rule_version}` : ''}
                      {selectedRisk.evidence?.rule_snapshot_id ? ` · ${selectedRisk.evidence.rule_snapshot_id}` : ''}
                    </div>
                  )}
                  {selectedRisk.evidence?.location_reason && (
                    <div className="mt-2 text-xs text-blue-800">
                      定位状态：{selectedRisk.evidence.location_status || '未记录'}；{selectedRisk.evidence.location_reason}
                    </div>
                  )}
                </div>
              )}
              <SourceTextPreview text={data.parsed_text || ''} selectedText={selectedSnippet} />
            </CardContent>
          </Card>

          <AnnotationsPanel annotations={data.annotations} />
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">审核侧栏</CardTitle>
                <Badge variant="outline">{data.reviewRun?.status || '未开始'}</Badge>
              </div>
              <SidePanelTabs value={sidePanelMode} onChange={setSidePanelMode} />
            </CardHeader>
            <CardContent className="pt-4">
              {sidePanelMode === 'review' && (
                <ReviewPanel
                  risks={data.riskFindings}
                  selectedRiskId={selectedRisk?.id || null}
                  onSelectRisk={setSelectedRiskId}
                  negotiationTasks={data.negotiationTasks}
                />
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

          <VersionOutputPanel
            data={data}
            contractId={contractId}
            actionLabel={versionActionLabel}
          />
        </aside>
      </div>
    </div>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-sm text-slate-500">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
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
          <h3 className="text-sm font-semibold text-slate-950">风险定位</h3>
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
                    {risk.rule_code && <span className="font-mono">{risk.rule_code}</span>}
                    {risk.clause_ref && <span>{risk.clause_ref}</span>}
                    <span>{manualLocation ? '未完成原文定位' : '已绑定原文定位'}</span>
                    <span>复核反馈待接入</span>
                    <span>{risk.status}</span>
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
          只基于当前合同、规则快照、SkillBundle、模型策略和已生成证据辅助解释，不作为规则事实来源。
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
          <InfoLine label="SkillBundle" value={reviewRun?.skill_bundle_id || '未生成'} />
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
      <InfoLine label="审核运行" value={reviewRun?.status || '未开始'} />
      <InfoLine
        label="证据状态"
        value={reviewRun?.evidence_status ? evidenceStatusLabel[reviewRun.evidence_status] : '未绑定'}
      />
      <InfoLine label="规则快照" value={reviewRun?.rule_snapshot_id || '未绑定'} />
      <InfoLine label="快照数量" value={String(reviewRun?.rule_snapshot_refs?.length ?? 0)} />
      <InfoLine label="技能包" value={reviewRun?.skill_bundle_id || '未生成'} />
      <InfoLine label="模型策略" value={reviewRun?.model_policy_id || 'rule-engine'} />
      <InfoLine
        label="模型来源"
        value={reviewRun?.model_policy?.source ? modelPolicySourceLabel[reviewRun.model_policy.source] : '未记录'}
      />
      <InfoLine label="开始时间" value={formatTime(reviewRun?.started_at)} />
      <InfoLine label="完成时间" value={formatTime(reviewRun?.completed_at)} />
      <div className="border-t border-slate-200 pt-3">
        <InfoLine label="最近执行器" value={latestJob?.provider || '未记录'} />
        <InfoLine label="执行状态" value={latestJob?.status || '未记录'} />
        <InfoLine label="降级" value={latestJob?.degraded ? '是' : '否'} />
      </div>
      {latestJob?.last_error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          {latestJob.last_error}
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
              客户谈判后的回传文件会形成新的 ContractVersion，不作为发起审核入口。
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
            ) : data.versions.map((version) => (
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
          </div>
        </div>
        <div className="border-t border-slate-200 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">输出文件</p>
          {data.outputs.length === 0 ? (
            <p className="text-slate-500">尚未生成 ONES 批注版本。</p>
          ) : (
            <div className="space-y-2">
              {data.outputs.map((output) => (
                <div key={output.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="font-medium text-slate-900">批注版 v{output.version_number}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatTime(output.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AnnotationsPanel({ annotations }: { annotations: Annotation[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareTextIcon className="h-4 w-4" />
          Word 批注
        </CardTitle>
      </CardHeader>
      <CardContent>
        {annotations.length === 0 ? (
          <p className="text-sm text-slate-500">审核完成后会在这里展示可写入 Word 的批注。</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {annotations.map((annotation) => {
              const manualLocation = needsManualAnnotationLocation(annotation)
              return (
                <div
                  key={annotation.id}
                  className={`rounded-md border p-3 text-sm ${
                    manualLocation ? 'border-amber-200 bg-amber-50' : 'border-slate-200'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{annotation.selected_text || '未定位批注'}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {manualLocation && <Badge variant="destructive">需人工定位</Badge>}
                      <Badge variant={annotation.priority === 'urgent' ? 'destructive' : 'secondary'}>
                        {annotation.priority || 'normal'}
                      </Badge>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap leading-6 text-slate-600">{annotation.comment}</p>
                </div>
              )
            })}
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
