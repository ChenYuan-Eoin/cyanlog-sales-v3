'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeftIcon,
  AlertTriangleIcon,
  DownloadIcon,
  GitCompareIcon,
  SparklesIcon,
  CheckCircleIcon,
  LockIcon,
  Edit3Icon,
  Loader2Icon,
} from 'lucide-react'

interface DiffItem {
  id: string
  diff_type: 'deleted' | 'added' | 'modified' | 'moved'
  baseline_text?: string
  compare_text?: string
  semantic_change?: string
  risk_level?: 'red' | 'yellow' | 'green'
  sort_order: number
}

interface ComparisonData {
  id: string
  contract_id: string
  baseline_type: string
  status: string
  ai_summary?: string
  ai_recommendation?: string
  diffs: DiffItem[]
  created_at: string
}

interface ContractOption {
  id: string
  filename: string
  status: string
  contract_no?: string | null
  quote_id?: string | null
  party_b_name?: string | null
  created_by?: string | null
  updated_at: string
}

interface ContractDetail {
  id: string
  filename?: string | null
  status?: string | null
  contract_no?: string | null
  quote_id?: string | null
  party_b_name?: string | null
  created_by?: string | null
  parsed_text?: string | null
  storage_path?: string | null
}

function readApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const data = payload as { error?: unknown; message?: unknown }
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error === 'object') {
    const error = data.error as { message?: unknown }
    if (typeof error.message === 'string') return error.message
  }
  if (typeof data.message === 'string') return data.message
  return fallback
}

function normalizeComparableField(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, '').toLowerCase()
}

function hasStructuredCompareIdentity(contract: Pick<ContractDetail, 'quote_id' | 'party_b_name'>) {
  return Boolean(contract.quote_id || normalizeComparableField(contract.party_b_name))
}

function isRelatedCompareCandidate(baseline: ContractDetail, candidate: ContractOption) {
  if (baseline.id === candidate.id) return false

  if (baseline.quote_id && candidate.quote_id && baseline.quote_id === candidate.quote_id) {
    return true
  }

  const partyName = normalizeComparableField(baseline.party_b_name)
  const candidatePartyName = normalizeComparableField(candidate.party_b_name)
  if (partyName && candidatePartyName && partyName === candidatePartyName) {
    return true
  }

  if (!hasStructuredCompareIdentity(baseline) && !hasStructuredCompareIdentity(candidate)) {
    return Boolean(baseline.created_by && baseline.created_by === candidate.created_by)
  }

  return false
}

async function fetchContractDetail(contractId: string, headers: HeadersInit) {
  const response = await fetch(`/api/contracts/${contractId}`, { headers })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(readApiError(payload, '获取合同详情失败'))
  }
  return payload as ContractDetail
}

export default function ContractComparePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const contractId = params.id as string
  const comparisonId = searchParams.get('comparison_id')

  const [comparison, setComparison] = useState<ComparisonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'dual' | 'merge'>('dual')
  const [candidateContracts, setCandidateContracts] = useState<ContractOption[]>([])
  const [excludedCandidateCount, setExcludedCandidateCount] = useState(0)
  const [selectedCompareDocId, setSelectedCompareDocId] = useState('')
  const [startingComparison, setStartingComparison] = useState(false)

  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const isSyncing = useRef(false)

  const fetchComparison = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

      let url = `/api/contracts/${contractId}/compare`
      if (comparisonId) {
        url = `/api/contracts/${contractId}/compare?comparison_id=${encodeURIComponent(comparisonId)}`
      }

      const res = await fetch(url, { headers })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || data?.error || '获取比对结果失败')
        return
      }

      const data = await res.json()
      setComparison(data.data)
      if (data.data?.diffs?.length > 0) {
        setSelectedDiffId(data.data.diffs[0].id)
      }
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [contractId, comparisonId])

  const fetchCandidateContracts = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
      const [baselineContract, res] = await Promise.all([
        fetchContractDetail(contractId, headers),
        fetch('/api/contracts?page=1&pageSize=100&status=COMPLETED', { headers }),
      ])
      if (!res.ok) {
        return
      }

      const data = await res.json()
      const allOptions = ((data.data?.data || []) as ContractOption[])
        .filter((contract) => contract.id !== contractId)
      const options = allOptions.filter((contract) => isRelatedCompareCandidate(baselineContract, contract))
      setCandidateContracts(options)
      setExcludedCandidateCount(allOptions.length - options.length)
      setSelectedCompareDocId((current) => (
        current && options.some((contract) => contract.id === current)
          ? current
          : options[0]?.id || ''
      ))
    } catch {
      // The empty state remains actionable through upload when candidates cannot be loaded.
    }
  }, [contractId])

  useEffect(() => {
    void fetchComparison()
  }, [fetchComparison])

  useEffect(() => {
    if (!comparisonId && !comparison) {
      void fetchCandidateContracts()
    }
  }, [comparison, comparisonId, fetchCandidateContracts])

  const handleStartComparison = useCallback(async () => {
    if (!selectedCompareDocId) {
      return
    }

    setStartingComparison(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
      const [baselineContract, compareContract] = await Promise.all([
        fetchContractDetail(contractId, authHeaders),
        fetchContractDetail(selectedCompareDocId, authHeaders),
      ])

      const missingTextContract = [baselineContract, compareContract].find((contract) => (
        !contract.parsed_text?.trim() && !contract.storage_path
      ))
      if (missingTextContract) {
        const name = missingTextContract.filename || '所选合同'
        setError(`无法发起比对：${name} 缺少源文件和可比对的解析文本。请上传可复制文本的 docx/pdf，或重新上传新版本后再比对。`)
        return
      }

      const res = await fetch(`/api/contracts/${contractId}/compare`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseline_type: 'previous_version',
          compare_doc_id: selectedCompareDocId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(readApiError(data, '发起比对失败'))
        return
      }

      await fetchComparison()
    } catch {
      setError('网络错误')
    } finally {
      setStartingComparison(false)
    }
  }, [contractId, fetchComparison, selectedCompareDocId])

  // 同步滚动
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isSyncing.current) return
    isSyncing.current = true

    const sourceRef = source === 'left' ? leftPaneRef : rightPaneRef
    const targetRef = source === 'left' ? rightPaneRef : leftPaneRef

    if (sourceRef.current && targetRef.current) {
      targetRef.current.scrollTop = sourceRef.current.scrollTop
    }

    setTimeout(() => {
      isSyncing.current = false
    }, 50)
  }, [])

  // 跳转到指定差异
  const scrollToDiff = useCallback((diffId: string) => {
    setSelectedDiffId(diffId)
    const element = document.getElementById(`diff-${diffId}`)
    if (element && leftPaneRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-500">加载比对结果...</div>
      </div>
    )
  }

  if (error) {
    return (
      <CompareBlockingState
        contractId={contractId}
        message={error}
        onReset={() => setError('')}
      />
    )
  }

  if (!comparison) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
              <GitCompareIcon className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900">发起文档比对</h1>
              <p className="text-sm text-slate-500">选择另一份已完成合同作为对比文档。</p>
            </div>
          </div>

          {candidateContracts.length > 0 ? (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                对比文档
                <select
                  value={selectedCompareDocId}
                  onChange={(event) => setSelectedCompareDocId(event.target.value)}
                  className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                >
                  {candidateContracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.filename || contract.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-between gap-3">
                <Link href={`/contracts/${contractId}`}>
                  <Button variant="outline">返回合同</Button>
                </Link>
                <Button onClick={handleStartComparison} disabled={!selectedCompareDocId || startingComparison}>
                  {startingComparison ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <GitCompareIcon className="mr-2 h-4 w-4" />
                  )}
                  开始比对
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {excludedCandidateCount > 0
                  ? `已排除 ${excludedCandidateCount} 份非同客户/同报价的已完成合同。请上传同一客户或同一报价下的新版本后再比对。`
                  : '当前没有可用于比对的已完成合同。请先上传或完成另一份合同审核。'}
              </p>
              <div className="flex items-center justify-between gap-3">
                <Link href={`/contracts/${contractId}`}>
                  <Button variant="outline">返回合同</Button>
                </Link>
                <Link href="/contracts/upload">
                  <Button>上传合同</Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 统计
  const stats = {
    deleted: comparison.diffs?.filter((d) => d.diff_type === 'deleted').length || 0,
    added: comparison.diffs?.filter((d) => d.diff_type === 'added').length || 0,
    modified: comparison.diffs?.filter((d) => d.diff_type === 'modified' || d.diff_type === 'moved').length || 0,
  }

  const totalChanges = stats.deleted + stats.added + stats.modified

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* 差异导航面板 */}
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-slate-100">
          <Link href={`/contracts/${contractId}`}>
            <Button variant="ghost" size="sm" className="mb-2">
              <ArrowLeftIcon className="h-4 w-4 mr-1" />
              返回合同
            </Button>
          </Link>
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <GitCompareIcon className="h-5 w-5 text-indigo-500" />
            文档比对
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            检测到 {totalChanges} 处差异
          </p>
        </div>

        {/* 差异统计 */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-red-200 border border-red-300 rounded-sm" />
            <span className="text-slate-600">删除 {stats.deleted}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-green-200 border border-green-300 rounded-sm" />
            <span className="text-slate-600">新增 {stats.added}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-blue-100 border border-blue-300 rounded-sm" />
            <span className="text-slate-600">修改 {stats.modified}</span>
          </div>
        </div>

        {/* 变更列表 */}
        <div className="flex-1 overflow-y-auto">
          {comparison.diffs?.map((diff, index) => (
            <button
              key={diff.id}
              onClick={() => scrollToDiff(diff.id)}
              className={`w-full text-left p-4 border-l-4 transition-colors ${
                selectedDiffId === diff.id
                  ? 'bg-indigo-50 border-indigo-500'
                  : 'border-transparent hover:bg-slate-50'
              } ${
                diff.diff_type === 'deleted'
                  ? 'border-l-red-500'
                  : diff.diff_type === 'added'
                    ? 'border-l-green-500'
                    : 'border-l-blue-500'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    diff.diff_type === 'deleted'
                      ? 'border-red-200 text-red-600 bg-red-50'
                      : diff.diff_type === 'added'
                        ? 'border-green-200 text-green-600 bg-green-50'
                        : 'border-blue-200 text-blue-600 bg-blue-50'
                  }`}
                >
                  {diff.diff_type === 'deleted'
                    ? '删除'
                    : diff.diff_type === 'added'
                      ? '新增'
                      : '修改'}
                </Badge>
                <span className="text-[10px] text-slate-400 font-mono">
                  #{index + 1}
                </span>
              </div>
              <p className="text-xs font-medium text-slate-800 truncate">
                {diff.semantic_change ||
                  diff.baseline_text?.slice(0, 30) ||
                  diff.compare_text?.slice(0, 30) ||
                  '内容变更'}
              </p>
              {diff.risk_level && diff.risk_level !== 'green' && (
                <div className="mt-2 flex items-center gap-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      diff.risk_level === 'red' ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                  />
                  <span
                    className={`text-[10px] ${
                      diff.risk_level === 'red' ? 'text-red-600' : 'text-amber-600'
                    }`}
                  >
                    {diff.risk_level === 'red' ? '高风险' : '需注意'}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* AI 总结 */}
        {comparison.ai_summary && (
          <div className="p-4 m-4 bg-indigo-600 rounded-xl text-white shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <SparklesIcon className="h-4 w-4" />
              <span className="text-xs font-bold">AI 差异深度解读</span>
            </div>
            <p className="text-xs leading-relaxed opacity-90">
              {comparison.ai_summary}
            </p>
          </div>
        )}
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部操作栏 */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="font-bold text-slate-900">
              {comparison.baseline_type === 'template'
                ? '标准模板 vs 客户回传'
                : '版本比对'}
            </h1>
            {totalChanges > 0 && (
              <Badge
                variant="outline"
                className="bg-amber-50 border-amber-200 text-amber-700"
              >
                {totalChanges} 处差异
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setViewMode('dual')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  viewMode === 'dual'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                双栏视图
              </button>
              <button
                onClick={() => setViewMode('merge')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  viewMode === 'merge'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                合并视图
              </button>
            </div>
            <Button size="sm">
              <DownloadIcon className="h-4 w-4 mr-1.5" />
              导出报告
            </Button>
          </div>
        </header>

        {/* 差异高亮说明 */}
        <div className="h-10 bg-slate-50 border-b border-slate-200 flex items-center px-4 gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-red-100 border border-red-300 rounded" />
            <span className="text-slate-500">删除内容</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-green-100 border border-green-300 rounded" />
            <span className="text-slate-500">新增内容</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-blue-50 border border-blue-300 rounded" />
            <span className="text-slate-500">移动/修改</span>
          </div>
        </div>

        {/* 双栏对比区 */}
        <div className="flex-1 flex overflow-hidden bg-slate-100 p-4 gap-4">
          {/* 左窗格：基准文档 */}
          <div
            ref={leftPaneRef}
            onScroll={() => handleScroll('left')}
            className="flex-1 bg-white rounded-xl shadow-sm overflow-y-auto custom-scrollbar relative"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 p-4 flex justify-between items-center z-10">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                基准文档
              </span>
              <LockIcon className="h-3 w-3 text-slate-300" />
            </div>
            <div className="p-8">
              <h2 className="text-xl font-bold text-center text-slate-900 mb-10">
                系统服务采购协议
              </h2>
              <div className="space-y-6 text-sm leading-loose text-slate-600">
                {comparison.diffs?.map((diff) => (
                  <div
                    key={`left-${diff.id}`}
                    id={`diff-${diff.id}`}
                    className={`p-3 rounded-lg transition-colors ${
                      selectedDiffId === diff.id ? 'bg-indigo-50/50 ring-1 ring-indigo-200' : ''
                    } ${
                      diff.diff_type === 'moved' ? 'border-l-2 border-blue-500 bg-blue-50/30' : ''
                    }`}
                  >
                    {diff.diff_type === 'deleted' ? (
                      <div className="bg-red-50/50 p-2 rounded">
                        <span className="bg-red-100 text-red-800 line-through decoration-red-400">
                          {diff.baseline_text}
                        </span>
                      </div>
                    ) : diff.diff_type === 'modified' ? (
                      <div className="space-y-2">
                        <h4 className="font-bold text-slate-800">条款内容</h4>
                        <p className="bg-red-50/50 p-2 rounded">
                          <span className="bg-red-100 text-red-800 line-through decoration-red-400">
                            {diff.baseline_text}
                          </span>
                        </p>
                      </div>
                    ) : (
                      <div>
                        <h4 className="font-bold text-slate-800 mb-2">条款内容</h4>
                        <p>{diff.baseline_text || '（无变化）'}</p>
                      </div>
                    )}
                  </div>
                ))}
                {(!comparison.diffs || comparison.diffs.length === 0) && (
                  <div className="text-center py-12 text-slate-400">
                    <CheckCircleIcon className="h-12 w-12 mx-auto mb-4 text-green-400" />
                    <p>未发现差异</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右窗格：对比文档 */}
          <div
            ref={rightPaneRef}
            onScroll={() => handleScroll('right')}
            className="flex-1 bg-white rounded-xl shadow-sm overflow-y-auto custom-scrollbar relative"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 p-4 flex justify-between items-center z-10">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">
                对比文档
              </span>
              <Edit3Icon className="h-3 w-3 text-indigo-300" />
            </div>
            <div className="p-8">
              <h2 className="text-xl font-bold text-center text-slate-900 mb-10">
                系统服务采购协议
              </h2>
              <div className="space-y-6 text-sm leading-loose text-slate-600">
                {comparison.diffs?.map((diff) => (
                  <div
                    key={`right-${diff.id}`}
                    className={`p-3 rounded-lg transition-colors ${
                      selectedDiffId === diff.id ? 'bg-indigo-50/50 ring-1 ring-indigo-200' : ''
                    } ${
                      diff.diff_type === 'moved' ? 'border-l-2 border-blue-500 bg-blue-50/30' : ''
                    }`}
                  >
                    {diff.diff_type === 'added' ? (
                      <div className="bg-green-50/50 p-2 rounded">
                        <span className="bg-green-100 text-green-800 underline decoration-green-400">
                          {diff.compare_text}
                        </span>
                      </div>
                    ) : diff.diff_type === 'modified' ? (
                      <div className="space-y-2">
                        <h4 className="font-bold text-slate-800">条款内容</h4>
                        <p className="bg-green-50/50 p-2 rounded">
                          <span className="bg-green-100 text-green-800 underline decoration-green-400">
                            {diff.compare_text}
                          </span>
                        </p>
                      </div>
                    ) : diff.diff_type === 'moved' ? (
                      <div className="bg-blue-50/50 p-2 rounded">
                        <h4 className="font-bold text-slate-800 italic">条款位置移动</h4>
                        <p>{diff.compare_text}</p>
                      </div>
                    ) : (
                      <div>
                        <h4 className="font-bold text-slate-800 mb-2">条款内容</h4>
                        <p>{diff.compare_text || '（保持原样）'}</p>
                      </div>
                    )}
                  </div>
                ))}
                {(!comparison.diffs || comparison.diffs.length === 0) && (
                  <div className="text-center py-12 text-slate-400">
                    <CheckCircleIcon className="h-12 w-12 mx-auto mb-4 text-green-400" />
                    <p>未发现差异</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* VS 标记 */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-10 h-10 bg-white rounded-full shadow-xl flex items-center justify-center border-2 border-indigo-100">
              <span className="text-[10px] font-black text-indigo-500">VS</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function CompareBlockingState({
  contractId,
  message,
  onReset,
}: {
  contractId: string
  message: string
  onReset: () => void
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-lg border border-amber-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50">
            <AlertTriangleIcon className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">暂不能发起文档比对</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link href={`/contracts/${contractId}`}>
            <Button variant="outline" className="w-full">
              返回合同
            </Button>
          </Link>
          <Link href={`/contracts/${contractId}/edit`}>
            <Button variant="outline" className="w-full">
              上传新版本
            </Button>
          </Link>
          <Button className="w-full" onClick={onReset}>
            重新选择
          </Button>
        </div>
      </div>
    </div>
  )
}
