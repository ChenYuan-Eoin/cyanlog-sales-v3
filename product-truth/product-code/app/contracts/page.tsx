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
  PenToolIcon,
  GitCompareIcon,
  FileTextIcon,
  AlertTriangleIcon,
  ClockIcon,
  ZapIcon,
  UploadIcon,
  SearchIcon,
  PlusIcon,
  FilterIcon,
  ChevronRightIcon,
  XIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import type { Contract } from '@/types'
import { readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import { loadContractsListForCache } from '@/lib/core-page-warmup'
import { handleError } from '@/lib/toast'
import { LoadingState } from '@/components/ui/LoadingState'

type TaskFilter = 'all' | 'draft' | 'pending' | 'review' | 'approved'
type ViewMode = 'desktop' | 'mobile'

type QuickAction = {
  id: 'draft' | 'batchReview' | 'review' | 'compare'
  title: string
  shortTitle: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  hoverColor: string
  href: string
  description: string
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

// 快捷操作配置 - 桌面端顶部工具栏 + 移动端底部快捷栏共用
const quickActions: QuickAction[] = [
  {
    id: 'draft',
    title: '起草合同',
    shortTitle: '起草',
    icon: PenToolIcon,
    color: 'bg-indigo-600',
    hoverColor: 'hover:bg-indigo-700',
    href: '/contracts/draft',
    description: 'AI智能生成',
  },
  {
    id: 'review',
    title: '发起审核',
    shortTitle: '审核',
    icon: ShieldCheckIcon,
    color: 'bg-rose-600',
    hoverColor: 'hover:bg-rose-700',
    href: '/contracts/new',
    description: '上传源文件并新建审核运行',
  },
  {
    id: 'compare',
    title: '文档比对',
    shortTitle: '比对',
    icon: GitCompareIcon,
    color: 'bg-emerald-600',
    hoverColor: 'hover:bg-emerald-700',
    href: '/contracts/upload?intent=compare',
    description: '完成审核后对照回传版',
  },
  {
    id: 'batchReview',
    title: '批量发起审核',
    shortTitle: '批量',
    icon: UploadIcon,
    color: 'bg-slate-800',
    hoverColor: 'hover:bg-slate-900',
    href: '/contracts/upload',
    description: '多文件创建审核运行',
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
    const compareTarget = contracts.find((contract) => contract.status === 'COMPLETED')
    return quickActions.map((action) => {
      if (action.id === 'review') {
        return {
          ...action,
          href: '/contracts/new',
          description: '上传源文件并创建 ReviewRun',
        }
      }

      if (action.id === 'compare') {
        return {
          ...action,
          href: compareTarget ? `/contracts/${compareTarget.id}/compare` : '/contracts/upload?intent=compare',
          description: compareTarget ? '进入最近完成合同的比对工作台' : '需先完成一份合同审核',
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
    }))

    const contractTasks = contracts.map((c) => {
      const statusMap: Record<string, { label: string; color: string }> = {
        COMPLETED: { label: '审核完成', color: 'bg-green-100 text-green-700' },
        PENDING: { label: '待审核', color: 'bg-amber-100 text-amber-700' },
        PARSING: { label: '解析中', color: 'bg-blue-100 text-blue-700' },
        ANALYZING: { label: '审核中', color: 'bg-indigo-100 text-indigo-700' },
        FAILED: { label: '审核失败', color: 'bg-red-100 text-red-700' },
      }
      const status = statusMap[c.status] || { label: c.status, color: 'bg-slate-100 text-slate-600' }
      return {
        id: c.id,
        name: c.filename,
        type: 'contract' as const,
        status: status.label,
        statusColor: status.color as string,
        updatedAt: c.updated_at,
        href: `/contracts/${c.id}`,
        meta: '合同',
      }
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

            {/* 桌面端快捷操作 */}
            <div className={`hidden md:flex items-center gap-2 ${isMobile ? 'hidden' : 'flex'}`}>
              {resolvedQuickActions.slice(0, 3).map((action) => (
                <Link key={action.id} href={action.href} prefetch={false}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <action.icon className="h-4 w-4" />
                    {action.shortTitle}
                  </Button>
                </Link>
              ))}
            </div>

            {/* 移动端筛选按钮 */}
            {isMobile && (
              <Button variant="ghost" size="icon" className="shrink-0">
                <FilterIcon className="h-5 w-5" />
              </Button>
            )}
          </div>

          {/* 桌面端快捷操作大按钮 */}
          {!isMobile && (
            <div className="grid grid-cols-4 gap-3 mt-4">
              {resolvedQuickActions.map((action) => (
                <Link key={action.id} href={action.href} prefetch={false} className="group">
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm transition-all">
                    <div className={`w-10 h-10 rounded-lg ${action.color} ${action.hoverColor} flex items-center justify-center shrink-0`}>
                      <action.icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{action.title}</p>
                      <p className="text-xs text-slate-500 truncate">{action.description}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* 主内容区 */}
      <main className="mx-auto max-w-[1480px] px-4 md:px-6 py-4 md:py-6">
        <ReviewLaunchPanel isMobile={isMobile} />

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
              <Link
                key={action.id}
                href={action.href}
                prefetch={false}
                className="flex flex-col items-center gap-1 py-1 px-3 active:scale-95 transition-transform"
              >
                <div className={`w-10 h-10 rounded-full ${action.color} flex items-center justify-center shadow-md`}>
                  <action.icon className="h-5 w-5 text-white" />
                </div>
                <span className="text-[10px] font-medium text-slate-700">{action.shortTitle}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewLaunchPanel({ isMobile }: { isMobile: boolean }) {
  return (
    <section className="mb-4 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm md:mb-6 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
            <ShieldCheckIcon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold text-slate-950`}>
              合同审核工作台入口
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              新建 ReviewRun，上传合同源文件，绑定已发布规则、SkillBundle 和模型策略，生成风险定位、销售谈判任务与 Word 批注版本。
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

      <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-4">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <span className="font-medium text-slate-900">源文件</span>
          <span className="ml-1">docx / pdf</span>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <span className="font-medium text-slate-900">审核依据</span>
          <span className="ml-1">规则快照 / Skill</span>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <span className="font-medium text-slate-900">风险定位</span>
          <span className="ml-1">复核 / 谈判</span>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <span className="font-medium text-slate-900">输出</span>
          <span className="ml-1">批注版 / 报告</span>
        </div>
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
  task: {
    id: string
    name: string
    type: string
    status: string
    statusColor: string
    updatedAt: string
    href: string
    meta: string
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
      <Card className="cursor-pointer border-slate-200 transition-all group-hover:border-indigo-200 group-hover:shadow-sm group-active:border-indigo-300 group-active:bg-indigo-50/20">
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
                <span className="text-[10px] text-slate-400">
                  {new Date(task.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: isMobile ? undefined : '2-digit',
                    minute: isMobile ? undefined : '2-digit',
                  })}
                </span>
              </div>
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
