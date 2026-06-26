'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AGENDA_TYPE_LABEL,
  AGENDA_TYPE_COLOR,
  PRIORITY_COLOR,
  STATUS_LABEL,
  type AgendaItem,
} from '@/lib/agenda/types'
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

export function ScheduleClient() {
  const [items, setItems] = useState<AgendaItem[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')

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

  const urgentCount = useMemo(
    () => items.filter((i) => i.priority === 'URGENT' && i.status === 'PENDING').length,
    [items]
  )
  const todayCount = useMemo(
    () => items.filter((i) => {
      const d = new Date(i.start_at)
      const today = new Date()
      return d.toDateString() === today.toDateString() && i.status === 'PENDING'
    }).length,
    [items]
  )

  return (
    <div data-schedule-state={state}>
      {(urgentCount > 0 || todayCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {urgentCount > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              🚨 <strong>{urgentCount}</strong> 个紧急待办
            </div>
          )}
          {todayCount > 0 && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              📅 今日 <strong>{todayCount}</strong> 个待办
            </div>
          )}
        </div>
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
      ) : items.length === 0 ? (
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
        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="rounded-lg border bg-white p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      AGENDA_TYPE_COLOR[it.agenda_type as keyof typeof AGENDA_TYPE_COLOR]
                    }`}
                  >
                    {AGENDA_TYPE_LABEL[it.agenda_type as keyof typeof AGENDA_TYPE_LABEL]}
                  </span>
                  <h3 className="font-medium text-slate-900 truncate">{it.title}</h3>
                </div>
                <span
                  className={`text-xs font-medium ${
                    PRIORITY_COLOR[it.priority as keyof typeof PRIORITY_COLOR]
                  }`}
                >
                  {it.priority}
                </span>
              </div>

              {it.description && (
                <p className="text-sm text-slate-600 mb-2 line-clamp-2">{it.description}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{new Date(it.start_at).toLocaleString('zh-CN')}</span>
                <span>·</span>
                <span>{STATUS_LABEL[it.status as keyof typeof STATUS_LABEL]}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
