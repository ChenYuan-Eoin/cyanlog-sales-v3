'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  GitCompareIcon,
  FileTextIcon,
  AlertTriangleIcon,
  ClockIcon,
  ZapIcon,
  SearchIcon,
  PlusIcon,
  ChevronRightIcon,
  XIcon,
  ShieldCheckIcon,
  PenToolIcon,
} from 'lucide-react'
import type { Contract } from '@/types'
import { readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import { CONTRACTS_LIST_CACHE_PREFIX, loadContractsListForCache } from '@/lib/core-page-warmup'
import {
  deriveContractCenterTaskModel,
  type ContractCenterBusinessTask,
  type ContractCenterTaskId,
} from '@/lib/contracts/contract-center-task-model'
import { buildContractCompareHref } from '@/lib/contracts/review-navigation'
import { handleError } from '@/lib/toast'
import { LoadingState } from '@/components/ui/LoadingState'

type TaskFilter = 'all' | 'contract' | 'reviewed' | 'compare' | 'draft' | 'pending' | 'review'
type ViewMode = 'desktop' | 'mobile'

type QuickAction = {
  id: ContractCenterTaskId
  task: ContractCenterBusinessTask
  shortTitle: string
  outcomeLabel: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}

type ContractsCachePayload = {
  contracts: ListContract[]
  drafts: Contract[]
  meta: {
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

type ContractVersionSummary = {
  id?: string | null
  version_number?: number | null
  source?: string | null
  storage_path?: string | null
  upload_id?: string | null
  file_sha256?: string | null
  text_sha256?: string | null
  created_at?: string | null
}

type ContractReviewSummary = {
  id: string
  status?: string | null
  source_binding?: 'matched_source_version' | 'points_to_output_version' | 'unresolved' | null
  contract_version_id?: string | null
  source_storage_path?: string | null
  created_at?: string | null
  completed_at?: string | null
}

type ContractSourceIdentitySummary = {
  state?: string | null
  label?: string | null
  description?: string | null
  ready?: boolean | null
  can_start_review?: boolean | null
  source_version_id?: string | null
  storage_path?: string | null
  failure_reason?: string | null
  recovery_action?: {
    id?: string | null
    label?: string | null
    description?: string | null
    href?: string | null
  } | null
}

type ContractComparisonSummary = {
  id: string
  contract_id?: string | null
  baseline_type?: string | null
  baseline_doc_id?: string | null
  compare_doc_id?: string | null
  status?: string | null
  ai_summary?: string | null
  created_at?: string | null
  completed_at?: string | null
  comparison_diffs?: Array<{ id?: string | null; risk_level?: string | null }>
}

type ListContract = Omit<Contract, 'contract_reviews'> & {
  current_version_id?: string | null
  contract_versions?: ContractVersionSummary[]
  contract_comparisons?: ContractComparisonSummary[]
  latest_review?: ContractReviewSummary | null
  review_runs?: ContractReviewSummary[]
  source_identity?: ContractSourceIdentitySummary | null
}

type TaskItemView = {
  id: string
  name: string
  type: 'draft' | 'review' | 'compare'
  moduleLabel: '合同审核' | '合同起草' | '文档对比'
  versionLabel: string
  objectLabel: string
  status: string
  statusColor: string
  updatedAt: string
  href: string | null
  nextAction: string
  nextActionDescription: string
  stateGroup: 'pending' | 'completed' | 'attention' | 'unavailable'
  hasExistingReview: boolean
  selectionOnly?: boolean
}

const LIST_CACHE_TTL_MS = 5 * 60 * 1000
const LIST_BACKGROUND_REFRESH_MS = 60 * 1000

function mergeContractsById(existing: ListContract[], incoming: ListContract[]) {
  const merged = new Map<string, ListContract>()
  for (const contract of existing) {
    merged.set(contract.id, contract)
  }
  for (const contract of incoming) {
    merged.set(contract.id, contract)
  }
  return Array.from(merged.values())
}

function readApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const data = payload as { error?: unknown; message?: unknown }
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error === 'object') {
    const error = data.error as { message?: unknown }
    if (typeof error.message === 'string') return error.message
  }
  if (typeof data.message === 'string') return data.message
  return fallback
}

async function readResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  return `${readApiError(payload, fallback)}（${response.status}）`
}

function contractActionName(contract?: {
  filename?: string | null
  title?: string | null
  contract_no?: string | null
}) {
  const name = contract?.filename || contract?.title || contract?.contract_no || ''
  return name.trim() || '未命名合同'
}

function buildTaskModel(contract?: ListContract) {
  const latestReview = contract?.latest_review || null
  const sourceIdentity = contract?.source_identity || null
  const versions = contract?.contract_versions || []
  const hasVersionStoragePaths = versions.some((version) => Boolean(version.storage_path?.trim()))
  return deriveContractCenterTaskModel({
    contract: contract ? { id: contract.id, name: contractActionName(contract) } : null,
    versions: versions.flatMap((version) => version.id ? [{
      id: version.id,
      versionNumber: version.version_number,
      source: version.source,
      storagePath: version.storage_path,
      createdAt: version.created_at,
    }] : []),
    latestReviewRun: latestReview ? {
      id: latestReview.id,
      status: latestReview.status,
      sourceBinding: latestReview.source_binding,
      sourceVersionId: latestReview.contract_version_id,
      sourceStoragePath: latestReview.source_storage_path,
      createdAt: latestReview.created_at,
      completedAt: latestReview.completed_at,
    } : null,
    reviewRuns: (contract?.review_runs || []).map((review) => ({
      id: review.id,
      status: review.status,
      sourceBinding: review.source_binding,
      sourceVersionId: review.contract_version_id,
      sourceStoragePath: review.source_storage_path,
      createdAt: review.created_at,
      completedAt: review.completed_at,
    })),
    currentSourceVersionId: contract?.current_version_id,
    currentSourceStoragePath: hasVersionStoragePaths ? contract?.storage_path : null,
    sourceIdentity: sourceIdentity ? {
      state: sourceIdentity.state,
      ready: sourceIdentity.ready,
      sourceVersionId: sourceIdentity.source_version_id,
      storagePath: sourceIdentity.storage_path,
      failureReason: sourceIdentity.failure_reason,
    } : null,
  })
}

function versionLabelForDocument(
  contract: ListContract,
  docId: string | null | undefined,
  fallback: string
) {
  const model = buildTaskModel(contract)
  if (!docId) return `${fallback} ${model.currentSourceVersionLabel}`
  const version = model.sourceVersions.find((item) => item.id === docId)
  if (version?.versionNumber) return `v${version.versionNumber}`
  return fallback
}

function comparisonVersionLabel(contract: ListContract, comparison: ContractComparisonSummary) {
  const baseline = versionLabelForDocument(contract, comparison.baseline_doc_id, '基准')
  const compare = versionLabelForDocument(contract, comparison.compare_doc_id, '新稿')
  return `${baseline} → ${compare}`
}

function comparisonStatus(comparison: ContractComparisonSummary) {
  const status = (comparison.status || '').toLowerCase()
  if (status === 'completed') return { label: '对比完成', color: 'bg-emerald-100 text-emerald-700' }
  if (status === 'processing') return { label: '对比中', color: 'bg-indigo-100 text-indigo-700' }
  if (status === 'failed') return { label: '对比失败', color: 'bg-red-100 text-red-700' }
  return { label: '待对比', color: 'bg-amber-100 text-amber-700' }
}

function comparisonNextAction(comparison: ContractComparisonSummary) {
  const riskCount = (comparison.comparison_diffs || []).filter((diff) => diff.risk_level === 'red').length
  if ((comparison.status || '').toLowerCase() === 'completed') {
    return {
      label: riskCount > 0 ? '查看红线差异' : '查看差异结果',
      description: riskCount > 0
        ? `发现 ${riskCount} 处红线差异，进入文档对比工作台复核旧稿与新稿。`
        : '对比已完成，进入文档对比工作台查看差异列表、原文定位和处理动作。',
    }
  }
  return {
    label: '继续文档对比',
    description: '对比任务尚未完成，进入文档对比工作台确认文件和执行状态。',
  }
}

function reviewTaskPresentation(status: string | null | undefined) {
  const normalized = (status || '').trim().toLowerCase()
  if (['pending', 'queued', 'created', 'parsing', 'analyzing', 'processing', 'running'].includes(normalized)) {
    return {
      action: '查看审核进度',
      description: '查看当前文件的正文读取、规则判断和风险审核进度。',
      stateGroup: 'pending' as const,
      executionComplete: false,
    }
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(normalized)) {
    return {
      action: '查看失败原因并重试',
      description: '先确认失败步骤，再恢复当前版本审核，不创建新的合同或文件版本。',
      stateGroup: 'attention' as const,
      executionComplete: false,
    }
  }
  if (['degraded', 'needs_review', 'needs_manual_review'].includes(normalized)) {
    return {
      action: '复核降级结果',
      description: '核对当前版本的规则依据、审核结果和原文定位。',
      stateGroup: 'attention' as const,
      executionComplete: false,
    }
  }
  if (['completed', 'succeeded', 'success', 'done'].includes(normalized)) {
    return {
      action: '处理审核风险',
      description: '风险结果已经生成，仍需复核处理并准备当前版本的批注输出。',
      // 模型运行结束不等于合同审核业务结束。风险处理、复审和交付
      // 尚未闭环前，列表必须继续把它放在待处理任务中。
      stateGroup: 'pending' as const,
      executionComplete: true,
    }
  }
  return {
    action: '查看审核记录',
    description: '进入当前版本审核工作台，确认审核状态和下一步。',
    stateGroup: 'pending' as const,
    executionComplete: false,
  }
}

const taskPresentation: Record<ContractCenterTaskId, Omit<QuickAction, 'id' | 'task'>> = {
  draft_contract: {
    shortTitle: '起草',
    outcomeLabel: '形成一份可继续完善的新合同草稿',
    icon: PenToolIcon,
    color: 'bg-indigo-600',
  },
  start_review: {
    shortTitle: '上传审核',
    outcomeLabel: '获得风险定位、处理建议和批注输出准备',
    icon: ShieldCheckIcon,
    color: 'bg-rose-600',
  },
  continue_review: {
    shortTitle: '已有审核',
    outcomeLabel: '查看进度、处理风险、重试或下载结果',
    icon: ClockIcon,
    color: 'bg-amber-500',
  },
  compare_versions: {
    shortTitle: '版本比对',
    outcomeLabel: '明确查看旧版与新版之间的差异',
    icon: GitCompareIcon,
    color: 'bg-emerald-600',
  },
}

export default function ContractCenterPage() {
  const [contracts, setContracts] = useState<ListContract[]>([])
  const [drafts, setDrafts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('desktop')
  const [loadingMore, setLoadingMore] = useState(false)

  // 分页状态
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  const [hasNext, setHasNext] = useState(false)

  // 检测视口宽度
  useEffect(() => {
    const checkViewport = () => {
      setViewMode(window.innerWidth < 768 ? 'mobile' : 'desktop')
    }
    checkViewport()
    window.addEventListener('resize', checkViewport)
    return () => window.removeEventListener('resize', checkViewport)
  }, [])

  useEffect(() => {
    const task = new URLSearchParams(window.location.search).get('task')
    if (task === 'continue_review') setTaskFilter('reviewed')
    if (task === 'compare' || task === 'compare_versions') setTaskFilter('compare')
  }, [])

  const applyContractsPayload = useCallback((
    payload: ContractsCachePayload,
    pageNum: number,
    append: boolean
  ) => {
    setContracts((current) => append
      ? mergeContractsById(current, payload.contracts)
      : payload.contracts
    )
    setDrafts(payload.drafts)
    setTotalPages(payload.meta.totalPages)
    setHasNext(payload.meta.hasNext)
    setPage(pageNum)
  }, [])

  const fetchData = useCallback(async (
    pageNum = 1,
    options: { append?: boolean; query?: string } = {}
  ) => {
    const append = Boolean(options.append)
    const query = (options.query || '').trim()

    try {
      setLoadError('')
      if (append) {
        setLoadingMore(true)
      }

      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

      if (query) {
        if (!append) {
          setLoading(true)
        }

        const res = await fetch(
          `/api/contracts?page=${pageNum}&pageSize=${pageSize}&search=${encodeURIComponent(query)}`,
          { headers }
        )

        if (!res.ok) {
          throw new Error(await readResponseError(res, '搜索合同失败'))
        }

        const data = await res.json()
        const meta = data.data?.meta || {}
        applyContractsPayload({
          contracts: data.data?.data || [],
          drafts: [],
          meta: {
            totalPages: meta.totalPages || 1,
            hasNext: Boolean(meta.hasNext),
            hasPrev: Boolean(meta.hasPrev),
          },
        }, pageNum, append)
        return
      }

      const cacheKey = scopedCacheKey(token, `${CONTRACTS_LIST_CACHE_PREFIX}:${pageNum}:${pageSize}`)
      const cachedEntry = readBrowserCacheEntry<ContractsCachePayload>(cacheKey)
      const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.savedAt : Number.POSITIVE_INFINITY
      const cached = cacheAgeMs <= LIST_CACHE_TTL_MS ? cachedEntry?.value : null

      if (cached) {
        applyContractsPayload(cached, pageNum, append)
        setLoading(false)
      } else if (!append) {
        setLoading(true)
      }

      if (cached && cacheAgeMs < LIST_BACKGROUND_REFRESH_MS) {
        return
      }

      if (token) {
        const payload = await loadContractsListForCache(token, pageNum, pageSize)
        if (!payload) {
          if (!cached) {
            throw new Error('合同列表加载失败，请检查登录状态或接口权限')
          }
          setLoadError('合同列表刷新失败，当前显示的是缓存数据')
          return
        }

        applyContractsPayload({
          contracts: payload.contracts as ListContract[],
          drafts: payload.drafts as Contract[],
          meta: payload.meta,
        }, pageNum, append)
        return
      }

      const [contractsRes, draftsRes] = await Promise.all([
        fetch(`/api/contracts?page=${pageNum}&pageSize=${pageSize}`, { headers }),
        fetch('/api/contracts/drafts', { headers }),
      ])

      let nextContracts = cached?.contracts || []
      let nextDrafts = cached?.drafts || []
      let nextMeta = cached?.meta || { totalPages: 1, hasNext: false, hasPrev: false }

      if (contractsRes.ok) {
        const contractsData = await contractsRes.json()
        nextContracts = contractsData.data.data || []
        const meta = contractsData.data.meta || {}
        nextMeta = {
          totalPages: meta.totalPages || 1,
          hasNext: meta.hasNext || false,
          hasPrev: meta.hasPrev || false,
        }
      }

      if (draftsRes.ok) {
        const draftsData = await draftsRes.json()
        nextDrafts = draftsData.data || []
      }

      if (!contractsRes.ok || !draftsRes.ok) {
        const failedResponse = !contractsRes.ok ? contractsRes : draftsRes
        if (!cached) {
          throw new Error(await readResponseError(failedResponse, '合同数据加载失败'))
        }
        setLoadError('合同数据刷新失败，当前显示的是缓存数据')
        return
      }

      applyContractsPayload({
        contracts: nextContracts,
        drafts: nextDrafts,
        meta: nextMeta,
      }, pageNum, append)

      if (contractsRes.ok && draftsRes.ok) {
        writeBrowserCache(cacheKey, {
          contracts: nextContracts,
          drafts: nextDrafts,
          meta: nextMeta,
        })
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载合同数据失败')
      handleError(err, '加载合同数据失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [applyContractsPayload, pageSize])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData(1, { query: searchQuery })
    }, searchQuery.trim() ? 300 : 0)
    return () => clearTimeout(timer)
  }, [fetchData, searchQuery])

  const handleLoadMore = useCallback(() => {
    if (!hasNext || loadingMore) return
    void fetchData(page + 1, {
      append: true,
      query: searchQuery,
    })
  }, [fetchData, hasNext, loadingMore, page, searchQuery])

  const resolvedQuickActions = useMemo<QuickAction[]>(() => {
    const globalModel = buildTaskModel()
    const reviewedContracts = contracts.filter((contract) => (contract.review_runs?.length || 0) > 0)
    const contractsWithSources = contracts.filter(
      (contract) => buildTaskModel(contract).sourceVersions.length > 0
    )
    return globalModel.taskOrder.map((id) => {
      let task = globalModel.tasks[id]
      if (id === 'continue_review' && reviewedContracts.length > 0) {
        task = {
          ...task,
          availability: 'available',
          availabilityLabel: '可选择',
          objectLabel: `${reviewedContracts.length} 份已有审核记录的合同`,
          preconditionLabel: '从列表明确选择要继续的合同和审核记录',
          href: '#contract-task-list',
          nextAction: {
            id: 'select_reviewed_contract',
            label: '选择已有审核',
            description: '列表只展示已有真实审核记录的合同，不会根据合同状态猜测。',
          },
          blockedReason: null,
        }
      } else if (id === 'continue_review' && hasNext) {
        task = {
          ...task,
          availability: 'available',
          availabilityLabel: '继续查找',
          objectLabel: '更多合同记录尚未加载',
          preconditionLabel: '继续加载后明确选择已有审核记录的合同',
          href: '#contract-task-list',
          nextAction: {
            id: 'load_more_reviewed_contracts',
            label: '加载更多并选择',
            description: '当前页没有审核记录，但后续还有合同；系统不会把当前 20 条误当作全部数据。',
          },
          blockedReason: null,
        }
      }
      if (id === 'compare_versions' && contracts.length > 0) {
        const moreContractsMayHaveSources = contractsWithSources.length === 0 && hasNext
        task = {
          ...task,
          availability: contractsWithSources.length > 0 || moreContractsMayHaveSources ? 'available' : 'needs_input',
          availabilityLabel: contractsWithSources.length > 0
            ? '可选择'
            : moreContractsMayHaveSources
              ? '继续查找'
              : '需先补源文件',
          objectLabel: contractsWithSources.length > 0
            ? `${contractsWithSources.length} 份已有源版本的合同`
            : moreContractsMayHaveSources
              ? '更多合同记录尚未加载'
            : `${contracts.length} 份待补源文件的合同`,
          preconditionLabel: '先选择合同；开始比对前再明确选择两个不同源版本',
          href: '#contract-task-list',
          nextAction: {
            id: 'select_contract_for_comparison',
            label: moreContractsMayHaveSources ? '加载更多并选择' : '选择合同',
            description: moreContractsMayHaveSources
              ? '当前页没有源版本，但后续还有合同；继续加载后再明确选择。'
              : '进入文档比对任务列表，由你选择合同；系统不会静默选最近合同。',
          },
          blockedReason: null,
        }
      }
      return {
        id,
        task,
        ...taskPresentation[id],
      }
    })
  }, [contracts, hasNext])

  // 合同中心任务对象：审核、对比、起草是独立任务，但共享合同版本流。
  const allTasks = useMemo(() => {
    const draftTasks = drafts.map((d) => ({
      id: d.id,
      name: d.title || '未命名草稿',
      type: 'draft' as const,
      moduleLabel: '合同起草' as const,
      versionLabel: '草案记录',
      objectLabel: '需求草案',
      status: '暂不可继续' as const,
      statusColor: 'bg-amber-100 text-amber-700' as const,
      updatedAt: d.updated_at,
      href: null,
      nextAction: '开始一份新草稿',
      nextActionDescription: '当前起草页还不能安全恢复这份历史草稿，因此不提供虚假的继续入口。',
      stateGroup: 'unavailable' as const,
      hasExistingReview: false,
    } satisfies TaskItemView))

    const contractTasks = contracts.flatMap((c) => {
      const model = buildTaskModel(c)
      const currentReview = model.currentReview
      const sourceState = model.sourceIdentity.state
      const sourceRecoveryAction = c.source_identity?.recovery_action
      const reviewAction = sourceRecoveryAction?.label
          ? {
              id: sourceRecoveryAction.id || 'recover_source_preparation',
              label: sourceRecoveryAction.label,
              description: sourceRecoveryAction.description || model.sourceIdentity.description,
            }
        : sourceState === 'ready' && model.sourceIdentity.canStartReview
          ? {
              id: 'start_first_review',
              label: `审核当前 ${model.currentSourceVersionLabel}`,
              description: model.reviewRuns.length > 0
                ? `已有 ${model.reviewRuns.length} 条历史审核仍可查看，但不会替代当前 ${model.currentSourceVersionLabel} 的首次审核。`
                : '文件已准备完成，可以启动当前版本的第一次风险审核。',
            }
          : sourceState === 'not_applicable'
              ? {
                  id: 'supply_source',
                  label: '补充源文件',
                  description: model.sourceIdentity.description,
                }
              : {
                  id: 'continue_source_preparation',
                  label: sourceState === 'preparing'
                    ? '查看文件准备进度'
                    : '完成文件准备',
                  description: model.sourceIdentity.description,
                }
      const stateGroup: TaskItemView['stateGroup'] = sourceState === 'failed' || sourceState === 'stale'
          ? 'attention'
          : 'pending'
      const statusColor = stateGroup === 'attention'
        ? 'bg-red-100 text-red-700'
        : 'bg-indigo-100 text-indigo-700'

      const currentUnreviewedTask = {
        id: `${c.id}:review:current-unreviewed`,
        name: contractActionName(c),
        type: 'review' as const,
        moduleLabel: '合同审核' as const,
        versionLabel: model.currentSourceVersion ? model.currentSourceVersionLabel : '暂无源版本',
        objectLabel: '当前版本待审核',
        status: model.sourceIdentity.label,
        statusColor,
        updatedAt: c.updated_at,
        href: sourceRecoveryAction?.href
          ? sourceRecoveryAction.href
          : `/contracts/${encodeURIComponent(c.id)}?from=list`,
        nextAction: reviewAction.label,
        nextActionDescription: reviewAction.description,
        stateGroup,
        hasExistingReview: false,
      } satisfies TaskItemView

      const reviewTasks = model.reviewRuns.map((review) => {
        const presentation = reviewTaskPresentation(review.status)
        const isCurrentReview = currentReview?.id === review.id
        const sourceVerified = review.sourceBinding === 'matched_source_version'
        const reviewStateGroup: TaskItemView['stateGroup'] = !sourceVerified
          ? 'attention'
          : isCurrentReview
            ? presentation.stateGroup
            : presentation.executionComplete
              ? 'completed'
              : presentation.stateGroup
        const isHistoricalRecord = !isCurrentReview
        const objectLabel = !sourceVerified
          ? '审核文件版本待核对'
          : isCurrentReview
            ? '当前版本审核'
            : review.isForCurrentSource
              ? `当前 ${model.currentSourceVersionLabel} 的较早审核`
              : `历史审核，不影响当前 ${model.currentSourceVersionLabel}`
        const nextAction = !sourceVerified
          ? {
              label: '打开合同核对来源',
              description: '先在合同工作台核对当前文件与审核历史；来源修复完成前，不会把这条记录展示成可信风险结果。',
            }
          : isHistoricalRecord && presentation.executionComplete
            ? {
                label: `查看 ${review.sourceVersionLabel} 历史审核`,
                description: `查看该次风险结论、处理记录和审核依据；不会把它当成当前 ${model.currentSourceVersionLabel} 的审核。`,
              }
            : {
                label: presentation.action,
                description: presentation.description,
              }

        return {
          id: `${c.id}:review:${review.id}`,
          name: contractActionName(c),
          type: 'review' as const,
          moduleLabel: '合同审核' as const,
          versionLabel: review.sourceVersionLabel,
          objectLabel,
          status: review.statusLabel,
          statusColor: reviewStateGroup === 'attention'
            ? 'bg-red-100 text-red-700'
            : reviewStateGroup === 'completed'
              ? 'bg-slate-100 text-slate-700'
              : 'bg-indigo-100 text-indigo-700',
          updatedAt: review.completedAt || review.createdAt || c.updated_at,
          href: sourceVerified
            ? `/contracts/${encodeURIComponent(c.id)}?from=list&review=${encodeURIComponent(review.id)}`
            : `/contracts/${encodeURIComponent(c.id)}?from=list`,
          nextAction: nextAction.label,
          nextActionDescription: nextAction.description,
          stateGroup: reviewStateGroup,
          hasExistingReview: true,
        } satisfies TaskItemView
      })

      // A failed/stale current source is actionable even when an older review
      // still points at that version. Keep recovery as its own business task;
      // the historical review remains separately available for audit.
      return model.sourceIdentity.ready && currentReview
        ? reviewTasks
        : [currentUnreviewedTask, ...reviewTasks]
    })

    const compareTasks = contracts.flatMap((contract) => {
      const comparisons = [...(contract.contract_comparisons || [])].sort(
        (left, right) => new Date(right.completed_at || right.created_at || 0).getTime()
          - new Date(left.completed_at || left.created_at || 0).getTime()
      )
      const latestComparison = comparisons[0]
      if (latestComparison?.id) {
        const latestStatus = comparisonStatus(latestComparison)
        const latestAction = comparisonNextAction(latestComparison)
        const stateGroup: TaskItemView['stateGroup'] = latestComparison.status?.toLowerCase() === 'completed'
          ? 'completed'
          : latestComparison.status?.toLowerCase() === 'failed'
            ? 'attention'
            : 'pending'
        return [{
          id: `${contract.id}:compare:${latestComparison.id}`,
          name: contractActionName(contract),
          type: 'compare' as const,
          moduleLabel: '文档对比' as const,
          versionLabel: comparisonVersionLabel(contract, latestComparison),
          objectLabel: '最近一次版本比对',
          status: latestStatus.label,
          statusColor: latestStatus.color,
          updatedAt: latestComparison.completed_at || latestComparison.created_at || contract.updated_at,
          href: buildContractCompareHref(contract.id, { from: 'list', comparisonId: latestComparison.id }),
          nextAction: latestAction.label,
          nextActionDescription: latestAction.description,
          stateGroup,
          hasExistingReview: false,
        } satisfies TaskItemView]
      }
      return []
    })

    const all = [...contractTasks, ...compareTasks, ...draftTasks].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return all
  }, [contracts, drafts])

  const compareChoices = useMemo(() => contracts.flatMap((contract) => {
    if ((contract.contract_comparisons || []).length > 0) return []
    const model = buildTaskModel(contract)
    const compareTask = model.tasks.compare_versions
    return [{
      id: `${contract.id}:compare:choose`,
      name: contractActionName(contract),
      type: 'compare' as const,
      moduleLabel: '文档对比' as const,
      versionLabel: model.comparison.sourceVersionCount > 0
        ? `${model.comparison.sourceVersionCount} 个源版本`
        : '暂无源版本',
      objectLabel: '可选择的合同',
      status: model.comparison.label,
      statusColor: model.comparison.state === 'ready'
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700',
      updatedAt: contract.updated_at,
      href: compareTask.href,
      nextAction: compareTask.nextAction.label,
      nextActionDescription: compareTask.nextAction.description,
      stateGroup: 'unavailable' as const,
      hasExistingReview: false,
      selectionOnly: true,
    } satisfies TaskItemView]
  }), [contracts])

  // 过滤后的任务列表
  const filteredTasks = useMemo(() => {
    if (taskFilter === 'all') return allTasks
    if (taskFilter === 'contract') return allTasks.filter((t) => t.type === 'review')
    if (taskFilter === 'reviewed') return allTasks.filter((t) => t.type === 'review' && t.hasExistingReview)
    if (taskFilter === 'compare') {
      return [...allTasks.filter((t) => t.type === 'compare'), ...compareChoices]
    }
    if (taskFilter === 'draft') return allTasks.filter((t) => t.type === 'draft')
    if (taskFilter === 'pending') {
      return allTasks.filter((t) => t.stateGroup === 'pending' || t.stateGroup === 'attention')
    }
    if (taskFilter === 'review') {
      return allTasks.filter((t) => t.stateGroup === 'completed')
    }
    return allTasks
  }, [allTasks, compareChoices, taskFilter])

  const stats = useMemo(() => ({
    total: contracts.length + drafts.length,
    pending: allTasks.filter((task) => task.stateGroup === 'pending').length,
    needAttention: allTasks.filter((task) => task.stateGroup === 'attention').length,
    completed: allTasks.filter((task) => task.stateGroup === 'completed').length,
  }), [allTasks, contracts.length, drafts.length])

  const isMobile = viewMode === 'mobile'
  const listUnavailable = !loading && Boolean(loadError) && filteredTasks.length === 0
  const emptyMode = searchQuery.trim()
    ? 'search' as const
    : contracts.length === 0 && drafts.length === 0
      ? 'organization' as const
      : 'filter' as const

  const selectGlobalTask = useCallback((taskId: ContractCenterTaskId) => {
    if (taskId !== 'continue_review' && taskId !== 'compare_versions') return
    setTaskFilter(taskId === 'continue_review' ? 'reviewed' : 'compare')
    const url = new URL(window.location.href)
    url.searchParams.set('task', taskId)
    window.history.replaceState(window.history.state, '', url)
    window.setTimeout(() => {
      document.getElementById('contract-task-list')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }, [])

  return (
    <div className="min-h-full bg-slate-50 pb-24 md:pb-8">
      {/* 桌面端顶部工具栏 / 移动端头部 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="mx-auto max-w-[1480px] px-4 md:px-6 py-4">
          {/* 顶部行：标题 + 搜索/操作 */}
          <div className="flex items-center justify-between gap-4">
            <div className={isMobile ? 'hidden' : 'block'}>
              <h1 className="text-xl font-bold text-slate-900">合同中心</h1>
              <p className="text-xs text-slate-500">全生命周期管理</p>
            </div>

            {/* 搜索框 */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder={isMobile ? '搜索合同...' : '搜索合同名称、编号、客户...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-9"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    aria-label="清除搜索"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

          </div>

        </div>
      </header>

      {/* 主内容区 */}
      <main className="mx-auto max-w-[1480px] px-4 md:px-6 py-4 md:py-6">
        <ReviewLaunchPanel
          isMobile={isMobile}
          actions={resolvedQuickActions}
          onSelectTask={selectGlobalTask}
        />

        {listUnavailable ? (
          <LoadErrorState message={loadError} onRetry={() => void fetchData(1, { query: searchQuery })} />
        ) : (
          <>
            {/* 统计卡片 - 桌面端完整 / 移动端简化 */}
            <div id="contract-task-list" className="grid scroll-mt-24 grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
              <StatCard
                icon={<FileTextIcon className="h-4 w-4 md:h-5 md:w-5 text-slate-500" />}
                label="合同与草稿"
                value={stats.total}
                isMobile={isMobile}
              />
              <StatCard
                icon={<ClockIcon className="h-4 w-4 md:h-5 md:w-5 text-indigo-500" />}
                label="待处理任务"
                value={stats.pending}
                highlight={stats.pending > 0}
                isMobile={isMobile}
              />
              <StatCard
                icon={<AlertTriangleIcon className="h-4 w-4 md:h-5 md:w-5 text-rose-500" />}
                label="需关注"
                value={stats.needAttention}
                alert={stats.needAttention > 0}
                isMobile={isMobile}
              />
              <StatCard
                icon={<ZapIcon className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />}
                label="已完成任务"
                value={stats.completed}
                isMobile={isMobile}
              />
            </div>

            {/* 状态筛选标签 */}
            <div className="mb-4 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <Tabs value={taskFilter} onValueChange={(v) => setTaskFilter(v as TaskFilter)}>
                <TabsList className={`${isMobile ? 'w-full' : ''} bg-white border`}>
                  <TabsTrigger value="all" className="text-xs md:text-sm">
                    全部
                    {!isMobile && <span className="ml-1.5 text-[10px] text-slate-400">{allTasks.length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="contract" className="text-xs md:text-sm">
                    审核
                    {!isMobile && <span className="ml-1.5 text-[10px] text-slate-400">{allTasks.filter((task) => task.type === 'review').length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="reviewed" className="text-xs md:text-sm">
                    已有审核
                  </TabsTrigger>
                  <TabsTrigger value="compare" className="text-xs md:text-sm">
                    对比
                    {!isMobile && <span className="ml-1.5 text-[10px] text-slate-400">{allTasks.filter((task) => task.type === 'compare').length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="draft" className="text-xs md:text-sm">
                    起草
                    {!isMobile && <span className="ml-1.5 text-[10px] text-slate-400">{allTasks.filter((task) => task.type === 'draft').length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="pending" className="text-xs md:text-sm">待处理</TabsTrigger>
                  <TabsTrigger value="review" className="text-xs md:text-sm">已完成</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* 列表内容 */}
            {loading ? (
              <LoadingState message="加载合同中..." />
            ) : filteredTasks.length === 0 ? (
              <EmptyState
                isMobile={isMobile}
                mode={emptyMode}
                query={searchQuery.trim()}
                onClearSearch={() => setSearchQuery('')}
                onResetFilter={() => setTaskFilter('all')}
              />
            ) : (
              <div className="space-y-2 md:space-y-3">
                {loadError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {loadError}
                  </div>
                )}
                {filteredTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    isMobile={isMobile}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* 分页控件 */}
        {!listUnavailable && !loading && totalPages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-6 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              已加载到第 {page} / {totalPages} 页
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext || loadingMore}
                onClick={handleLoadMore}
                className="min-w-28"
              >
                {loadingMore ? '加载中...' : hasNext ? '加载更多' : '已加载全部'}
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* 移动端底部固定快捷操作栏 */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 z-20 safe-area-pb">
          <div className="flex items-center justify-around">
            {resolvedQuickActions.map((action) => (
              <QuickActionButton key={action.id} action={action} onSelectTask={selectGlobalTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QuickActionButton({
  action,
  onSelectTask,
}: {
  action: QuickAction
  onSelectTask: (taskId: ContractCenterTaskId) => void
}) {
  const Icon = action.icon
  const disabled = !action.task.href || action.task.availability === 'blocked'
  const description = action.task.blockedReason || action.task.nextAction.description
  const content = (
    <>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full shadow-md ${disabled ? 'bg-slate-200' : action.color}`}>
        <Icon className={`h-5 w-5 ${disabled ? 'text-slate-400' : 'text-white'}`} />
      </div>
      <span className={`text-[10px] font-medium ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>{action.shortTitle}</span>
    </>
  )

  if (disabled) {
    return (
      <div className="flex flex-col items-center gap-1 px-3 py-1" aria-disabled="true" title={description}>
        {content}
      </div>
    )
  }

  if (action.id === 'continue_review' || action.id === 'compare_versions') {
    return (
      <button
        type="button"
        onClick={() => onSelectTask(action.id)}
        className="flex flex-col items-center gap-1 px-3 py-1 transition-transform active:scale-95"
      >
        {content}
      </button>
    )
  }

  return (
    <Link href={action.task.href!} prefetch={false} className="flex flex-col items-center gap-1 px-3 py-1 transition-transform active:scale-95">
      {content}
    </Link>
  )
}

function ReviewLaunchPanel({
  isMobile,
  actions,
  onSelectTask,
}: {
  isMobile: boolean
  actions: QuickAction[]
  onSelectTask: (taskId: ContractCenterTaskId) => void
}) {
  return (
    <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm md:mb-6 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
            <ShieldCheckIcon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold text-slate-950`}>
              合同中心
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              先选择要完成的业务任务。新建、已有审核和版本比对各自进入对应流程，不会因为合同状态被合并成同一个上传入口。
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon
          const disabled = !action.task.href || action.task.availability === 'blocked'
          const content = (
            <div className={`h-full rounded-lg border p-3 transition ${
              disabled
                ? 'border-slate-200 bg-slate-50 opacity-70'
                : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${disabled ? 'bg-slate-200' : action.color}`}>
                    <Icon className={`h-4 w-4 ${disabled ? 'text-slate-400' : 'text-white'}`} />
                  </span>
                  <div className="font-semibold text-slate-950">{action.task.label}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  disabled ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-700'
                }`}>
                  {action.task.availabilityLabel}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{action.outcomeLabel}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                <span className="font-medium text-slate-700">开始前：</span>{action.task.preconditionLabel}
              </p>
              <div className={`mt-3 rounded-md px-2 py-1.5 text-[11px] leading-5 ${
                disabled ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'
              }`}>
                <span className="font-medium">下一步：{action.task.nextAction.label}</span>
                <span className="mt-0.5 block">{action.task.blockedReason || action.task.nextAction.description}</span>
              </div>
            </div>
          )
          if (disabled) {
            return <div key={action.id} aria-disabled="true" title={action.task.blockedReason || undefined}>{content}</div>
          }
          if (action.id === 'continue_review' || action.id === 'compare_versions') {
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => onSelectTask(action.id)}
                className="block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {content}
              </button>
            )
          }
          return (
            <Link key={action.id} href={action.task.href!} prefetch={false} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
              {content}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// 统计卡片组件
function StatCard({
  icon,
  label,
  value,
  highlight = false,
  alert = false,
  isMobile,
}: {
  icon: React.ReactNode
  label: string
  value: number
  highlight?: boolean
  alert?: boolean
  isMobile: boolean
}) {
  return (
    <Card className={`${alert ? 'border-rose-200 bg-rose-50/30' : highlight ? 'border-indigo-200 bg-indigo-50/30' : ''}`}>
      <CardContent className={`${isMobile ? 'p-3' : 'p-4'}`}>
        <div className="flex items-center gap-2 md:gap-3">
          <div className={`${isMobile ? 'w-8 h-8' : 'w-10 h-10'} rounded-lg bg-slate-100 flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className={`font-bold text-slate-900 ${isMobile ? 'text-lg' : 'text-2xl'}`}>{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 任务项组件
function TaskItem({
  task,
  isMobile,
}: {
  task: TaskItemView
  isMobile: boolean
}) {
  const moduleStyle = {
    '合同审核': {
      icon: ShieldCheckIcon,
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      iconBox: 'bg-rose-50 text-rose-600',
      bar: 'bg-rose-500',
      versionBadge: 'border-rose-200 bg-rose-600 text-white',
    },
    '文档对比': {
      icon: GitCompareIcon,
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      iconBox: 'bg-emerald-50 text-emerald-600',
      bar: 'bg-emerald-500',
      versionBadge: 'border-emerald-200 bg-emerald-600 text-white',
    },
    '合同起草': {
      icon: PenToolIcon,
      badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      iconBox: 'bg-indigo-50 text-indigo-600',
      bar: 'bg-indigo-500',
      versionBadge: 'border-indigo-200 bg-indigo-600 text-white',
    },
  }[task.moduleLabel]
  const ModuleIcon = moduleStyle.icon

  const content = (
      <Card className={`relative overflow-hidden border-slate-200 transition-colors ${task.href ? 'cursor-pointer group-hover:border-indigo-200 group-hover:shadow-sm group-active:border-indigo-300 group-active:bg-indigo-50/20' : 'bg-slate-50'}`}>
        <div className={`absolute inset-y-0 left-0 w-1 ${moduleStyle.bar}`} aria-hidden="true" />
        <CardContent className={`${isMobile ? 'p-3' : 'p-4'}`}>
          <div className="flex items-center gap-3 pl-1">
            {/* 图标 */}
            <div className={`${isMobile ? 'h-9 w-9' : 'h-10 w-10'} ${moduleStyle.iconBox} flex shrink-0 items-center justify-center rounded-lg`}>
              <ModuleIcon className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} />
            </div>

            {/* 内容 */}
            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${moduleStyle.badge}`}>
                  <ModuleIcon className="h-3 w-3" />
                  {task.selectionOnly ? '选择：' : '任务：'}{task.moduleLabel}
                </span>
                <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${moduleStyle.versionBadge}`}>
                  版本：{task.versionLabel}
                </span>
                <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                  {task.objectLabel}
                </span>
                <span className="text-[10px] text-slate-400">
                  {new Date(task.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: isMobile ? undefined : '2-digit',
                    minute: isMobile ? undefined : '2-digit',
                  })}
                </span>
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2">
                <p className={`truncate font-semibold text-slate-900 ${isMobile ? 'text-sm' : 'text-base'}`}>
                  <span className="sr-only">{task.moduleLabel} {task.versionLabel} </span>
                  {task.name}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${task.statusColor}`}>
                  {task.status}
                </span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                  下一步：{task.nextAction}
                </span>
              </div>
              {!isMobile && (
                <p className="mt-1 truncate text-xs text-slate-500">{task.nextActionDescription}</p>
              )}
            </div>

            {/* 箭头 */}
            {task.href ? (
              <ChevronRightIcon className="h-5 w-5 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
            ) : (
              <span className="shrink-0 rounded bg-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500">暂不可用</span>
            )}
          </div>
        </CardContent>
      </Card>
  )

  if (!task.href) {
    return (
      <div className="group block rounded-lg" aria-disabled="true">
        {content}
      </div>
    )
  }

  return (
    <Link
      href={task.href}
      prefetch={false}
      className="group block rounded-lg transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      aria-label={`打开${task.moduleLabel} ${task.versionLabel} ${task.name}`}
    >
      {content}
    </Link>
  )
}

function LoadErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-center">
      <AlertTriangleIcon className="mx-auto h-8 w-8 text-rose-500" />
      <p className="mt-3 text-sm font-medium text-rose-900">合同数据加载失败</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-rose-700">{message}</p>
      <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
        <Link href="/contracts/new" prefetch={false}>
          <Button size="sm">发起新审核</Button>
        </Link>
      </div>
    </div>
  )
}

// 空状态组件：组织没有资产、搜索无结果和筛选无结果是三种不同的下一步。
function EmptyState({
  isMobile,
  mode,
  query,
  onClearSearch,
  onResetFilter,
}: {
  isMobile: boolean
  mode: 'organization' | 'search' | 'filter'
  query: string
  onClearSearch: () => void
  onResetFilter: () => void
}) {
  const content = mode === 'organization'
    ? {
        title: '还没有合同或草稿',
        description: '可以起草一份新合同，也可以上传已有 Word 或 PDF 发起风险审核。',
      }
    : mode === 'search'
      ? {
          title: `没有找到“${query}”`,
          description: '换一个合同名称、编号或客户关键词，或者清除搜索查看全部任务。',
        }
      : {
          title: '当前分类没有任务',
          description: '合同资产仍然存在，只是没有符合当前分类的任务。',
        }

  return (
    <div className="text-center py-12 md:py-16">
      <div className={`${isMobile ? 'w-16 h-16' : 'w-20 h-20'} bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4`}>
        <FileTextIcon className={`${isMobile ? 'h-8 w-8' : 'h-10 w-10'} text-slate-300`} />
      </div>
      <p className={`text-slate-700 font-medium ${isMobile ? 'text-sm' : 'text-base'}`}>{content.title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-slate-500">{content.description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {mode === 'organization' && (
          <>
            <Link href="/contracts/draft" prefetch={false}>
              <Button variant="outline" size="sm">
                <PenToolIcon className="mr-1 h-4 w-4" />
                开始起草
              </Button>
            </Link>
            <Link href="/contracts/new?from=workbench" prefetch={false}>
              <Button size="sm">
                <PlusIcon className="mr-1 h-4 w-4" />
                上传并审核
              </Button>
            </Link>
          </>
        )}
        {mode === 'search' && (
          <Button variant="outline" size="sm" onClick={onClearSearch}>清除搜索</Button>
        )}
        {mode === 'filter' && (
          <Button variant="outline" size="sm" onClick={onResetFilter}>查看全部任务</Button>
        )}
      </div>
    </div>
  )
}
