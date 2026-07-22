import type { HElement } from 'docx-preview'

const BROWSER_WORD_EXTENSIONS = ['.docx', '.docm'] as const

export type BrowserWordPreviewPhase = 'ticket' | 'download' | 'import' | 'render' | 'retrying' | 'ready' | 'error'

export interface BrowserWordSourcePosition {
  start_offset_utf16?: number | null
  end_offset_utf16?: number | null
  normalized_progress?: number | null
}

export interface BrowserWordSourceFocusResult {
  element: HTMLElement
  accuracy: 'text' | 'approximate'
  reason: 'text-match' | 'partial-text-match' | 'empty-source' | 'short-source' | 'text-not-found'
}

export const BROWSER_WORD_PREVIEW_TIMEOUT_MS = Object.freeze({
  ticket: 20_000,
  download: 20_000,
  import: 10_000,
  render: 15_000,
})

const PREVIEW_STAGE_TIMEOUT_MESSAGES = {
  ticket: '获取 Word 原文件读取凭据超时',
  download: '下载 Word 原文件超时',
  import: '加载 Word 预览组件超时',
  render: '解析 Word 原文、修订与批注超时',
} as const

export class BrowserWordPreviewStageTimeoutError extends Error {
  constructor(readonly phase: keyof typeof BROWSER_WORD_PREVIEW_TIMEOUT_MS) {
    super(`${PREVIEW_STAGE_TIMEOUT_MESSAGES[phase]}，请重试`)
    this.name = 'BrowserWordPreviewStageTimeoutError'
  }
}

export class BrowserWordPreviewRetryableError extends Error {
  constructor(readonly phase: 'ticket' | 'download', message: string) {
    super(message)
    this.name = 'BrowserWordPreviewRetryableError'
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Word preview attempt aborted', 'AbortError')
}

/**
 * Bound every external browser-preview stage. Fetches receive a real abort
 * signal; import/render promises that cannot be cancelled are still detached
 * from the active attempt after the deadline or component cleanup.
 */
export async function runBrowserWordPreviewStage<T>(
  phase: keyof typeof BROWSER_WORD_PREVIEW_TIMEOUT_MS,
  operation: (signal: AbortSignal) => Promise<T>,
  options: { parentSignal?: AbortSignal; timeoutMs?: number } = {}
) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? BROWSER_WORD_PREVIEW_TIMEOUT_MS[phase]
  let timeout: ReturnType<typeof setTimeout> | null = null
  let onParentAbort: (() => void) | null = null

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new BrowserWordPreviewStageTimeoutError(phase)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  const parentAbortPromise = options.parentSignal
    ? new Promise<never>((_resolve, reject) => {
        onParentAbort = () => {
          const error = abortReason(options.parentSignal!)
          controller.abort(error)
          reject(error)
        }
        if (options.parentSignal!.aborted) onParentAbort()
        else options.parentSignal!.addEventListener('abort', onParentAbort!, { once: true })
      })
    : null

  try {
    const pending = [operation(controller.signal), timeoutPromise]
    if (parentAbortPromise) pending.push(parentAbortPromise)
    return await Promise.race(pending)
  } catch (error) {
    if (controller.signal.reason instanceof BrowserWordPreviewStageTimeoutError) {
      throw controller.signal.reason
    }
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    if (onParentAbort) options.parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

export function isRetryableBrowserWordPreviewError(error: unknown) {
  return error instanceof BrowserWordPreviewStageTimeoutError
    || error instanceof BrowserWordPreviewRetryableError
    || error instanceof TypeError
}

export function isRetryableBrowserWordPreviewStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

export function shouldAutomaticallyRetryBrowserWordPreview(
  error: unknown,
  sourceIdentityKey: string,
  automaticallyRetriedIdentityKey: string | null
) {
  return isRetryableBrowserWordPreviewError(error)
    && automaticallyRetriedIdentityKey !== sourceIdentityKey
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The signed URL only proves that Storage authorized one path. Before OOXML is
 * rendered, independently prove that the browser received the frozen bytes the
 * comparison identity names.
 */
export async function verifyBrowserWordSourceBlob(
  source: Blob,
  expectedSha256: string,
  expectedFileSize?: number | null,
) {
  const normalizedHash = expectedSha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error('Word 冻结原文件摘要无效')
  }
  if (
    expectedFileSize !== undefined
    && expectedFileSize !== null
    && (!Number.isSafeInteger(expectedFileSize) || expectedFileSize < 1)
  ) {
    throw new Error('Word 冻结原文件大小无效')
  }
  if (expectedFileSize !== undefined && expectedFileSize !== null && source.size !== expectedFileSize) {
    throw new Error('Word 原文件大小与创建时快照不一致')
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持 Word 原文件摘要校验')
  }

  const actualHash = bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', await source.arrayBuffer()))
  if (actualHash !== normalizedHash) {
    throw new Error('Word 原文件字节与创建时快照不一致')
  }
  return { file_size: source.size, sha256: actualHash }
}

function lowerFilename(filename: string | null | undefined) {
  return (filename || '').trim().toLowerCase()
}

export function isBrowserWordPreview(filename: string | null | undefined) {
  const normalized = lowerFilename(filename)
  return BROWSER_WORD_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

export function isLegacyWordSource(filename: string | null | undefined) {
  return lowerFilename(filename).endsWith('.doc')
}

type DocxPreviewElement = HElement | Node | string

/**
 * docx-preview 0.4.0 drops #fragment children in its default element factory,
 * which removes every comment reference/popover. Keep delegation intact for
 * normal nodes and repair only that upstream fragment case.
 */
export function createDocxPreviewElementFactory(defaultFactory: (element: DocxPreviewElement) => Node) {
  const createElement = (element: DocxPreviewElement): Node => {
    if (
      typeof element === 'object'
      && element !== null
      && !(element instanceof Node)
      && element.tagName === '#fragment'
    ) {
      const fragment = document.createDocumentFragment()
      for (const child of element.children || []) fragment.appendChild(createElement(child))
      return fragment
    }
    return defaultFactory(element)
  }
  return createElement
}

/**
 * OOXML external relationships are untrusted input. docx-preview faithfully
 * copies their targets into anchors, so the rendered DOM must not be allowed
 * to turn javascript:/data:/file: links into same-origin script execution.
 */
export function hardenRenderedWordDom(container: HTMLElement) {
  container.querySelectorAll('script,iframe,object,embed,link,meta,base,foreignObject').forEach((element) => {
    element.remove()
  })

  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        element.removeAttribute(attribute.name)
        continue
      }

      if (name === 'src') {
        const value = attribute.value.trim()
        if (!/^(?:data:image\/|blob:)/i.test(value)) element.removeAttribute(attribute.name)
      }

      if ((name === 'href' || name === 'xlink:href') && element.tagName.toLowerCase() !== 'a') {
        const value = attribute.value.trim()
        if (!value.startsWith('#') && !/^(?:data:image\/|blob:)/i.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }

      if (name === 'style' && /(?:expression\s*\(|url\(\s*['"]?(?:https?:|\/\/|javascript:|data:text|file:))/i.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const target = (anchor.getAttribute('href') || '').trim()
    const internalAnchor = target.startsWith('#')
    const scheme = target.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase()
    const safeExternal = scheme === 'http' || scheme === 'https' || scheme === 'mailto'

    if (!internalAnchor && !safeExternal) {
      anchor.removeAttribute('href')
      anchor.removeAttribute('target')
      anchor.removeAttribute('rel')
      return
    }

    anchor.removeAttribute('download')
    if (scheme === 'http' || scheme === 'https') {
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    } else {
      anchor.removeAttribute('target')
      anchor.rel = 'noopener noreferrer'
    }
  })
}

export function hardenRenderedWordStyles(container: HTMLElement) {
  container.querySelectorAll('style').forEach((style) => {
    style.textContent = (style.textContent || '')
      .replace(/@import\s+[^;]+;?/gi, '')
      .replace(/url\(\s*(['"]?)(?!data:|blob:|#)[^)]+\)/gi, 'none')
      .replace(/expression\s*\([^)]*\)/gi, '')
  })
}

export function enhanceRenderedWordComments(container: HTMLElement, className: string) {
  const refs = Array.from(container.querySelectorAll<HTMLElement>(`.${className}-comment-ref`))
  refs.forEach((commentRef, index) => {
    const popover = commentRef.nextElementSibling as HTMLElement | null
    if (!popover?.classList.contains(`${className}-comment-popover`)) return
    const popoverId = `${className}-comment-${index + 1}`
    popover.id = popoverId
    popover.setAttribute('role', 'note')
    commentRef.tabIndex = 0
    commentRef.setAttribute('role', 'button')
    commentRef.setAttribute('aria-label', `查看第 ${index + 1} 条源文件批注`)
    commentRef.setAttribute('aria-controls', popoverId)
    commentRef.setAttribute('aria-expanded', 'false')

    const setOpen = (open: boolean) => {
      commentRef.dataset.commentOpen = open ? 'true' : 'false'
      commentRef.setAttribute('aria-expanded', String(open))
    }
    commentRef.addEventListener('click', () => setOpen(commentRef.dataset.commentOpen !== 'true'))
    commentRef.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(commentRef.dataset.commentOpen !== 'true')
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    })
  })
  return refs.length
}

function normalizeRenderedText(value: string | null | undefined) {
  return (value || '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedProgress(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value as number))
}

function focusReasonForFallback(sourceText: string) {
  if (!sourceText) return 'empty-source' as const
  if (sourceText.length < 8) return 'short-source' as const
  return 'text-not-found' as const
}

/**
 * Locate one review anchor in the already-rendered Word DOM. This only marks
 * and scrolls the matching block; it never changes the source document or its
 * tracked changes/comments. Manual scrolling remains untouched until another
 * risk is selected.
 */
export function focusRenderedWordSourceText(
  container: HTMLElement,
  sourceText: string | null | undefined,
  position: BrowserWordSourcePosition = {},
): BrowserWordSourceFocusResult | null {
  container.querySelectorAll<HTMLElement>('[data-selected-risk-source="true"]').forEach((element) => {
    element.removeAttribute('data-selected-risk-source')
    element.removeAttribute('data-source-focus-accuracy')
    element.removeAttribute('data-source-focus-reason')
    element.removeAttribute('data-source-start-utf16')
    element.removeAttribute('data-source-end-utf16')
    element.classList.remove('g5-word-source-selected-clause')
    element.classList.remove('g5-word-source-approximate-clause')
  })

  const normalizedSource = normalizeRenderedText(sourceText)
  const candidates = Array.from(container.querySelectorAll<HTMLElement>('p,li,td,th,h1,h2,h3,h4,h5,h6'))
  if (candidates.length === 0) return null

  const expectedProgress = normalizedProgress(position.normalized_progress)
  let textCursor = 0
  const indexedCandidates = candidates.map((element) => {
    const text = normalizeRenderedText(element.textContent)
    const length = Math.max(1, text.length)
    const indexed = { element, text, start: textCursor, length }
    textCursor += length
    return indexed
  })
  const totalLength = Math.max(1, textCursor)
  const candidateProgress = (candidate: typeof indexedCandidates[number], localOffset = candidate.length / 2) => (
    (candidate.start + localOffset) / totalLength
  )

  let target: HTMLElement | null = null
  let accuracy: BrowserWordSourceFocusResult['accuracy'] = 'approximate'
  let reason: BrowserWordSourceFocusResult['reason'] = focusReasonForFallback(normalizedSource)

  if (normalizedSource.length >= 8) {
    const probes = Array.from(new Set([
      normalizedSource,
      normalizedSource.slice(0, 96),
      normalizedSource.slice(0, 64),
      normalizedSource.slice(0, 32),
    ].filter((probe) => probe.length >= 8)))

    for (const probe of probes) {
      const occurrences: Array<{ candidate: typeof indexedCandidates[number]; offset: number }> = []
      for (const candidate of indexedCandidates) {
        let offset = candidate.text.indexOf(probe)
        while (offset >= 0) {
          occurrences.push({ candidate, offset })
          offset = candidate.text.indexOf(probe, offset + Math.max(1, probe.length))
        }
      }
      if (occurrences.length === 0) continue
      const closest = occurrences.reduce((best, occurrence) => {
        const distance = Math.abs(candidateProgress(occurrence.candidate, occurrence.offset + probe.length / 2) - expectedProgress)
        const bestDistance = Math.abs(candidateProgress(best.candidate, best.offset + probe.length / 2) - expectedProgress)
        return distance < bestDistance ? occurrence : best
      })
      target = closest.candidate.element
      accuracy = probe === normalizedSource ? 'text' : 'approximate'
      reason = probe === normalizedSource ? 'text-match' : 'partial-text-match'
      break
    }
  }

  if (!target) {
    target = indexedCandidates.reduce((best, candidate) => (
      Math.abs(candidateProgress(candidate) - expectedProgress) < Math.abs(candidateProgress(best) - expectedProgress)
        ? candidate
        : best
    )).element
  }

  target.dataset.selectedRiskSource = 'true'
  target.dataset.sourceFocusAccuracy = accuracy
  target.dataset.sourceFocusReason = reason
  if (Number.isSafeInteger(position.start_offset_utf16)) {
    target.dataset.sourceStartUtf16 = String(position.start_offset_utf16)
  }
  if (Number.isSafeInteger(position.end_offset_utf16)) {
    target.dataset.sourceEndUtf16 = String(position.end_offset_utf16)
  }
  target.classList.add(accuracy === 'text' ? 'g5-word-source-selected-clause' : 'g5-word-source-approximate-clause')
  target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  return { element: target, accuracy, reason }
}
