'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingState } from '@/components/ui/LoadingState'
import { readBrowserCacheEntry, scopedCacheKey } from '@/lib/browser-cache'
import {
  CORE_PAGE_BACKGROUND_REFRESH_MS,
  CORE_PAGE_VISIBLE_CACHE_TTL_MS,
  loadTendersListForCache,
  type TendersCachePayload,
} from '@/lib/core-page-warmup'

interface TenderRecord {
  id: string
  original_file: string
  key_info?: {
    tenderName?: string
    tenderNo?: string
    budget?: string
    deadline?: string
  }
  confidence?: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
}

export default function TendersClient() {
  const [tenders, setTenders] = useState<TenderRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTenders() {
      try {
        const token = localStorage.getItem('token')
        const cacheKey = scopedCacheKey(token, 'tenders:list')
        const cachedEntry = readBrowserCacheEntry<TendersCachePayload>(cacheKey)
        const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.savedAt : Number.POSITIVE_INFINITY
        const cached = cacheAgeMs <= CORE_PAGE_VISIBLE_CACHE_TTL_MS ? cachedEntry?.value : null

        if (cached) {
          setTenders(cached.tenders as TenderRecord[])
          setLoading(false)
          if (cacheAgeMs < CORE_PAGE_BACKGROUND_REFRESH_MS) return
        } else {
          setLoading(true)
        }

        if (token) {
          const payload = await loadTendersListForCache(token)
          if (payload) {
            setTenders(payload.tenders as TenderRecord[])
          }
          return
        }

        const res = await fetch('/api/tenders')
        if (res.ok) {
          const data = await res.json()
          setTenders(data.data || [])
        }
      } catch (error) {
        console.error('获取标书失败:', error)
      } finally {
        setLoading(false)
      }
    }

    void fetchTenders()
  }, [])

  const stats = useMemo(() => {
    const highConfidence = tenders.filter((t) => (t.confidence ?? 0) >= 0.8).length
    const pendingCount = tenders.filter((t) => t.status === 'pending' || t.status === 'processing').length
    const failedCount = tenders.filter((t) => t.status === 'failed').length
    return { highConfidence, pendingCount, failedCount }
  }, [tenders])

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">标书中心</h1>
          <p className="text-sm text-slate-500">招标文件 OCR 解析、关键信息提取、标书生成</p>
        </div>
        <Link href="/contracts/new" prefetch={false}>
          <Button>+ 上传招标文件</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="总标书数" value={tenders.length} color="slate" />
        <StatCard label="高置信度" value={stats.highConfidence} color="green" />
        <StatCard label="处理中" value={stats.pendingCount} color="amber" />
        <StatCard label="失败" value={stats.failedCount} color="red" />
      </div>

      {loading ? (
        <LoadingState message="加载标书..." />
      ) : tenders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-2">暂无标书</p>
            <p className="text-sm text-slate-400 mb-4">上传招标文件后，OCR 会自动解析关键信息</p>
            <Link href="/contracts/new" prefetch={false}>
              <Button>+ 上传招标文件</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">标书名称</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">招标编号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">预算</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">截止日期</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">置信度</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.map((t) => {
                const keyInfo = t.key_info || {}
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/tenders/${t.id}`}
                        prefetch={false}
                        className="text-sm font-medium text-slate-900 hover:text-blue-600"
                      >
                        {keyInfo.tenderName || t.original_file}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 font-mono">
                      {keyInfo.tenderNo || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {keyInfo.budget || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {keyInfo.deadline || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <ConfidenceIndicator value={t.confidence ?? 0} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/tenders/${t.id}`}
                        prefetch={false}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        查看详情
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    slate: 'border-slate-200 bg-white',
    green: 'border-green-200 bg-green-50',
    amber: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
  }
  const textMap: Record<string, string> = {
    slate: 'text-slate-900',
    green: 'text-green-900',
    amber: 'text-amber-900',
    red: 'text-red-900',
  }
  return (
    <div className={`rounded-lg border p-4 ${colorMap[color]}`}>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${textMap[color]}`}>{value}</div>
    </div>
  )
}

function ConfidenceIndicator({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-600 font-mono w-8">{pct}%</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    completed: { label: '完成', variant: 'default' },
    processing: { label: '处理中', variant: 'secondary' },
    pending: { label: '待处理', variant: 'outline' },
    failed: { label: '失败', variant: 'destructive' },
  }
  const config = map[status] || { label: status, variant: 'outline' }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
