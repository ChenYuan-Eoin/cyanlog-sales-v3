'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ArrowLeftIcon,
  GitBranchIcon,
  RocketIcon,
  RotateCcwIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  BarChart3Icon,
  ChevronRightIcon,
} from 'lucide-react'
import { handleError, error } from '@/lib/toast'

interface Version {
  id: string
  version: number
  status: 'draft' | 'published' | 'rolled_back'
  config_snapshot: Record<string, unknown>
  released_by?: string
  released_at?: string
  release_note?: string
  is_gray_release: boolean
  gray_end_at?: string
  created_at: string
  impact_report?: {
    affected_contracts: number
    pass_rate_change: number
    risk_level_change: {
      red: number
      yellow: number
      green: number
    }
    report_content: string
  } | null
}

interface Rule {
  id: string
  code: string
  name: string
  version: number
  is_active: boolean
}

export default function RuleVersionsPage() {
  const params = useParams()
  const ruleId = params.id as string

  const [rule, setRule] = useState<Rule | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [rollingBackId, setRollingBackId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contract-policies/rules/${ruleId}/versions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setRule(data.data.rule)
        setVersions(data.data.versions || [])
      }
    } catch (err) {
      handleError(err, '加载版本数据失败')
    } finally {
      setLoading(false)
    }
  }, [ruleId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handlePublish = useCallback(
    async (versionId: string, grayRelease = false) => {
      setPublishingId(versionId)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(
          `/api/contract-policies/rules/${ruleId}/versions/${versionId}/publish`,
          {
            method: 'POST',
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ gray_release: grayRelease }),
          }
        )
        if (res.ok) {
          await fetchData()
        }
      } catch {
        error('发布失败')
      } finally {
        setPublishingId(null)
      }
    },
    [ruleId, fetchData]
  )

  const handleRollback = useCallback(
    async (versionId: string) => {
      if (!confirm('确定要回滚到此版本吗？')) return
      setRollingBackId(versionId)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(
          `/api/contract-policies/rules/${ruleId}/versions/${versionId}/rollback`,
          {
            method: 'POST',
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reason: '用户手动回滚' }),
          }
        )
        if (res.ok) {
          await fetchData()
        }
      } catch {
        error('回滚失败')
      } finally {
        setRollingBackId(null)
      }
    },
    [ruleId, fetchData]
  )

  const currentPublished = versions.find((v) => v.status === 'published')

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1480px] px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/contract-policies">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <GitBranchIcon className="h-5 w-5 text-indigo-500" />
                <h1 className="text-2xl font-bold text-slate-900">版本管理</h1>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {rule?.code} · {rule?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-indigo-50 border-indigo-200">
              当前版本: v{currentPublished?.version || rule?.version || 1}
            </Badge>
            <Link href={`/admin/contract-policies/rules/${ruleId}`}>
              <Button variant="outline" size="sm">
                编辑规则
                <ChevronRightIcon className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>

        {/* 灰度/发布状态卡片 */}
        {currentPublished?.is_gray_release && (
          <Card className="mb-6 border-amber-200 bg-amber-50/50">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <AlertCircleIcon className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="font-medium text-amber-900">灰度发布中</p>
                  <p className="text-sm text-amber-700">
                    版本 v{currentPublished.version} 正在灰度测试，预计结束时间:{' '}
                    {currentPublished.gray_end_at
                      ? new Date(currentPublished.gray_end_at).toLocaleDateString('zh-CN')
                      : '未设置'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 版本列表 */}
        <div className="space-y-4">
          {versions.map((version, index) => {
            const isPublished = version.status === 'published'
            const isRolledBack = version.status === 'rolled_back'
            const isLatest = index === 0

            return (
              <Card
                key={version.id}
                className={`overflow-hidden ${
                  isPublished ? 'border-indigo-200 ring-1 ring-indigo-100' : ''
                } ${isRolledBack ? 'opacity-60' : ''}`}
              >
                <CardHeader className="bg-slate-50/50 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${
                          isPublished
                            ? 'bg-indigo-100 text-indigo-700'
                            : isRolledBack
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        v{version.version}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">
                            {isPublished
                              ? '当前生效版本'
                              : isRolledBack
                                ? '已回滚版本'
                                : isLatest
                                  ? '最新草稿'
                                  : `历史版本 v${version.version}`}
                          </CardTitle>
                          {isPublished && (
                            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">
                              <CheckCircleIcon className="h-3 w-3 mr-1" />
                              已发布
                            </Badge>
                          )}
                          {version.is_gray_release && (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                              灰度
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          创建于{' '}
                          {new Date(version.created_at).toLocaleDateString('zh-CN')}
                          {version.released_at && (
                            <>
                              {' · 发布于 '}
                              {new Date(version.released_at).toLocaleDateString(
                                'zh-CN'
                              )}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isPublished && !isRolledBack && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePublish(version.id, true)}
                            disabled={publishingId === version.id}
                          >
                            <ClockIcon className="h-4 w-4 mr-1" />
                            灰度发布
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handlePublish(version.id, false)}
                            disabled={publishingId === version.id}
                          >
                            <RocketIcon className="h-4 w-4 mr-1" />
                            {publishingId === version.id ? '发布中...' : '全量发布'}
                          </Button>
                        </>
                      )}
                      {!isPublished && isRolledBack && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRollback(version.id)}
                          disabled={rollingBackId === version.id}
                        >
                          <RotateCcwIcon className="h-4 w-4 mr-1" />
                          {rollingBackId === version.id ? '回滚中...' : '回滚至此'}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="py-4">
                  <div className="grid grid-cols-2 gap-6">
                    {/* 配置快照 */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase mb-2">
                        配置快照
                      </p>
                      <pre className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 overflow-auto max-h-40">
                        {JSON.stringify(version.config_snapshot, null, 2)}
                      </pre>
                    </div>

                    {/* 影响分析 */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase mb-2">
                        影响分析
                      </p>
                      {version.impact_report ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-50 rounded-lg p-3">
                              <p className="text-xs text-slate-500">影响合同数</p>
                              <p className="text-lg font-bold text-slate-900">
                                {version.impact_report.affected_contracts}
                              </p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-3">
                              <p className="text-xs text-slate-500">通过率变化</p>
                              <p
                                className={`text-lg font-bold ${
                                  version.impact_report.pass_rate_change >= 0
                                    ? 'text-emerald-600'
                                    : 'text-rose-600'
                                }`}
                              >
                                {version.impact_report.pass_rate_change >= 0 ? '+' : ''}
                                {version.impact_report.pass_rate_change}%
                              </p>
                            </div>
                          </div>
                          <div className="bg-slate-50 rounded-lg p-3">
                            <p className="text-xs text-slate-500 mb-2">风险分布</p>
                            <div className="flex gap-2">
                              <Badge
                                variant="outline"
                                className="bg-red-50 border-red-200 text-red-700"
                              >
                                红: {version.impact_report.risk_level_change.red}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="bg-amber-50 border-amber-200 text-amber-700"
                              >
                                黄: {version.impact_report.risk_level_change.yellow}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="bg-green-50 border-green-200 text-green-700"
                              >
                                绿: {version.impact_report.risk_level_change.green}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600">
                            {version.impact_report.report_content}
                          </p>
                        </div>
                      ) : (
                        <div className="bg-slate-50 rounded-lg p-6 text-center">
                          <BarChart3Icon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">
                            {isPublished
                              ? '暂无影响分析数据'
                              : '发布后生成影响分析'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {versions.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <GitBranchIcon className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500">暂无版本历史</p>
                <p className="text-sm text-slate-400 mt-1">编辑规则后将自动创建首个版本</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
