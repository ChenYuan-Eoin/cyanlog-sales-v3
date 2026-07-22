'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  GitCompareIcon,
  Link2Icon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCcwIcon,
  Unlink2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ComparisonSourcePreview,
  type ComparisonDiffPosition,
  type ComparisonSourceIdentity,
} from '@/components/contracts/comparison-source-preview'
import {
  nextCompareViewerZoom,
  synchronizedTargetScrollTop,
  type CompareViewerScrollMode,
} from '@/lib/contracts/compare-viewer'
import { cn } from '@/lib/utils'

interface DiffItem {
  id: string
  diff_type: 'deleted' | 'added' | 'modified' | 'moved'
  baseline_position?: ComparisonDiffPosition | null
  compare_position?: ComparisonDiffPosition | null
  baseline_text?: string | null
  compare_text?: string | null
  semantic_change?: string | null
  risk_level?: 'red' | 'yellow' | 'green' | null
  sort_order: number
}

interface ComparisonData {
  id: string
  contract_id: string
  org_id: string
  baseline_type: string
  status: string
  ai_summary?: string | null
  error_message?: string | null
  diffs: DiffItem[]
  sources: {
    old: ComparisonSourceIdentity
    new: ComparisonSourceIdentity
  }
  created_at: string
  completed_at?: string | null
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: string | { message?: string } }).error
  if (typeof error === 'string') return error || fallback
  return error?.message || fallback
}

function diffLabel(type: DiffItem['diff_type']) {
  if (type === 'deleted') return '删除'
  if (type === 'added') return '新增'
  if (type === 'moved') return '移动'
  return '修改'
}

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function shortHash(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

export default function ContractComparePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const contractId = params.id as string
  const comparisonId = searchParams.get('comparison_id')
  const [comparison, setComparison] = useState<ComparisonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportError, setReportError] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [fitWidth, setFitWidth] = useState(true)
  const [scrollMode, setScrollMode] = useState<CompareViewerScrollMode>('synchronized')
  const oldPaneRef = useRef<HTMLDivElement>(null)
  const newPaneRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const differenceJumpRef = useRef(false)
  const syncFrameRef = useRef<number | null>(null)
  const jumpTimerRef = useRef<number | null>(null)

  const fetchComparison = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const endpoint = comparisonId
        ? `/api/comparisons/${comparisonId}`
        : `/api/contracts/${contractId}/compare`
      const response = await fetch(endpoint, { headers: authHeaders(), cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.data) {
        throw new Error(responseMessage(payload, '获取比对结果失败'))
      }
      setComparison(payload.data as ComparisonData)
      setSelectedIndex(0)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '获取比对结果失败')
    } finally {
      setLoading(false)
    }
  }, [comparisonId, contractId])

  useEffect(() => {
    void fetchComparison()
  }, [fetchComparison])

  useEffect(() => () => {
    if (syncFrameRef.current !== null) window.cancelAnimationFrame(syncFrameRef.current)
    if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current)
  }, [])

  const diffs = useMemo(() => comparison?.diffs ?? [], [comparison?.diffs])
  const selectedDiff = diffs[selectedIndex] || null
  const stats = useMemo(() => ({
    deleted: diffs.filter((item) => item.diff_type === 'deleted').length,
    added: diffs.filter((item) => item.diff_type === 'added').length,
    modified: diffs.filter((item) => item.diff_type === 'modified').length,
    moved: diffs.filter((item) => item.diff_type === 'moved').length,
  }), [diffs])

  const syncScroll = useCallback((sourceRole: 'old' | 'new') => {
    if (syncingRef.current || differenceJumpRef.current) return
    const source = sourceRole === 'old' ? oldPaneRef.current : newPaneRef.current
    const target = sourceRole === 'old' ? newPaneRef.current : oldPaneRef.current
    if (!source || !target) return
    const targetTop = synchronizedTargetScrollTop(scrollMode, {
      scrollTop: source.scrollTop,
      scrollHeight: source.scrollHeight,
      clientHeight: source.clientHeight,
    }, {
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
    if (targetTop === null) return
    syncingRef.current = true
    target.scrollTop = targetTop
    if (syncFrameRef.current !== null) window.cancelAnimationFrame(syncFrameRef.current)
    syncFrameRef.current = window.requestAnimationFrame(() => {
      syncingRef.current = false
      syncFrameRef.current = null
    })
  }, [scrollMode])

  const selectDiff = useCallback((index: number) => {
    if (!comparison || diffs.length === 0) return
    const bounded = Math.max(0, Math.min(diffs.length - 1, index))
    differenceJumpRef.current = true
    if (jumpTimerRef.current !== null) window.clearTimeout(jumpTimerRef.current)
    jumpTimerRef.current = window.setTimeout(() => {
      differenceJumpRef.current = false
      jumpTimerRef.current = null
    }, 700)
    setSelectedIndex(bounded)
    const diff = diffs[bounded]
    window.requestAnimationFrame(() => {
      const targets: Array<[HTMLDivElement | null, ComparisonDiffPosition | null | undefined]> = [
        [oldPaneRef.current, diff.baseline_position],
        [newPaneRef.current, diff.compare_position],
      ]
      targets.forEach(([pane, position]) => {
        if (!pane || !position?.page) return
        pane.querySelector<HTMLElement>(`[data-comparison-page="${position.page}"]`)
          ?.scrollIntoView({ behavior: 'auto', block: 'center' })
      })
    })
  }, [comparison, diffs])

  const downloadReport = useCallback(async () => {
    if (!comparison) return
    setReportLoading(true)
    setReportError('')
    try {
      const response = await fetch(`/api/comparisons/${comparison.id}/report`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(responseMessage(payload, '差异报告生成失败'))
      }
      const blob = await response.blob()
      if (blob.size < 1) throw new Error('差异报告文件为空')
      const disposition = response.headers.get('content-disposition') || ''
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const name = encodedName ? decodeURIComponent(encodedName) : `合同差异报告-${comparison.id}.docx`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (downloadError) {
      setReportError(downloadError instanceof Error ? downloadError.message : '差异报告生成失败')
    } finally {
      setReportLoading(false)
    }
  }, [comparison])

  if (loading) {
    return <div className="flex h-dvh items-center justify-center bg-slate-100 text-sm text-slate-600"><Loader2Icon className="mr-2 size-5 animate-spin" />正在读取冻结的旧/新原文件…</div>
  }
  if (error || !comparison) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-100 p-8 text-center">
        <p className="max-w-xl text-sm text-red-700">{error || '未找到可审计比对记录'}</p>
        <Button variant="outline" onClick={() => void fetchComparison()}><RefreshCcwIcon />重新加载</Button>
      </div>
    )
  }

  return (
    <div className="flex h-dvh min-h-[640px] overflow-hidden bg-slate-100" data-testid="g6-compare-workbench">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 p-3">
          <Link href="/contracts/compare"><Button variant="ghost" size="sm"><ArrowLeftIcon />返回文件选择</Button></Link>
          <div className="mt-3 flex items-center gap-2"><GitCompareIcon className="size-5 text-indigo-600" /><h1 className="font-semibold">文档对比</h1></div>
          <p className="mt-1 text-xs text-slate-500">{diffs.length} 处已定位差异</p>
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-3 text-[11px]">
          <span className="rounded bg-red-50 px-2 py-1 text-red-700">删除 {stats.deleted}</span>
          <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">新增 {stats.added}</span>
          <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">修改 {stats.modified}</span>
          <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">移动 {stats.moved}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-label="差异列表">
          {diffs.length === 0 ? <p className="p-4 text-sm text-slate-500">两份冻结文本没有可报告差异。</p> : diffs.map((diff, index) => (
            <button
              key={diff.id}
              type="button"
              onClick={() => selectDiff(index)}
              className={cn('w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50', index === selectedIndex && 'bg-indigo-50 ring-1 ring-inset ring-indigo-200')}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[10px]">{diffLabel(diff.diff_type)}</Badge>
                <span className="text-[10px] text-slate-400">{index + 1}/{diffs.length}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-700">{diff.semantic_change || diff.baseline_text || diff.compare_text}</p>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 overflow-x-auto border-b border-slate-200 bg-white px-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => selectDiff(Math.max(0, selectedIndex - 1))}><ChevronLeftIcon /></Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">旧/新原文件对比</p>
              <p className="text-[10px] text-slate-500">创建时快照 · {new Date(comparison.created_at).toLocaleString('zh-CN')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-md border border-slate-200">
              <Button variant="ghost" size="icon-sm" onClick={() => { setFitWidth(false); setZoom((value) => nextCompareViewerZoom(value, 'out')) }} aria-label="缩小"><ZoomOutIcon /></Button>
              <span className="w-12 text-center text-[11px]">{fitWidth ? '适宽' : `${zoom}%`}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => { setFitWidth(false); setZoom((value) => nextCompareViewerZoom(value, 'in')) }} aria-label="放大"><ZoomInIcon /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => { setZoom(100); setFitWidth(true) }} aria-label="适合宽度"><Maximize2Icon /></Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setScrollMode((value) => value === 'synchronized' ? 'independent' : 'synchronized')}>
              {scrollMode === 'synchronized' ? <Link2Icon /> : <Unlink2Icon />}{scrollMode === 'synchronized' ? '同步滚动' : '独立滚动'}
            </Button>
            <Button size="sm" onClick={() => void downloadReport()} disabled={reportLoading || comparison.status !== 'completed'}>
              {reportLoading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}导出报告
            </Button>
          </div>
        </header>

        {(reportError || comparison.error_message) && <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="alert">{reportError || comparison.error_message}</div>}
        {comparison.ai_summary && <div className="shrink-0 border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-xs text-indigo-900"><span className="font-semibold">差异摘要：</span>{comparison.ai_summary}</div>}

        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-slate-300">
          {(['old', 'new'] as const).map((role) => {
            const source = comparison.sources[role]
            const position = role === 'old' ? selectedDiff?.baseline_position : selectedDiff?.compare_position
            const text = role === 'old' ? selectedDiff?.baseline_text : selectedDiff?.compare_text
            return (
              <section key={role} className="flex min-w-0 flex-col overflow-hidden bg-slate-200" aria-label={role === 'old' ? '旧文件原文' : '新文件原文'}>
                <div className={cn('shrink-0 border-b px-3 py-2', role === 'old' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><Badge className={role === 'old' ? 'bg-red-600' : 'bg-emerald-600'}>{role === 'old' ? '旧文件' : '新文件'}</Badge><p className="truncate text-xs font-semibold">{source.file_name}</p></div>
                      <p className="mt-1 truncate font-mono text-[9px] text-slate-500">SHA {shortHash(source.file_sha256)} · {fileSize(source.file_size)} · {source.page_map.page_count} 页</p>
                    </div>
                  </div>
                </div>
                <div
                  ref={role === 'old' ? oldPaneRef : newPaneRef}
                  onScroll={() => syncScroll(role)}
                  className="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain"
                  data-testid={`${role}-source-scroll`}
                  data-scroll-mode={scrollMode}
                >
                  <ComparisonSourcePreview
                    comparisonId={comparison.id}
                    source={source}
                    zoom={zoom}
                    fitWidth={fitWidth}
                    selectedDiffId={selectedDiff?.id}
                    selectedText={text}
                    selectedPosition={position}
                  />
                </div>
              </section>
            )
          })}
        </div>

        <footer className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-3">
          <div className="min-w-0 text-xs text-slate-600">
            {selectedDiff ? <><span className="font-semibold">{diffLabel(selectedDiff.diff_type)}：</span><span className="line-clamp-1">{selectedDiff.semantic_change || '双侧原文已定位'}</span></> : '没有差异项'}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => selectDiff(selectedIndex - 1)} disabled={selectedIndex <= 0}><ChevronLeftIcon />上一处</Button>
            <span className="min-w-16 text-center text-xs">{diffs.length ? `${selectedIndex + 1}/${diffs.length}` : '0/0'}</span>
            <Button variant="outline" size="sm" onClick={() => selectDiff(selectedIndex + 1)} disabled={selectedIndex >= diffs.length - 1}>下一处<ChevronRightIcon /></Button>
          </div>
        </footer>
      </main>
    </div>
  )
}
