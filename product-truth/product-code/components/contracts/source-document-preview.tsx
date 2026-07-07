'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { AlertTriangleIcon, ExternalLinkIcon, FileTextIcon, Loader2Icon, MapPinIcon } from 'lucide-react'
import { inferDocumentLocator } from '@/lib/contracts/document-locator'

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
  fallbackLabel?: string
  minHeightClassName?: string
}

type EvidenceFocusState = 'idle' | 'found' | 'missing'

function isPdf(file: SourceDocumentPreviewFile | null | undefined) {
  return Boolean(file?.mimeType?.includes('pdf') || (file?.label || '').toLowerCase().endsWith('.pdf'))
}

function isDocx(file: SourceDocumentPreviewFile | null | undefined) {
  return Boolean(
    file?.mimeType?.includes('wordprocessingml.document') ||
    (file?.label || '').toLowerCase().endsWith('.docx')
  )
}

function normalizeNeedle(text?: string) {
  const normalized = (text || '').replace(/\s+/g, '')
  if (normalized.length <= 0) return ''
  return normalized.slice(0, 48)
}

function clearEvidenceFocus(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-ones-evidence-focus="true"]').forEach((element) => {
    element.removeAttribute('data-ones-evidence-focus')
    element.style.outline = ''
    element.style.background = ''
    element.style.borderRadius = ''
    element.style.scrollMargin = ''
  })
}

function focusEvidenceText(container: HTMLElement | null, evidenceText?: string): EvidenceFocusState {
  if (!container) return 'idle'
  clearEvidenceFocus(container)
  const needle = normalizeNeedle(evidenceText)
  if (!needle) return 'idle'

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const haystack = node.textContent?.replace(/\s+/g, '') || ''
    if (haystack.includes(needle)) {
      const host = node.parentElement
      if (!host) return 'missing'
      host.dataset.onesEvidenceFocus = 'true'
      host.style.outline = '2px solid rgba(79, 70, 229, 0.75)'
      host.style.background = 'rgba(254, 249, 195, 0.82)'
      host.style.borderRadius = '3px'
      host.style.scrollMargin = '96px'
      host.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      return 'found'
    }
    node = walker.nextNode()
  }

  return 'missing'
}

export function SourceDocumentPreview({
  file,
  title = '原件预览',
  selectedText,
  fallbackLabel = '未绑定文件',
  minHeightClassName = 'min-h-[680px]',
}: SourceDocumentPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectedTextRef = useRef(selectedText)
  const [docxState, setDocxState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [docxError, setDocxError] = useState('')
  const [evidenceFocusState, setEvidenceFocusState] = useState<EvidenceFocusState>('idle')
  const canPreviewPdf = Boolean(file?.fileUrl && isPdf(file))
  const canPreviewDocx = Boolean(file?.fileUrl && isDocx(file))
  const locator = inferDocumentLocator(selectedText)
  const evidenceNeedle = useMemo(() => normalizeNeedle(selectedText), [selectedText])
  const renderModeLabel = canPreviewPdf ? 'PDF 原件' : canPreviewDocx ? 'DOCX 页级渲染' : '文本定位降级'
  const renderStatusLabel = canPreviewPdf
    ? '浏览器内嵌'
    : canPreviewDocx
      ? docxState === 'ready'
        ? '已渲染'
        : docxState === 'loading'
          ? '渲染中'
          : docxState === 'failed'
            ? '预览失败'
            : '等待渲染'
      : '降级'
  const renderStatusVariant = canPreviewPdf || (canPreviewDocx && docxState === 'ready')
    ? 'default'
    : docxState === 'failed'
      ? 'destructive'
      : 'outline'

  useEffect(() => {
    selectedTextRef.current = selectedText
  }, [selectedText])

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    setDocxError('')

    if (!canPreviewDocx || !file?.fileUrl) {
      setDocxState('idle')
      return
    }
    const docxFileUrl = file.fileUrl

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
          setDocxState('ready')
          setEvidenceFocusState(focusEvidenceText(containerRef.current, selectedTextRef.current))
        }
      } catch (error) {
        if (cancelled) return
        setDocxState('failed')
        setDocxError(error instanceof Error ? error.message : 'DOCX 渲染失败')
      }
    }

    void renderDocx()
    return () => {
      cancelled = true
    }
  }, [canPreviewDocx, file?.fileUrl])

  useEffect(() => {
    if (!canPreviewDocx || docxState !== 'ready') {
      if (!evidenceNeedle) setEvidenceFocusState('idle')
      return
    }
    setEvidenceFocusState(focusEvidenceText(containerRef.current, selectedText))
  }, [canPreviewDocx, docxState, evidenceNeedle, selectedText])

  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${minHeightClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileTextIcon className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-950">{title}</span>
            <Badge variant={canPreviewPdf || canPreviewDocx ? 'outline' : 'secondary'}>
              {renderModeLabel}
            </Badge>
            <Badge variant={renderStatusVariant}>
              {renderStatusLabel}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {file?.label || fallbackLabel}
            {file?.storagePath ? ` · ${file.storagePath}` : ''}
          </p>
        </div>
        {file?.fileUrl ? (
          <a
            href={file.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[0.8rem] font-medium text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                {evidenceFocusState === 'found' ? '已定位原文' : evidenceFocusState === 'missing' ? '需人工定位' : '等待定位'}
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {canPreviewPdf ? (
        <iframe
          title={`${file?.label || fallbackLabel} PDF 原件预览`}
          src={file?.fileUrl || ''}
          className="h-[720px] w-full bg-white"
        />
      ) : canPreviewDocx ? (
        <div className="relative bg-slate-100 p-3">
          {docxState === 'loading' ? (
            <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              正在渲染 DOCX 页级预览
            </div>
          ) : null}
          {docxState === 'failed' ? (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">DOCX 浏览器渲染失败，本页不能作为 1:1 原文验收。</p>
                  <p className="mt-1">{docxError || '请打开原件复核。导出批注仍以源 DOCX 包写入，不依赖此预览。'}</p>
                </div>
              </div>
            </div>
          ) : null}
          <div ref={containerRef} className="ones-docx-preview-surface min-h-[680px] overflow-auto" />
        </div>
      ) : (
        <div className="p-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
            当前文件没有可直接渲染的原件地址，页面只能提供条款定位降级，不能冒充 1:1 原文。请打开原件复核；正式导出只在源文件上增加批注层。
          </div>
        </div>
      )}
    </div>
  )
}
