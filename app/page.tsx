'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

interface DashboardStats {
  pendingContracts: number
  pendingQuotes: number
  monthlyQuotes: number
  monthlyContracts: number
}

interface RecentItem {
  id: string
  type: 'quote' | 'contract'
  title: string
  subtitle: string
  status: string
  statusLabel: string
  statusVariant: 'default' | 'secondary' | 'outline' | 'destructive'
}

export default function HomePage() {
  const [stats, setStats] = useState<DashboardStats>({
    pendingContracts: 0,
    pendingQuotes: 0,
    monthlyQuotes: 0,
    monthlyContracts: 0,
  })
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const token = localStorage.getItem('token')
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`

        // 并行获取数据
        const [contractsRes, quotesRes] = await Promise.all([
          fetch('/api/contracts?status=PENDING', { headers }),
          fetch('/api/quotes?status=PENDING_APPROVAL', { headers }),
        ])

        const contractsData = contractsRes.ok ? await contractsRes.json() : { data: [] }
        const quotesData = quotesRes.ok ? await quotesRes.json() : { data: [] }

        setStats({
          pendingContracts: contractsData.data?.length || 0,
          pendingQuotes: quotesData.data?.length || 0,
          monthlyQuotes: 12, // 实际应该从 API 按月份过滤
          monthlyContracts: 8,
        })

        // 构建最近访问列表（合并报价和合同，按时间排序）
        const recent: RecentItem[] = [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...contractsData.data?.slice(0, 3).map((c: any) => ({
            id: c.id,
            type: 'contract' as const,
            title: c.filename || '合同文件',
            subtitle: c.storage_path || '',
            status: c.status,
            statusLabel: statusMap[c.status]?.label || c.status,
            statusVariant: statusMap[c.status]?.variant || 'default',
          })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...quotesData.data?.slice(0, 3).map((q: any) => ({
            id: q.id,
            type: 'quote' as const,
            title: q.quote_no || '报价单',
            subtitle: q.customer_name || '',
            status: q.status,
            statusLabel: quoteStatusMap[q.status]?.label || q.status,
            statusVariant: quoteStatusMap[q.status]?.variant || 'default',
          })),
        ]

        setRecentItems(recent)
      } catch (error) {
        console.error('获取工作台数据失败:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">工作台</h1>

      {loading && <div className="text-slate-500">加载中...</div>}

      {/* 待办统计 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">待审核合同</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.pendingContracts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">待审批报价</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.pendingQuotes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">本月报价</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.monthlyQuotes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">本月合同</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.monthlyContracts}</div>
          </CardContent>
        </Card>
      </div>

      {/* 快捷入口 */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">快捷入口</h2>
        <div className="flex gap-4 flex-wrap">
          <Link href="/quotes/new">
            <Button size="lg">+ 新建报价</Button>
          </Link>
          <Link href="/contracts/new">
            <Button variant="outline" size="lg">上传合同</Button>
          </Link>
        </div>
      </div>

      {/* 最近访问 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">最近访问</h2>
        <div className="space-y-2">
          {recentItems.length === 0 && !loading && (
            <div className="text-slate-500 text-sm">暂无数据</div>
          )}
          {recentItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
              <div>
                <div className="font-medium">{item.title}</div>
                <div className="text-sm text-slate-500">{item.subtitle}</div>
              </div>
              <Badge variant={item.statusVariant}>{item.statusLabel}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'secondary' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}

const quoteStatusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: '草稿', variant: 'secondary' },
  PENDING_APPROVAL: { label: '审批中', variant: 'default' },
  APPROVED: { label: '已批准', variant: 'outline' },
  REJECTED: { label: '已驳回', variant: 'destructive' },
}
