// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserWordPreviewRetryableError,
  BrowserWordPreviewStageTimeoutError,
  enhanceRenderedWordComments,
  focusRenderedWordSourceText,
  hardenRenderedWordDom,
  hardenRenderedWordStyles,
  isBrowserWordPreview,
  isLegacyWordSource,
  isRetryableBrowserWordPreviewError,
  isRetryableBrowserWordPreviewStatus,
  runBrowserWordPreviewStage,
  shouldAutomaticallyRetryBrowserWordPreview,
  verifyBrowserWordSourceBlob,
} from './browser-word-preview'

describe('browser Word preview boundary', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bounds each preview stage and aborts the active fetch on timeout', async () => {
    vi.useFakeTimers()
    const captured: { signal?: AbortSignal } = {}
    const pending = runBrowserWordPreviewStage('ticket', (signal) => {
      captured.signal = signal
      return new Promise<Response>(() => undefined)
    }, { timeoutMs: 25 })

    const rejection = expect(pending).rejects.toMatchObject({
      name: 'BrowserWordPreviewStageTimeoutError',
      phase: 'ticket',
    })
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(captured.signal?.aborted).toBe(true)
  })

  it('only retries bounded transient failures, never product 404/409 responses', () => {
    expect(isRetryableBrowserWordPreviewError(new BrowserWordPreviewStageTimeoutError('download'))).toBe(true)
    expect(isRetryableBrowserWordPreviewError(new BrowserWordPreviewRetryableError('ticket', '503'))).toBe(true)
    expect(isRetryableBrowserWordPreviewError(new TypeError('fetch failed'))).toBe(true)
    expect(isRetryableBrowserWordPreviewError(new Error('源文件不存在'))).toBe(false)
    expect(isRetryableBrowserWordPreviewStatus(408)).toBe(true)
    expect(isRetryableBrowserWordPreviewStatus(429)).toBe(true)
    expect(isRetryableBrowserWordPreviewStatus(503)).toBe(true)
    expect(isRetryableBrowserWordPreviewStatus(404)).toBe(false)
    expect(isRetryableBrowserWordPreviewStatus(409)).toBe(false)

    const timeout = new BrowserWordPreviewStageTimeoutError('ticket')
    expect(shouldAutomaticallyRetryBrowserWordPreview(timeout, 'source-a', null)).toBe(true)
    expect(shouldAutomaticallyRetryBrowserWordPreview(timeout, 'source-a', 'source-a')).toBe(false)
    expect(shouldAutomaticallyRetryBrowserWordPreview(timeout, 'source-b', 'source-a')).toBe(true)
  })

  it('only sends OOXML Word files to the browser renderer', () => {
    expect(isBrowserWordPreview('contract.docx')).toBe(true)
    expect(isBrowserWordPreview('contract.DOCM')).toBe(true)
    expect(isBrowserWordPreview('contract.doc')).toBe(false)
    expect(isBrowserWordPreview('contract.pdf')).toBe(false)
    expect(isLegacyWordSource('contract.DOC')).toBe(true)
  })

  it('verifies the downloaded Word Blob against the frozen size and SHA before rendering', async () => {
    const source = new Blob(['frozen-word-source'])
    const expectedSha256 = '3d3e001764559382722dfd263045fc4678349dad79dfd02fce20a72d6770a2d8'

    await expect(verifyBrowserWordSourceBlob(source, expectedSha256, 18)).resolves.toEqual({
      file_size: 18,
      sha256: expectedSha256,
    })
    await expect(verifyBrowserWordSourceBlob(source, expectedSha256, 17))
      .rejects.toThrow('Word 原文件大小与创建时快照不一致')
    await expect(verifyBrowserWordSourceBlob(source, '0'.repeat(64), 18))
      .rejects.toThrow('Word 原文件字节与创建时快照不一致')
  })

  it('removes executable relationships and active DOM from rendered OOXML', () => {
    const container = document.createElement('div')
    container.innerHTML = [
      '<a id="js" href="javascript:alert(document.domain)" onclick="alert(1)">bad</a>',
      '<a id="data" href="data:text/html,bad">data</a>',
      '<a id="file" href="file:///etc/passwd">file</a>',
      '<a id="relative" href="//tracker.example/path">relative</a>',
      '<a id="http" href="https://example.com/contract">safe</a>',
      '<a id="bookmark" href="#clause-1">bookmark</a>',
      '<img id="tracking" src="https://tracker.example/pixel.png" onload="alert(1)">',
      '<img id="embedded" src="data:image/png;base64,AAAA">',
      '<svg><use id="external-use" href="https://tracker.example/icon.svg"></use></svg>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<object data="data:text/html,bad"></object>',
    ].join('')

    hardenRenderedWordDom(container)

    expect(container.querySelector('#js')?.hasAttribute('href')).toBe(false)
    expect(container.querySelector('#js')?.hasAttribute('onclick')).toBe(false)
    expect(container.querySelector('#data')?.hasAttribute('href')).toBe(false)
    expect(container.querySelector('#file')?.hasAttribute('href')).toBe(false)
    expect(container.querySelector('#relative')?.hasAttribute('href')).toBe(false)
    expect(container.querySelector<HTMLAnchorElement>('#http')?.target).toBe('_blank')
    expect(container.querySelector<HTMLAnchorElement>('#http')?.rel).toBe('noopener noreferrer')
    expect(container.querySelector('#bookmark')?.getAttribute('href')).toBe('#clause-1')
    expect(container.querySelector('#tracking')?.hasAttribute('src')).toBe(false)
    expect(container.querySelector('#embedded')?.hasAttribute('src')).toBe(true)
    expect(container.querySelector('#external-use')?.hasAttribute('href')).toBe(false)
    expect(container.querySelector('iframe,object,script')).toBeNull()
  })

  it('removes external CSS fetches and makes comments keyboard/touch readable', () => {
    const styles = document.createElement('div')
    styles.innerHTML = '<style>@import "https://tracker.example/x.css";.x{background:url(https://tracker.example/pixel)}</style>'
    hardenRenderedWordStyles(styles)
    expect(styles.textContent).not.toContain('tracker.example')

    const body = document.createElement('div')
    body.innerHTML = '<span class="word-comment-ref">💬</span><div class="word-comment-popover">批注内容</div>'
    expect(enhanceRenderedWordComments(body, 'word')).toBe(1)
    const ref = body.querySelector<HTMLElement>('.word-comment-ref')!
    expect(ref.tabIndex).toBe(0)
    expect(ref.getAttribute('aria-expanded')).toBe('false')
    ref.click()
    expect(ref.dataset.commentOpen).toBe('true')
    expect(ref.getAttribute('aria-expanded')).toBe('true')
    ref.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(ref.getAttribute('aria-expanded')).toBe('false')
  })

  it('locates one real source paragraph without locking later manual scrolling', () => {
    const body = document.createElement('div')
    body.innerHTML = [
      '<p>前文：双方应遵循平等互利原则。</p>',
      '<p><span>若甲方逾期十五日仍未付款，</span><span>乙方有权终止本合同。</span></p>',
      '<p>后文：服务终止后的资料应依法返还。</p>',
    ].join('')
    const target = body.children[1] as HTMLElement
    target.scrollIntoView = vi.fn()

    expect(focusRenderedWordSourceText(body, '若甲方逾期十五日仍未付款，乙方有权终止本合同。')?.element).toBe(target)
    expect(target.dataset.selectedRiskSource).toBe('true')
    expect(target.classList.contains('g5-word-source-selected-clause')).toBe(true)
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1)

    expect(focusRenderedWordSourceText(body, '服务终止后的资料应依法返还。')?.element).toBe(body.children[2])
    expect(target.hasAttribute('data-selected-risk-source')).toBe(false)
  })

  it('chooses the repeated text occurrence nearest the frozen normalized progress', () => {
    const body = document.createElement('div')
    const repeated = '未经书面同意不得向第三方披露合同资料。'
    body.innerHTML = [
      `<p>${repeated}</p>`,
      '<p>中间包含若干独立条款以及较长的履约说明。</p>',
      `<p>${repeated}</p>`,
    ].join('')
    const first = body.children[0] as HTMLElement
    const last = body.children[2] as HTMLElement
    first.scrollIntoView = vi.fn()
    last.scrollIntoView = vi.fn()

    const result = focusRenderedWordSourceText(body, repeated, {
      start_offset_utf16: 120,
      end_offset_utf16: 140,
      normalized_progress: 0.9,
    })

    expect(result).toMatchObject({ element: last, accuracy: 'text', reason: 'text-match' })
    expect(first.scrollIntoView).not.toHaveBeenCalled()
    expect(last.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(last.dataset.sourceStartUtf16).toBe('120')
    expect(last.dataset.sourceEndUtf16).toBe('140')
  })

  it('labels short and empty-side navigation as approximate instead of an exact text match', () => {
    const body = document.createElement('div')
    body.innerHTML = [
      '<p>第一段相邻原文</p>',
      '<p>第二段相邻原文</p>',
      '<p>第三段相邻原文</p>',
      '<p>第四段相邻原文</p>',
    ].join('')
    const last = body.children[3] as HTMLElement
    last.scrollIntoView = vi.fn()

    const shortResult = focusRenderedWordSourceText(body, '短改', {
      start_offset_utf16: 42,
      end_offset_utf16: 44,
      normalized_progress: 0.95,
    })
    expect(shortResult).toMatchObject({ element: last, accuracy: 'approximate', reason: 'short-source' })
    expect(last.classList.contains('g5-word-source-approximate-clause')).toBe(true)

    const emptyResult = focusRenderedWordSourceText(body, '', {
      start_offset_utf16: 0,
      end_offset_utf16: 0,
      normalized_progress: 0,
    })
    expect(emptyResult).toMatchObject({ element: body.children[0], accuracy: 'approximate', reason: 'empty-source' })
    expect(last.hasAttribute('data-selected-risk-source')).toBe(false)
  })
})
