'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  buildContractCompareHref,
  buildContractWorkbenchHref,
  buildContractsCenterHref,
  buildCustomerReturnUploadHref,
} from '@/lib/contracts/review-navigation'
import {
  ArrowLeftIcon,
  AlertTriangleIcon,
  DownloadIcon,
  GitCompareIcon,
  SparklesIcon,
  CheckCircleIcon,
  Edit3Icon,
  Loader2Icon,
  FileTextIcon,
  UploadIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
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
  document_pair?: {
    baseline: ComparisonDocumentMeta
    compare: ComparisonDocumentMeta
  }
  diffs: DiffItem[]
  created_at: string
}

interface ComparisonDocumentMeta {
  id: string | null
  label: string
  filename: string | null
  source: 'current_contract' | 'contract' | 'version' | 'unknown'
  source_label: string
  version_number?: number
  created_at?: string | null
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

interface CompareCandidateOption extends ContractOption {
  relation_status: 'recommended' | 'manual_confirm'
  relation_reason: string
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

interface ContractVersionOption {
  id: string
  version_number: number
  source: 'original' | 'review_revision' | 'manual_revision'
  storage_path: string
  file_size: number | null
  mime_type: string | null
  parent_version_id: string | null
  change_summary: string | null
  review_id: string | null
  created_at: string | null
}

type DiffFilter = 'all' | 'red' | 'yellow' | 'green' | 'deleted' | 'added' | 'modified'

const diffFilters: Array<{ value: DiffFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'red', label: '红线' },
  { value: 'yellow', label: '需关注' },
  { value: 'deleted', label: '删除' },
  { value: 'added', label: '新增' },
  { value: 'modified', label: '修改' },
]

function filterDiffs(diffs: DiffItem[], filter: DiffFilter) {
  if (filter === 'all') return diffs
  if (filter === 'red' || filter === 'yellow' || filter === 'green') {
    return diffs.filter((diff) => diff.risk_level === filter)
  }
  if (filter === 'modified') {
    return diffs.filter((diff) => diff.diff_type === 'modified' || diff.diff_type === 'moved')
  }
  return diffs.filter((diff) => diff.diff_type === filter)
}

function diffTypeLabel(type: DiffItem['diff_type']) {
  if (type === 'deleted') return '删除'
  if (type === 'added') return '新增'
  return '修改/移动'
}

function riskLabel(level?: DiffItem['risk_level']) {
  if (level === 'red') return '红线'
  if (level === 'yellow') return '需关注'
  if (level === 'green') return '低风险'
  return '未分级'
}

function riskChangeLabel(diff: DiffItem) {
  if (diff.diff_type === 'added') {
    return diff.risk_level === 'red' || diff.risk_level === 'yellow' ? '新增风险' : '新增低风险内容'
  }
  if (diff.diff_type === 'deleted') {
    return diff.risk_level === 'red' || diff.risk_level === 'yellow' ? '[实质修改] 内容被删除或替换' : '删除低风险内容'
  }
  if (diff.risk_level === 'red') return '风险加重或红线变化'
  if (diff.risk_level === 'yellow') return '需关注变化'
  return '低风险变化'
}

function sourceLabel(meta?: ComparisonDocumentMeta | null) {
  if (!meta) return '未识别'
  if (meta.source === 'version' && meta.version_number) return `${meta.source_label} v${meta.version_number}`
  return meta.source_label
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

function describeCompareCandidateRelation(baseline: ContractDetail, candidate: ContractOption): CompareCandidateOption {
  if (baseline.quote_id && candidate.quote_id && baseline.quote_id === candidate.quote_id) {
    return {
      ...candidate,
      relation_status: 'recommended',
      relation_reason: `同报价：${candidate.quote_id}`,
    }
  }

  const partyName = normalizeComparableField(baseline.party_b_name)
  const candidatePartyName = normalizeComparableField(candidate.party_b_name)
  if (partyName && candidatePartyName && partyName === candidatePartyName) {
    return {
      ...candidate,
      relation_status: 'recommended',
      relation_reason: `同客户：${candidate.party_b_name || '未命名客户'}`,
    }
  }

  if (!hasStructuredCompareIdentity(baseline) && !hasStructuredCompareIdentity(candidate) && baseline.created_by === candidate.created_by) {
    return {
      ...candidate,
      relation_status: 'manual_confirm',
      relation_reason: '同上传人，缺少客户或报价字段',
    }
  }

  return {
    ...candidate,
    relation_status: 'manual_confirm',
    relation_reason: '关系未自动识别，需要人工确认属于同一业务文件',
  }
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
  const router = useRouter()
  const contractId = params.id as string
  const comparisonId = searchParams.get('comparison_id')

  const [comparison, setComparison] = useState<ComparisonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'dual' | 'merge'>('dual')
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all')
  const [baselineContract, setBaselineContract] = useState<ContractDetail | null>(null)
  const [candidateContracts, setCandidateContracts] = useState<CompareCandidateOption[]>([])
  const [versionOptions, setVersionOptions] = useState<ContractVersionOption[]>([])
  const [excludedCandidateCount, setExcludedCandidateCount] = useState(0)
  const [selectedBaselineDocId, setSelectedBaselineDocId] = useState('')
  const [selectedBaselineVersionId, setSelectedBaselineVersionId] = useState('')
  const [selectedCompareDocId, setSelectedCompareDocId] = useState('')
  const [selectedCompareVersionId, setSelectedCompareVersionId] = useState('')
  const [startingComparison, setStartingComparison] = useState(false)
  const [startingRerun, setStartingRerun] = useState(false)
  const [rerunNotice, setRerunNotice] = useState('')

  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const isSyncing = useRef(false)

  const fetchComparison = useCallback(async () => {
    if (!comparisonId) {
      setComparison(null)
      setSelectedDiffId(null)
      setLoading(false)
      return
    }

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

  const openComparisonResult = useCallback((payload: unknown) => {
    const data = payload && typeof payload === 'object'
      ? payload as { data?: { id?: unknown }; id?: unknown }
      : {}
    const nextComparisonId = typeof data.data?.id === 'string'
      ? data.data.id
      : typeof data.id === 'string'
        ? data.id
        : ''

    if (!nextComparisonId) {
      setError('比对已创建，但返回结果缺少 comparison_id，无法打开结果页。')
      return
    }

    router.push(buildContractCompareHref(contractId, {
      from: 'compare',
      comparisonId: nextComparisonId,
    }))
  }, [contractId, router])

  const fetchCandidateContracts = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
      const [baselineContract, res, workbenchRes] = await Promise.all([
        fetchContractDetail(contractId, headers),
        fetch('/api/contracts?page=1&pageSize=100&status=COMPLETED', { headers }),
        fetch(`/api/contracts/${contractId}/review`, { headers }),
      ])
      setBaselineContract(baselineContract)
      if (workbenchRes.ok) {
        const workbenchData = await workbenchRes.json().catch(() => ({}))
        const versions = ((workbenchData?.data?.versions || []) as ContractVersionOption[])
          .filter((version) => version.source !== 'review_revision')
          .sort((left, right) => right.version_number - left.version_number)
        setVersionOptions(versions)
        setSelectedBaselineVersionId((current) => {
          if (current && versions.some((version) => version.id === current)) return current
          const original = versions.find((version) => version.source === 'original')
          return original?.id || ''
        })
        setSelectedCompareVersionId((current) => {
          if (current && versions.some((version) => version.id === current)) return current
          return ''
        })
      }
      if (!res.ok) {
        return
      }

      const data = await res.json()
      const allOptions = ((data.data?.data || []) as ContractOption[])
        .filter((contract) => contract.id !== contractId)
      const options = allOptions.map((contract) => describeCompareCandidateRelation(baselineContract, contract))
      setCandidateContracts(options)
      setExcludedCandidateCount(options.filter((contract) => contract.relation_status === 'manual_confirm').length)
      setSelectedBaselineDocId((current) => (
        current && allOptions.some((contract) => contract.id === current)
          ? current
          : ''
      ))
      setSelectedCompareDocId((current) => (
        current && allOptions.some((contract) => contract.id === current)
          ? current
          : ''
      ))
    } catch {
      setError('候选版本加载失败。仍可先上传客户回传版；上传后会作为当前合同版本流参与比对。')
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

  useEffect(() => {
    if (!comparison) return
    const filtered = filterDiffs(comparison.diffs || [], diffFilter)
    if (!filtered.length) {
      if (selectedDiffId !== null) {
        setSelectedDiffId(null)
      }
      return
    }
    if (!selectedDiffId || !filtered.some((diff) => diff.id === selectedDiffId)) {
      setSelectedDiffId(filtered[0].id)
    }
  }, [comparison, diffFilter, selectedDiffId])

  const handleStartComparison = useCallback(async () => {
    if (!selectedCompareDocId && !selectedCompareVersionId) {
      setError('请先选择一个新文件、客户回传版本或确认一份候选合同，再开始比对。')
      return
    }

    setStartingComparison(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const authHeaders: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
      if (selectedCompareVersionId) {
        if (selectedBaselineVersionId && selectedBaselineVersionId === selectedCompareVersionId) {
          setError('旧文件和新文件不能选择同一个合同版本。')
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
            baseline_doc_id: selectedBaselineVersionId || undefined,
            compare_version_id: selectedCompareVersionId,
          }),
        })

        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setError(readApiError(data, '发起版本比对失败'))
          return
        }

        openComparisonResult(data)
        return
      }

      const baselineDocId = selectedBaselineVersionId || selectedBaselineDocId || undefined
      if (baselineDocId && baselineDocId === selectedCompareDocId) {
        setError('旧文件和新文件不能选择同一份合同。')
        return
      }
      const baselineDetailId = selectedBaselineDocId || contractId

      const [baselineContract, compareContract] = await Promise.all([
        fetchContractDetail(baselineDetailId, authHeaders),
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
          baseline_doc_id: baselineDocId,
          compare_doc_id: selectedCompareDocId,
          manual_confirmed: true,
        }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(readApiError(data, '发起比对失败'))
        return
      }

      openComparisonResult(data)
    } catch {
      setError('网络错误')
    } finally {
      setStartingComparison(false)
    }
  }, [contractId, openComparisonResult, selectedBaselineDocId, selectedBaselineVersionId, selectedCompareDocId, selectedCompareVersionId])

  const handleStartReReview = useCallback(async () => {
    if (!comparison || (comparison.diffs || []).length === 0) return

    setStartingRerun(true)
    setRerunNotice('')
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contracts/${contractId}/review-runs`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trigger_event: 'customer_version_received',
          comparison_id: comparison.id,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setRerunNotice(readApiError(payload, '创建再审核任务失败'))
        return
      }
      router.push(buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' }))
    } catch {
      setRerunNotice('网络错误，创建再审核任务失败')
    } finally {
      setStartingRerun(false)
    }
  }, [comparison, contractId, router])

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <Link href={buildContractsCenterHref()}>
              <Button variant="outline" size="sm">
                <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
                返回合同中心
              </Button>
            </Link>
            <Link href={buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' })}>
              <Button variant="outline" size="sm">返回审核工作台</Button>
            </Link>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-semibold text-slate-950">
                <Loader2Icon className="h-4 w-4 animate-spin text-indigo-600" />
                正在打开文档比对工作台
              </div>
              <p className="mt-2 leading-6 text-slate-500">
                系统会先读取当前合同版本流，再检查是否已有客户回传版或历史比对结果。
              </p>
              <p className="mt-1 leading-6 text-slate-500">
                对比目标是旧文件、新文件、差异列表、并排高亮和再审核闭环，不会替代合同风险审核结论。
              </p>
            </div>
            <Badge variant="outline">旧/新文件装载中</Badge>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            {['旧文件', '新文件', '差异列表', '并排高亮'].map((item, index) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">
                    {index + 1}
                  </span>
                  <span className="text-xs font-semibold text-slate-900">{item}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-indigo-500" />
                </div>
              </div>
            ))}
          </div>
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
        versionOptions={versionOptions}
        excludedCandidateCount={excludedCandidateCount}
        selectedBaselineDocId={selectedBaselineDocId}
        setSelectedBaselineDocId={setSelectedBaselineDocId}
        selectedBaselineVersionId={selectedBaselineVersionId}
        setSelectedBaselineVersionId={setSelectedBaselineVersionId}
        selectedCompareDocId={selectedCompareDocId}
        setSelectedCompareDocId={setSelectedCompareDocId}
        selectedCompareVersionId={selectedCompareVersionId}
        setSelectedCompareVersionId={setSelectedCompareVersionId}
        startingComparison={startingComparison}
        onStartComparison={handleStartComparison}
      />
    )
  }

  const allDiffs = comparison.diffs || []
  const visibleDiffs = filterDiffs(allDiffs, diffFilter)

  // 统计
  const stats = {
    deleted: allDiffs.filter((d) => d.diff_type === 'deleted').length,
    added: allDiffs.filter((d) => d.diff_type === 'added').length,
    modified: allDiffs.filter((d) => d.diff_type === 'modified' || d.diff_type === 'moved').length,
  }

  const totalChanges = stats.deleted + stats.added + stats.modified
  const selectedDiff = visibleDiffs.find((diff) => diff.id === selectedDiffId) || visibleDiffs[0] || null
  const selectedVisibleIndex = selectedDiff ? visibleDiffs.findIndex((diff) => diff.id === selectedDiff.id) : -1
  const redDiffCount = allDiffs.filter((diff) => diff.risk_level === 'red').length
  const yellowDiffCount = allDiffs.filter((diff) => diff.risk_level === 'yellow').length
  const documentPair = comparison.document_pair
  const goToVisibleDiff = (offset: number) => {
    if (!visibleDiffs.length) return
    const currentIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), visibleDiffs.length - 1)
    scrollToDiff(visibleDiffs[nextIndex].id)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* 差异导航面板 */}
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-slate-100">
          <div className="mb-2 flex flex-wrap gap-2">
            <Link href={buildContractsCenterHref()}>
              <Button variant="ghost" size="sm">
                <ArrowLeftIcon className="h-4 w-4 mr-1" />
                返回合同中心
              </Button>
            </Link>
            <Link href={buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' })}>
              <Button variant="ghost" size="sm">
                返回审核工作台
              </Button>
            </Link>
            <Link href={buildContractCompareHref(contractId, { from: 'compare' })}>
              <Button variant="ghost" size="sm">
                返回文件选择
              </Button>
            </Link>
          </div>
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <GitCompareIcon className="h-5 w-5 text-indigo-500" />
            文档比对
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            检测到 {totalChanges} 处差异，当前筛选 {visibleDiffs.length} 处
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

        <div className="border-b border-slate-100 p-3">
          <div className="mb-2 text-[11px] font-medium text-slate-500">差异筛选</div>
          <div className="flex flex-wrap gap-1.5">
            {diffFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setDiffFilter(filter.value)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  diffFilter === filter.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-slate-900'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {/* 变更列表 */}
        <div className="flex-1 overflow-y-auto">
          {visibleDiffs.length > 0 ? visibleDiffs.map((diff, index) => (
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
                  {diffTypeLabel(diff.diff_type)}
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
                    {diff.risk_level === 'red' ? '高风险' : '需注意'} · {riskChangeLabel(diff)}
                  </span>
                </div>
              )}
            </button>
          )) : (
            <div className="p-4 text-sm leading-6 text-slate-500">
              当前筛选下没有差异。可以切回“全部”继续复核。
            </div>
          )}
        </div>

        {/* AI 总结 */}
        {comparison.ai_summary && (
          <div className="p-4 m-4 bg-indigo-600 rounded-xl text-white shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <SparklesIcon className="h-4 w-4" />
              <span className="text-xs font-bold">AI 差异披露摘要</span>
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
        <header className="min-h-16 bg-white border-b border-slate-200 flex flex-col gap-3 px-4 py-3 flex-shrink-0 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
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
              {selectedDiff ? (
                <Badge variant={selectedDiff.risk_level === 'red' ? 'destructive' : 'outline'}>
                  当前：{riskLabel(selectedDiff.risk_level)}
                </Badge>
              ) : null}
            </div>
            <div className="grid gap-2 text-xs text-slate-500 lg:grid-cols-2">
              <DocumentPill label="基准文件" meta={documentPair?.baseline} fallback="当前合同" />
              <DocumentPill label="回传文件" meta={documentPair?.compare} fallback="对比文件" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={selectedVisibleIndex <= 0}
                onClick={() => goToVisibleDiff(-1)}
                className="h-8 px-2"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="min-w-16 text-center text-xs text-slate-500">
                {visibleDiffs.length ? `${selectedVisibleIndex + 1}/${visibleDiffs.length}` : '0/0'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={selectedVisibleIndex < 0 || selectedVisibleIndex >= visibleDiffs.length - 1}
                onClick={() => goToVisibleDiff(1)}
                className="h-8 px-2"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
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
            <Button size="sm" variant="outline" disabled title="差异报告导出需要绑定正式对比版本后接入">
              <DownloadIcon className="h-4 w-4 mr-1.5" />
              导出差异报告
            </Button>
          </div>
        </header>

        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800">
          当前是文本镜像审计视图：只展示可解析文本的变化片段和高亮，不把合同编号、客户、报价等属性写进左右文件画布。后续原件级还原应接入 Word/PDF 渲染层。
        </div>

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

        <CompareClosureStrip
          totalChanges={totalChanges}
          redDiffCount={redDiffCount}
          yellowDiffCount={yellowDiffCount}
          selectedDiff={selectedDiff}
          selectedIndex={selectedVisibleIndex}
          visibleCount={visibleDiffs.length}
          canStartReview={totalChanges > 0}
          startingRerun={startingRerun}
          rerunNotice={rerunNotice}
          onStartReReview={handleStartReReview}
        />

        {/* 对比区 */}
	      <div className="relative flex-1 flex overflow-hidden bg-slate-100 p-4 gap-4">
          {viewMode === 'merge' ? (
            <MergedDiffView
              diffs={visibleDiffs}
              selectedDiffId={selectedDiffId}
              onSelect={scrollToDiff}
            />
          ) : (
            <>
          {/* 左窗格：基准文档 */}
          <div
            ref={leftPaneRef}
            onScroll={() => handleScroll('left')}
            className="flex-1 bg-white rounded-xl shadow-sm overflow-y-auto custom-scrollbar relative"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 p-4 flex justify-between items-center z-10">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                1:1 原件预览（基准）
              </span>
              <FileTextIcon className="h-3 w-3 text-slate-300" />
            </div>
            <div className="p-8">
	              <h2 className="text-xl font-bold text-center text-slate-900 mb-10">
	                1:1 原件预览（基准）
              </h2>
              <div className="space-y-6 text-sm leading-loose text-slate-600">
                {visibleDiffs.map((diff) => (
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
                        <h4 className="font-bold text-slate-800">原件片段</h4>
                        <p className="bg-red-50/50 p-2 rounded">
                          <span className="bg-red-100 text-red-800 line-through decoration-red-400">
                            {diff.baseline_text}
                          </span>
                        </p>
                      </div>
                    ) : (
                      <div>
                        <h4 className="font-bold text-slate-800 mb-2">原件片段</h4>
                        <p>{diff.baseline_text || '（无变化）'}</p>
                      </div>
                    )}
                  </div>
                ))}
                {visibleDiffs.length === 0 && (
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
                1:1 原件预览（回传）
              </span>
              <Edit3Icon className="h-3 w-3 text-indigo-300" />
            </div>
            <div className="p-8">
	              <h2 className="text-xl font-bold text-center text-slate-900 mb-10">
	                1:1 原件预览（回传）
              </h2>
              <div className="space-y-6 text-sm leading-loose text-slate-600">
                {visibleDiffs.map((diff) => (
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
                        <h4 className="font-bold text-slate-800">回传片段</h4>
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
                        <h4 className="font-bold text-slate-800 mb-2">回传片段</h4>
                        <p>{diff.compare_text || '（保持原样）'}</p>
                      </div>
                    )}
                  </div>
                ))}
                {visibleDiffs.length === 0 && (
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
            </>
          )}
        </div>
      </main>

      <aside className="hidden w-80 flex-shrink-0 flex-col border-l border-slate-200 bg-white xl:flex">
        <div className="border-b border-slate-100 p-4">
          <div className="text-xs font-medium text-slate-500">复核闭环</div>
          <h2 className="mt-1 text-base font-semibold text-slate-950">AI 差异披露与合规建议</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            对比只定位版本差异；红线或需谈判变化应回到审核工作台发起再审核。
          </p>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-lg font-semibold text-slate-900">{totalChanges}</div>
              <div className="text-[11px] text-slate-500">差异</div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-2">
              <div className="text-lg font-semibold text-red-600">{redDiffCount}</div>
              <div className="text-[11px] text-red-600">红线</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
              <div className="text-lg font-semibold text-amber-600">{yellowDiffCount}</div>
              <div className="text-[11px] text-amber-600">需关注</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">当前差异</div>
              {selectedDiff ? (
                <Badge variant={selectedDiff.risk_level === 'red' ? 'destructive' : 'outline'}>
                  {riskLabel(selectedDiff.risk_level)}
                </Badge>
              ) : null}
            </div>
            {selectedDiff ? (
              <div className="space-y-3 text-xs leading-5">
                <CompareFact label="序号" value={`${selectedVisibleIndex + 1} / ${visibleDiffs.length}`} />
                <CompareFact label="类型" value={diffTypeLabel(selectedDiff.diff_type)} />
                <CompareFact label="风险变化" value={riskChangeLabel(selectedDiff)} />
                <CompareFact label="业务影响" value={selectedDiff.semantic_change || '未生成业务影响说明'} />
                <CompareFact label="旧文件内容" value={selectedDiff.baseline_text || '无'} />
                <CompareFact label="新文件内容" value={selectedDiff.compare_text || '无'} />
              </div>
            ) : (
              <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                未发现差异。
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-900">文件关系</div>
            <div className="mt-3 space-y-2 text-xs leading-5">
              <CompareFact label="旧文件/基准" value={`${sourceLabel(documentPair?.baseline)}：${documentPair?.baseline?.label || '当前合同'}`} />
              <CompareFact label="新文件/回传" value={`${sourceLabel(documentPair?.compare)}：${documentPair?.compare?.label || '对比文件'}`} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-900">版本流动作</div>
            <div className="mt-3 space-y-2">
              <Button className="w-full" variant="destructive" disabled>
                驳回用印（风险拦截）
              </Button>
              <Button className="w-full" variant="outline" disabled>
                接受差异（特批通过）
              </Button>
              <Link href={buildContractsCenterHref()}>
                <Button className="w-full" variant="outline">返回合同中心</Button>
              </Link>
              <Link href={buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' })}>
                <Button className="w-full" variant="outline">返回审核工作台</Button>
              </Link>
              <Link href={buildContractCompareHref(contractId, { from: 'compare' })}>
                <Button className="w-full" variant="outline">返回文件选择</Button>
              </Link>
              <Button className="w-full" disabled={totalChanges === 0 || startingRerun} onClick={handleStartReReview}>
                {startingRerun && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                进入风险再审核
              </Button>
            </div>
            {rerunNotice && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-700">
                {rerunNotice}
              </p>
            )}
            <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-500">
              点击“进入风险再审核”会基于当前比对任务创建新的 ReviewRun；比对结果只作为版本变化证据，不替代审核结论。
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}

function CompareClosureStrip({
  totalChanges,
  redDiffCount,
  yellowDiffCount,
  selectedDiff,
  selectedIndex,
  visibleCount,
  canStartReview,
  startingRerun,
  rerunNotice,
  onStartReReview,
}: {
  totalChanges: number
  redDiffCount: number
  yellowDiffCount: number
  selectedDiff: DiffItem | null
  selectedIndex: number
  visibleCount: number
  canStartReview: boolean
  startingRerun: boolean
  rerunNotice: string
  onStartReReview: () => void
}) {
  return (
    <section className="border-b border-slate-200 bg-white px-4 py-3 xl:hidden">
      <div className="grid gap-3 min-[700px]:grid-cols-[220px_minmax(0,1fr)_210px]">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
            <div className="text-lg font-semibold text-slate-950">{totalChanges}</div>
            <div className="text-[11px] text-slate-500">差异</div>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 px-2 py-2">
            <div className="text-lg font-semibold text-red-600">{redDiffCount}</div>
            <div className="text-[11px] text-red-600">红线</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-2">
            <div className="text-lg font-semibold text-amber-600">{yellowDiffCount}</div>
            <div className="text-[11px] text-amber-600">关注</div>
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-950">AI 差异披露与合规建议</span>
            <Badge variant={selectedDiff?.risk_level === 'red' ? 'destructive' : 'outline'}>
              {selectedDiff ? `${selectedIndex + 1}/${visibleCount} · ${riskLabel(selectedDiff.risk_level)}` : '暂无差异'}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-slate-600">
            {selectedDiff?.semantic_change || '比对只定位版本差异；红线或需谈判变化需要回到审核工作台进入再审核。'}
          </p>
          {selectedDiff && (
            <p className="mt-1 line-clamp-1 font-medium text-slate-700">
              风险变化：{riskChangeLabel(selectedDiff)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="destructive" disabled>
              驳回用印
            </Button>
            <Button size="sm" variant="outline" disabled>
              接受差异
            </Button>
          </div>
          <Button size="sm" disabled={!canStartReview || startingRerun} onClick={onStartReReview}>
            {startingRerun && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            进入风险再审核
          </Button>
          {rerunNotice && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-4 text-amber-700">
              {rerunNotice}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function DocumentPill({
  label,
  meta,
  fallback,
}: {
  label: string
  meta?: ComparisonDocumentMeta | null
  fallback: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
      <FileTextIcon className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-slate-500">{label} · {sourceLabel(meta)}</div>
        <div className="truncate text-xs font-semibold text-slate-800">{meta?.label || fallback}</div>
      </div>
    </div>
  )
}

function ComparePairPrimer({
  baselineName,
  selectedCompareName,
  hasCompareSource,
}: {
  baselineName: string
  selectedCompareName: string
  hasCompareSource: boolean
}) {
  const steps = [
    {
      label: '旧文件',
      value: baselineName,
      done: true,
      description: '默认使用当前合同源文件；需要时再进入高级选择切换旧稿。',
    },
    {
      label: '新文件 / 回传',
      value: hasCompareSource ? selectedCompareName : '等待上传客户回传版',
      done: hasCompareSource,
      description: '主路径是上传新文件；已有回传件只作为可选属性。',
    },
    {
      label: '输出',
      value: '差异列表 + 并排高亮 + 风险影响',
      done: false,
      description: '比对结果进入版本流，必要时触发再审核。',
    },
  ]

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
      {steps.map((step, index) => (
        <div key={step.label} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${
                step.done ? 'bg-emerald-600 text-white' : 'bg-indigo-100 text-indigo-700'
              }`}>
                {step.done ? '✓' : index + 1}
              </span>
              <span className="text-sm font-semibold text-slate-950">{step.label}</span>
            </div>
            <Badge variant={step.done ? 'default' : 'outline'} className="ml-auto shrink-0">{step.done ? '已就绪' : '待完成'}</Badge>
          </div>
          <p className="mt-1 truncate text-xs font-medium text-slate-800">{step.value}</p>
        </div>
      ))}
    </section>
  )
}

function CompareFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-1 max-h-28 overflow-auto rounded-md bg-slate-50 p-2 text-slate-700">{value}</div>
    </div>
  )
}

function MergedDiffView({
  diffs,
  selectedDiffId,
  onSelect,
}: {
  diffs: DiffItem[]
  selectedDiffId: string | null
  onSelect: (diffId: string) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto rounded-xl bg-white shadow-sm">
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">合并审阅视图</div>
        <div className="mt-1 text-sm text-slate-600">按差异顺序同时展示旧文件、新文件、业务影响和风险等级。</div>
      </div>
      <div className="space-y-3 p-5">
        {diffs.length === 0 ? (
          <div className="grid min-h-[320px] place-items-center text-center text-slate-400">
            <div>
              <CheckCircleIcon className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
              <p>未发现差异</p>
            </div>
          </div>
        ) : diffs.map((diff, index) => {
          const active = diff.id === selectedDiffId
          return (
            <button
              key={diff.id}
              type="button"
              id={`diff-merge-${diff.id}`}
              onClick={() => onSelect(diff.id)}
              className={`w-full rounded-lg border p-4 text-left transition ${
                active ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200'
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">#{index + 1}</Badge>
                  <Badge
                    variant={diff.risk_level === 'red' ? 'destructive' : 'outline'}
                    className={diff.risk_level === 'yellow' ? 'border-amber-200 bg-amber-50 text-amber-700' : undefined}
                  >
                    {diff.risk_level === 'red' ? '红线' : diff.risk_level === 'yellow' ? '需关注' : '低风险'}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {diff.diff_type === 'deleted' ? '删除' : diff.diff_type === 'added' ? '新增' : '修改/移动'}
                  </span>
                </div>
                <span className="text-xs text-slate-400">点击同步左侧差异导航</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-red-100 bg-red-50/60 p-3">
                  <div className="text-[11px] font-medium text-red-700">旧文件 / 基准</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{diff.baseline_text || '无'}</p>
                </div>
                <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="text-[11px] font-medium text-emerald-700">新文件 / 回传</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{diff.compare_text || '无'}</p>
                </div>
              </div>
              <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                {diff.semantic_change || '未生成业务影响说明'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CompareSetupWorkspace({
  contractId,
  baselineContract,
  candidateContracts,
  versionOptions,
  excludedCandidateCount,
  selectedBaselineDocId,
  setSelectedBaselineDocId,
  selectedBaselineVersionId,
  setSelectedBaselineVersionId,
  selectedCompareDocId,
  setSelectedCompareDocId,
  selectedCompareVersionId,
  setSelectedCompareVersionId,
  startingComparison,
  onStartComparison,
}: {
  contractId: string
  baselineContract: ContractDetail | null
  candidateContracts: CompareCandidateOption[]
  versionOptions: ContractVersionOption[]
  excludedCandidateCount: number
  selectedBaselineDocId: string
  setSelectedBaselineDocId: (value: string) => void
  selectedBaselineVersionId: string
  setSelectedBaselineVersionId: (value: string) => void
  selectedCompareDocId: string
  setSelectedCompareDocId: (value: string) => void
  selectedCompareVersionId: string
  setSelectedCompareVersionId: (value: string) => void
  startingComparison: boolean
  onStartComparison: () => void
}) {
  const [showAdvancedSelection, setShowAdvancedSelection] = useState(false)
  const selectedBaselineCandidate = candidateContracts.find((contract) => contract.id === selectedBaselineDocId)
  const selectedBaselineVersion = versionOptions.find((version) => version.id === selectedBaselineVersionId)
  const selectedCandidate = candidateContracts.find((contract) => contract.id === selectedCompareDocId)
  const selectedVersion = versionOptions.find((version) => version.id === selectedCompareVersionId)
  const comparableVersions = versionOptions.filter((version) => version.source === 'manual_revision')
  const baselineOptions = versionOptions.filter((version) => version.source === 'original' || version.source === 'manual_revision')
  const recommendedCandidates = candidateContracts.filter((contract) => contract.relation_status === 'recommended')
  const manualConfirmCandidates = candidateContracts.filter((contract) => contract.relation_status === 'manual_confirm')
  const selectedBaselineName = selectedBaselineVersion
    ? `v${selectedBaselineVersion.version_number} ${selectedBaselineVersion.source === 'original' ? '源文件' : '客户回传版'}`
    : selectedBaselineCandidate?.filename || baselineContract?.filename || '当前合同'
  const selectedCompareName = selectedVersion
    ? `v${selectedVersion.version_number} 客户回传版`
    : selectedCandidate?.filename || ''
  const hasCompareSource = Boolean(selectedVersion || selectedCandidate)
  const hasExistingCompareOptions = comparableVersions.length > 0 || recommendedCandidates.length > 0 || manualConfirmCandidates.length > 0
  const uploadHref = buildCustomerReturnUploadHref(contractId, 'compare')
  const noCandidateReason = excludedCandidateCount > 0
    ? `系统发现 ${excludedCandidateCount} 份关系不明确的已完成合同，但不会默认展示为新文件。请优先上传客户回传版；确认同一业务文件时再进入高级选择。`
    : '当前没有可明确比对的新文件。请上传客户回传版或人工修订版后再开始比对。'
  const resetCompareSource = () => {
    setSelectedCompareDocId('')
    setSelectedCompareVersionId('')
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <Link href={buildContractsCenterHref()} className="hover:text-slate-900">合同中心</Link>
              <span>/</span>
              <Link href={buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' })} className="hover:text-slate-900">审核工作台</Link>
              <span>/</span>
              <span>文档比对</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-950">文档比对工作台</h1>
            <p className="mt-1 text-sm text-slate-500">
              主路径是确认旧文件、上传客户回传/新文件、开始比对。版本和候选合同只作为属性辅助，不默认占用文件画布。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={buildContractsCenterHref()}>
              <Button variant="outline">
                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                返回合同中心
              </Button>
            </Link>
            <Link href={buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' })}>
              <Button variant="outline">
                返回审核工作台
              </Button>
            </Link>
            <Link href={uploadHref}>
              <Button variant={hasCompareSource ? 'outline' : 'default'}>
                <UploadIcon className="mr-2 h-4 w-4" />
                上传新文件 / 客户回传版
              </Button>
            </Link>
            <Button onClick={onStartComparison} disabled={!hasCompareSource || startingComparison}>
              {startingComparison ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GitCompareIcon className="mr-2 h-4 w-4" />
              )}
              开始比对
            </Button>
          </div>
        </header>

        <ComparePairPrimer
          baselineName={selectedBaselineName}
          selectedCompareName={selectedCompareName}
          hasCompareSource={hasCompareSource}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="space-y-4">
            <section className="grid gap-3 lg:grid-cols-[minmax(220px,0.85fr)_minmax(320px,1.15fr)_240px]">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileTextIcon className="h-4 w-4 text-indigo-500" />
                    <h2 className="font-semibold text-slate-950">基准文件</h2>
                  </div>
                  <Badge variant="outline">可切换</Badge>
                </div>
                <p className="line-clamp-2 text-sm font-semibold text-slate-900">{selectedBaselineName}</p>
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  <p>合同编号：{baselineContract?.contract_no || '未记录'}</p>
                  <p>客户：{baselineContract?.party_b_name || '未记录'}</p>
                  <p>报价：{baselineContract?.quote_id || '未绑定'}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  onClick={() => setShowAdvancedSelection((value) => !value)}
                >
                  {showAdvancedSelection ? '收起属性选择' : '系统版本库 / 基准切换'}
                </Button>
              </div>

              <div className={`rounded-lg border bg-white p-4 shadow-sm ${
                hasCompareSource ? 'border-emerald-200' : 'border-amber-200'
              }`}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <UploadIcon className="h-4 w-4 text-indigo-500" />
                    <h2 className="font-semibold text-slate-950">回传文件（上传为主）</h2>
                  </div>
                  <Badge variant={hasCompareSource ? 'default' : 'outline'}>
                    {hasCompareSource ? '已选择' : '待上传'}
                  </Badge>
                </div>
                {hasCompareSource ? (
                  <>
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900">{selectedCompareName}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      已明确本次比对的新文件来源。需要替换时优先重新上传回传件；已有版本只作为属性选择。
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={resetCompareSource}>
                        清除选择
                      </Button>
                      <Link href={uploadHref}>
                        <Button type="button" variant="outline" size="sm">
                          重新上传
                        </Button>
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-900">还没有新文件</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      对比应以实时上传的客户回传版为主。没有明确回传件时，不把历史版本和候选合同摊在文件画布里。
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href={uploadHref}>
                        <Button type="button" size="sm">
                          <UploadIcon className="mr-2 h-4 w-4" />
                          上传新文件
                        </Button>
                      </Link>
                      {hasExistingCompareOptions && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowAdvancedSelection(true)}
                        >
                          选择已有回传
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GitCompareIcon className="h-4 w-4 text-indigo-500" />
                    <h2 className="font-semibold text-slate-950">执行全文审计</h2>
                  </div>
                  <Badge variant={hasCompareSource ? 'default' : 'outline'}>
                    {hasCompareSource ? '可开始' : '等待新文件'}
                  </Badge>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  执行 1:1 全文比对审计，输出差异列表、并排高亮和风险影响，不覆盖原合同。
                </p>
                <Button
                  type="button"
                  className="mt-4 w-full"
                  onClick={onStartComparison}
                  disabled={!hasCompareSource || startingComparison}
                >
                  {startingComparison ? (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <GitCompareIcon className="mr-2 h-4 w-4" />
                  )}
                  执行审计
                </Button>
              </div>
            </section>

            {!hasCompareSource && (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                {noCandidateReason}
              </section>
            )}

            {showAdvancedSelection && (
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-950">高级选择</h2>
                    <p className="text-sm text-slate-500">
                      只在明确知道要比较哪两个已有文件时使用。普通路径建议直接上传客户回传版。
                    </p>
                  </div>
                  <Badge variant="outline">已有回传 {comparableVersions.length} / 候选 {candidateContracts.length}</Badge>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-slate-900">旧文件来源</div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedBaselineDocId('')
                        setSelectedBaselineVersionId('')
                      }}
                      className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                        !selectedBaselineDocId && !selectedBaselineVersionId
                          ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                          : 'border-slate-200 bg-slate-50 hover:border-indigo-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="break-words font-medium text-slate-900">
                          当前合同：{baselineContract?.filename || '未命名文件'}
                        </p>
                        {!selectedBaselineDocId && !selectedBaselineVersionId && <Badge>已选</Badge>}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">默认旧稿，适用于大多数客户回传对比。</p>
                    </button>

                    {baselineOptions.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-500">当前合同版本流</div>
                        {baselineOptions.map((version) => {
                          const active = version.id === selectedBaselineVersionId
                          const disabled = version.id === selectedCompareVersionId
                          return (
                            <button
                              key={version.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                setSelectedBaselineVersionId(version.id)
                                setSelectedBaselineDocId('')
                              }}
                              className={`w-full rounded-lg border p-3 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                active
                                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                                  : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-semibold text-slate-900">
                                  v{version.version_number} · {version.source === 'original' ? '源文件' : '客户回传版'}
                                </span>
                                {active ? <Badge>已选</Badge> : disabled ? <Badge variant="outline">已作为新文件</Badge> : null}
                              </div>
                              <p className="mt-1 text-slate-500">{version.change_summary || '当前合同版本'}</p>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-slate-900">新文件来源</div>
                    {comparableVersions.length > 0 ? (
                      <div className="space-y-2">
                        {comparableVersions.map((version) => {
                          const active = version.id === selectedCompareVersionId
                          return (
                            <button
                              key={version.id}
                              type="button"
                              onClick={() => {
                                setSelectedCompareVersionId(version.id)
                                setSelectedCompareDocId('')
                              }}
                              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                active
                                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                                  : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="line-clamp-2 text-sm font-semibold text-slate-900">
                                  v{version.version_number} 客户回传版
                                </p>
                                {active && <Badge>已选</Badge>}
                              </div>
                              <div className="mt-2 space-y-1 text-xs text-slate-500">
                                <p>{version.change_summary || '客户回传或人工修订版本'}</p>
                                <p>类型：{version.mime_type || '未记录'}</p>
                                <p>创建：{version.created_at ? new Date(version.created_at).toLocaleString('zh-CN') : '未记录'}</p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                        当前合同版本流没有客户回传版。建议上传新文件；如果必须从候选合同中选择，请只选确认属于同一业务文件的合同。
                      </div>
                    )}

                    {candidateContracts.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
                          <span>候选合同（人工确认后作为新文件）</span>
                          <span>推荐 {recommendedCandidates.length} / 需确认 {manualConfirmCandidates.length}</span>
                        </div>
                        {candidateContracts.slice(0, 8).map((contract) => {
                          const active = contract.id === selectedCompareDocId
                          const disabled = contract.id === selectedBaselineDocId
                          return (
                            <button
                              key={contract.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                setSelectedCompareDocId(contract.id)
                                setSelectedCompareVersionId('')
                              }}
                              className={`w-full rounded-lg border p-3 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                active
                                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                                  : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="line-clamp-2 font-semibold text-slate-900">{contract.filename || contract.id}</span>
                                {active ? (
                                  <Badge>已选</Badge>
                                ) : (
                                  <Badge variant={contract.relation_status === 'recommended' ? 'default' : 'outline'}>
                                    {contract.relation_status === 'recommended' ? '推荐' : '需确认'}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-slate-500">客户：{contract.party_b_name || '未记录'}</p>
                              <p className="mt-1 text-slate-500">关系：{contract.relation_reason}</p>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </main>

          <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <GitCompareIcon className="h-4 w-4 text-indigo-500" />
              <h2 className="font-semibold text-slate-950">输出闭环</h2>
            </div>
            <div className="space-y-3 text-sm">
              <CompareStep done label="1. 确认旧文件" value={selectedBaselineName} />
              <CompareStep done={hasCompareSource} label="2. 上传/选择新文件" value={hasCompareSource ? selectedCompareName : '等待上传客户回传版'} />
              <CompareStep done={false} label="3. 生成差异列表" value="删除 / 新增 / 修改 / 风险等级" />
              <CompareStep done={false} label="4. 并排高亮复核" value="左旧右新，差异可跳转" />
            </div>
            <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              文件属性只用于辅助选择和记录关系，不参与左右文件画布渲染。比对结果不会替代合同审核结论；红线差异仍应进入风险审核或再审核。
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

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href={buildContractsCenterHref()}>
            <Button variant="outline" className="w-full">
              返回合同中心
            </Button>
          </Link>
          <Link href={buildContractWorkbenchHref(contractId, { panel: 'review', from: 'compare' })}>
            <Button variant="outline" className="w-full">
              返回审核工作台
            </Button>
          </Link>
          <Link href={buildCustomerReturnUploadHref(contractId, 'compare')}>
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
