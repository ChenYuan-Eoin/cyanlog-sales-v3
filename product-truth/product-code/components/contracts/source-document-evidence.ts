export type EvidenceFocusState = 'idle' | 'found' | 'missing' | 'ambiguous'

export type EvidenceSourceRange = {
  start?: number | null
  end?: number | null
}

export type EvidenceFocusOptions = {
  sourceText?: string | null
  sourceRange?: EvidenceSourceRange | null
}

export type EvidenceFocusResult = {
  state: EvidenceFocusState
  pageNumber: number | null
}

type EvidenceCandidate = {
  host: HTMLElement
  text: string
  offsets: number[]
}

const EVIDENCE_BLOCK_SELECTOR = 'p, li, td, th, h1, h2, h3, h4, h5, h6'

function normalizeEvidenceText(text: string | null | undefined) {
  return (text || '').replace(/\s+/g, '')
}

export function normalizeEvidenceNeedle(text?: string) {
  const normalized = normalizeEvidenceText(text)
  if (normalized.length <= 0) return ''
  return normalized.slice(0, 96)
}

export function clearEvidenceFocus(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-ones-evidence-focus="true"]').forEach((element) => {
    element.removeAttribute('data-ones-evidence-focus')
    element.style.outline = ''
    element.style.background = ''
    element.style.borderRadius = ''
    element.style.scrollMargin = ''
  })
}

export function renderedPageElements(container: HTMLElement) {
  const directPages = Array.from(container.querySelectorAll<HTMLElement>('.docx-wrapper > section, section.docx'))
  if (directPages.length > 0) return directPages
  return Array.from(container.querySelectorAll<HTMLElement>('section'))
}

function renderedPageNumberFor(container: HTMLElement, host: HTMLElement) {
  const pages = renderedPageElements(container)
  const index = pages.findIndex((page) => page.contains(host))
  return index >= 0 ? index + 1 : null
}

function occurrenceOffsets(text: string, needle: string) {
  const offsets: number[] = []
  let cursor = 0
  while (cursor <= text.length - needle.length) {
    const offset = text.indexOf(needle, cursor)
    if (offset < 0) break
    offsets.push(offset)
    cursor = offset + Math.max(1, needle.length)
  }
  return offsets
}

function evidenceBlocks(container: HTMLElement, needle: string): EvidenceCandidate[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textByHost = new Map<HTMLElement, string>()
  let node = walker.nextNode()

  while (node) {
    const text = normalizeEvidenceText(node.textContent)
    const parent = node.parentElement
    if (text && parent) {
      const block = parent.closest<HTMLElement>(EVIDENCE_BLOCK_SELECTOR)
      const host = block && container.contains(block) ? block : parent
      textByHost.set(host, `${textByHost.get(host) || ''}${text}`)
    }
    node = walker.nextNode()
  }

  return Array.from(textByHost.entries()).flatMap(([host, text]) => {
    const offsets = occurrenceOffsets(text, needle)
    return offsets.length > 0 ? [{ host, text, offsets }] : []
  })
}

function sourceLineContext(sourceText: string, start: number, end: number) {
  const previousBreak = sourceText.lastIndexOf('\n', Math.max(0, start - 1))
  const nextBreak = sourceText.indexOf('\n', end)
  const lineStart = Math.max(previousBreak + 1, start - 80)
  const lineEnd = Math.min(nextBreak >= 0 ? nextBreak : sourceText.length, end + 80)
  return normalizeEvidenceText(sourceText.slice(lineStart, lineEnd))
}

function sourceRangeMatchesNeedle(
  sourceText: string,
  sourceRange: EvidenceSourceRange,
  needle: string
) {
  const start = sourceRange.start
  const end = sourceRange.end
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false
  if ((start as number) < 0 || (end as number) <= (start as number) || (end as number) > sourceText.length) {
    return false
  }
  const rangedText = normalizeEvidenceText(sourceText.slice(start as number, end as number))
  return rangedText.includes(needle) || needle.includes(rangedText)
}

function candidateFromSourceRange(
  candidates: EvidenceCandidate[],
  needle: string,
  options: EvidenceFocusOptions
) {
  const sourceText = options.sourceText || ''
  const sourceRange = options.sourceRange
  if (!sourceText || !sourceRange || !sourceRangeMatchesNeedle(sourceText, sourceRange, needle)) {
    return null
  }

  const context = sourceLineContext(
    sourceText,
    sourceRange.start as number,
    sourceRange.end as number
  )
  if (!context) return null
  const contextualCandidates = candidates.filter((candidate) => candidate.text.includes(context))
  if (contextualCandidates.length !== 1) return null
  const candidate = contextualCandidates[0]
  const contextOffset = candidate.text.indexOf(context)
  const needleOffsetInContext = context.indexOf(needle)
  const expectedOffset = needleOffsetInContext >= 0
    ? contextOffset + needleOffsetInContext
    : candidate.offsets[0]
  return candidate.offsets.includes(expectedOffset)
    ? { host: candidate.host, offset: expectedOffset }
    : null
}

export function findEvidenceMatch(
  container: HTMLElement,
  needle: string,
  options: EvidenceFocusOptions = {}
): { state: 'found'; host: HTMLElement } | { state: 'missing' | 'ambiguous'; host: null } {
  const candidates = evidenceBlocks(container, needle)
  const matchCount = candidates.reduce((total, candidate) => total + candidate.offsets.length, 0)
  if (matchCount === 0) return { state: 'missing', host: null }

  if (options.sourceText && options.sourceRange) {
    if (!sourceRangeMatchesNeedle(options.sourceText, options.sourceRange, needle)) {
      return { state: 'ambiguous', host: null }
    }
    const anchoredCandidate = candidateFromSourceRange(candidates, needle, options)
    if (anchoredCandidate) return { state: 'found', host: anchoredCandidate.host }
    if (matchCount > 1) return { state: 'ambiguous', host: null }
  }

  if (matchCount !== 1) return { state: 'ambiguous', host: null }
  return { state: 'found', host: candidates[0].host }
}

export function focusEvidenceText(
  container: HTMLElement | null,
  evidenceText?: string,
  options: EvidenceFocusOptions = {}
): EvidenceFocusResult {
  if (!container) return { state: 'idle', pageNumber: null }
  clearEvidenceFocus(container)
  const needle = normalizeEvidenceNeedle(evidenceText)
  if (!needle) return { state: 'idle', pageNumber: null }

  const match = findEvidenceMatch(container, needle, options)
  if (match.state !== 'found') return { state: match.state, pageNumber: null }
  const host = match.host
  const pageNumber = renderedPageNumberFor(container, host)
  host.dataset.onesEvidenceFocus = 'true'
  host.style.outline = '2px solid rgba(79, 70, 229, 0.75)'
  host.style.background = 'rgba(254, 249, 195, 0.82)'
  host.style.borderRadius = '3px'
  host.style.scrollMargin = '96px'
  const viewport = container.closest<HTMLElement>('[data-document-scroll-viewport="true"]')
  if (viewport) {
    const viewportRect = viewport.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const hostTop = viewport.scrollTop + hostRect.top - viewportRect.top
    const centeredTop = hostTop - ((viewport.clientHeight - hostRect.height) / 2)
    const maximumTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const nextTop = Math.min(maximumTop, Math.max(0, centeredTop))
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: nextTop, left: viewport.scrollLeft, behavior: 'auto' })
    } else {
      viewport.scrollTop = nextTop
    }
  }
  return { state: 'found', pageNumber }
}
