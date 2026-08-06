'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AGENDA_TYPE_LABEL,
  AGENDA_TYPE_COLOR,
  PRIORITY_COLOR,
  STATUS_LABEL,
  type AgendaItem,
  type AgendaStatus,
  type AgendaType,
} from '@/lib/agenda/types'
import { computeCriticalPath, DependencyCycleError } from '@/lib/agenda/critical-path'
import {
  buildTree,
  DAY_MS,
  daySpan,
  flattenVisible,
  fmtDate,
  startOfDay,
  WD,
  type TreeNode,
} from '@/lib/agenda/schedule-tree'
import { readBrowserCacheEntry, scopedCacheKey } from '@/lib/browser-cache'
import {
  AGENDA_UPCOMING_CACHE_KEY,
  CORE_PAGE_BACKGROUND_REFRESH_MS,
  CORE_PAGE_VISIBLE_CACHE_TTL_MS,
  loadAgendaUpcomingForCache,
  type AgendaUpcomingCachePayload,
} from '@/lib/core-page-warmup'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type LoadState = 'loading' | 'ready' | 'error'
type ViewMode = 'timeline' | 'calendar' | 'kanban' | 'list'

const VIEW_TABS: { id: ViewMode; label: string }[] = [
  { id: 'timeline', label: '时间线' },
  { id: 'calendar', label: '日历' },
  { id: 'kanban', label: '看板' },
  { id: 'list', label: '列表' },
]

export function ScheduleClient() {
  const [items, setItems] = useState<AgendaItem[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [view, setView] = useState<ViewMode>('timeline')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showCritical, setShowCritical] = useState(true)
  const [search, setSearch] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [calendarMode, setCalendarMode] = useState<'week' | 'month'>('month')

  const loadItems = useCallback(async (isMounted: () => boolean = () => true) => {
    const token = window.localStorage.getItem('token')
    if (!token) {
      if (isMounted()) setState('ready')
      return
    }
    const cacheKey = scopedCacheKey(token, AGENDA_UPCOMING_CACHE_KEY)
    const cachedEntry = readBrowserCacheEntry<AgendaUpcomingCachePayload>(cacheKey)
    const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.savedAt : Number.POSITIVE_INFINITY
    const cached = cacheAgeMs <= CORE_PAGE_VISIBLE_CACHE_TTL_MS ? cachedEntry?.value : null
    if (cached) {
      setItems(cached.items)
      setState('ready')
      if (cacheAgeMs < CORE_PAGE_BACKGROUND_REFRESH_MS) return
    } else {
      setState('loading')
    }
    setError('')
    try {
      const payload = await loadAgendaUpcomingForCache(token)
      if (!isMounted()) return
      setItems(payload?.items || [])
      setState('ready')
    } catch {
      if (!isMounted()) return
      setError('日程加载失败，请稍后重试')
      setState('error')
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void loadItems(() => mounted)
    return () => {
      mounted = false
    }
  }, [loadItems])

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.trim().toLowerCase()
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (AGENDA_TYPE_LABEL[i.agenda_type] || '').includes(q)
    )
  }, [items, search])

  const tree = useMemo(() => buildTree(filtered), [filtered])
  const visibleRows = useMemo(() => flattenVisible(tree, collapsed), [tree, collapsed])

  const depsMap = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const item of filtered) {
      if (item.depends_on && item.depends_on.length > 0) m.set(item.id, item.depends_on)
    }
    return m
  }, [filtered])

  const critical = useMemo(() => {
    if (!showCritical) return null
    try {
      return computeCriticalPath(
        filtered.map((i) => ({ id: i.id, startAt: i.start_at, endAt: i.end_at })),
        depsMap
      )
    } catch (err) {
      if (err instanceof DependencyCycleError) return { cycle: err.cycle }
      return null
    }
  }, [filtered, depsMap, showCritical])

  const timelineWindow = useMemo(() => {
    const now = startOfDay(new Date().toISOString())
    let min = now - 7 * DAY_MS
    let max = now + 7 * DAY_MS
    if (filtered.length > 0) {
      const starts = filtered.map((i) => startOfDay(i.start_at))
      const ends = filtered.map((i) => (i.end_at ? startOfDay(i.end_at) : startOfDay(i.start_at)))
      min = Math.min(now, ...starts)
      max = Math.max(now, ...ends)
    }
    const days: number[] = []
    for (let t = min; t <= max; t += DAY_MS) days.push(t)
    if (days.length < 14) {
      const head = days[0] || now
      while (days.length < 14) {
        days.push(days[days.length - 1] + DAY_MS)
      }
      void head
    }
    return { days }
  }, [filtered])

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const moveStatus = useCallback(async (id: string, status: AgendaStatus) => {
    const token = window.localStorage.getItem('token')
    try {
      const res = await fetch(`/api/agenda?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) return
      const body = (await res.json()) as { data?: AgendaItem }
      if (body.data) {
        setItems((prev) => prev.map((i) => (i.id === id ? (body.data as AgendaItem) : i)))
      }
    } catch {
      // 拖拽更新失败时保持原状态，不打断页面
    }
  }, [])

  const cycleError =
    critical && 'cycle' in critical ? (critical as { cycle: string[] }).cycle : null

  return (
    <div data-schedule-state={state} className="text-slate-800">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {VIEW_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`cursor-pointer rounded-md px-3 py-1.5 ${
                view === t.id
                  ? 'bg-slate-100 font-medium text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索标题和 ID"
          className="h-8 w-48 rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-blue-400"
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={showCritical}
            onChange={(e) => setShowCritical(e.target.checked)}
            className="accent-rose-500"
          />
          关键路径
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={collapsed.size === 0}
            onChange={(e) =>
              setCollapsed(e.target.checked ? new Set() : new Set(filtered.map((i) => i.id)))
            }
            className="accent-blue-500"
          />
          子任务折叠展示
        </label>
        {view === 'calendar' && (
          <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 text-xs">
            {(['week', 'month'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCalendarMode(m)}
                className={`cursor-pointer rounded px-2 py-1 ${
                  calendarMode === m ? 'bg-slate-100 font-medium' : 'text-slate-500'
                }`}
              >
                {m === 'week' ? '周' : '月'}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {cycleError && (
            <span className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">
              依赖成环：{cycleError.join(' → ')}
            </span>
          )}
          <Button type="button" size="sm" onClick={() => setQuickOpen((v) => !v)}>
            + 新建
          </Button>
          <Link href="/schedule/new">
            <Button type="button" size="sm" variant="outline">
              完整表单
            </Button>
          </Link>
        </div>
      </div>

      {quickOpen && (
        <QuickCreate
          items={filtered}
          onCreated={(item) => {
            setItems((prev) => [...prev, item])
            setQuickOpen(false)
          }}
        />
      )}

      {state === 'loading' ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="text-sm text-slate-500">加载日程中...</div>
          </CardContent>
        </Card>
      ) : state === 'error' ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-slate-700 font-medium mb-2">{error}</p>
            <Button type="button" onClick={() => void loadItems()}>
              重新加载
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="text-4xl mb-4">📅</div>
            <p className="text-slate-700 font-medium mb-2">还没有日程</p>
            <p className="text-sm text-slate-500 mb-4">添加任务、会议或跟进提醒</p>
            <Link href="/schedule/new">
              <Button>+ 创建第一项</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {view === 'timeline' && (
            <TimelineView
              rows={visibleRows}
              windowDays={timelineWindow.days}
              collapsed={collapsed}
              onToggle={toggleCollapse}
              critical={critical && !cycleError && 'criticalIds' in critical ? critical : null}
            />
          )}
          {view === 'calendar' && <CalendarView items={filtered} mode={calendarMode} />}
          {view === 'kanban' && (
            <KanbanView tree={tree} collapsed={collapsed} onToggle={toggleCollapse} onMove={moveStatus} />
          )}
          {view === 'list' && (
            <ListView rows={visibleRows} collapsed={collapsed} onToggle={toggleCollapse} />
          )}
        </>
      )}
    </div>
  )
}

function QuickCreate({
  items,
  onCreated,
}: {
  items: AgendaItem[]
  onCreated: (item: AgendaItem) => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [type, setType] = useState<AgendaType>('TASK')
  const [parentId, setParentId] = useState('')
  const [depId, setDepId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (title.trim().length < 2) {
      setErr('标题至少 2 个字')
      return
    }
    setSubmitting(true)
    setErr('')
    try {
      const token = window.localStorage.getItem('token')
      const payload = {
        title: title.trim(),
        agenda_type: type,
        start_at: `${date}T09:00:00.000Z`,
        all_day: true,
        ...(parentId ? { parent_id: parentId } : {}),
        ...(depId ? { depends_on: [depId] } : {}),
      }
      const res = await fetch('/api/agenda', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const body = (await res.json()) as { data?: AgendaItem; error?: string }
      if (!res.ok || !body.data) {
        setErr(body.error || '创建失败')
        return
      }
      onCreated(body.data)
    } catch {
      setErr('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="任务标题"
          className="col-span-2 h-9 rounded-md border border-slate-200 px-2.5 outline-none focus:border-blue-400"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2.5 outline-none focus:border-blue-400"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AgendaType)}
          className="h-9 rounded-md border border-slate-200 px-2 outline-none focus:border-blue-400"
        >
          {Object.entries(AGENDA_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 outline-none focus:border-blue-400"
        >
          <option value="">父任务：无</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </select>
        <select
          value={depId}
          onChange={(e) => setDepId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 outline-none focus:border-blue-400"
        >
          <option value="">依赖：无</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" disabled={submitting} onClick={() => void submit()}>
          {submitting ? '创建中...' : '创建'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setTitle('')}>
          清空
        </Button>
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>
    </div>
  )
}

function Chevron({ open, onClick }: { open: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className="w-4 cursor-pointer text-slate-400 hover:text-slate-700"
      aria-label={open ? '折叠' : '展开'}
    >
      {open ? '▾' : '▸'}
    </button>
  )
}

function TypeTag({ type }: { type: AgendaType }) {
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
        AGENDA_TYPE_COLOR[type]
      }`}
    >
      {AGENDA_TYPE_LABEL[type]}
    </span>
  )
}

function TimelineView({
  rows,
  windowDays,
  collapsed,
  onToggle,
  critical,
}: {
  rows: TreeNode[]
  windowDays: number[]
  collapsed: Set<string>
  onToggle: (id: string) => void
  critical: ReturnType<typeof computeCriticalPath> | null
}) {
  const colPct = 100 / windowDays.length
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[960px]">
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
          <div className="flex w-[54%] border-r border-slate-200">
            <div className="flex-1 px-2 py-2 font-medium text-slate-700">任务标题</div>
            <div className="w-[20%] border-l border-slate-100 px-2 py-2">开始时间</div>
            <div className="w-[20%] border-l border-slate-100 px-2 py-2">截止时间</div>
            <div className="w-[15%] border-l border-slate-100 px-2 py-2">状态</div>
          </div>
          <div className="flex flex-1">
            {windowDays.map((d) => {
              const date = new Date(d)
              const today = d === startOfDay(new Date().toISOString())
              return (
                <div
                  key={d}
                  className={`flex-1 border-l border-slate-100 px-1 py-2 text-center ${
                    today ? 'bg-blue-50 font-medium text-blue-700' : ''
                  }`}
                >
                  <div>{date.getDate()}</div>
                  <div className="text-[10px] text-slate-400">周{WD[date.getDay()]}</div>
                </div>
              )
            })}
          </div>
        </div>
        {rows.map((node) => {
          const item = node.item
          const [startMs, endMs] = daySpan(item)
          const left = ((startMs - windowDays[0]) / DAY_MS) * colPct
          const width = Math.max(1.5, ((endMs - startMs) / DAY_MS + 1) * colPct)
          const isCritical = critical?.criticalIds.has(item.id) ?? false
          return (
            <div key={item.id} className="flex border-b border-slate-100 text-xs hover:bg-slate-50">
              <div className="flex w-[54%] min-w-0 border-r border-slate-100">
                <div className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5">
                  <span style={{ width: node.depth * 14 }} className="shrink-0" />
                  {node.children.length > 0 ? (
                    <Chevron open={!collapsed.has(item.id)} onClick={() => onToggle(item.id)} />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span
                    className={`truncate ${isCritical ? 'font-medium text-rose-700' : 'text-slate-800'}`}
                  >
                    {item.title}
                  </span>
                  <TypeTag type={item.agenda_type} />
                </div>
                <div className="w-[20%] border-l border-slate-100 px-2 py-1.5 text-slate-500">
                  {fmtDate(item.start_at)}
                </div>
                <div className="w-[20%] border-l border-slate-100 px-2 py-1.5 text-slate-500">
                  {fmtDate(item.end_at)}
                </div>
                <div className="w-[15%] border-l border-slate-100 px-2 py-1.5">
                  <span className={`font-medium ${PRIORITY_COLOR[item.priority]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
              </div>
              <div className="relative h-8 flex-1">
                <div
                  className={`absolute top-1.5 h-5 truncate rounded px-1.5 text-[10px] leading-5 text-white ${
                    isCritical ? 'bg-rose-500 shadow-[0_0_0_2px_#ffe4e6]' : 'bg-blue-500'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${item.title} · ${fmtDate(item.start_at)} → ${fmtDate(item.end_at)}`}
                >
                  {item.title}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CalendarView({ items, mode }: { items: AgendaItem[]; mode: 'week' | 'month' }) {
  const today = startOfDay(new Date().toISOString())
  const byDay = useMemo(() => {
    const m = new Map<number, AgendaItem[]>()
    for (const item of items) {
      const [start] = daySpan(item)
      const list = m.get(start) || []
      list.push(item)
      m.set(start, list)
    }
    return m
  }, [items])

  if (mode === 'week') {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return startOfDay(d.toISOString())
    })
    return (
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
        {days.map((d, i) => {
          const date = new Date(d)
          const dayItems = byDay.get(d) || []
          return (
            <div key={d} className="min-h-[420px] bg-white">
              <div
                className={`border-b border-slate-100 px-2 py-1.5 text-xs ${
                  d === today ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600'
                }`}
              >
                周{WD[(i + 1) % 7]} {date.getMonth() + 1}/{date.getDate()}
              </div>
              <div className="space-y-1 p-1">
                {dayItems.map((item) => (
                  <div
                    key={item.id}
                    className="truncate rounded bg-slate-100 px-1.5 py-1 text-[11px] text-slate-700"
                    title={item.title}
                  >
                    {item.title}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const days: (number | null)[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), i - offset + 1)
    days.push(d.getMonth() === now.getMonth() ? startOfDay(d.toISOString()) : null)
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <div key={w} className="px-2 py-1.5 text-center">
            周{w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          if (d === null) return <div key={`e${i}`} className="min-h-[96px] bg-slate-50" />
          const date = new Date(d)
          const dayItems = (byDay.get(d) || []).slice(0, 3)
          return (
            <div
              key={d}
              className={`min-h-[96px] border-b border-r border-slate-100 p-1 ${
                d === today ? 'bg-blue-50' : ''
              }`}
            >
              <div
                className={`mb-0.5 text-[11px] ${
                  d === today
                    ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-semibold text-white'
                    : 'text-slate-500'
                }`}
              >
                {date.getDate()}
              </div>
              {dayItems.map((item) => (
                <div
                  key={item.id}
                  className="truncate rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700"
                  title={item.title}
                >
                  {item.title}
                </div>
              ))}
              {(byDay.get(d) || []).length > 3 && (
                <div className="text-[10px] text-slate-400">
                  +{(byDay.get(d) || []).length - 3} 项
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanView({
  tree,
  collapsed,
  onToggle,
  onMove,
}: {
  tree: TreeNode[]
  collapsed: Set<string>
  onToggle: (id: string) => void
  onMove: (id: string, status: AgendaStatus) => void
}) {
  const columns: { status: AgendaStatus; label: string; dot: string }[] = [
    { status: 'PENDING', label: '待办', dot: 'bg-slate-300' },
    { status: 'DONE', label: '已完成', dot: 'bg-emerald-400' },
    { status: 'CANCELLED', label: '已取消', dot: 'bg-slate-400' },
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {columns.map((col) => {
        const nodes = flattenVisible(tree, collapsed).filter((n) => n.item.status === col.status)
        return (
          <div
            key={col.status}
            className="min-h-[320px] rounded-lg bg-slate-100 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData('text/plain')
              if (id) void onMove(id, col.status)
            }}
          >
            <div className="flex items-center gap-1.5 px-1 pb-2 text-sm font-medium text-slate-700">
              <span className={`h-2 w-2 rounded-full ${col.dot}`} />
              {col.label}
              <span className="rounded-full bg-white px-1.5 text-[10px] text-slate-500">
                {nodes.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {nodes.map((node) => (
                <KanbanCard key={node.item.id} node={node} collapsed={collapsed} onToggle={onToggle} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KanbanCard({
  node,
  collapsed,
  onToggle,
}: {
  node: TreeNode
  collapsed: Set<string>
  onToggle: (id: string) => void
}) {
  const item = node.item
  const subCount = node.children.length
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', item.id)}
      className="cursor-grab rounded-md border border-slate-200 bg-white p-2 shadow-sm"
    >
      <div className="flex items-start gap-1">
        {subCount > 0 ? (
          <Chevron open={!collapsed.has(item.id)} onClick={() => onToggle(item.id)} />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs leading-snug text-slate-800">{item.title}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
            <TypeTag type={item.agenda_type} />
            <span>{fmtDate(item.start_at)}</span>
            {subCount > 0 && <span>{subCount} 个子任务</span>}
          </div>
        </div>
      </div>
      {subCount > 0 && !collapsed.has(item.id) && (
        <div className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-2">
          {node.children.map((child) => (
            <div key={child.item.id} className="text-[11px] text-slate-600">
              {child.item.title}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ListView({
  rows,
  collapsed,
  onToggle,
}: {
  rows: TreeNode[]
  collapsed: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="w-[46%] px-3 py-2 text-left font-medium">任务标题</th>
            <th className="px-3 py-2 text-left font-medium">类型</th>
            <th className="px-3 py-2 text-left font-medium">优先级</th>
            <th className="px-3 py-2 text-left font-medium">开始</th>
            <th className="px-3 py-2 text-left font-medium">截止</th>
            <th className="px-3 py-2 text-left font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => {
            const item = node.item
            return (
              <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <span style={{ width: node.depth * 14 }} className="shrink-0" />
                    {node.children.length > 0 ? (
                      <Chevron open={!collapsed.has(item.id)} onClick={() => onToggle(item.id)} />
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="truncate text-slate-800">{item.title}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <TypeTag type={item.agenda_type} />
                </td>
                <td className={`px-3 py-1.5 font-medium ${PRIORITY_COLOR[item.priority]}`}>
                  {item.priority}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{fmtDate(item.start_at)}</td>
                <td className="px-3 py-1.5 text-slate-500">{fmtDate(item.end_at)}</td>
                <td className="px-3 py-1.5 text-slate-600">{STATUS_LABEL[item.status]}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
