'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2Icon, RefreshCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  BROWSER_WORD_PREVIEW_TIMEOUT_MS,
  BrowserWordPreviewRetryableError,
  type BrowserWordPreviewPhase,
  type BrowserWordSourceFocusResult,
  type BrowserWordSourcePosition,
  createDocxPreviewElementFactory,
  enhanceRenderedWordComments,
  focusRenderedWordSourceText,
  hardenRenderedWordDom,
  hardenRenderedWordStyles,
  isRetryableBrowserWordPreviewStatus,
  runBrowserWordPreviewStage,
  shouldAutomaticallyRetryBrowserWordPreview,
  verifyBrowserWordSourceBlob,
} from '@/lib/documents/browser-word-preview'

interface SourceIdentity {
  storage_path: string
  source_hash: string
  source_text_hash: string
}

interface BrowserWordPreviewProps {
  contractId: string
  filename: string
  sourceIdentity: SourceIdentity | null
  expectedFileSize?: number | null
  zoom: number
  fitWidth?: boolean
  ticketEndpoint?: string
  selectedRiskId?: string | null
  selectedSourceText?: string | null
  selectedSourcePosition?: BrowserWordSourcePosition | null
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function responseError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: string | { message?: string } }).error
  if (typeof error === 'string') return error.trim() || fallback
  return error?.message || fallback
}

function approximateFocusNotice(result: BrowserWordSourceFocusResult | null) {
  if (!result || result.accuracy === 'text') return ''
  if (result.reason === 'empty-source') return '近似定位：该侧是空范围，已按冻结位置显示相邻原文。'
  if (result.reason === 'short-source') return '近似定位：差异文本过短，已按冻结位置显示相邻原文。'
  if (result.reason === 'partial-text-match') return '近似定位：仅匹配到部分原文，已选择最接近冻结位置的一处。'
  return '近似定位：未找到完整原文，已按冻结位置显示相邻内容。'
}

export function BrowserWordPreview({
  contractId,
  filename,
  sourceIdentity,
  expectedFileSize,
  zoom,
  fitWidth = false,
  ticketEndpoint,
  selectedRiskId,
  selectedSourceText,
  selectedSourcePosition,
}: BrowserWordPreviewProps) {
  const previewHostRef = useRef<HTMLDivElement>(null)
  const automaticRetryIdentityRef = useRef<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [phase, setPhase] = useState<BrowserWordPreviewPhase>('ticket')
  const [errorMessage, setErrorMessage] = useState('')
  const [focusNotice, setFocusNotice] = useState('')
  const [fitZoom, setFitZoom] = useState(100)
  const storagePath = sourceIdentity?.storage_path || ''
  const sourceHash = sourceIdentity?.source_hash || ''
  const sourceTextHash = sourceIdentity?.source_text_hash || ''
  const resolvedTicketEndpoint = ticketEndpoint || `/api/contracts/${contractId}/source`
  const sourceIdentityKey = storagePath && sourceHash && sourceTextHash
    ? [resolvedTicketEndpoint, storagePath, sourceHash, sourceTextHash, expectedFileSize ?? 'unknown-size'].join(':')
    : `${contractId}:missing-source-identity`
  const selectedStartUtf16 = selectedSourcePosition?.start_offset_utf16
  const selectedEndUtf16 = selectedSourcePosition?.end_offset_utf16
  const selectedProgress = selectedSourcePosition?.normalized_progress

  useEffect(() => {
    const previewHost = previewHostRef.current
    if (!previewHost) return
    const shadowRoot = previewHost.shadowRoot || previewHost.attachShadow({ mode: 'open' })
    const styleContainer = document.createElement('div')
    const bodyContainer = document.createElement('div')
    bodyContainer.dataset.previewBody = 'true'
    shadowRoot.replaceChildren(styleContainer, bodyContainer)

    let active = true
    const controller = new AbortController()
    bodyContainer.replaceChildren()
    styleContainer.replaceChildren()
    setPhase('ticket')
    setErrorMessage('')

    async function renderSource() {
      try {
        if (!storagePath || !sourceHash || !sourceTextHash) throw new Error('源文件身份尚未生成，请刷新后重试')
        const identityQuery = new URLSearchParams({
          storage_path: storagePath,
          source_hash: sourceHash,
          source_text_hash: sourceTextHash,
          // This URL previously returned a 307. Some browser caches retain the
          // old redirect after its signed token expires, even with no-store.
          // A per-attempt nonce guarantees that the JSON ticket route runs.
          ticket_nonce: String(reloadNonce),
        })
        setPhase('ticket')
        const { ticketResponse, ticketPayload } = await runBrowserWordPreviewStage('ticket', async (signal) => {
          const response = await fetch(`${resolvedTicketEndpoint}?${identityQuery.toString()}`, {
            headers: authHeaders(),
            cache: 'no-store',
            signal,
          })
          const payload = await response.json().catch(() => null) as {
            data?: { download_url?: string }
          } | null
          return { ticketResponse: response, ticketPayload: payload }
        }, { parentSignal: controller.signal, timeoutMs: BROWSER_WORD_PREVIEW_TIMEOUT_MS.ticket })
        if (!ticketResponse.ok || !ticketPayload?.data?.download_url) {
          const payload = ticketPayload
          const message = responseError(payload, 'Word 原文件加载失败')
          if (isRetryableBrowserWordPreviewStatus(ticketResponse.status)) {
            throw new BrowserWordPreviewRetryableError('ticket', message)
          }
          throw new Error(message)
        }
        setPhase('download')
        const { response, source } = await runBrowserWordPreviewStage('download', async (signal) => {
          const sourceResponse = await fetch(ticketPayload.data!.download_url!, {
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal,
          })
          const sourceBlob = sourceResponse.ok ? await sourceResponse.blob() : null
          if (sourceBlob) await verifyBrowserWordSourceBlob(sourceBlob, sourceHash, expectedFileSize)
          return { response: sourceResponse, source: sourceBlob }
        }, { parentSignal: controller.signal, timeoutMs: BROWSER_WORD_PREVIEW_TIMEOUT_MS.download })
        if (!response.ok) {
          const message = 'Word 原文件短期读取地址已失效，请重试'
          if (response.status === 401 || response.status === 403 || isRetryableBrowserWordPreviewStatus(response.status)) {
            throw new BrowserWordPreviewRetryableError('download', message)
          }
          throw new Error(message)
        }
        if (!source) throw new Error('Word 原文件内容为空，请重试')
        if (!active) return

        setPhase('import')
        const { defaultOptions, renderAsync } = await runBrowserWordPreviewStage(
          'import',
          () => import('docx-preview'),
          { parentSignal: controller.signal, timeoutMs: BROWSER_WORD_PREVIEW_TIMEOUT_MS.import }
        )
        if (!active) return
        const stagingBody = document.createElement('div')
        const stagingStyles = document.createElement('div')
        setPhase('render')
        await runBrowserWordPreviewStage(
          'render',
          () => renderAsync(source, stagingBody, stagingStyles, {
            className: 'g5-word-source',
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderChanges: true,
            renderComments: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            renderAltChunks: false,
            useBase64URL: true,
            h: createDocxPreviewElementFactory(defaultOptions.h),
          }),
          { parentSignal: controller.signal, timeoutMs: BROWSER_WORD_PREVIEW_TIMEOUT_MS.render }
        )
        hardenRenderedWordDom(stagingBody)
        hardenRenderedWordStyles(stagingStyles)
        enhanceRenderedWordComments(stagingBody, 'g5-word-source')
        const accessibleCommentStyles = document.createElement('style')
        accessibleCommentStyles.textContent = [
          '.g5-word-source-comment-ref:focus~.g5-word-source-comment-popover,',
          '.g5-word-source-comment-ref[data-comment-open="true"]~.g5-word-source-comment-popover{display:block}',
          '.g5-word-source-selected-clause{outline:3px solid rgba(37,99,235,.45);outline-offset:4px;background:rgba(219,234,254,.42);scroll-margin-block:30vh}',
          '.g5-word-source-approximate-clause{outline:3px dashed rgba(217,119,6,.72);outline-offset:4px;background:rgba(254,243,199,.55);scroll-margin-block:30vh}',
        ].join('')
        stagingStyles.appendChild(accessibleCommentStyles)
        if (!active) {
          return
        }
        styleContainer.replaceChildren(...Array.from(stagingStyles.childNodes))
        bodyContainer.replaceChildren(...Array.from(stagingBody.childNodes))
        setPhase('ready')
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
        if (shouldAutomaticallyRetryBrowserWordPreview(error, sourceIdentityKey, automaticRetryIdentityRef.current)) {
          automaticRetryIdentityRef.current = sourceIdentityKey
          setPhase('retrying')
          setReloadNonce((value) => value + 1)
          return
        }
        bodyContainer.replaceChildren()
        styleContainer.replaceChildren()
        setPhase('error')
        const message = error instanceof Error ? error.message : 'Word 原文件预览失败'
        setErrorMessage(automaticRetryIdentityRef.current === sourceIdentityKey
          ? `自动重试后仍未打开：${message}`
          : message)
      }
    }

    void renderSource()
    return () => {
      active = false
      controller.abort()
      shadowRoot.replaceChildren()
    }
  }, [expectedFileSize, reloadNonce, resolvedTicketEndpoint, sourceHash, sourceIdentityKey, sourceTextHash, storagePath])

  useEffect(() => {
    if (phase !== 'ready' || !selectedRiskId) {
      setFocusNotice('')
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const previewBody = previewHostRef.current?.shadowRoot?.querySelector<HTMLElement>('[data-preview-body="true"]')
      if (!previewBody) return
      const result = focusRenderedWordSourceText(previewBody, selectedSourceText, {
        start_offset_utf16: selectedStartUtf16,
        end_offset_utf16: selectedEndUtf16,
        normalized_progress: selectedProgress,
      })
      setFocusNotice(approximateFocusNotice(result))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [phase, selectedEndUtf16, selectedProgress, selectedRiskId, selectedSourceText, selectedStartUtf16])

  useEffect(() => {
    if (!fitWidth || phase !== 'ready') return
    const host = previewHostRef.current
    const viewport = host?.parentElement?.parentElement
    const previewBody = host?.shadowRoot?.querySelector<HTMLElement>('[data-preview-body="true"]')
    if (!host || !viewport || !previewBody) return
    const measure = () => {
      const naturalWidth = Math.max(previewBody.scrollWidth, previewBody.getBoundingClientRect().width)
      const availableWidth = Math.max(1, viewport.clientWidth - 24)
      if (naturalWidth > 0) setFitZoom(Math.max(60, Math.min(180, Math.floor((availableWidth / naturalWidth) * 100))))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(previewBody)
    return () => observer.disconnect()
  }, [fitWidth, phase])

  const resolvedZoom = fitWidth ? fitZoom : zoom

  const loadingMessage = phase === 'retrying'
    ? '首次加载未完成，正在自动重试一次…'
    : phase === 'download'
      ? '正在下载并核验 Word 冻结原文件…'
      : phase === 'import'
        ? '正在加载 Word 预览组件…'
        : phase === 'render'
          ? '正在解析 Word 原文、修订与批注…'
          : '正在获取 Word 原文件读取凭据…'

  return (
    <div className="relative mx-auto min-h-full w-fit min-w-full py-4" data-testid="browser-word-preview" data-preview-phase={phase}>
      <div
        className={phase === 'error' ? 'hidden' : 'mx-auto w-fit origin-top'}
        style={{ zoom: resolvedZoom / 100 }}
        aria-label={`${filename} 原文、修订与已有批注预览`}
      >
        <div ref={previewHostRef} data-testid="browser-word-preview-body" data-render-scope="shadow-root" data-preview-phase={phase} />
      </div>
      {phase === 'ready' && focusNotice && (
        <div className="sticky bottom-3 z-20 mx-auto mt-2 w-fit max-w-[calc(100%_-_1.5rem)] rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm" role="status" data-testid="word-focus-notice">
          {focusNotice}
        </div>
      )}
      {phase !== 'ready' && phase !== 'error' && (
        <div className="absolute inset-0 flex min-h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/90 p-8 text-sm text-slate-600" role="status">
          <Loader2Icon className="mr-2 size-5 animate-spin" />{loadingMessage}
        </div>
      )}
      {phase === 'error' && (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900" role="alert">
          <p>{errorMessage}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadNonce((value) => value + 1)}>
            <RefreshCcwIcon />重新加载 Word 原文
          </Button>
        </div>
      )}
    </div>
  )
}
