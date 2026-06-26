'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { FeishuSyncFeedback, OrgSummaryPayload } from '@/app/configs/types'
import { confirmAction } from '@/lib/toast'
import {
  buildFeishuErrorFeedback,
  buildFeishuNetworkErrorFeedback,
  buildFeishuSuccessFeedback,
  type FeishuSyncResponse,
} from '@/app/configs/feishu-sync-feedback'

const OrgStructureTab = dynamic(() => import('@/app/configs/tabs/OrgStructureTab'), {
  loading: () => (
    <div className="space-y-4 rounded-lg border bg-white p-6">
      <div className="h-6 w-40 rounded bg-slate-100" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-20 rounded bg-slate-100" />
        <div className="h-20 rounded bg-slate-100" />
        <div className="h-20 rounded bg-slate-100" />
      </div>
      <div className="h-72 rounded bg-slate-100" />
    </div>
  ),
})

// B11: /admin/org 入口复用 OrgStructureTab，避免与 /configs?tab=org-structure 重复代码
export default function AdminOrgPage() {
  const [orgSummary, setOrgSummary] = useState<OrgSummaryPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [feishuSyncing, setFeishuSyncing] = useState(false)
  const [feishuFeedback, setFeishuFeedback] = useState<FeishuSyncFeedback | null>(null)

  const fetchOrgData = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/org', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (res.ok) {
        const data = await res.json()
        setOrgSummary(data)
      }
    } catch (err) {
      console.error('[AdminOrgPage] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchOrgData()
  }, [fetchOrgData])

  const handleFeishuSync = useCallback(async () => {
    if (!await confirmAction('从飞书导入部门结构？现有部门树将保留，source=feishu 的记录会被刷新。本阶段不会导入成员。', { confirmText: '开始导入' })) return
    setFeishuSyncing(true)
    setFeishuFeedback(null)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/access/feishu/sync', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json().catch(() => ({})) as FeishuSyncResponse

      if (res.ok) {
        await fetchOrgData()
        setFeishuFeedback(buildFeishuSuccessFeedback(data))
      } else {
        setFeishuFeedback(buildFeishuErrorFeedback(res.status, data))
      }
    } catch {
      setFeishuFeedback(buildFeishuNetworkErrorFeedback())
    } finally {
      setFeishuSyncing(false)
    }
  }, [fetchOrgData])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">组织管理</h1>
        <p className="text-sm text-slate-500 mb-6">
          维护组织架构、成员、角色归属。
        </p>
        <OrgStructureTab
          orgSummary={orgSummary}
          feishuSyncing={feishuSyncing}
          feishuFeedback={feishuFeedback}
          onFeishuSync={handleFeishuSync}
          onRefresh={fetchOrgData}
        />
      </div>
    </div>
  )
}
