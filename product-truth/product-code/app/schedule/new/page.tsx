// F018 日程新建页
// 路径：/schedule/new

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  AGENDA_TYPES,
  AGENDA_TYPE_LABEL,
  AGENDA_PRIORITIES,
  type AgendaType,
  type AgendaPriority,
} from '@/lib/agenda/types'
import { invalidateAgendaUpcomingCache } from '@/lib/core-page-warmup'

export default function NewAgendaPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const form = new FormData(e.currentTarget)

    // 拼接 start_at 为完整 ISO datetime
    const date = String(form.get('date') || '')
    const time = String(form.get('time') || '09:00')
    const start_at = new Date(`${date}T${time}:00`).toISOString()

    const payload = {
      title: String(form.get('title') || '').trim(),
      description: String(form.get('description') || '').trim() || undefined,
      agenda_type: String(form.get('agenda_type') || 'TASK') as AgendaType,
      priority: String(form.get('priority') || 'NORMAL') as AgendaPriority,
      start_at,
      all_day: form.get('all_day') === 'on',
    }
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    try {
      const res = await fetch('/api/agenda', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || '创建失败')
        return
      }
      invalidateAgendaUpcomingCache(token)
      router.push('/schedule')
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  // 默认日期为今天
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">新建日程</h1>
      <p className="text-sm text-slate-500 mb-6">添加任务、会议、跟进或提醒</p>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="标题" required>
              <Input name="title" required placeholder="如：客户需求确认会议" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="类型" required>
                <select
                  name="agenda_type"
                  defaultValue="TASK"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {AGENDA_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {AGENDA_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="优先级" required>
                <select
                  name="priority"
                  defaultValue="NORMAL"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {AGENDA_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="日期" required>
                <Input name="date" type="date" defaultValue={today} required />
              </Field>
              <Field label="时间" required>
                <Input name="time" type="time" defaultValue="09:00" required />
              </Field>
            </div>
            <Field label="全天">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="all_day" className="rounded" />
                <span className="text-slate-700">全天事件</span>
              </label>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>详情</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea name="description" rows={4} placeholder="议程、目标、相关人员..." />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '创建中...' : '创建日程'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
