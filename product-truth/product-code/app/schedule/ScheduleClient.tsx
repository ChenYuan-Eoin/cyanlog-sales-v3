'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AGENDA_TYPE_LABEL,
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
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Flag,
  GanttChart,
  Kanban,
  Link2,
  List as ListIcon,
  Plus,
  Search,
  XCircle,
} from 'lucide-react'

type LoadState = 'loading' | 'ready' | 'error'
type ViewMode = 'timeline' | 'calendar' | 'kanban' | 'list'

const INK = '#37352F'
const INK_2 = '#787774'
const INK_3 = '#9B9A97'
const BORDER = '#E9E9E7'
const HOVER = '#F1F1EF'
const PAGE_BG = '#F7F6F3'
const ACCENT = '#2383E2'
const DANGER = '#E5484D'
const SUCCESS = '#2EA043'

const TYPE_DOT: Record<AgendaType, string> = {
  TASK: '#4E8DF8',
  MEETING: '#9B59B6',
  FOLLOW_UP: '#2EA043',
  REMINDER: '#F2994A',
}

const PRIORITY_DOT: Record<AgendaItem['priority'], string> = {
  LOW: '#C0BEB9',
  NORMAL: '#4E8DF8',
  HIGH: '#F2994A',
  URGENT: '#E5484D',
}

const STATUS_META: Record<AgendaStatus, { label: string; color: string; icon: typeof Circle }> = {
  PENDING: { label: '待办', color: INK_2, icon: Circle },
  DONE: { label: '已完成', color: SUCCESS, icon: CheckCircle2 },
  CANCELLED: { label: '已取消', color: INK_3, icon: XCircle },
}

function fmt(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  if (!withTime) return base
  return `${base} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const VIEW_TABS: { id: ViewMode; label: string; icon: typeof GanttChart }[] = [
  { id: 'timeline', label: '时间线', icon: GanttChart },
  { id: 'calendar', label: '日历', icon: CalendarDays },
  { id: 'kanban', label: '看板', icon: Kanban },
  { id: 'list', label: '列表', icon: ListIcon },
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
      while (days.length < 14) days.push(days[days.length - 1] + DAY_MS)
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
      // 拖拽失败保持原状态
    }
  }, [])

  const cycleError =
    critical && 'cycle' in critical ? (critical as { cycle: string[] }).cycle : null

  return (
    <div data-schedule-state={state} className="text-[13px]" style={{ color: INK }}>
      {/* 工具条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          className="flex items-center rounded-lg p-0.5"
          style={{ background: HOVER, border: `1px solid ${BORDER}` }}
        >
          {VIEW_TABS.map((t) => {
            const Icon = t.icon
            const active = view === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors"
                style={{
                  background: active ? '#FFFFFF' : 'transparent',
                  color: active ? INK : INK_2,
                  boxShadow: active ? '0 1px 2px rgba(15,15,15,.08)' : 'none',
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon size={14} strokeWidth={active ? 2 : 1.75} />
                {t.label}
              </button>
            )
          })}
        </div>

        <div
          className="flex h-[30px] w-56 items-center gap-1.5 rounded-md border bg-white px-2 transition-shadow focus-within:ring-2"
          style={{ borderColor: BORDER, ['--tw-ring-color' as string]: 'rgba(35,131,226,.25)' }}
        >
          <Search size={13} style={{ color: INK_3 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#9B9A97]"
            style={{ color: INK }}
          />
        </div>

        <ToggleChip
          active={showCritical}
          onClick={() => setShowCritical((v) => !v)}
          icon={Flag}
          label="关键路径"
        />
        <ToggleChip
          active={collapsed.size === 0}
          onClick={() =>
            setCollapsed(collapsed.size === 0 ? new Set(filtered.map((i) => i.id)) : new Set())
          }
          icon={ChevronDown}
          label="折叠子任务"
        />

        {view === 'calendar' && (
          <div
            className="flex items-center rounded-md p-0.5"
            style={{ background: HOVER, border: `1px solid ${BORDER}` }}
          >
            {(['week', 'month'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCalendarMode(m)}
                className="cursor-pointer rounded px-2 py-1 text-xs transition-colors"
                style={{
                  background: calendarMode === m ? '#FFFFFF' : 'transparent',
                  color: calendarMode === m ? INK : INK_2,
                  fontWeight: calendarMode === m ? 500 : 400,
                }}
              >
                {m === 'week' ? '周' : '月'}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {cycleError && (
            <span
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              style={{ background: '#FDECEC', color: DANGER }}
            >
              <AlertCircle size={13} />
              依赖成环：{cycleError.join(' → ')}
            </span>
          )}
          <Button type="button" size="sm" onClick={() => setQuickOpen((v) => !v)}>
            <Plus size={14} className="mr-1" />
            新建
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
          <CardContent className="py-20 text-center text-sm" style={{ color: INK_2 }}>
            加载日程中…
          </CardContent>
        </Card>
      ) : state === 'error' ? (
        <Card>
          <CardContent className="py-20 text-center">
            <p className="mb-3 font-medium" style={{ color: INK }}>
              {error}
            </p>
            <Button type="button" onClick={() => void loadItems()}>
              重新加载
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <CalendarDays size={40} className="mx-auto mb-3" style={{ color: INK_3 }} />
            <p className="mb-1 font-medium" style={{ color: INK }}>
              还没有日程
            </p>
            <p className="mb-4 text-sm" style={{ color: INK_2 }}>
              添加任务、会议或跟进提醒
            </p>
            <Link href="/schedule/new">
              <Button>创建第一项</Button>
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

function ToggleChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Flag
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs transition-colors"
      style={{
        borderColor: active ? '#B3D4F7' : BORDER,
        color: active ? ACCENT : INK_2,
        background: active ? '#F3F9FF' : '#FFFFFF',
      }}
    >
      <Icon size={13} strokeWidth={1.75} />
      {label}
    </button>
  )
}

function Chevron({ open, onClick }: { open: boolean; onClick?: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className="shrink-0 cursor-pointer rounded-sm p-0.5 transition-colors hover:bg-[#E8E7E4]"
      style={{ color: INK_3 }}
      aria-label={open ? '折叠' : '展开'}
    >
      <Icon size={13} strokeWidth={2} />
    </button>
  )
}

function TypeDot({ type }: { type: AgendaType }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]"
      style={{ background: `${TYPE_DOT[type]}14`, color: TYPE_DOT[type] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_DOT[type] }} />
      {AGENDA_TYPE_LABEL[type]}
    </span>
  )
}

function StatusBadge({ status }: { status: AgendaStatus }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: meta.color }}>
      <Icon size={13} strokeWidth={1.75} />
      {meta.label}
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
  const today = startOfDay(new Date().toISOString())
  const todayIdx = windowDays.indexOf(today)
  return (
    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: BORDER }}>
      <div className="min-w-[980px]">
        {/* 表头：任务列 + 日期 */}
        <div
          className="sticky top-0 z-10 flex border-b text-xs"
          style={{ background: PAGE_BG, borderColor: BORDER }}
        >
          <div className="flex w-[54%] border-r" style={{ borderColor: BORDER }}>
            <div
              className="flex-1 px-3 py-2 font-medium"
              style={{ color: INK_2, fontSize: 11, letterSpacing: '.02em' }}
            >
              任务标题
            </div>
            <div className="w-[16%] border-l px-2 py-2" style={{ borderColor: BORDER, color: INK_3 }}>
              开始
            </div>
            <div className="w-[16%] border-l px-2 py-2" style={{ borderColor: BORDER, color: INK_3 }}>
              截止
            </div>
            <div className="w-[13%] border-l px-2 py-2" style={{ borderColor: BORDER, color: INK_3 }}>
              状态
            </div>
          </div>
          <div className="flex flex-1">
            {windowDays.map((d, i) => {
              const date = new Date(d)
              const isToday = d === today
              const weekend = date.getDay() === 0 || date.getDay() === 6
              return (
                <div
                  key={d}
                  className="flex-1 border-l px-1 py-1.5 text-center"
                  style={{
                    borderColor: BORDER,
                    background: isToday ? '#F0F7FF' : 'transparent',
                  }}
                >
                  <div
                    className="text-[11px] font-medium"
                    style={{ color: isToday ? ACCENT : weekend ? INK_3 : INK_2 }}
                  >
                    {date.getDate()}
                  </div>
                  <div className="text-[10px]" style={{ color: INK_3 }}>
                    周{WD[date.getDay()]}
                  </div>
                  {isToday && (
                    <div className="mx-auto mt-0.5 h-1 w-1 rounded-full" style={{ background: ACCENT }} />
                  )}
                  {i === 0 && <span className="sr-only">列起始</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* 行 */}
        <div className="relative">
          {todayIdx >= 0 && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-0"
              style={{
                left: `calc(54% + ${todayIdx * (46 / windowDays.length)}%)`,
                width: `${46 / windowDays.length}%`,
                background: 'rgba(35,131,226,.045)',
              }}
            />
          )}
          {rows.map((node) => {
            const item = node.item
            const [startMs, endMs] = daySpan(item)
            const left = ((startMs - windowDays[0]) / DAY_MS) * colPct
            const width = Math.max(1.5, ((endMs - startMs) / DAY_MS + 1) * colPct)
            const isCritical = critical?.criticalIds.has(item.id) ?? false
            return (
              <div
                key={item.id}
                className="group flex border-b transition-colors hover:bg-[#FBFBFA]"
                style={{ borderColor: '#F0EFED', minHeight: 38 }}
              >
                <div
                  className="flex w-[54%] min-w-0 items-center border-r"
                  style={{ borderColor: '#F0EFED' }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1 px-2">
                    <span style={{ width: node.depth * 16 }} className="shrink-0" />
                    {node.children.length > 0 ? (
                      <Chevron open={!collapsed.has(item.id)} onClick={() => onToggle(item.id)} />
                    ) : (
                      <span className="w-[18px] shrink-0" />
                    )}
                    <span
                      className="truncate text-[13px]"
                      style={{
                        color: isCritical ? DANGER : INK,
                        fontWeight: isCritical ? 500 : 400,
                      }}
                    >
                      {item.title}
                    </span>
                    <TypeDot type={item.agenda_type} />
                    {item.depends_on && item.depends_on.length > 0 && (
                      <Link2 size={11} className="shrink-0" style={{ color: INK_3 }} />
                    )}
                  </div>
                  <div className="w-[16%] px-2 text-xs" style={{ color: INK_2 }}>
                    {fmt(item.start_at)}
                  </div>
                  <div className="w-[16%] px-2 text-xs" style={{ color: INK_2 }}>
                    {fmt(item.end_at)}
                  </div>
                  <div className="w-[13%] px-2">
                    <StatusBadge status={item.status} />
                  </div>
                </div>
                <div className="relative h-[38px] flex-1">
                  <div
                    className="absolute top-[11px] h-[15px] rounded-[4px] transition-all"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: isCritical
                        ? `linear-gradient(90deg, ${DANGER}, #F2555A)`
                        : `linear-gradient(90deg, #4E8DF8, #2383E2)`,
                      boxShadow: isCritical
                        ? '0 1px 3px rgba(229,72,77,.35)'
                        : '0 1px 3px rgba(35,131,226,.25)',
                    }}
                    title={`${item.title} · ${fmt(item.start_at)} → ${fmt(item.end_at)}`}
                  >
                    {width > 10 && (
                      <span className="truncate px-1.5 text-[10px] leading-[15px] text-white">
                        {item.title}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
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
      <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: BORDER }}>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const date = new Date(d)
            const isToday = d === today
            const dayItems = byDay.get(d) || []
            return (
              <div
                key={d}
                className="min-h-[420px] border-r last:border-r-0"
                style={{ borderColor: BORDER, background: isToday ? '#F0F7FF' : '#FFFFFF' }}
              >
                <div
                  className="flex items-center gap-2 border-b px-3 py-2"
                  style={{ borderColor: BORDER }}
                >
                  <span className="text-xs" style={{ color: isToday ? ACCENT : INK_2, fontWeight: 500 }}>
                    周{WD[(i + 1) % 7]}
                  </span>
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
                    style={{
                      background: isToday ? ACCENT : 'transparent',
                      color: isToday ? '#FFFFFF' : INK,
                    }}
                  >
                    {date.getDate()}
                  </span>
                </div>
                <div className="space-y-1 p-1.5">
                  {dayItems.map((item) => (
                    <div
                      key={item.id}
                      className="truncate rounded-[4px] px-1.5 py-1 text-[11px] transition-colors hover:bg-white hover:shadow-sm"
                      style={{ background: HOVER, color: INK }}
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
    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: BORDER }}>
      <div className="grid grid-cols-7 border-b text-xs" style={{ borderColor: BORDER, background: PAGE_BG }}>
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <div key={w} className="px-3 py-2 text-center font-medium" style={{ color: INK_2 }}>
            周{w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          if (d === null) return <div key={`e${i}`} className="min-h-[104px]" style={{ background: '#FBFAF9' }} />
          const date = new Date(d)
          const isToday = d === today
          const weekend = date.getDay() === 0 || date.getDay() === 6
          const dayItems = (byDay.get(d) || []).slice(0, 3)
          return (
            <div
              key={d}
              className="min-h-[104px] border-b border-r p-1.5 transition-colors hover:bg-[#FBFBFA]"
              style={{
                borderColor: '#F0EFED',
                background: isToday ? '#F0F7FF' : 'transparent',
              }}
            >
              <div className="mb-1 flex justify-end">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
                  style={{
                    background: isToday ? ACCENT : 'transparent',
                    color: isToday ? '#FFFFFF' : weekend ? INK_3 : INK,
                  }}
                >
                  {date.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayItems.map((item) => (
                  <div
                    key={item.id}
                    className="truncate rounded-[4px] px-1.5 py-0.5 text-[11px]"
                    style={{ background: HOVER, color: INK }}
                    title={item.title}
                  >
                    {item.title}
                  </div>
                ))}
                {(byDay.get(d) || []).length > 3 && (
                  <div className="px-1 text-[10px]" style={{ color: INK_3 }}>
                    +{(byDay.get(d) || []).length - 3} 项
                  </div>
                )}
              </div>
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
    { status: 'PENDING', label: '待办', dot: '#C0BEB9' },
    { status: 'DONE', label: '已完成', dot: SUCCESS },
    { status: 'CANCELLED', label: '已取消', dot: INK_3 },
  ]
  const [dragOver, setDragOver] = useState<AgendaStatus | null>(null)
  return (
    <div className="grid grid-cols-3 gap-3">
      {columns.map((col) => {
        const nodes = flattenVisible(tree, collapsed).filter((n) => n.item.status === col.status)
        return (
          <div
            key={col.status}
            className="min-h-[400px] rounded-lg p-2 transition-colors"
            style={{
              background: dragOver === col.status ? '#F0F7FF' : PAGE_BG,
              outline: dragOver === col.status ? `1px solid ${ACCENT}40` : 'none',
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(col.status)
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(null)
              const id = e.dataTransfer.getData('text/plain')
              if (id) void onMove(id, col.status)
            }}
          >
            <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-medium" style={{ color: INK }}>
              <span className="h-2 w-2 rounded-full" style={{ background: col.dot }} />
              {col.label}
              <span
                className="rounded-full px-1.5 py-0.5 text-[11px] font-normal"
                style={{ background: '#E8E7E4', color: INK_2 }}
              >
                {nodes.length}
              </span>
            </div>
            <div className="space-y-2">
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
      className="cursor-grab rounded-md border bg-white p-2.5 transition-all hover:shadow-md active:cursor-grabbing"
      style={{
        borderColor: BORDER,
        boxShadow: '0 1px 2px rgba(15,15,15,.05)',
      }}
    >
      <div className="flex items-start gap-1.5">
        {subCount > 0 ? (
          <Chevron open={!collapsed.has(item.id)} onClick={() => onToggle(item.id)} />
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug" style={{ color: INK }}>
            {item.title}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <TypeDot type={item.agenda_type} />
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: INK_3 }}>
              <Clock size={11} />
              {fmt(item.start_at)}
            </span>
            {subCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: INK_3 }}>
                <ChevronDown size={11} />
                {subCount}
              </span>
            )}
          </div>
        </div>
        <span
          className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: PRIORITY_DOT[item.priority] }}
          title={`优先级 ${item.priority}`}
        />
      </div>
      {subCount > 0 && !collapsed.has(item.id) && (
        <div className="mt-2 space-y-1 border-l pl-2" style={{ borderColor: '#E0DEDA' }}>
          {node.children.map((child) => (
            <div key={child.item.id} className="text-xs" style={{ color: INK_2 }}>
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
    <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: BORDER }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: PAGE_BG }}>
            <th className="w-[44%] px-3 py-2 text-left font-medium" style={{ color: INK_2, fontSize: 11 }}>
              任务标题
            </th>
            <th className="px-3 py-2 text-left font-medium" style={{ color: INK_2, fontSize: 11 }}>
              类型
            </th>
            <th className="px-3 py-2 text-left font-medium" style={{ color: INK_2, fontSize: 11 }}>
              优先级
            </th>
            <th className="px-3 py-2 text-left font-medium" style={{ color: INK_2, fontSize: 11 }}>
              开始
            </th>
            <th className="px-3 py-2 text-left font-medium" style={{ color: INK_2, fontSize: 11 }}>
              截止
            </th>
            <th className="px-3 py-2 text-left font-medium" style={{ color: INK_2, fontSize: 11 }}>
              状态
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => {
            const item = node.item
            return (
              <tr
                key={item.id}
                className="border-t transition-colors hover:bg-[#FBFBFA]"
                style={{ borderColor: '#F0EFED' }}
              >
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <span style={{ width: node.depth * 16 }} className="shrink-0" />
                    {node.children.length > 0 ? (
                      <Chevron open={!collapsed.has(item.id)} onClick={() => onToggle(item.id)} />
                    ) : (
                      <span className="w-[18px] shrink-0" />
                    )}
                    <span className="truncate font-medium" style={{ color: INK }}>
                      {item.title}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <TypeDot type={item.agenda_type} />
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: INK_2 }}>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: PRIORITY_DOT[item.priority] }}
                    />
                    {item.priority}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: INK_2 }}>
                  {fmt(item.start_at)}
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: INK_2 }}>
                  {fmt(item.end_at)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={item.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
    <div
      className="mb-3 rounded-lg border bg-white p-3"
      style={{ borderColor: BORDER, boxShadow: '0 4px 16px rgba(15,15,15,.08)' }}
    >
      <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="任务标题"
          className="col-span-2 h-8 rounded-md border bg-white px-2.5 text-[13px] outline-none transition-shadow focus:ring-2"
          style={{ borderColor: BORDER, color: INK, ['--tw-ring-color' as string]: 'rgba(35,131,226,.25)' }}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 rounded-md border bg-white px-2 text-[13px] outline-none"
          style={{ borderColor: BORDER, color: INK }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AgendaType)}
          className="h-8 rounded-md border bg-white px-2 text-[13px] outline-none"
          style={{ borderColor: BORDER, color: INK }}
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
          className="h-8 rounded-md border bg-white px-2 text-[13px] outline-none"
          style={{ borderColor: BORDER, color: INK }}
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
          className="h-8 rounded-md border bg-white px-2 text-[13px] outline-none"
          style={{ borderColor: BORDER, color: INK }}
        >
          <option value="">依赖：无</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Button type="button" size="sm" disabled={submitting} onClick={() => void submit()}>
          {submitting ? '创建中…' : '创建'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setTitle('')}>
          清空
        </Button>
        {err && (
          <span className="flex items-center gap-1 text-xs" style={{ color: DANGER }}>
            <AlertCircle size={12} />
            {err}
          </span>
        )}
      </div>
    </div>
  )
}
