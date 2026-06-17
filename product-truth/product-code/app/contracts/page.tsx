'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import type { Contract } from '@/types'

type FilterMode = 'all' | 'failed' | 'running' | 'degraded'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}

const analysisJobStatusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  queued: { label: '已排队', variant: 'secondary' },
  running: { label: '执行中', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  failed: { label: '已失败', variant: 'destructive' },
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  const fetchContracts = useCallback(async (silent: boolean = false) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts?pageSize=100', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (!silent) {
          if (res.status === 401) setError('未登录或登录已过期')
          else setError('获取合同列表失败')
        }
        return
      }

      const data = await res.json()
      setContracts(data.data || [])
      if (!silent) {
        setError('')
      }
    } catch {
      if (!silent) {
        setError('网络错误，请稍后重试')
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void fetchContracts()
  }, [fetchContracts])

  const hasActiveJobs = useMemo(() => (
    contracts.some((contract) => (
      contract.status === 'PARSING'
      || contract.status === 'ANALYZING'
      || contract.latest_analysis_job?.status === 'queued'
      || contract.latest_analysis_job?.status === 'running'
    ))
  ), [contracts])

  useEffect(() => {
    if (!hasActiveJobs) {
      return
    }

    const timer = window.setInterval(() => {
      void fetchContracts(true)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [fetchContracts, hasActiveJobs])

  const summary = useMemo(() => ({
    total: contracts.length,
    failed: contracts.filter((contract) => (
      contract.status === 'FAILED' || contract.latest_analysis_job?.status === 'failed'
    )).length,
    running: contracts.filter((contract) => (
      contract.status === 'PARSING'
      || contract.status === 'ANALYZING'
      || contract.latest_analysis_job?.status === 'queued'
      || contract.latest_analysis_job?.status === 'running'
    )).length,
    degraded: contracts.filter((contract) => contract.latest_analysis_job?.degraded).length,
  }), [contracts])

  const filteredContracts = useMemo(() => {
    switch (filterMode) {
      case 'failed':
        return contracts.filter((contract) => (
          contract.status === 'FAILED' || contract.latest_analysis_job?.status === 'failed'
        ))
      case 'running':
        return contracts.filter((contract) => (
          contract.status === 'PARSING'
          || contract.status === 'ANALYZING'
          || contract.latest_analysis_job?.status === 'queued'
          || contract.latest_analysis_job?.status === 'running'
        ))
      case 'degraded':
        return contracts.filter((contract) => contract.latest_analysis_job?.degraded)
      default:
        return contracts
    }
  }, [contracts, filterMode])

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">合同审核</h1>
        <div className="flex gap-2">
          <Link href="/admin/review-strategies">
            <Button variant="outline" size="sm">审核策略</Button>
          </Link>
          <Link href="/admin/clause-library">
            <Button variant="outline" size="sm">条款库</Button>
          </Link>
          <Link href="/contracts/draft">
            <Button variant="outline" size="sm">起草合同</Button>
          </Link>
          <Link href="/contracts/new">
            <Button>+ 上传合同</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4 mb-6">
        <SummaryCard label="合同总数" value={summary.total} />
        <SummaryCard label="处理中" value={summary.running} tone="default" />
        <SummaryCard label="失败关注" value={summary.failed} tone="destructive" />
        <SummaryCard label="降级结果" value={summary.degraded} tone="outline" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <FilterButton active={filterMode === 'all'} onClick={() => setFilterMode('all')}>
          全部
        </FilterButton>
        <FilterButton active={filterMode === 'running'} onClick={() => setFilterMode('running')}>
          处理中
        </FilterButton>
        <FilterButton active={filterMode === 'failed'} onClick={() => setFilterMode('failed')}>
          失败关注
        </FilterButton>
        <FilterButton active={filterMode === 'degraded'} onClick={() => setFilterMode('degraded')}>
          降级结果
        </FilterButton>
        {hasActiveJobs && (
          <span className="text-sm text-slate-500">列表每 5 秒自动刷新一次。</span>
        )}
      </div>

      {error && (
        <Card className="mb-6 border-red-200">
          <CardContent className="py-4">
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-slate-500">加载中...</div>
      ) : filteredContracts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">
              {contracts.length === 0 ? '暂无合同' : '当前筛选条件下没有合同'}
            </p>
            {contracts.length === 0 && (
              <Link href="/contracts/new">
                <Button>+ 上传合同</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>合同列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-sm text-slate-500">
                    <th className="text-left py-3 px-4">文件名</th>
                    <th className="text-left py-3 px-4">上传时间</th>
                    <th className="text-left py-3 px-4">大小</th>
                    <th className="text-left py-3 px-4">状态</th>
                    <th className="text-left py-3 px-4">任务</th>
                    <th className="text-left py-3 px-4">最近异常</th>
                    <th className="text-left py-3 px-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContracts.map((contract) => (
                    <tr key={contract.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4">{contract.filename}</td>
                      <td className="py-3 px-4 text-sm text-slate-500">
                        {new Date(contract.created_at).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-500">
                        {(contract.size / 1024 / 1024).toFixed(2)} MB
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={statusMap[contract.status]?.variant || 'default'}>
                          {statusMap[contract.status]?.label || contract.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        {contract.latest_analysis_job ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={analysisJobStatusMap[contract.latest_analysis_job.status]?.variant || 'default'}>
                              {analysisJobStatusMap[contract.latest_analysis_job.status]?.label || contract.latest_analysis_job.status}
                            </Badge>
                            <span className="text-xs text-slate-500">
                              尝试 {contract.latest_analysis_job.attempts}
                            </span>
                            {contract.latest_analysis_job.degraded && (
                              <Badge variant="outline">降级</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">暂无任务</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-500 max-w-xs">
                        {contract.latest_analysis_job?.last_error ? (
                          <span className="line-clamp-2">{contract.latest_analysis_job.last_error}</span>
                        ) : (
                          <span className="text-slate-400">无</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Link href={`/contracts/${contract.id}`} className="text-blue-600 hover:underline text-sm">
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone = 'secondary',
}: {
  label: string
  value: number
  tone?: 'default' | 'secondary' | 'outline' | 'destructive'
}) {
  return (
    <div className="rounded-md border bg-background px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <Badge variant={tone}>{value}</Badge>
      </div>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button variant={active ? 'default' : 'outline'} size="sm" onClick={onClick}>
      {children}
    </Button>
  )
}
