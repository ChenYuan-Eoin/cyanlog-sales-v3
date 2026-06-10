// REQ:F005
// PURPOSE: Contract detail page - display contract info, AI review results, and ASK list

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import type { Contract, ContractAnalysisJob } from '@/types'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}

interface Risk {
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
}

const riskLevelMap: Record<string, { label: string; className: string }> = {
  red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
  yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
}

const analysisJobStatusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  queued: { label: '已排队', variant: 'secondary' },
  running: { label: '执行中', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  failed: { label: '已失败', variant: 'destructive' },
}

// ASK 类型
interface AskItem {
  id: string
  ask_code: string
  clause_ref: string | null
  risk_name: string
  initial_level: 'red' | 'yellow' | 'green'
  question_type: string
  required_roles: string[]
  question_text: string
  qualified_std: string
  status: 'pending' | 'responded' | 'closed'
  trigger_user_id: string
  response_id: string | null
  closed_by: string | null
  closed_reason: string | null
  created_at: string
  updated_at: string
  response?: {
    responder_name: string
    responder_role: string
    response_text: string
    created_at: string
  }
}

export default function ContractDetailPage() {
  const params = useParams()
  const [contract, setContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [actionError, setActionError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [askItems, setAskItems] = useState<AskItem[]>([])
  const [askLoading, setAskLoading] = useState(false)

  const contractId = params.id as string

  const fetchContract = useCallback(async (silent: boolean = false) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (!silent) {
          if (res.status === 404) setPageError('合同不存在')
          else if (res.status === 401) setPageError('未登录或登录已过期')
          else setPageError('获取合同失败')
        }
        return
      }

      const data = await res.json()
      setContract(data)
      if (!silent) {
        setPageError('')
      }
    } catch {
      if (!silent) {
        setPageError('网络错误，请稍后重试')
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [contractId])

  useEffect(() => {
    void fetchContract()
  }, [fetchContract])

  useEffect(() => {
    if (!contract || (contract.status !== 'PARSING' && contract.status !== 'ANALYZING')) {
      return
    }

    const timer = window.setInterval(() => {
      void fetchContract(true)
    }, 3000)

    return () => window.clearInterval(timer)
  }, [contract, fetchContract])

  async function handleAnalyze() {
    if (!contract) return
    setAnalyzing(true)
    setActionError('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/analyze`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      const data = await res.json()

      if (!res.ok) {
        setActionError(data.error || '启动审核失败')
        setAnalyzing(false)
        return
      }

      if (data.message) {
        setActionError('')
      }

      await fetchContract()
    } catch {
      setActionError('网络错误，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleExport() {
    if (!contract) return
    setExporting(true)
    setActionError('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/export`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const data = await res.json()
        setActionError(data.error || '导出失败')
        setExporting(false)
        return
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${contract.filename}-审核结果.docx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {
      setActionError('网络错误，导出失败')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  if (pageError) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-red-600 mb-4">{pageError}</p>
            <Link href="/contracts">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">合同不存在</p>
            <Link href="/contracts">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const latestReview = contract.contract_reviews?.[0]
  const latestJob = contract.latest_analysis_job
  const isAnalyzing = contract.status === 'PARSING' || contract.status === 'ANALYZING'
  const canAnalyze = contract.status === 'PENDING' || contract.status === 'FAILED'

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/contracts" className="hover:underline">合同审核</Link>
            <span className="mx-2">/</span>
            <span>详情</span>
          </div>
          <h1 className="text-2xl font-bold">{contract.filename}</h1>
        </div>
        <Link href="/contracts">
          <Button variant="outline">返回列表</Button>
        </Link>
      </div>

      {actionError && (
        <Card className="mb-6 border-red-200">
          <CardContent className="py-4">
            <p className="text-sm text-red-600">{actionError}</p>
          </CardContent>
        </Card>
      )}

      {/* Basic Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">状态：</span>
              <Badge variant={statusMap[contract.status]?.variant || 'default'}>
                {statusMap[contract.status]?.label || contract.status}
              </Badge>
            </div>
            <div>
              <span className="text-slate-500">大小：</span>
              <span>{(contract.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <div>
              <span className="text-slate-500">类型：</span>
              <span>{contract.mime_type}</span>
            </div>
            <div>
              <span className="text-slate-500">上传时间：</span>
              <span>{new Date(contract.created_at).toLocaleString('zh-CN')}</span>
            </div>
          </div>

          {canAnalyze && (
            <div className="mt-6 pt-4 border-t">
              <Button onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? '启动中...' : '开始AI审核'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {latestJob && (
        <AnalysisJobCard job={latestJob} isPolling={isAnalyzing} />
      )}

      {/* Analyzing State */}
      {isAnalyzing && (
        <Card className="mb-6">
          <CardContent className="py-8 text-center">
            <div className="animate-pulse">
              <p className="text-slate-500">AI 正在审核合同中...</p>
              <p className="text-sm text-slate-400 mt-2">状态会自动刷新；失败会记录到任务和错误日志。</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs for Review Results and ASK List */}
      <Card>
        <CardHeader>
          <Tabs defaultValue="review">
            <TabsList variant="line">
              <TabsTrigger value="review">审核结果</TabsTrigger>
              <TabsTrigger value="ask">ASK 清单</TabsTrigger>
            </TabsList>
            <TabsContent value="review" className="pt-4">
              <ReviewResultsTab
                contract={contract}
                latestReview={latestReview}
                exporting={exporting}
                handleExport={handleExport}
              />
            </TabsContent>
            <TabsContent value="ask" className="pt-4">
              <AskListTab
                contractId={contractId}
                askItems={askItems}
                setAskItems={setAskItems}
                askLoading={askLoading}
                setAskLoading={setAskLoading}
              />
            </TabsContent>
          </Tabs>
        </CardHeader>
      </Card>

      {/* Failed State */}
      {contract.status === 'FAILED' && (
        <Card className="mt-6">
          <CardContent className="py-8 text-center">
            <p className="text-red-600 mb-2">审核失败</p>
            <p className="text-sm text-slate-500">请稍后重试，或联系管理员</p>
            {canAnalyze && (
              <Button onClick={handleAnalyze} disabled={analyzing} className="mt-4">
                {analyzing ? '重试中...' : '重新审核'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function AnalysisJobCard({
  job,
  isPolling,
}: {
  job: ContractAnalysisJob
  isPolling: boolean
}) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">审核任务</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500">任务状态：</span>
            <Badge variant={analysisJobStatusMap[job.status]?.variant || 'default'}>
              {analysisJobStatusMap[job.status]?.label || job.status}
            </Badge>
          </div>
          <div>
            <span className="text-slate-500">尝试次数：</span>
            <span>{job.attempts}</span>
          </div>
          <div>
            <span className="text-slate-500">执行器：</span>
            <span>{job.provider || '未记录'}</span>
          </div>
          <div>
            <span className="text-slate-500">最后更新：</span>
            <span>{new Date(job.updated_at).toLocaleString('zh-CN')}</span>
          </div>
        </div>

        {job.degraded && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            当前结果来自降级路径，建议人工复核。
          </div>
        )}

        {job.last_error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            最近错误：{job.last_error}
          </div>
        )}

        {isPolling && (
          <p className="mt-4 text-sm text-slate-500">
            详情页每 3 秒自动刷新一次任务状态。
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Review Results Tab
function ReviewResultsTab({
  contract,
  latestReview,
  exporting,
  handleExport,
}: {
  contract: Contract
  latestReview: {
    results: {
      summary: string
      risks: Risk[]
    }
  } | null | undefined
  exporting: boolean
  handleExport: () => void
}) {
  if (contract.status !== 'COMPLETED' || !latestReview?.results) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500">暂无审核结果</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <CardTitle className="text-base">AI 审核结果</CardTitle>
        <Button onClick={handleExport} disabled={exporting} variant="outline" size="sm">
          {exporting ? '导出中...' : '导出Word'}
        </Button>
      </div>

      <div className="p-4 bg-slate-50 rounded-lg mb-6">
        <p className="text-sm">{latestReview.results.summary}</p>
      </div>

      {latestReview.results.risks.length > 0 ? (
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-slate-700">
            发现问题 ({latestReview.results.risks.length})
          </h4>
          {latestReview.results.risks.map((risk: Risk, index: number) => (
            <div
              key={index}
              className={`p-4 rounded-lg border ${riskLevelMap[risk.level]?.className || 'bg-slate-50'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs">
                  {riskLevelMap[risk.level]?.label || risk.level}
                </Badge>
                <span className="font-medium">{risk.title}</span>
              </div>
              <p className="text-sm mb-2">{risk.description}</p>
              <p className="text-sm text-slate-600">
                <span className="font-medium">建议：</span>
                {risk.suggestion}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-green-600">✓ 未发现明显风险</p>
        </div>
      )}
    </div>
  )
}

// ASK List Tab
function AskListTab({
  contractId,
  askItems,
  setAskItems,
  askLoading,
  setAskLoading,
}: {
  contractId: string
  askItems: AskItem[]
  setAskItems: (items: AskItem[]) => void
  askLoading: boolean
  setAskLoading: (loading: boolean) => void
}) {
  const [responding, setResponding] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')

  useEffect(() => {
    fetchAskItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId])

  async function fetchAskItems() {
    setAskLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/asks`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (res.ok) {
        const data = await res.json()
        setAskItems(data.data?.items || [])
      }
    } catch {
      // silently fail
    } finally {
      setAskLoading(false)
    }
  }

  async function handleGenerateAsk() {
    setAskLoading(true)
    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/contracts/${contractId}/asks/generate`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      await fetchAskItems()
    } catch {
      // silently fail
    } finally {
      setAskLoading(false)
    }
  }

  async function handleSubmitResponse(askId: string) {
    if (!responseText.trim()) return

    try {
      const token = localStorage.getItem('token')
      await fetch(`/api/asks/${askId}/responses`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ response_text: responseText }),
      })
      setResponseText('')
      setResponding(null)
      await fetchAskItems()
    } catch {
      // silently fail
    }
  }

  if (askLoading) {
    return <div className="text-center py-8 text-slate-500">加载 ASK 清单...</div>
  }

  if (askItems.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500 mb-4">该合同尚未生成 ASK 清单</p>
        <Button onClick={handleGenerateAsk} variant="outline" size="sm">
          生成 ASK 清单
        </Button>
      </div>
    )
  }

  const pendingCount = askItems.filter((a) => a.status === 'pending').length
  const respondedCount = askItems.filter((a) => a.status === 'responded').length
  const closedCount = askItems.filter((a) => a.status === 'closed').length

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <span className="text-slate-500">ASK 统计：</span>
        <Badge variant="secondary">总计: {askItems.length}</Badge>
        <Badge variant="outline" className="text-yellow-700">待回应: {pendingCount}</Badge>
        <Badge variant="outline" className="text-green-700">已回应: {respondedCount}</Badge>
        <Badge variant="outline" className="text-slate-700">已关闭: {closedCount}</Badge>
      </div>

      {/* ASK Items */}
      <div className="space-y-3">
        {askItems.map((ask) => (
          <div
            key={ask.id}
            className={`p-4 rounded-lg border ${
              ask.status === 'pending'
                ? 'bg-yellow-50 border-yellow-200'
                : ask.status === 'responded'
                ? 'bg-green-50 border-green-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{ask.ask_code}</span>
                <Badge variant="outline" className="text-xs">
                  {ask.initial_level === 'red' ? '红灯' : ask.initial_level === 'yellow' ? '黄灯' : '绿灯'}
                </Badge>
                <span className="font-medium text-sm">{ask.risk_name}</span>
              </div>
              <Badge
                variant={
                  ask.status === 'pending'
                    ? 'secondary'
                    : ask.status === 'responded'
                    ? 'outline'
                    : 'default'
                }
                className="text-xs"
              >
                {ask.status === 'pending' ? '待回应' : ask.status === 'responded' ? '已回应' : '已关闭'}
              </Badge>
            </div>

            {ask.clause_ref && (
              <p className="text-xs text-slate-500 mb-1">{ask.clause_ref}</p>
            )}

            <p className="text-sm mb-2">{ask.question_text}</p>

            {/* Response */}
            {ask.status === 'responded' && ask.response && (
              <div className="mt-3 p-3 bg-white rounded border border-green-200">
                <p className="text-sm text-green-800">
                  <span className="font-medium">
                    {ask.response.responder_name} ({ask.response.responder_role}):
                  </span>{' '}
                  {ask.response.response_text}
                </p>
              </div>
            )}

            {ask.status === 'closed' && ask.closed_reason && (
              <div className="mt-3 p-3 bg-white rounded border border-slate-200">
                <p className="text-sm text-slate-600">
                  <span className="font-medium">关闭原因：</span>
                  {ask.closed_reason}
                </p>
              </div>
            )}

            {/* Actions */}
            {ask.status === 'pending' && (
              <div className="mt-3 flex gap-2">
                {responding === ask.id ? (
                  <div className="flex-1">
                    <textarea
                      className="w-full p-2 text-sm border rounded-lg mb-2 resize-y"
                      rows={3}
                      placeholder="输入回应..."
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSubmitResponse(ask.id)}
                        disabled={!responseText.trim()}
                      >
                        提交回应
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setResponding(null)
                          setResponseText('')
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setResponding(ask.id)}
                  >
                    录入回应
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
