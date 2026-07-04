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
  MessageSquareTextIcon,
} from 'lucide-react'
import type { Contract } from '@/types'
import { readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import { loadContractsListForCache } from '@/lib/core-page-warmup'
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
  id: 'review' | 'continue' | 'annotations' | 'compare'
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
  contracts: Contract[]
  drafts: Contract[]
  meta: {
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

type TaskItemView = {
  id: string
  name: string
  type: 'draft' | 'contract'
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

function mergeContractsById(existing: Contract[], incoming: Contract[]) {
  const merged = new Map<string, Contract>()
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

// 快捷操作配置 - 桌面端顶部工具栏 + 移动端底部快捷栏共用
const quickActions: QuickAction[] = [
  {
    id: 'review',
    title: '发起合同审核',
    shortTitle: '发起',
    workflowLabel: '创建新的 ReviewRun',
    objectLabel: '新的源文件',
    outcomeLabel: '进入风险定位与批注工作台',
    boundaryLabel: '不会打开历史批注或旧对比结果',
    icon: ShieldCheckIcon,
    color: 'bg-rose-600',
    hoverColor: 'hover:bg-rose-700',
    href: '/contracts/new',
    description: '上传合同源文件，创建新的审核运行，不复用旧批注或旧对比结果',
    stateLabel: '新任务',
  },
  {
    id: 'continue',
    title: '继续合同审核',
    shortTitle: '继续',
    workflowLabel: '回到未完成 ReviewRun',
    objectLabel: '未完成审核运行',
    outcomeLabel: '查看真实处理进度与失败原因',
    boundaryLabel: '不会创建新的合同或重复导出批注版',
    icon: ClockIcon,
    color: 'bg-indigo-600',
    hoverColor: 'hover:bg-indigo-700',
    href: '/contracts/new',
    description: '回到解析中、审核中或待处理的合同，不创建新任务',
    stateLabel: '进行中',
  },
  {
    id: 'annotations',
    title: '查看批注输出',
    shortTitle: '输出',
    workflowLabel: '打开已完成输出',
    objectLabel: '已完成 ReviewRun',
    outcomeLabel: '检查证据门禁，满足后导出源文件批注版',
    boundaryLabel: '不是重新审核，也不是文档对比',
    icon: MessageSquareTextIcon,
    color: 'bg-slate-800',
    hoverColor: 'hover:bg-slate-900',
    href: '/contracts/new',
    description: '查看已完成合同的风险证据、源文件批注版和导出记录',
    stateLabel: '已完成',
  },
  {
    id: 'compare',
    title: '合同文档对比',
    shortTitle: '比对',
    workflowLabel: '旧版 / 新版差异复核',
    objectLabel: '同一合同版本流',
    outcomeLabel: '选择基准与客户回传件，生成差异列表',
    boundaryLabel: '比对结果不替代风险审核结论',
    icon: GitCompareIcon,
    color: 'bg-emerald-600',
    hoverColor: 'hover:bg-emerald-700',
    href: '/contracts/upload?intent=compare',
    description: '以当前合同为基准，对比客户回传版或同客户候选版本',
    stateLabel: '版本流',
  },
]

export default function ContractCenterPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
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

      const cacheKey = scopedCacheKey(token, `contracts:list:${pageNum}:${pageSize}`)
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
          contracts: payload.contracts as Contract[],
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
    const continuingTarget = sortedContracts.find((contract) => (
      contract.status === 'PENDING' || contract.status === 'PARSING' || contract.status === 'ANALYZING'
    ))
    const annotatedTarget = sortedContracts.find((contract) => contract.status === 'COMPLETED')
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

      if (action.id === 'continue') {
        return {
          ...action,
          href: continuingTarget
            ? buildContractWorkbenchHref(continuingTarget.id, { from: 'workbench' })
            : buildContractNewReviewHref('workbench'),
          description: continuingTarget ? '继续未完成的解析、审核或再审核任务，不创建新合同' : '暂无进行中 ReviewRun；请先上传源文件发起合同审核',
          targetName: continuingTarget ? contractActionName(continuingTarget) : '没有进行中任务',
          disabled: !continuingTarget,
        }
      }

      if (action.id === 'annotations') {
        return {
          ...action,
          href: annotatedTarget
            ? buildContractWorkbenchHref(annotatedTarget.id, { panel: 'evidence', from: 'workbench' })
            : buildContractNewReviewHref('workbench'),
          description: annotatedTarget ? '查看风险证据、Word 批注意图、导出门禁和下载记录' : '暂无已完成 ReviewRun；批注输出只来自已完成的源文件审核',
          targetName: annotatedTarget ? contractActionName(annotatedTarget) : '暂无已完成输出',
          disabled: !annotatedTarget,
        }
      }

      if (action.id === 'compare') {
        return {
          ...action,
          href: compareTarget
            ? buildContractCompareHref(compareTarget.id, { from: 'workbench' })
            : buildContractNewReviewHref('workbench'),
          description: compareTarget ? '进入基准合同版本流，选择客户回传版或候选合同做差异复核' : '暂无可作为基准的合同版本；先完成审核或补充源文件',
          targetName: compareTarget ? contractActionName(compareTarget) : '暂无可比对基准',
          disabled: !compareTarget,
        }
      }

      return action
    })
  }, [contracts])

  // 过滤后的任务列表
  const filteredTasks = useMemo(() => {
    const draftTasks = drafts.map((d) => ({
      id: d.id,
      name: d.title || '未命名草稿',
      type: 'draft' as const,
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

    const all = [...draftTasks, ...contractTasks].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    if (taskFilter === 'all') return all
    if (taskFilter === 'draft') return all.filter((t) => t.type === 'draft')
    if (taskFilter === 'pending') return all.filter((t) => t.status === '待审核' || t.status === '解析中' || t.status === '审核中')
    if (taskFilter === 'review') return all.filter((t) => t.status === '审核完成')
    return all.filter((t) => t.status === '审核失败')
  }, [contracts, drafts, taskFilter])

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
              <QuickActionButton action={resolvedQuickActions[1]} compact />
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
                    {!isMobile && <span className="ml-1.5 text-[10px] text-slate-400">{stats.total}</span>}
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
              合同审核状态机
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              合同中心只做四类动作：发起新的审核运行、继续未完成运行、查看批注输出与导出门禁、对比客户回传版本。每个入口必须绑定明确对象，不能互相替代。
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

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
    type: 'draft' | 'contract'
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
            <div className={`${isMobile ? 'w-9 h-9' : 'w-10 h-10'} rounded-lg bg-slate-100 flex items-center justify-center shrink-0`}>
              <FileTextIcon className={`${isMobile ? 'h-4 w-4' : 'h-5 w-5'} text-slate-400`} />
            </div>

            {/* 内容 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`font-medium text-slate-900 truncate ${isMobile ? 'text-sm' : 'text-sm'}`}>
                  {task.name}
                </p>
                {!isMobile && (
                  <span className="text-[10px] text-slate-400 shrink-0">{task.meta}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${task.statusColor}`}>
                  {task.status}
                </span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                  下一步：{task.nextAction}
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
