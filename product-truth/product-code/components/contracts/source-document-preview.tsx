'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type UIEventHandler,
} from 'react'
import { Badge } from '@/components/ui/badge'
import { AlertTriangleIcon, ExternalLinkIcon, FileTextIcon, Loader2Icon, MapPinIcon } from 'lucide-react'
import { inferDocumentLocator } from '@/lib/contracts/document-locator'
import { fitWidthScale } from '@/lib/contracts/compare-viewer'
import {
  focusEvidenceText,
  normalizeEvidenceNeedle,
  renderedPageElements,
  type EvidenceFocusState,
  type EvidenceSourceRange,
} from './source-document-evidence'

export interface SourceDocumentPreviewFile {
  label: string
  fileUrl?: string | null
  mimeType?: string | null
  storagePath?: string | null
}

export interface SourceDocumentPreviewProps {
  file: SourceDocumentPreviewFile | null | undefined
  title?: string
  selectedText?: string
  sourceText?: string | null
  sourceRange?: EvidenceSourceRange | null
  fallbackLabel?: string
  minHeightClassName?: string
  surfaceMinHeightClassName?: string
  frameHeightClassName?: string
  zoomMode?: 'fit-width' | 'manual'
  zoomPercent?: number
  scrollViewportRef?: MutableRefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
  onViewerCapabilitiesChange?: (capabilities: SourceDocumentViewerCapabilities) => void
}

export interface SourceDocumentViewerCapabilities {
  kind: 'docx' | 'pdf' | 'unavailable'
  controlledScroll: boolean
  controlledZoom: boolean
  fidelity: 'browser-approximation' | 'native-pdf' | 'unavailable'
}

function isPdf(file: SourceDocumentPreviewFile | null | undefined) {
  return Boolean(file?.mimeType?.includes('pdf') || (file?.label || '').toLowerCase().endsWith('.pdf'))
}

function isDocx(file: SourceDocumentPreviewFile | null | undefined) {
  return Boolean(
    file?.mimeType?.includes('wordprocessingml.document') ||
    (file?.label || '').toLowerCase().endsWith('.docx')
  )
}

function needsAuthorizedPreviewFetch(url: string | null | undefined) {
  return Boolean(url?.startsWith('/api/'))
}

function hasVisibleDocxRender(container: HTMLElement) {
  const pageCount = renderedPageElements(container).length
  const textLength = (container.textContent || '').replace(/\s+/g, '').length
  const elementCount = container.querySelectorAll('*').length
  return pageCount > 0 || textLength > 0 || elementCount > 3
}

export function SourceDocumentPreview({
  file,
  title = '原件预览',
  selectedText,
  sourceText,
  sourceRange,
  fallbackLabel = '未绑定文件',
  minHeightClassName = 'min-h-[680px]',
  surfaceMinHeightClassName = 'min-h-[680px]',
  frameHeightClassName = 'h-[720px]',
  zoomMode = 'fit-width',
  zoomPercent = 100,
  scrollViewportRef,
  onScroll,
  onViewerCapabilitiesChange,
}: SourceDocumentPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const internalScrollViewportRef = useRef<HTMLDivElement | null>(null)
  const naturalPageWidthRef = useRef(0)
  const [authorizedPreviewUrl, setAuthorizedPreviewUrl] = useState('')
  const [authorizedPreviewError, setAuthorizedPreviewError] = useState('')
  const [authorizedPreviewLoading, setAuthorizedPreviewLoading] = useState(false)
  const [docxState, setDocxState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [docxError, setDocxError] = useState('')
  const [evidenceFocusState, setEvidenceFocusState] = useState<EvidenceFocusState>('idle')
  const [evidencePageNumber, setEvidencePageNumber] = useState<number | null>(null)
  const [renderedPageCount, setRenderedPageCount] = useState<number | null>(null)
  const [fitZoom, setFitZoom] = useState(1)
  const rawFileUrl = file?.fileUrl || ''
  const requiresAuthorizedPreview = needsAuthorizedPreviewFetch(rawFileUrl)
  const effectiveFileUrl = requiresAuthorizedPreview ? authorizedPreviewUrl : rawFileUrl
  const waitingForAuthorizedPreview = Boolean(requiresAuthorizedPreview && rawFileUrl && authorizedPreviewLoading && !authorizedPreviewUrl)
  const canPreviewPdf = Boolean(effectiveFileUrl && isPdf(file))
  const canPreviewDocx = Boolean(effectiveFileUrl && isDocx(file))
  const locator = inferDocumentLocator(selectedText)
  const evidenceNeedle = useMemo(() => normalizeEvidenceNeedle(selectedText), [selectedText])
  const sourceRangeStart = sourceRange?.start ?? null
  const sourceRangeEnd = sourceRange?.end ?? null
  const renderModeLabel = canPreviewPdf
    ? 'PDF 原件'
    : canPreviewDocx && docxState === 'failed'
      ? 'DOCX 渲染降级'
      : canPreviewDocx
        ? 'DOCX 近似页预览'
        : '文本定位降级'
  const renderStatusLabel = canPreviewPdf
    ? '浏览器内嵌'
    : waitingForAuthorizedPreview
      ? '授权读取中'
      : authorizedPreviewError
        ? '读取失败'
    : canPreviewDocx
      ? docxState === 'ready'
        ? '已生成预览'
        : docxState === 'loading'
          ? '渲染中'
          : docxState === 'failed'
            ? '预览失败'
            : '等待渲染'
      : '降级'
  const renderStatusVariant = canPreviewPdf || (canPreviewDocx && docxState === 'ready')
    ? 'default'
    : docxState === 'failed' || authorizedPreviewError
      ? 'destructive'
      : 'outline'
  const effectiveZoom = zoomMode === 'fit-width'
    ? fitZoom
    : Math.min(1.8, Math.max(0.6, zoomPercent / 100))
  const previewStyle = {
    '--ones-docx-preview-zoom': String(effectiveZoom),
  } as CSSProperties

  const assignScrollViewport = useCallback((node: HTMLDivElement | null) => {
    internalScrollViewportRef.current = node
    if (scrollViewportRef) scrollViewportRef.current = node
  }, [scrollViewportRef])

  const updateFitZoom = useCallback(() => {
    if (zoomMode !== 'fit-width') return
    const viewport = internalScrollViewportRef.current
    const naturalPageWidth = naturalPageWidthRef.current
    if (!viewport || naturalPageWidth <= 0) return
    setFitZoom(fitWidthScale(viewport.clientWidth, naturalPageWidth))
  }, [zoomMode])

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''

    setAuthorizedPreviewUrl('')
    setAuthorizedPreviewError('')
    setAuthorizedPreviewLoading(false)

    if (!rawFileUrl || !requiresAuthorizedPreview) {
      return
    }

    async function loadAuthorizedPreview() {
      setAuthorizedPreviewLoading(true)
      try {
        const token = window.localStorage.getItem('token')
        if (!token) {
          throw new Error('未找到登录 token，无法读取私有文件预览。')
        }
        const response = await fetch(rawFileUrl, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          throw new Error(`文件读取失败：${response.status}`)
        }
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setAuthorizedPreviewUrl(objectUrl)
      } catch (error) {
        if (!cancelled) {
          setAuthorizedPreviewError(error instanceof Error ? error.message : '文件读取失败')
        }
      } finally {
        if (!cancelled) setAuthorizedPreviewLoading(false)
      }
    }

    void loadAuthorizedPreview()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [rawFileUrl, requiresAuthorizedPreview])

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    setDocxError('')
    setEvidenceFocusState('idle')
    setEvidencePageNumber(null)
    naturalPageWidthRef.current = 0
    setFitZoom(1)

    if (!canPreviewDocx || !effectiveFileUrl) {
      setDocxState('idle')
      setEvidenceFocusState('idle')
      setEvidencePageNumber(null)
      setRenderedPageCount(null)
      return
    }
    const docxFileUrl = effectiveFileUrl

    async function renderDocx() {
      setDocxState('loading')
      try {
        const response = await fetch(docxFileUrl)
        if (!response.ok) {
          throw new Error(`文件读取失败：${response.status}`)
        }
        const blob = await response.blob()
        if (cancelled || !containerRef.current) return
        const { renderAsync } = await import('docx-preview')
        containerRef.current.innerHTML = ''
        await renderAsync(blob, containerRef.current, undefined, {
          className: 'ones-docx-preview',
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: true,
          renderChanges: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          useBase64URL: true,
        })
        if (!cancelled) {
          if (!containerRef.current || !hasVisibleDocxRender(containerRef.current)) {
            throw new Error('DOCX 预览未生成可见页面；请打开原件复核，浏览器端不冒充 1:1 预览。')
          }
          const pageCount = renderedPageElements(containerRef.current).length
          const firstPage = renderedPageElements(containerRef.current)[0]
          naturalPageWidthRef.current = firstPage?.getBoundingClientRect().width || 0
          setRenderedPageCount(pageCount > 0 ? pageCount : null)
          setDocxState('ready')
        }
      } catch (error) {
        if (cancelled) return
        setDocxState('failed')
        setRenderedPageCount(null)
        setEvidencePageNumber(null)
        setEvidenceFocusState('missing')
        setDocxError(error instanceof Error ? error.message : 'DOCX 渲染失败')
      }
    }

    void renderDocx()
    return () => {
      cancelled = true
    }
  }, [canPreviewDocx, effectiveFileUrl])

  useEffect(() => {
    if (!canPreviewDocx || docxState !== 'ready') return
    const viewport = internalScrollViewportRef.current
    if (!viewport) return
    updateFitZoom()
    const observer = new ResizeObserver(updateFitZoom)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [canPreviewDocx, docxState, updateFitZoom])

  useEffect(() => {
    if (!onViewerCapabilitiesChange) return
    if (canPreviewPdf) {
      onViewerCapabilitiesChange({
        kind: 'pdf',
        controlledScroll: false,
        controlledZoom: false,
        fidelity: 'native-pdf',
      })
      return
    }
    if (canPreviewDocx) {
      onViewerCapabilitiesChange({
        kind: 'docx',
        controlledScroll: docxState === 'ready',
        controlledZoom: docxState === 'ready',
        fidelity: 'browser-approximation',
      })
      return
    }
    onViewerCapabilitiesChange({
      kind: 'unavailable',
      controlledScroll: false,
      controlledZoom: false,
      fidelity: 'unavailable',
    })
  }, [canPreviewDocx, canPreviewPdf, docxState, onViewerCapabilitiesChange])

  useEffect(() => {
    if (!canPreviewDocx) {
      setEvidenceFocusState('idle')
      setEvidencePageNumber(null)
      return
    }
    if (docxState === 'failed') {
      setEvidenceFocusState(evidenceNeedle ? 'missing' : 'idle')
      setEvidencePageNumber(null)
      return
    }
    if (docxState !== 'ready') {
      setEvidenceFocusState('idle')
      setEvidencePageNumber(null)
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const focusResult = focusEvidenceText(containerRef.current, selectedText, {
        sourceText,
        sourceRange: { start: sourceRangeStart, end: sourceRangeEnd },
      })
      setEvidenceFocusState(focusResult.state)
      setEvidencePageNumber(focusResult.pageNumber)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    canPreviewDocx,
    docxState,
    effectiveZoom,
    evidenceNeedle,
    selectedText,
    sourceRangeEnd,
    sourceRangeStart,
    sourceText,
  ])

  return (
    <div
      data-source-document-preview="true"
      className={`flex min-h-0 max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${minHeightClassName}`}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <FileTextIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold leading-5 text-slate-950">{title}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
            <Badge className="shrink-0" variant={canPreviewPdf || canPreviewDocx ? 'outline' : 'secondary'}>
              {renderModeLabel}
            </Badge>
            <Badge className="shrink-0" variant={renderStatusVariant}>
              {renderStatusLabel}
            </Badge>
            {canPreviewDocx && renderedPageCount ? (
              <Badge className="shrink-0" variant="outline">浏览器页数 {renderedPageCount}</Badge>
            ) : null}
            {evidencePageNumber ? (
              <Badge className="shrink-0" variant="default">定位第 {evidencePageNumber} 页</Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {file?.label || fallbackLabel}
            {file?.storagePath ? ` · ${file.storagePath}` : ''}
          </p>
        </div>
        {effectiveFileUrl ? (
          <a
            href={effectiveFileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`在新窗口打开原件：${file?.label || fallbackLabel}`}
            className="inline-flex min-h-12 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[0.8rem] font-medium text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            打开原件
          </a>
        ) : (
          <Badge variant="outline">无可访问文件</Badge>
        )}
      </div>

      {locator.mode !== 'missing' ? (
        <div className="border-b border-slate-100 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
              <MapPinIcon className="h-3.5 w-3.5 text-indigo-500" />
              {locator.clauseLabel}
            </span>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
              {locator.pageLabel}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-500">
              证据：{locator.evidencePreview}
            </span>
            {canPreviewDocx && evidenceNeedle ? (
              <Badge variant={evidenceFocusState === 'found' ? 'default' : 'outline'} className="shrink-0">
                {evidenceFocusState === 'found'
                  ? '已定位原文'
                  : evidenceFocusState === 'ambiguous'
                    ? '多处相同原文，需人工定位'
                    : evidenceFocusState === 'missing'
                      ? '需人工定位'
                      : '等待定位'}
              </Badge>
            ) : null}
            {canPreviewPdf ? (
              <Badge variant="outline" className="shrink-0">PDF 需按页人工定位</Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {waitingForAuthorizedPreview ? (
        <div className="flex min-h-[320px] flex-1 items-center justify-center bg-slate-50 p-4">
          <div role="status" aria-live="polite" className="inline-flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            正在读取私有源文件预览
          </div>
        </div>
      ) : canPreviewPdf ? (
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            {sourceText?.trim()
              ? '浏览器原生 PDF 查看器不提供可靠的合同文本偏移跳转；当前风险需按页核对，系统不会把模糊命中冒充已定位。'
              : '该 PDF 没有可用文本层，可能是扫描件；请在原件中按页核对，OCR 结果只能辅助定位，不能冒充原文锚点。'}
          </div>
          <iframe
            title={`${file?.label || fallbackLabel} PDF 原件预览`}
            src={effectiveFileUrl}
            className={`${frameHeightClassName} min-h-0 w-full flex-1 bg-white`}
          />
        </div>
      ) : canPreviewDocx ? (
        <div className={`relative min-h-0 flex-1 overflow-hidden bg-slate-100 ${frameHeightClassName}`}>
          {docxState === 'loading' ? (
            <div role="status" aria-live="polite" className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              正在生成 DOCX 近似页预览
            </div>
          ) : null}
          <div
            ref={assignScrollViewport}
            onScroll={onScroll}
            data-compare-scroll-owner="true"
            data-document-scroll-viewport="true"
            role="region"
            aria-label={`${file?.label || fallbackLabel} 文档滚动区`}
            tabIndex={0}
            className="absolute inset-0 min-h-0 touch-pan-x touch-pan-y overflow-auto overscroll-auto p-3 [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
          >
            {docxState === 'failed' ? (
              <div role="alert" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">DOCX 浏览器渲染失败，本页不能作为 1:1 原文验收。</p>
                    <p className="mt-1">{docxError || '请打开原件复核。导出批注仍以源 DOCX 包写入，不依赖此预览。'}</p>
                  </div>
                </div>
              </div>
            ) : null}
            <div
              ref={containerRef}
              style={previewStyle}
              className={`ones-docx-preview-surface ${surfaceMinHeightClassName}`}
            />
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
            {authorizedPreviewError
              ? `源文件读取失败：${authorizedPreviewError}。页面不能冒充 1:1 原文，请稍后重试或重新上传。`
              : '当前文件没有可直接渲染的原件地址，页面只能提供条款定位降级，不能冒充 1:1 原文。请打开原件复核；正式导出只在源文件上增加批注层。'}
          </div>
        </div>
      )}
    </div>
  )
}
