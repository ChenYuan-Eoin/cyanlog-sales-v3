'use client'

import { useState, useEffect, useCallback } from 'react'
import OrgStructureTab from '@/app/configs/tabs/OrgStructureTab'
import type { OrgSummaryPayload } from '@/app/configs/types'

// B11: /admin/org 入口复用 OrgStructureTab，避免与 /configs?tab=org-structure 重复代码
export default function AdminOrgPage() {
  const [orgSummary, setOrgSummary] = useState<OrgSummaryPayload | null>(null)
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _feishuSyncing = false
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _feishuResult = ''

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
          feishuSyncing={false}
          feishuResult=""
          onFeishuSync={fetchOrgData}
        />
      </div>
    </div>
  )
}
