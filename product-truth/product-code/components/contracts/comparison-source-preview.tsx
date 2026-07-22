'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangleIcon, Loader2Icon, RefreshCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrowserWordPreview } from '@/app/contracts/[id]/review/BrowserWordPreview'
import { cn } from '@/lib/utils'

export interface ComparisonSourceIdentity {
  id: string
  comparison_id: string
  org_id: string
  role: 'old' | 'new'
  contract_id: string
  storage_path: string
  file_name: string
  file_size: number
  mime_type: string
  file_sha256: string
  text_sha256: string
  render_mode: 'native-pdf' | 'browser-ooxml'
  page_map: {
    page_count: number
    locator: 'rendered' | 'provisional'
    pages: Array<{
      page: number
      start: number
      end: number
      locator: 'rendered' | 'provisional'
      line_boxes?: Array<{
        start: number
        end: number
        text: string
        left: number
        top: number
        width: number
        height: number
      }>
    }>
  }
  captured_at: string
}

export interface ComparisonDiffPosition {
  page?: number
  start?: number
  end?: number
  start_offset_utf16?: number
  end_offset_utf16?: number
  progress?: number
  normalized_progress?: number
  page_progress?: number
  locator?: 'rendered' | 'provisional'
  line_boxes?: Array<{
    left: number
    top: number
    width: number
    height: number
  }>
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

function FrozenPdfPage({
  comparisonId,
  role,
  page,
  source,
  zoom,
  selectedPosition,
}: {
  comparisonId: string
  role: 'old' | 'new'
  page: number
  source: ComparisonSourceIdentity
  zoom: number
  selectedPosition?: ComparisonDiffPosition | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(page <= 2)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [pageAspectRatio, setPageAspectRatio] = useState<string>()

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '900px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let objectUrl = ''
    const identity = new URLSearchParams({
      storage_path: source.storage_path,
      source_hash: source.file_sha256,
      source_text_hash: source.text_sha256,
      nonce: String(nonce),
    })
    setError('')
    setUrl('')
    setPageAspectRatio(undefined)
    void fetch(`/api/comparisons/${comparisonId}/sources/${role}/pages/${page}?${identity}`, {
      headers: authHeaders(),
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(responseMessage(payload, `第 ${page} 页加载失败`))
      }
      objectUrl = URL.createObjectURL(await response.blob())
      setUrl(objectUrl)
    }).catch((loadError) => {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      setError(loadError instanceof Error ? loadError.message : `第 ${page} 页加载失败`)
    })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [comparisonId, nonce, page, role, source.file_sha256, source.storage_path, source.text_sha256, visible])

  const isSelected = selectedPosition?.page === page
  const progress = Math.max(0, Math.min(1, selectedPosition?.page_progress ?? 0))

  return (
    <div
      ref={hostRef}
      data-comparison-page={page}
      className="mx-auto mb-5 min-h-[360px] w-full scroll-mt-24"
      aria-label={`${role === 'old' ? '旧文件' : '新文件'}第 ${page} 页`}
    >
      <div
        className={cn('relative mx-auto overflow-hidden border bg-white shadow-lg', isSelected && 'ring-2 ring-indigo-500')}
        style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none', aspectRatio: pageAspectRatio }}
      >
        {url ? <img
          src={url}
          alt={`${source.file_name} 第 ${page} 页`}
          className="block h-auto w-full max-w-none"
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            if (naturalWidth > 0 && naturalHeight > 0) {
              setPageAspectRatio(`${naturalWidth} / ${naturalHeight}`)
            }
          }}
        /> : error ? (
          <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-amber-800">
            <AlertTriangleIcon className="size-5" />
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => setNonce((value) => value + 1)}><RefreshCcwIcon />重试</Button>
          </div>
        ) : (
          <div className="flex h-full min-h-80 items-center justify-center text-sm text-slate-500"><Loader2Icon className="mr-2 size-5 animate-spin" />正在读取第 {page} 页…</div>
        )}
        {isSelected && selectedPosition?.line_boxes?.map((box, index) => (
          <div
            key={`${box.left}-${box.top}-${index}`}
            className="pointer-events-none absolute z-20 rounded-[2px] border-2 border-indigo-500 bg-indigo-300/25"
            style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
          />
        ))}
        {isSelected && !selectedPosition?.line_boxes?.length && (
          <div className="pointer-events-none absolute inset-x-2 z-20 h-8 rounded border-2 border-indigo-500 bg-indigo-300/20" style={{ top: `${Math.min(94, progress * 100)}%` }} />
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">第 {page}/{source.page_map.page_count} 页</p>
    </div>
  )
}

export function ComparisonSourcePreview({
  comparisonId,
  source,
  zoom,
  fitWidth = false,
  selectedDiffId,
  selectedText,
  selectedPosition,
}: {
  comparisonId: string
  source: ComparisonSourceIdentity
  zoom: number
  fitWidth?: boolean
  selectedDiffId?: string | null
  selectedText?: string | null
  selectedPosition?: ComparisonDiffPosition | null
}) {
  const pages = useMemo(
    () => Array.from({ length: source.page_map.page_count }, (_, index) => index + 1),
    [source.page_map.page_count],
  )
  const wordSourceIdentity = useMemo(() => ({
    storage_path: source.storage_path,
    source_hash: source.file_sha256,
    source_text_hash: source.text_sha256,
  }), [source.file_sha256, source.storage_path, source.text_sha256])
  const wordSourcePosition = useMemo(() => selectedPosition ? ({
    start_offset_utf16: selectedPosition.start_offset_utf16 ?? selectedPosition.start,
    end_offset_utf16: selectedPosition.end_offset_utf16 ?? selectedPosition.end,
    normalized_progress: selectedPosition.normalized_progress ?? selectedPosition.progress,
  }) : null, [selectedPosition])

  if (source.render_mode === 'browser-ooxml') {
    return (
      <BrowserWordPreview
        contractId={source.contract_id}
        filename={source.file_name}
        sourceIdentity={wordSourceIdentity}
        expectedFileSize={source.file_size}
        ticketEndpoint={`/api/comparisons/${comparisonId}/sources/${source.role}`}
        zoom={zoom}
        fitWidth={fitWidth}
        selectedRiskId={selectedDiffId}
        selectedSourceText={selectedText}
        selectedSourcePosition={wordSourcePosition}
      />
    )
  }

  return (
    <div className="min-w-full px-3 py-4">
      {pages.map((page) => (
        <FrozenPdfPage
          key={page}
          comparisonId={comparisonId}
          role={source.role}
          page={page}
          source={source}
          zoom={fitWidth ? 100 : zoom}
          selectedPosition={selectedPosition}
        />
      ))}
    </div>
  )
}
