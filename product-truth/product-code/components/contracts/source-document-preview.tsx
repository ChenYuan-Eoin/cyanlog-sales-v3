'use client'

import { useEffect, useRef, useState } from 'react'
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

function isPdf(file: SourceDocumentPreviewFile | null | undefined) {
  return Boolean(file?.mimeType?.includes('pdf') || (file?.label || '').toLowerCase().endsWith('.pdf'))
}

function isDocx(file: SourceDocumentPreviewFile | null | undefined) {
  return Boolean(
    file?.mimeType?.includes('wordprocessingml.document') ||
    (file?.label || '').toLowerCase().endsWith('.docx')
  )
}

export function SourceDocumentPreview({
  file,
  title = '原件预览',
  selectedText,
  fallbackLabel = '未绑定文件',
  minHeightClassName = 'min-h-[680px]',
}: SourceDocumentPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [docxState, setDocxState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [docxError, setDocxError] = useState('')
  const canPreviewPdf = Boolean(file?.fileUrl && isPdf(file))
  const canPreviewDocx = Boolean(file?.fileUrl && isDocx(file))
  const locator = inferDocumentLocator(selectedText)
  const renderModeLabel = canPreviewPdf ? 'PDF 原件' : canPreviewDocx ? 'DOCX 页级渲染' : '文本定位降级'

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
        if (!cancelled) setDocxState('ready')
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
