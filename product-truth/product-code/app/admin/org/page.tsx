'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { OrgSummaryPayload } from '@/app/configs/types'

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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchOrgData = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined
      const [orgResponse, profileResponse] = await Promise.all([
        fetch('/api/admin/org', { headers }),
        fetch('/api/auth/me', { headers, cache: 'no-store' }).catch(() => null),
      ])
      if (orgResponse.ok) {
        const data = await orgResponse.json()
        setOrgSummary(data)
      }
      if (profileResponse?.ok) {
        const profile = await profileResponse.json() as { user?: { id?: unknown } }
        setCurrentUserId(typeof profile.user?.id === 'string' ? profile.user.id : null)
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
          currentUserId={currentUserId}
          onRefresh={fetchOrgData}
        />
      </div>
    </div>
  )
}
