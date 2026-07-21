import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusEvidenceText } from './source-document-evidence'

const source = readFileSync(
  resolve(process.cwd(), 'components/contracts/source-document-preview.tsx'),
  'utf8'
)
const evidenceSource = readFileSync(
  resolve(process.cwd(), 'components/contracts/source-document-evidence.ts'),
  'utf8'
)

function setMetric(element: HTMLElement, key: 'clientHeight' | 'scrollHeight' | 'scrollTop', value: number) {
  Object.defineProperty(element, key, { configurable: true, writable: true, value })
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('SourceDocumentPreview document scroll ownership', () => {
  it('bounds the outer component and gives long DOCX content one real scroll owner', () => {
    expect(source).toContain('max-h-[calc(100dvh-1.5rem)]')
    expect(source).toContain('relative min-h-0 flex-1 overflow-hidden bg-slate-100')
    expect(source).toContain('data-document-scroll-viewport="true"')
    expect(source).toContain('className="absolute inset-0 min-h-0')
    expect(source).toContain('overflow-auto overscroll-auto')
    expect(source).toContain('tabIndex={0}')
    expect(source).not.toContain('overscroll-contain')
  })

  it('positions evidence by scrolling the document viewport rather than the page', () => {
    expect(evidenceSource).toContain("const EVIDENCE_BLOCK_SELECTOR = 'p, li, td, th, h1, h2, h3, h4, h5, h6'")
    expect(evidenceSource).toContain("container.closest<HTMLElement>('[data-document-scroll-viewport=\"true\"]')")
    expect(evidenceSource).toContain('viewport.scrollTop + hostRect.top - viewportRect.top')
    expect(evidenceSource).toContain('viewport.scrollHeight - viewport.clientHeight')
    expect(evidenceSource).toContain("viewport.scrollTo({ top: nextTop, left: viewport.scrollLeft, behavior: 'auto' })")
    expect(evidenceSource).not.toContain('scrollIntoView(')
    expect(evidenceSource).not.toContain('window.scrollTo(')
  })

  it('finds evidence split across Word runs and scrolls only its document viewport', () => {
    const viewport = document.createElement('div')
    viewport.dataset.documentScrollViewport = 'true'
    const container = document.createElement('div')
    const paragraph = document.createElement('p')
    paragraph.innerHTML = '<span>合同金额不得</span><span>低于 5 万元</span>'
    container.append(paragraph)
    viewport.append(container)
    document.body.append(viewport)

    setMetric(viewport, 'clientHeight', 200)
    setMetric(viewport, 'scrollHeight', 1000)
    setMetric(viewport, 'scrollTop', 100)
    viewport.getBoundingClientRect = () => ({
      x: 0, y: 200, top: 200, right: 600, bottom: 400, left: 0,
      width: 600, height: 200, toJSON: () => ({}),
    })
    paragraph.getBoundingClientRect = () => ({
      x: 20, y: 500, top: 500, right: 580, bottom: 520, left: 20,
      width: 560, height: 20, toJSON: () => ({}),
    })
    const scrollTo = vi.fn((optionsOrX?: ScrollToOptions | number, y?: number) => {
      const top = typeof optionsOrX === 'number' ? y : optionsOrX?.top
      if (typeof top === 'number') viewport.scrollTop = top
    })
    viewport.scrollTo = scrollTo as typeof viewport.scrollTo
    const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    expect(focusEvidenceText(container, '合同金额不得低于 5 万元')).toEqual({
      state: 'found',
      pageNumber: null,
    })
    expect(paragraph.dataset.onesEvidenceFocus).toBe('true')
    expect(scrollTo).toHaveBeenCalledWith({ top: 310, left: 0, behavior: 'auto' })
    expect(viewport.scrollTop).toBe(310)
    expect(windowScrollTo).not.toHaveBeenCalled()
  })

  it('never constructs evidence by joining the end and start of adjacent blocks', () => {
    const container = document.createElement('div')
    const firstParagraph = document.createElement('p')
    const secondParagraph = document.createElement('p')
    firstParagraph.textContent = '合同金额不得'
    secondParagraph.textContent = '低于 5 万元'
    container.append(firstParagraph, secondParagraph)
    document.body.append(container)

    expect(focusEvidenceText(container, '合同金额不得低于 5 万元')).toEqual({
      state: 'missing',
      pageNumber: null,
    })
    expect(firstParagraph.dataset.onesEvidenceFocus).toBeUndefined()
    expect(secondParagraph.dataset.onesEvidenceFocus).toBeUndefined()
  })

  it('fails closed on repeated text until source offsets uniquely identify its block', () => {
    const viewport = document.createElement('div')
    viewport.dataset.documentScrollViewport = 'true'
    const container = document.createElement('div')
    const firstParagraph = document.createElement('p')
    const secondParagraph = document.createElement('p')
    firstParagraph.textContent = '甲方条款：合同金额不得低于 5 万元'
    secondParagraph.textContent = '乙方条款：合同金额不得低于 5 万元'
    container.append(firstParagraph, secondParagraph)
    viewport.append(container)
    document.body.append(viewport)
    setMetric(viewport, 'clientHeight', 200)
    setMetric(viewport, 'scrollHeight', 800)
    setMetric(viewport, 'scrollTop', 0)
    viewport.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 600, bottom: 200, left: 0,
      width: 600, height: 200, toJSON: () => ({}),
    })
    secondParagraph.getBoundingClientRect = () => ({
      x: 20, y: 500, top: 500, right: 580, bottom: 520, left: 20,
      width: 560, height: 20, toJSON: () => ({}),
    })
    viewport.scrollTo = vi.fn() as typeof viewport.scrollTo

    expect(focusEvidenceText(container, '合同金额不得低于 5 万元')).toEqual({
      state: 'ambiguous',
      pageNumber: null,
    })

    const sourceText = '甲方条款：合同金额不得低于 5 万元\n乙方条款：合同金额不得低于 5 万元'
    const start = sourceText.lastIndexOf('合同金额不得低于 5 万元')
    const result = focusEvidenceText(container, '合同金额不得低于 5 万元', {
      sourceText,
      sourceRange: { start, end: start + '合同金额不得低于 5 万元'.length },
    })

    expect(result).toEqual({ state: 'found', pageNumber: null })
    expect(firstParagraph.dataset.onesEvidenceFocus).toBeUndefined()
    expect(secondParagraph.dataset.onesEvidenceFocus).toBe('true')
  })

  it('fails closed when the evidence is absent without moving either scroll owner', () => {
    const viewport = document.createElement('div')
    viewport.dataset.documentScrollViewport = 'true'
    const container = document.createElement('div')
    container.textContent = '这里只存在其他合同条款'
    viewport.append(container)
    document.body.append(viewport)
    setMetric(viewport, 'scrollTop', 240)
    const scrollTo = vi.fn()
    viewport.scrollTo = scrollTo as typeof viewport.scrollTo

    expect(focusEvidenceText(container, '不存在的证据')).toEqual({
      state: 'missing',
      pageNumber: null,
    })
    expect(viewport.scrollTop).toBe(240)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('waits for final zoom layout and cancels stale evidence positioning', () => {
    expect(source.match(/focusEvidenceText\(/g)).toHaveLength(1)
    expect(source).toContain('window.requestAnimationFrame(() => {')
    expect(source).toContain('window.cancelAnimationFrame(frame)')
    expect(source).toContain('effectiveZoom,')
    expect(source).toContain('sourceRangeStart,')
    expect(source).not.toContain('selectedTextRef')
  })

  it('clears stale DOCX focus state and exposes explicit PDF manual-location boundaries', () => {
    expect(source).toContain("setEvidenceFocusState('idle')")
    expect(source).toContain("setEvidenceFocusState('missing')")
    expect(source).toContain('多处相同原文，需人工定位')
    expect(source).toContain('PDF 需按页人工定位')
    expect(source).toContain('扫描件')
    expect(source).toContain('不会把模糊命中冒充已定位')
  })

  it('lets the native PDF frame shrink inside the same bounded viewport', () => {
    expect(source).toContain('className={`${frameHeightClassName} min-h-0 w-full flex-1 bg-white`}')
    expect(source).not.toContain('min-h-[480px] w-full flex-1 bg-white')
  })
})
