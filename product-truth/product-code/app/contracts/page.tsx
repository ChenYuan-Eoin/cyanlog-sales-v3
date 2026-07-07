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
  FilterIcon,
  ChevronRightIcon,
  XIcon,
  ShieldCheckIcon,
  PenToolIcon,
} from 'lucide-react'
import type { Contract } from '@/types'
import { readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import { CONTRACTS_LIST_CACHE_PREFIX, loadContractsListForCache } from '@/lib/core-page-warmup'
import { deriveReviewWorkflowState } from '@/lib/contracts/review-state-machine'
import {
  buildContractCompareHref,
  buildContractNewReviewHref,
  buildContractWorkbenchHref,
} from '@/lib/contracts/review-navigation'
import { handleError } from '@/lib/toast'
import { LoadingState } from '@/components/ui/LoadingState'

type TaskFilter = 'all' | 'draft' | 'pending' | 'review' | 'approved'
type ViewMode = 'desktop' | 'mobile'

type QuickAction = {
  id: 'review' | 'compare' | 'draft'
  title: string
  shortTitle: string
  workflowLabel: string
  objectLabel: string
  outcomeLabel: string
  boundaryLabel: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  hoverColor: string
  href: string
  description: string
  stateLabel?: string
  targetName?: string
  disabled?: boolean
}

type ResolvedQuickAction = QuickAction

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
  created_at?: string | null
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

type ListContract = Contract & {
  contract_versions?: ContractVersionSummary[]
  contract_comparisons?: ContractComparisonSummary[]
}

type TaskItemView = {
  id: string
  name: string
  type: 'draft' | 'contract' | 'compare'
  moduleLabel: '合同审核' | '合同起草' | '文档对比'
  versionLabel: string
  status: string
  statusColor: string
  updatedAt: string
  href: string
  meta: string
  nextAction: string
  nextActionDescription: string
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

function contractActionName(contract?: Contract) {
  const withOptionalNumber = contract as (Contract & { contract_no?: string }) | undefined
  const name = contract?.filename || contract?.title || withOptionalNumber?.contract_no || ''
  return name.trim() || '未命名合同'
}

function sortedContractVersions(contract: ListContract) {
  return [...(contract.contract_versions || [])].sort((left, right) => {
    const leftNumber = Number(left.version_number)
    const rightNumber = Number(right.version_number)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return rightNumber - leftNumber
    }
    return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
  })
}

function contractVersionLabel(contract: ListContract) {
  const versions = sortedContractVersions(contract)
  const latestVersion = versions.reduce<number | null>((latest, version) => {
    const value = Number(version.version_number)
    if (!Number.isFinite(value)) return latest
    return latest === null ? value : Math.max(latest, value)
  }, null)
  return latestVersion ? `v${latestVersion}` : 'v1'
}

function versionLabelForDocument(contract: ListContract, docId?: string | null, fallback = '当前') {
  if (!docId) return `${fallback} ${contractVersionLabel(contract)}`
  const version = sortedContractVersions(contract).find((item) => item.id === docId)
  if (version?.version_number) return `v${version.version_number}`
  if (docId === contract.id) return contractVersionLabel(contract)
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

// 快捷操作配置 - 桌面端顶部工具栏 + 移动端底部快捷栏共用
const quickActions: QuickAction[] = [
  {
    id: 'review',
    title: '合同审核',
    shortTitle: '审核',
    workflowLabel: '上传源文件并创建 ReviewRun',
    objectLabel: 'DOCX / PDF 源文件',
    outcomeLabel: '风险定位、AI 批注、源文件批注版',
    boundaryLabel: '审核自动消费配置中心已发布规则，不在这里选择规则版本',
    icon: ShieldCheckIcon,
    color: 'bg-rose-600',
    hoverColor: 'hover:bg-rose-700',
    href: '/contracts/new',
    description: '上传合同源文件，系统自动绑定已发布规则、SkillBundle 和模型策略',
    stateLabel: '源文件审核',
  },
  {
    id: 'compare',
    title: '合同文档对比',
    shortTitle: '对比',
    workflowLabel: '选择旧文件和新文件',
    objectLabel: '合同版本流或客户回传件',
    outcomeLabel: '差异列表、并排高亮、风险变化判断',
    boundaryLabel: '对比不替代审核；红线或需谈判变化进入再审核',
    icon: GitCompareIcon,
    color: 'bg-emerald-600',
    hoverColor: 'hover:bg-emerald-700',
    href: '/contracts/upload?intent=compare',
    description: '选择旧文件和新文件进行差异复核，文件属性只作为面板信息，不污染文件画布',
    stateLabel: '旧/新文件',
  },
  {
    id: 'draft',
    title: '合同起草',
    shortTitle: '起草',
    workflowLabel: '输入需求生成合同草稿',
    objectLabel: '客户需求、模板、条款限制',
    outcomeLabel: '可编辑合同草稿，可进入审核或对比',
    boundaryLabel: '起草是独立路径，不等同于上传审核或版本对比',
    icon: PenToolIcon,
    color: 'bg-indigo-600',
    hoverColor: 'hover:bg-indigo-700',
    href: '/contracts/draft',
    description: '描述业务需求，结合模板和条款限制生成可修改、可审核的合同草稿',
    stateLabel: '需求起草',
  },
]

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

  // 统计计算
  const stats = useMemo(() => {
    const total = contracts.length + drafts.length
    const pending = contracts.filter((c) =>
      c.status === 'PENDING' || c.status === 'PARSING' || c.status === 'ANALYZING'
    ).length
    const needAttention = contracts.filter((c) =>
      c.status === 'FAILED' || c.latest_analysis_job?.degraded
    ).length
    const completed = contracts.filter((c) => c.status === 'COMPLETED').length
    return { total, pending, needAttention, completed }
  }, [contracts, drafts])

  const resolvedQuickActions = useMemo<ResolvedQuickAction[]>(() => {
    const sortedContracts = [...contracts].sort(
      (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    )
    const compareTarget = sortedContracts.find((contract) => contract.status === 'COMPLETED')
    return quickActions.map((action) => {
      if (action.id === 'review') {
        return {
          ...action,
          href: buildContractNewReviewHref('workbench'),
          description: '上传源文件后直接创建新的审核运行，并进入风险定位与批注工作台',
          targetName: '新建合同版本',
        }
      }

      if (action.id === 'compare') {
        return {
          ...action,
          href: compareTarget
            ? buildContractCompareHref(compareTarget.id, { from: 'workbench' })
            : buildContractNewReviewHref('workbench'),
          description: compareTarget ? '进入旧文件/新文件选择页，文件属性在面板展示，不写进文件画布' : '暂无可作为版本流入口的合同；请先上传源文件或完成一个合同版本',
          targetName: compareTarget ? contractActionName(compareTarget) : '缺少合同版本流',
          disabled: !compareTarget,
        }
      }

      return action
    })
  }, [contracts])

  // 合同中心任务对象：审核、对比、起草是独立任务，但共享合同版本流。
  const allTasks = useMemo(() => {
    const draftTasks = drafts.map((d) => ({
      id: d.id,
      name: d.title || '未命名草稿',
      type: 'draft' as const,
      moduleLabel: '合同起草' as const,
      versionLabel: '草案 v1',
      status: '起草中' as const,
      statusColor: 'bg-slate-100 text-slate-600' as const,
      updatedAt: d.updated_at,
      href: `/contracts/draft?id=${d.id}`,
      meta: '草稿',
      nextAction: '继续起草',
      nextActionDescription: '补齐合同信息后再上传源文件或转入审核。',
    } satisfies TaskItemView))

    const contractTasks = contracts.map((c) => {
      const statusMap: Record<string, { label: string; color: string }> = {
        COMPLETED: { label: '审核完成', color: 'bg-green-100 text-green-700' },
        PENDING: { label: '待审核', color: 'bg-amber-100 text-amber-700' },
        PARSING: { label: '解析中', color: 'bg-blue-100 text-blue-700' },
        ANALYZING: { label: '审核中', color: 'bg-indigo-100 text-indigo-700' },
        FAILED: { label: '审核失败', color: 'bg-red-100 text-red-700' },
      }
      const status = statusMap[c.status] || { label: c.status, color: 'bg-slate-100 text-slate-600' }
      const workflowState = deriveReviewWorkflowState({
        status: c.status,
        hasSourceAsset: Boolean(c.parsed_text?.trim() || c.storage_path),
        exportReady: false,
      })
      return {
        id: c.id,
        name: c.filename,
        type: 'contract' as const,
        moduleLabel: '合同审核' as const,
        versionLabel: contractVersionLabel(c),
        status: status.label,
        statusColor: status.color as string,
        updatedAt: c.updated_at,
        href: workflowState.detailPanel === 'evidence'
          ? buildContractWorkbenchHref(c.id, { panel: 'evidence', from: 'list' })
          : buildContractWorkbenchHref(c.id, { from: 'list' }),
        meta: '合同',
        nextAction: workflowState.nextActionLabel,
        nextActionDescription: workflowState.nextActionDescription,
      } satisfies TaskItemView
    })

    const compareTasks = contracts.flatMap((contract) => {
      const comparisons = [...(contract.contract_comparisons || [])].sort(
        (left, right) => new Date(right.completed_at || right.created_at || 0).getTime()
          - new Date(left.completed_at || left.created_at || 0).getTime()
      )
      const latestComparison = comparisons[0]
      if (!latestComparison?.id) return []
      const status = comparisonStatus(latestComparison)
      const nextAction = comparisonNextAction(latestComparison)
      return [{
        id: `${contract.id}:compare:${latestComparison.id}`,
        name: contract.filename || contract.title || '未命名文档对比',
        type: 'compare' as const,
        moduleLabel: '文档对比' as const,
        versionLabel: comparisonVersionLabel(contract, latestComparison),
        status: status.label,
        statusColor: status.color,
        updatedAt: latestComparison.completed_at || latestComparison.created_at || contract.updated_at,
        href: buildContractCompareHref(contract.id, { from: 'list', comparisonId: latestComparison.id }),
        meta: '文档对比',
        nextAction: nextAction.label,
        nextActionDescription: nextAction.description,
      } satisfies TaskItemView]
    })

    const all = [...draftTasks, ...compareTasks, ...contractTasks].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return all
  }, [contracts, drafts])

  // 过滤后的任务列表
  const filteredTasks = useMemo(() => {
    if (taskFilter === 'all') return allTasks
    if (taskFilter === 'draft') return allTasks.filter((t) => t.type === 'draft')
    if (taskFilter === 'pending') {
      return allTasks.filter((t) => ['待审核', '解析中', '审核中', '待对比', '对比中'].includes(t.status))
    }
    if (taskFilter === 'review') {
      return allTasks.filter((t) => ['审核完成', '对比完成'].includes(t.status))
    }
    return allTasks.filter((t) => ['审核失败', '对比失败'].includes(t.status))
  }, [allTasks, taskFilter])

  const isMobile = viewMode === 'mobile'
  const listUnavailable = !loading && Boolean(loadError) && filteredTasks.length === 0

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

            {/* 桌面端保留少量全局动作，完整状态机放到正文首屏 */}
            <div className={`hidden md:flex items-center gap-2 ${isMobile ? 'hidden' : 'flex'}`}>
              <QuickActionButton action={resolvedQuickActions[0]} compact />
              <QuickActionButton action={resolvedQuickActions[2]} compact />
            </div>

            {/* 移动端筛选按钮 */}
            {isMobile && (
              <Button variant="ghost" size="icon" className="shrink-0">
                <FilterIcon className="h-5 w-5" />
              </Button>
            )}
          </div>

        </div>
      </header>

      {/* 主内容区 */}
      <main className="mx-auto max-w-[1480px] px-4 md:px-6 py-4 md:py-6">
        <ReviewLaunchPanel isMobile={isMobile} actions={resolvedQuickActions} />

        {listUnavailable ? (
          <LoadErrorState message={loadError} onRetry={() => void fetchData(1, { query: searchQuery })} />
        ) : (
          <>
            {/* 统计卡片 - 桌面端完整 / 移动端简化 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
              <StatCard
                icon={<FileTextIcon className="h-4 w-4 md:h-5 md:w-5 text-slate-500" />}
                label="全部合同"
                value={stats.total}
                isMobile={isMobile}
              />
              <StatCard
                icon={<ClockIcon className="h-4 w-4 md:h-5 md:w-5 text-indigo-500" />}
                label="进行中"
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
                label="已完成"
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
                  <TabsTrigger value="draft" className="text-xs md:text-sm">起草中</TabsTrigger>
                  <TabsTrigger value="pending" className="text-xs md:text-sm">待审核</TabsTrigger>
                  <TabsTrigger value="review" className="text-xs md:text-sm">已完成</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* 列表内容 */}
            {loading ? (
              <LoadingState message="加载合同中..." />
            ) : filteredTasks.length === 0 ? (
              <EmptyState isMobile={isMobile} />
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
        {!listUnavailable && !loading && filteredTasks.length > 0 && totalPages > 1 && (
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
              <QuickActionButton key={action.id} action={action} mobile />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QuickActionButton({
  action,
  compact = false,
  mobile = false,
}: {
  action: ResolvedQuickAction
  compact?: boolean
  mobile?: boolean
}) {
  const Icon = action.icon
  if (mobile) {
    const content = (
      <>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full shadow-md ${action.disabled ? 'bg-slate-200' : action.color}`}>
          <Icon className={`h-5 w-5 ${action.disabled ? 'text-slate-400' : 'text-white'}`} />
        </div>
        <span className={`text-[10px] font-medium ${action.disabled ? 'text-slate-400' : 'text-slate-700'}`}>{action.shortTitle}</span>
      </>
    )
    if (action.disabled) {
      return (
        <div className="flex flex-col items-center gap-1 px-3 py-1" aria-disabled="true" title={action.description}>
          {content}
        </div>
      )
    }
    return (
      <Link href={action.href} prefetch={false} className="flex flex-col items-center gap-1 px-3 py-1 transition-transform active:scale-95">
        {content}
      </Link>
    )
  }

  if (action.disabled) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled title={action.description}>
        <Icon className="h-4 w-4" />
        {action.shortTitle}
      </Button>
    )
  }

  return (
    <Link href={action.href} prefetch={false}>
      <Button size={compact ? 'sm' : 'default'} variant="outline" className="gap-1.5">
        <Icon className="h-4 w-4" />
        {action.shortTitle}
      </Button>
    </Link>
  )
}

function ReviewLaunchPanel({
  isMobile,
  actions,
}: {
  isMobile: boolean
  actions: ResolvedQuickAction[]
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
              一级入口只保留合同审核、文档对比、AI 起草合同。继续审核、查看批注版和再审核是合同任务内部状态动作，不作为首页功能入口。
            </p>
          </div>
        </div>
        <Link href="/contracts/new" prefetch={false} className="shrink-0">
          <Button className="w-full gap-1.5 md:w-auto">
            <PlusIcon className="h-4 w-4" />
            上传源文件并发起审核
          </Button>
        </Link>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
	        {actions.map((action, index) => {
	          const Icon = action.icon
	          const content = (
	            <div className={`h-full rounded-lg border p-3 transition ${
              action.disabled
                ? 'border-slate-200 bg-slate-50 opacity-70'
                : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <div className="font-semibold text-slate-950">{action.title}</div>
                </div>
                <Icon className={`h-4 w-4 ${action.disabled ? 'text-slate-400' : 'text-indigo-600'}`} />
	              </div>
	              <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-600">
	                <WorkflowFact label="入口" value={action.stateLabel || action.shortTitle} />
                <WorkflowFact label="动作" value={action.workflowLabel} />
                <WorkflowFact label="对象" value={action.objectLabel} />
                <WorkflowFact label="当前目标" value={action.targetName || '等待选择'} />
                <WorkflowFact label="结果" value={action.outcomeLabel} />
	              </div>
	              <div className={`mt-3 rounded-md px-2 py-1.5 text-[11px] leading-5 ${
	                action.disabled ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'
	              }`}>
	                <span className="font-medium">{action.disabled ? '当前不可用：' : '边界：'}</span>
	                {action.disabled ? action.description : action.boundaryLabel}
	              </div>
	            </div>
	          )
          if (action.disabled) {
            return <div key={action.id} aria-disabled="true" title={action.description}>{content}</div>
          }
          return (
            <Link key={action.id} href={action.href} prefetch={false} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
              {content}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function WorkflowFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="min-w-0 truncate font-medium text-slate-800">{value}</span>
    </div>
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
  task: {
    id: string
    name: string
    type: 'draft' | 'contract' | 'compare'
    moduleLabel: '合同审核' | '合同起草' | '文档对比'
    versionLabel: string
    status: string
    statusColor: string
    updatedAt: string
    href: string
    meta: string
    nextAction: string
    nextActionDescription: string
  }
  isMobile: boolean
}) {
  const moduleStyle = {
    '合同审核': {
      icon: ShieldCheckIcon,
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      iconBox: 'bg-rose-50 text-rose-600',
    },
    '文档对比': {
      icon: GitCompareIcon,
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      iconBox: 'bg-emerald-50 text-emerald-600',
    },
    '合同起草': {
      icon: PenToolIcon,
      badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      iconBox: 'bg-indigo-50 text-indigo-600',
    },
  }[task.moduleLabel]
  const ModuleIcon = moduleStyle.icon

  return (
    <Link
      href={task.href}
      prefetch={false}
      className="group block rounded-lg transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      aria-label={`打开${task.meta}${task.name}`}
    >
      <Card className="cursor-pointer border-slate-200 transition-colors group-hover:border-indigo-200 group-hover:shadow-sm group-active:border-indigo-300 group-active:bg-indigo-50/20">
        <CardContent className={`${isMobile ? 'p-3' : 'p-4'}`}>
          <div className="flex items-center gap-3">
            {/* 图标 */}
            <div className={`${isMobile ? 'h-9 w-9' : 'h-10 w-10'} ${moduleStyle.iconBox} flex shrink-0 items-center justify-center rounded-lg`}>
              <ModuleIcon className={isMobile ? 'h-4 w-4' : 'h-5 w-5'} />
            </div>

            {/* 内容 */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold ${moduleStyle.badge}`}>
                  {task.moduleLabel}
                </span>
                <span className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {task.versionLabel}
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
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <p className={`truncate font-semibold text-slate-900 ${isMobile ? 'text-sm' : 'text-base'}`}>
                  {task.name}
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
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
            <ChevronRightIcon className="h-5 w-5 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
          </div>
        </CardContent>
      </Card>
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

// 空状态组件
function EmptyState({ isMobile }: { isMobile: boolean }) {
  return (
    <div className="text-center py-12 md:py-16">
      <div className={`${isMobile ? 'w-16 h-16' : 'w-20 h-20'} bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4`}>
        <FileTextIcon className={`${isMobile ? 'h-8 w-8' : 'h-10 w-10'} text-slate-300`} />
      </div>
      <p className={`text-slate-500 ${isMobile ? 'text-sm' : 'text-base'}`}>暂无合同记录</p>
      <p className="text-xs text-slate-400 mt-1">可以直接发起合同审核，上传源文件后生成审核运行。</p>
      {!isMobile && (
        <Link href="/contracts/new" prefetch={false}>
          <Button variant="outline" size="sm" className="mt-4">
            <PlusIcon className="h-4 w-4 mr-1" />
            发起审核
          </Button>
        </Link>
      )}
    </div>
  )
}
