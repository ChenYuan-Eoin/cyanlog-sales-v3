// REQ:F005
// PURPOSE: Contract detail page - display contract info, AI review results, and ASK list

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import Link from 'next/link'
import type { Contract, ContractAnalysisJob } from '@/types'
import { error as toastError, success as toastSuccess } from '@/lib/toast'

// 扩展 Contract 类型，包含业务字段
interface ContractWithDetails extends Contract {
  contract_no?: string
  contract_amount?: number
  party_a_name?: string
  party_b_name?: string
  quote_id?: string
  owner_name?: string
}

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function asNumber(value: unknown, fallback = 0): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRiskSummary(value: unknown) {
  const source = isRecord(value) ? value : {}
  return {
    total_clauses: asNumber(source.total_clauses),
    critical_risks: asNumber(source.critical_risks),
    high_risks: asNumber(source.high_risks),
    medium_risks: asNumber(source.medium_risks),
    low_risks: asNumber(source.low_risks),
    compliance_score: asNumber(source.compliance_score),
    strategy_code: typeof source.strategy_code === 'string' ? source.strategy_code : undefined,
  }
}

function normalizeComplianceCheck(value: unknown) {
  const source = isRecord(value) ? value : {}
  return {
    missing_required_clauses: asStringArray(source.missing_required_clauses),
    dangerous_clauses: asStringArray(source.dangerous_clauses),
    ambiguous_clauses: asStringArray(source.ambiguous_clauses),
    unbalanced_clauses: asStringArray(source.unbalanced_clauses),
    party_a_consistency: typeof source.party_a_consistency === 'string' ? source.party_a_consistency : 'unknown',
    party_b_consistency: typeof source.party_b_consistency === 'string' ? source.party_b_consistency : 'unknown',
    issues: asStringArray(source.issues),
  }
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
  const [contract, setContract] = useState<ContractWithDetails | null>(null)
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

  // 用指定策略重新审核
  async function handleReAnalyze(strategyCode: string) {
    if (!contract) return
    setAnalyzing(true)
    setActionError('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/analyze`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ strategy: strategyCode }),
      })

      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '重新审核失败')
        return
      }

      await fetchContract()
    } catch {
      setActionError('网络错误')
    } finally {
      setAnalyzing(false)
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
        <div className="flex items-center gap-3">
          <Link href={`/contracts/${contractId}/compare-standard`}>
            <Button variant="outline" size="sm">标准合同对照</Button>
          </Link>
          <Link href="/contracts">
            <Button variant="outline">返回列表</Button>
          </Link>
        </div>
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">基本信息</CardTitle>
          <Link href={`/contracts/${contractId}/edit`}>
            <Button variant="outline" size="sm">编辑</Button>
          </Link>
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
            {contract.contract_no && (
              <div>
                <span className="text-slate-500">合同编号：</span>
                <span>{contract.contract_no}</span>
              </div>
            )}
            {contract.party_b_name && (
              <div>
                <span className="text-slate-500">乙方：</span>
                <span>{contract.party_b_name}</span>
              </div>
            )}
            {(contract.contract_amount ?? 0) > 0 && (
              <div>
                <span className="text-slate-500">合同金额：</span>
                <span>¥{contract.contract_amount?.toLocaleString()}</span>
              </div>
            )}
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

      {/* 报价章节（如果引用了报价） */}
      {contract.quote_id && (
        <QuoteSection contractId={contractId} quoteId={contract.quote_id} />
      )}

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

      {/* 报告三表 Tab */}
      <Card>
        <CardHeader>
          <Tabs defaultValue="preview">
            <TabsList variant="line">
              <TabsTrigger value="preview">表一 · 预览</TabsTrigger>
              <TabsTrigger value="clarify">表二 · 澄清</TabsTrigger>
              <TabsTrigger value="summary">表三 · 摘要</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="pt-4">
              <PreviewTableTab
                contract={contract}
                latestReview={latestReview}
                exporting={exporting}
                handleExport={handleExport}
                onReAnalyze={handleReAnalyze}
                contractId={contractId}
              />
            </TabsContent>
            <TabsContent value="clarify" className="pt-4">
              <ClarifyTableTab
                contractId={contractId}
                askItems={askItems}
                setAskItems={setAskItems}
                askLoading={askLoading}
                setAskLoading={setAskLoading}
              />
            </TabsContent>
            <TabsContent value="summary" className="pt-4">
              <SummaryTableTab
                contract={contract}
                latestReview={latestReview}
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

// Review Results Tab - iTerms 风格：风险统计 + 策略 + 条款 + 效力分析
// 表一·预览 — 风险统计 + 条款列表 + AI风险点
function PreviewTableTab({
  contract,
  latestReview,
  exporting,
  handleExport,
  onReAnalyze,
  contractId,
}: {
  contract: Contract
  latestReview: {
    results: {
      summary: string
      risks: Risk[]
    }
    risk_summary?: {
      total_clauses: number
      critical_risks: number
      high_risks: number
      medium_risks: number
      low_risks: number
      compliance_score: number
      strategy_code?: string
    }
    compliance_check?: {
      missing_required_clauses: string[]
      dangerous_clauses: string[]
      ambiguous_clauses: string[]
      unbalanced_clauses: string[]
      party_a_consistency: string
      party_b_consistency: string
      issues: string[]
    }
    effectiveness_analysis?: string
    report_version?: number
  } | null | undefined
  exporting: boolean
  handleExport: () => void
  onReAnalyze: (strategyCode: string) => Promise<void>
  contractId: string
}) {
  const [selectedStrategy, setSelectedStrategy] = useState<string>(
    latestReview?.risk_summary?.strategy_code || 'BALANCED'
  )
  const [strategies, setStrategies] = useState<Array<{ id: string; code: string; name: string; description: string | null; risk_threshold: number }>>([])
  const [clauses, setClauses] = useState<Array<{
    id: string
    clause_number: string | null
    clause_title: string | null
    clause_text: string
    risk_level: string
    risk_category: string | null
    risk_description: string | null
    legal_basis: string | null
    suggestion: string | null
  }>>([])
  const [reAnalyzing, setReAnalyzing] = useState(false)

  // 加载策略列表
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/review-strategies')
        if (res.ok) {
          const data = await res.json()
          setStrategies(data.data?.strategies || [])
        }
      } catch {
        toastError('加载审核策略失败')
      }
    })()
  }, [])

  // 加载条款列表
  useEffect(() => {
    if (contract.status !== 'COMPLETED') return
    void (async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/contracts/${contractId}/clauses`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setClauses(data.data?.clauses || [])
        }
      } catch {
        toastError('加载合同条款失败')
      }
    })()
  }, [contractId, contract.status])

  if (contract.status !== 'COMPLETED' || !latestReview?.results) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500">暂无审核结果</p>
      </div>
    )
  }

  const risk = normalizeRiskSummary(latestReview.risk_summary)
  const compliance = normalizeComplianceCheck(latestReview.compliance_check)
  const reviewRisks = Array.isArray(latestReview.results.risks) ? latestReview.results.risks : []
  const reviewSummary = typeof latestReview.results.summary === 'string'
    ? latestReview.results.summary
    : '暂无审核摘要'

  async function handleStrategyChange(code: string) {
    setSelectedStrategy(code)
    setReAnalyzing(true)
    try {
      await onReAnalyze(code)
    } finally {
      setReAnalyzing(false)
    }
  }

  const scoreColor = risk.compliance_score >= 80 ? 'text-green-600' : risk.compliance_score >= 60 ? 'text-yellow-600' : 'text-red-600'
  const scoreBg = risk.compliance_score >= 80 ? 'bg-green-50 border-green-200' : risk.compliance_score >= 60 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'

  return (
    <div className="space-y-6">
      {/* 1. 风险统计卡片（iTerms 风格顶部） */}
      <div className="grid grid-cols-4 gap-3">
        <div className={`p-4 rounded-lg border ${scoreBg}`}>
          <div className="text-xs text-slate-500">综合评分</div>
          <div className={`text-2xl font-bold ${scoreColor}`}>{risk.compliance_score}</div>
          <div className="text-xs text-slate-500 mt-1">/ 100</div>
        </div>
        <div className="p-4 rounded-lg border border-red-200 bg-red-50">
          <div className="text-xs text-slate-500">严重风险</div>
          <div className="text-2xl font-bold text-red-600">{risk.critical_risks}</div>
        </div>
        <div className="p-4 rounded-lg border border-orange-200 bg-orange-50">
          <div className="text-xs text-slate-500">高风险</div>
          <div className="text-2xl font-bold text-orange-600">{risk.high_risks}</div>
        </div>
        <div className="p-4 rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="text-xs text-slate-500">中风险</div>
          <div className="text-2xl font-bold text-yellow-600">{risk.medium_risks}</div>
        </div>
      </div>

      {/* 2. 审核策略选择器 */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">审核策略</div>
              <div className="flex gap-2">
                {strategies.length > 0 ? strategies.map(s => (
                  <Button
                    key={s.code}
                    size="sm"
                    variant={selectedStrategy === s.code ? 'default' : 'outline'}
                    onClick={() => void handleStrategyChange(s.code)}
                    disabled={reAnalyzing}
                    title={s.description || ''}
                  >
                    {s.name}
                  </Button>
                )) : (
                  <>
                    <Button size="sm" variant={selectedStrategy === 'AGGRESSIVE' ? 'default' : 'outline'} disabled>强势</Button>
                    <Button size="sm" variant={selectedStrategy === 'BALANCED' ? 'default' : 'outline'} disabled>平衡</Button>
                    <Button size="sm" variant={selectedStrategy === 'CONSERVATIVE' ? 'default' : 'outline'} disabled>弱势</Button>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {strategies.find(s => s.code === selectedStrategy)?.description || '选择不同的审核立场，重新分析合同风险'}
              </p>
            </div>
            <Button onClick={handleExport} disabled={exporting} variant="outline" size="sm">
              {exporting ? '导出中...' : '导出 Word（含批注）'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 3. 综合分析（效力 + 解释） */}
      {latestReview.effectiveness_analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">效力与风险分析</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              {latestReview.effectiveness_analysis.split('\n').map((line, i) => {
                if (line.startsWith('## ')) {
                  return <h3 key={i} className="text-lg font-semibold mt-3 mb-2">{line.slice(3)}</h3>
                }
                if (line.startsWith('### ')) {
                  return <h4 key={i} className="text-base font-semibold mt-3 mb-1">{line.slice(4)}</h4>
                }
                if (line.startsWith('- ')) {
                  return <li key={i} className="ml-4 list-disc text-sm">{line.slice(2)}</li>
                }
                if (line.trim() === '') return <br key={i} />
                return <p key={i} className="text-sm my-1">{line}</p>
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. 合规检查（关联方一致性、必备条款） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">合规性检查</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-slate-500 mb-1">甲方信息一致性</div>
              <Badge variant={compliance.party_a_consistency === 'consistent' ? 'outline' : 'destructive'}>
                {compliance.party_a_consistency === 'consistent' ? '一致' : compliance.party_a_consistency === 'inconsistent' ? '存在冲突' : '未知'}
              </Badge>
            </div>
            <div>
              <div className="text-slate-500 mb-1">乙方信息一致性</div>
              <Badge variant={compliance.party_b_consistency === 'consistent' ? 'outline' : 'destructive'}>
                {compliance.party_b_consistency === 'consistent' ? '一致' : compliance.party_b_consistency === 'inconsistent' ? '存在冲突' : '未知'}
              </Badge>
            </div>
            <div>
              <div className="text-slate-500 mb-1">缺失必备条款</div>
              <Badge variant={compliance.missing_required_clauses.length === 0 ? 'outline' : 'destructive'}>
                {compliance.missing_required_clauses.length} 项
              </Badge>
            </div>
            <div>
              <div className="text-slate-500 mb-1">高风险条款</div>
              <Badge variant={compliance.dangerous_clauses.length === 0 ? 'outline' : 'destructive'}>
                {compliance.dangerous_clauses.length} 项
              </Badge>
            </div>
            <div>
              <div className="text-slate-500 mb-1">模糊用语条款</div>
              <Badge variant={compliance.ambiguous_clauses.length === 0 ? 'outline' : 'secondary'}>
                {compliance.ambiguous_clauses.length} 项
              </Badge>
            </div>
          </div>

          {(compliance.missing_required_clauses.length > 0 ||
            compliance.dangerous_clauses.length > 0 ||
            compliance.ambiguous_clauses.length > 0 ||
            compliance.issues.length > 0) && (
            <div className="mt-4 pt-4 border-t space-y-2">
              {compliance.missing_required_clauses.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-orange-700 mb-1">缺失必备条款</div>
                  <ul className="text-sm text-slate-600 space-y-1">
                    {compliance.missing_required_clauses.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-orange-500">●</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {compliance.dangerous_clauses.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-red-700 mb-1">高风险条款</div>
                  <ul className="text-sm text-slate-600 space-y-1">
                    {compliance.dangerous_clauses.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-red-500">●</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {compliance.issues.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-amber-700 mb-1">其他问题</div>
                  <ul className="text-sm text-slate-600 space-y-1">
                    {compliance.issues.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-500">●</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. 提取的合同条款（按条款定位风险） */}
      {clauses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              提取条款（{clauses.length} 条）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {clauses.slice(0, 20).map((clause, i) => (
                <div
                  key={clause.id || i}
                  className={`p-3 rounded-lg border ${
                    clause.risk_level === 'critical' || clause.risk_level === 'high'
                      ? 'border-red-200 bg-red-50'
                      : clause.risk_level === 'medium'
                      ? 'border-yellow-200 bg-yellow-50'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {clause.clause_number && (
                      <span className="text-sm font-medium text-slate-700">
                        第{clause.clause_number}条
                      </span>
                    )}
                    {clause.clause_title && (
                      <span className="text-sm text-slate-600">· {clause.clause_title}</span>
                    )}
                    {clause.risk_level && clause.risk_level !== 'low' && (
                      <Badge variant="destructive" className="text-xs">
                        {clause.risk_level === 'critical' ? '严重' : clause.risk_level === 'high' ? '高风险' : '中风险'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-2 mb-1">
                    {clause.clause_text}
                  </p>
                  {clause.suggestion && (
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="font-medium">建议：</span>{clause.suggestion}
                    </p>
                  )}
                </div>
              ))}
              {clauses.length > 20 && (
                <p className="text-xs text-center text-slate-500">
                  还有 {clauses.length - 20} 条条款...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. AI 原始风险列表（兼容老数据） */}
      {reviewRisks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 风险点（{reviewRisks.length} 项）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-slate-50 rounded-lg mb-4">
              <p className="text-sm">{reviewSummary}</p>
            </div>
            <div className="space-y-3">
              {reviewRisks.map((risk, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${riskLevelMap[risk.level]?.className || 'bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">
                      {riskLevelMap[risk.level]?.label || risk.level}
                    </Badge>
                    <span className="font-medium text-sm">{risk.title}</span>
                  </div>
                  <p className="text-sm mb-2">{risk.description}</p>
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">建议：</span>{risk.suggestion}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ASK List Tab
// 表二·澄清 — ASK清单（法务录入回应）
function ClarifyTableTab({
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
  const [closing, setClosing] = useState<string | null>(null)
  const [closeReason, setCloseReason] = useState('')

  async function readApiMessage(res: Response, fallback: string) {
    const data = await res.json().catch(() => null)
    return data?.error?.message || data?.message || data?.error || fallback
  }

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
      } else {
        toastError(await readApiMessage(res, '获取 ASK 清单失败'))
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '获取 ASK 清单失败')
    } finally {
      setAskLoading(false)
    }
  }

  async function handleGenerateAsk() {
    setAskLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/asks/generate`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        toastError(await readApiMessage(res, '生成 ASK 清单失败'))
        return
      }
      toastSuccess('ASK 清单已生成')
      await fetchAskItems()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '生成 ASK 清单失败')
    } finally {
      setAskLoading(false)
    }
  }

  async function handleSubmitResponse(askId: string) {
    if (!responseText.trim()) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/asks/${askId}/responses`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ response_text: responseText }),
      })
      if (!res.ok) {
        toastError(await readApiMessage(res, '提交回应失败'))
        return
      }
      setResponseText('')
      setResponding(null)
      toastSuccess('ASK 回应已提交')
      await fetchAskItems()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '提交回应失败')
    }
  }

  async function handleCloseAsk(askId: string) {
    if (!closeReason.trim()) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/asks/${askId}/transition`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'close', reason: closeReason }),
      })
      if (!res.ok) {
        toastError(await readApiMessage(res, '关闭 ASK 失败'))
        return
      }
      setCloseReason('')
      setClosing(null)
      toastSuccess('ASK 已关闭')
      await fetchAskItems()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '关闭 ASK 失败')
    }
  }

  async function handleReopenAsk(askId: string) {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/asks/${askId}/transition`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'reopen' }),
      })
      if (!res.ok) {
        toastError(await readApiMessage(res, '重开 ASK 失败'))
        return
      }
      toastSuccess('ASK 已重开')
      await fetchAskItems()
    } catch (err) {
      toastError(err instanceof Error ? err.message : '重开 ASK 失败')
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
              <div className="mt-3 flex gap-2 flex-wrap">
                {responding === ask.id ? (
                  <div className="flex-1">
                    <Textarea
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
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setResponding(ask.id)}
                    >
                      录入回应
                    </Button>
                    {closing === ask.id ? (
                      <div className="flex-1">
                        <Textarea
                          className="w-full p-2 text-sm border rounded-lg mb-2 resize-y"
                          rows={2}
                          placeholder="填写关闭原因（如：伪风险/重复项）..."
                          value={closeReason}
                          onChange={(e) => setCloseReason(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleCloseAsk(ask.id)}
                            disabled={!closeReason.trim()}
                          >
                            确认关闭
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setClosing(null)
                              setCloseReason('')
                            }}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-500 hover:text-slate-700"
                        onClick={() => setClosing(ask.id)}
                      >
                        关闭（伪风险）
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 已回应的ASK：支持重开 */}
            {(ask.status === 'responded' || ask.status === 'closed') && (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-slate-500 hover:text-amber-600"
                  onClick={() => handleReopenAsk(ask.id)}
                >
                  重开 ASK
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

interface QuoteData {
  id: string
  quote_no: string
  customer_name: string
  total_amount: number
  subtotal: number
  tax_amount: number
  status: string
  valid_until: string
}

interface QuoteItemData {
  id: string
  name: string
  specification: string | null
  quantity: number
  unit: string
  unit_price: number
  line_total: number
}

// QuoteSection - 展示引用的报价章节
function QuoteSection({ contractId, quoteId }: { contractId: string; quoteId: string }) {
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [items, setItems] = useState<QuoteItemData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadQuote() {
      try {
        const token = localStorage.getItem('token')
        const [quoteRes, itemsRes] = await Promise.all([
          fetch(`/api/quotes/${quoteId}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/contracts/${contractId}/items`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
        ])

        if (quoteRes.ok) {
          const quoteData = await quoteRes.json()
          setQuote(quoteData.data || quoteData)
        }
        if (itemsRes.ok) {
          const itemsData = await itemsRes.json()
          setItems(itemsData.data || [])
        }
      } catch {
        // 报价信息加载失败不影响主页面显示
      } finally {
        setLoading(false)
      }
    }

    void loadQuote()
  }, [contractId, quoteId])

  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="py-6">
          <p className="text-sm text-slate-500">加载报价信息...</p>
        </CardContent>
      </Card>
    )
  }

  if (!quote) return null

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">报价章节</CardTitle>
        <Link href={`/quotes/${quoteId}`}>
          <Button variant="ghost" size="sm">查看原报价</Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="mb-4 text-sm">
          <p>
            <span className="text-slate-500">报价编号：</span>
            {quote.quote_no}
          </p>
          <p>
            <span className="text-slate-500">客户：</span>
            {quote.customer_name}
          </p>
          <p>
            <span className="text-slate-500">报价总金额：</span>
            ¥{quote.total_amount?.toLocaleString()}
          </p>
        </div>

        {items.length > 0 && (
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">标的名称</th>
                  <th className="px-3 py-2 text-right">数量</th>
                  <th className="px-3 py-2 text-right">单价</th>
                  <th className="px-3 py-2 text-right">小计</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2 text-right">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">¥{item.unit_price?.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">¥{item.line_total?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// 表三·摘要 — 综合评分 + 效力分析 + 行动建议
function SummaryTableTab({
  contract,
  latestReview,
}: {
  contract: Contract
  latestReview: {
    results?: {
      summary: string
      risks: Array<{
        level: 'red' | 'yellow' | 'green'
        title: string
        description: string
        suggestion: string
      }>
    }
    risk_summary?: {
      total_clauses: number
      critical_risks: number
      high_risks: number
      medium_risks: number
      low_risks: number
      compliance_score: number
    }
    compliance_check?: {
      missing_required_clauses: string[]
      dangerous_clauses: string[]
      ambiguous_clauses: string[]
      unbalanced_clauses: string[]
      party_a_consistency: string
      party_b_consistency: string
      issues: string[]
    }
    effectiveness_analysis?: string
  } | null | undefined
}) {
  const risk = latestReview?.risk_summary
  const compliance = latestReview?.compliance_check
  const summary = latestReview?.results?.summary
  const risks = latestReview?.results?.risks || []
  const effectiveness = latestReview?.effectiveness_analysis

  if (contract.status !== 'COMPLETED' || !latestReview?.results) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500">审核完成后显示摘要</p>
      </div>
    )
  }

  // 评分颜色
  const score = risk?.compliance_score ?? 0
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600'
  const scoreBg = score >= 80 ? 'bg-green-50 border-green-200' : score >= 60 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'

  // 风险等级统计
  const redCount = risks.filter(r => r.level === 'red').length
  const yellowCount = risks.filter(r => r.level === 'yellow').length
  const greenCount = risks.filter(r => r.level === 'green').length

  // 整体结论
  let conclusion = '合同整体风险可控'
  let conclusionColor = 'text-green-600'
  if (redCount > 0) {
    conclusion = `存在 ${redCount} 项严重风险，建议修改后签署`
    conclusionColor = 'text-red-600'
  } else if (yellowCount > 0) {
    conclusion = `存在 ${yellowCount} 项需关注风险，建议与法务确认`
    conclusionColor = 'text-yellow-600'
  }

  // 行动建议
  const actionItems: Array<{ title: string; desc: string; urgent: boolean }> = []
  if (compliance?.missing_required_clauses.length) {
    actionItems.push({
      title: '补充缺失条款',
      desc: `需补充：${compliance.missing_required_clauses.join('、')}`,
      urgent: true,
    })
  }
  if (compliance?.dangerous_clauses.length) {
    actionItems.push({
      title: '修改高风险条款',
      desc: '部分条款严重偏离标准，必须修改',
      urgent: true,
    })
  }
  if (compliance?.ambiguous_clauses.length) {
    actionItems.push({
      title: '澄清模糊用语',
      desc: `需澄清：${compliance.ambiguous_clauses.join('、')}`,
      urgent: false,
    })
  }
  if (!actionItems.length && score >= 80) {
    actionItems.push({
      title: '合同可直接签署',
      desc: '经审核未发现重大风险，建议按标准流程签署',
      urgent: false,
    })
  }

  return (
    <div className="space-y-6">
      {/* 1. 综合评分 */}
      <div className="grid grid-cols-4 gap-3">
        <div className={`p-4 rounded-lg border ${scoreBg}`}>
          <div className="text-xs text-slate-500">合规评分</div>
          <div className={`text-2xl font-bold ${scoreColor}`}>{score}</div>
          <div className="text-xs text-slate-500 mt-1">/ 100</div>
        </div>
        <div className="p-4 rounded-lg border border-red-200 bg-red-50">
          <div className="text-xs text-slate-500">红灯</div>
          <div className="text-2xl font-bold text-red-600">{redCount}</div>
        </div>
        <div className="p-4 rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="text-xs text-slate-500">黄灯</div>
          <div className="text-2xl font-bold text-yellow-600">{yellowCount}</div>
        </div>
        <div className="p-4 rounded-lg border border-green-200 bg-green-50">
          <div className="text-xs text-slate-500">绿灯</div>
          <div className="text-2xl font-bold text-green-600">{greenCount}</div>
        </div>
      </div>

      {/* 2. 整体结论 */}
      <Card className={`border-l-4 ${redCount > 0 ? 'border-l-red-500' : yellowCount > 0 ? 'border-l-yellow-500' : 'border-l-green-500'}`}>
        <CardHeader>
          <CardTitle className="text-base">整体结论</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-sm font-medium mb-3 ${conclusionColor}`}>{conclusion}</p>
          {summary && (
            <div className="prose prose-sm max-w-none text-slate-600">
              {summary}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. 效力分析 */}
      {effectiveness && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">效力与风险分析</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              {effectiveness.split('\n').map((line, i) => {
                if (line.startsWith('## ')) return <h3 key={i} className="text-lg font-semibold mt-3 mb-2">{line.slice(3)}</h3>
                if (line.startsWith('### ')) return <h4 key={i} className="text-base font-semibold mt-3 mb-1">{line.slice(4)}</h4>
                if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc text-sm">{line.slice(2)}</li>
                if (line.trim() === '') return <br key={i} />
                return <p key={i} className="text-sm my-1">{line}</p>
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. 合规检查摘要 */}
      {compliance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">合规检查</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500">甲方一致性：</span>
                <Badge variant={compliance.party_a_consistency === 'consistent' ? 'outline' : 'destructive'}>
                  {compliance.party_a_consistency === 'consistent' ? '一致' : compliance.party_a_consistency === 'inconsistent' ? '冲突' : '未知'}
                </Badge>
              </div>
              <div>
                <span className="text-slate-500">乙方一致性：</span>
                <Badge variant={compliance.party_b_consistency === 'consistent' ? 'outline' : 'destructive'}>
                  {compliance.party_b_consistency === 'consistent' ? '一致' : compliance.party_b_consistency === 'inconsistent' ? '冲突' : '未知'}
                </Badge>
              </div>
              <div>
                <span className="text-slate-500">缺失条款：</span>
                <span className={compliance.missing_required_clauses.length > 0 ? 'text-red-600' : 'text-slate-600'}>
                  {compliance.missing_required_clauses.length} 项
                </span>
              </div>
              <div>
                <span className="text-slate-500">高风险条款：</span>
                <span className={compliance.dangerous_clauses.length > 0 ? 'text-red-600' : 'text-slate-600'}>
                  {compliance.dangerous_clauses.length} 项
                </span>
              </div>
              <div>
                <span className="text-slate-500">模糊用语：</span>
                <span className={compliance.ambiguous_clauses.length > 0 ? 'text-yellow-600' : 'text-slate-600'}>
                  {compliance.ambiguous_clauses.length} 项
                </span>
              </div>
              <div>
                <span className="text-slate-500">总问题数：</span>
                <span>{compliance.issues.length} 项</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5. 行动建议 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">行动建议</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {actionItems.map((item, i) => (
              <div key={i} className={`p-3 rounded-lg border ${item.urgent ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-sm font-medium ${item.urgent ? 'text-red-700' : 'text-slate-700'}`}>
                    {i + 1}. {item.title}
                  </span>
                  {item.urgent && <Badge variant="destructive" className="text-xs">紧急</Badge>}
                </div>
                <p className="text-sm text-slate-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 6. 风险分布 */}
      {risks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">风险点清单（{risks.length} 项）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {risks.slice(0, 10).map((risk, i) => (
                <div key={i} className={`p-3 rounded border text-sm ${
                  risk.level === 'red' ? 'border-red-200 bg-red-50' : risk.level === 'yellow' ? 'border-yellow-200 bg-yellow-50' : 'border-green-200 bg-green-50'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={
                      risk.level === 'red' ? 'text-red-600' : risk.level === 'yellow' ? 'text-yellow-600' : 'text-green-600'
                    }>
                      {risk.level === 'red' ? '红灯' : risk.level === 'yellow' ? '黄灯' : '绿灯'}
                    </Badge>
                    <span className="font-medium">{risk.title}</span>
                  </div>
                  <p className="text-slate-600">{risk.description}</p>
                  {risk.suggestion && (
                    <p className="text-slate-500 mt-1 text-xs">
                      建议：{risk.suggestion}
                    </p>
                  )}
                </div>
              ))}
              {risks.length > 10 && (
                <p className="text-xs text-center text-slate-500">
                  还有 {risks.length - 10} 项风险...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
