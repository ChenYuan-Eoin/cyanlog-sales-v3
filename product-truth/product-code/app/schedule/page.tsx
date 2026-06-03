// F018 日程管理 - 列表页
// 路径：/schedule

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import {
  AGENDA_TYPE_LABEL,
  AGENDA_TYPE_COLOR,
  PRIORITY_COLOR,
  STATUS_LABEL,
  type AgendaItem,
} from '@/lib/agenda/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function SchedulePage() {
  const now = new Date().toISOString()
  const { data: records } = await supabaseAdmin
    .from('agenda_items')
    .select('*')
    .gte('start_at', now)
    .order('start_at', { ascending: true })
    .limit(50)

  const items = (records as AgendaItem[] | null) || []

  // 统计
  const urgentCount = items.filter((i) => i.priority === 'URGENT' && i.status === 'PENDING').length
  const todayCount = items.filter((i) => {
    const d = new Date(i.start_at)
    const today = new Date()
    return d.toDateString() === today.toDateString() && i.status === 'PENDING'
  }).length

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">日程管理</h1>
          <p className="text-sm text-slate-500">管理任务、会议、跟进、提醒</p>
        </div>
        <Link href="/schedule/new">
          <Button>+ 新建日程</Button>
        </Link>
      </div>

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

      {items.length === 0 ? (
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
