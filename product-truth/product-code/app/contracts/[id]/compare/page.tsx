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
  const [baselineContract, setBaselineContract] = useState<ContractDetail | null>(null)
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
      setBaselineContract(baselineContract)
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
        setError(`无法发起比对：${name} 缺少源文件和可比对的解析文本。请补充可复制文本的 docx/pdf 回传件或候选合同后再比对。`)
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
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
          正在加载文档比对工作台…
        </div>
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
      <CompareSetupWorkspace
        contractId={contractId}
        baselineContract={baselineContract}
        candidateContracts={candidateContracts}
        excludedCandidateCount={excludedCandidateCount}
        selectedCompareDocId={selectedCompareDocId}
        setSelectedCompareDocId={setSelectedCompareDocId}
        startingComparison={startingComparison}
        onStartComparison={handleStartComparison}
      />
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
	          <div className="min-w-0 flex items-center gap-4">
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
	                基准文档
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
	                对比文档
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

function CompareSetupWorkspace({
  contractId,
  baselineContract,
  candidateContracts,
  excludedCandidateCount,
  selectedCompareDocId,
  setSelectedCompareDocId,
  startingComparison,
  onStartComparison,
}: {
  contractId: string
  baselineContract: ContractDetail | null
  candidateContracts: ContractOption[]
  excludedCandidateCount: number
  selectedCompareDocId: string
  setSelectedCompareDocId: (value: string) => void
  startingComparison: boolean
  onStartComparison: () => void
}) {
  const selectedCandidate = candidateContracts.find((contract) => contract.id === selectedCompareDocId)
  const noCandidateReason = excludedCandidateCount > 0
    ? `已排除 ${excludedCandidateCount} 份非同客户或同报价的已完成合同。请在当前合同版本流补充客户回传件，或补齐同客户/同报价的候选合同。`
    : '当前没有可用于比对的已完成合同。请先为当前合同补充客户回传版本，或完成另一份同客户/同报价合同审核。'

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Link href="/contracts" className="hover:text-slate-900">合同中心</Link>
              <span>/</span>
              <Link href={`/contracts/${contractId}`} className="hover:text-slate-900">审核工作台</Link>
              <span>/</span>
              <span>文档比对</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-950">文档比对工作台</h1>
            <p className="mt-1 text-sm text-slate-500">
              先选择基准合同和客户回传/候选版本，再生成差异列表、并排高亮和风险解读。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/contracts/${contractId}`}>
              <Button variant="outline">
                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                返回审核工作台
              </Button>
            </Link>
            <Link href={`/contracts/${contractId}/edit?intent=customer-return&next=compare`}>
              <Button variant="outline">上传客户回传版</Button>
            </Link>
            <Button onClick={onStartComparison} disabled={!selectedCompareDocId || startingComparison}>
              {startingComparison ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitCompareIcon className="mr-2 h-4 w-4" />
              )}
              开始比对
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <LockIcon className="h-4 w-4 text-slate-400" />
              <h2 className="font-semibold text-slate-950">基准文件</h2>
            </div>
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <p className="break-words font-medium text-slate-900">
                {baselineContract?.filename || '当前合同'}
              </p>
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                <p>合同编号：{baselineContract?.contract_no || '未记录'}</p>
                <p>客户：{baselineContract?.party_b_name || '未记录'}</p>
                <p>报价：{baselineContract?.quote_id || '未绑定'}</p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              基准文件来自当前合同版本流，不重新生成源文件。比对只读取可解析文本并保留原始文件作为事实来源。
            </p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">对比版本</h2>
                <p className="text-sm text-slate-500">优先选择同客户、同报价或当前合同回传版本。</p>
              </div>
              <Badge variant={candidateContracts.length > 0 ? 'outline' : 'secondary'}>
                {candidateContracts.length} 个候选
              </Badge>
            </div>

            {candidateContracts.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {candidateContracts.map((contract) => {
                  const active = contract.id === selectedCompareDocId
                  return (
                    <button
                      key={contract.id}
                      type="button"
                      onClick={() => setSelectedCompareDocId(contract.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                          : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{contract.filename || contract.id}</p>
                        {active && <Badge>已选</Badge>}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-slate-500">
                        <p>客户：{contract.party_b_name || '未记录'}</p>
                        <p>报价：{contract.quote_id || '未绑定'}</p>
                        <p>更新时间：{new Date(contract.updated_at).toLocaleString('zh-CN')}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                {noCandidateReason}
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <GitCompareIcon className="h-4 w-4 text-indigo-500" />
              <h2 className="font-semibold text-slate-950">输出闭环</h2>
            </div>
            <div className="space-y-3 text-sm">
              <CompareStep done label="1. 选择基准文件" value={baselineContract?.filename || '当前合同'} />
              <CompareStep done={Boolean(selectedCandidate)} label="2. 选择对比版本" value={selectedCandidate?.filename || '等待选择'} />
              <CompareStep done={false} label="3. 生成差异列表" value="删除 / 新增 / 修改 / 风险等级" />
              <CompareStep done={false} label="4. 并排高亮复核" value="左旧右新，差异可跳转" />
            </div>
            <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              比对结果不会替代合同审核结论；红线差异仍应进入风险审核或再审核。
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}

function CompareStep({ done, label, value }: { done: boolean; label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-md bg-slate-50 p-3">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
      }`}>
        {done ? '✓' : '·'}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{label}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{value}</p>
      </div>
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
              补充可比对文件
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
