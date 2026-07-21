export type PdfTextUnavailableReason = 'NO_TEXT' | 'INSUFFICIENT_TEXT_COVERAGE' | 'UNRELIABLE_TEXT'

export interface ExtractedPdfPage {
  page: number
  start: number
  end: number
  text: string
}

export type PdfTextExtraction =
  | {
      status: 'TEXT'
      pageCount: number
      text: string
      pages: ExtractedPdfPage[]
      reason: null
    }
  | {
      status: 'UNAVAILABLE'
      pageCount: number
      text: null
      pages: null
      reason: PdfTextUnavailableReason
    }

export class PdfTextExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PdfTextExtractionError'
  }
}

interface PdfJsTextItem {
  str: string
  hasEOL?: boolean
}

interface ExtractedPageText {
  text: string
  hasRasterImage: boolean
}

function isTextItem(value: unknown): value is PdfJsTextItem {
  return typeof value === 'object'
    && value !== null
    && 'str' in value
    && typeof value.str === 'string'
}

const CJK_RADICAL_GLYPH_VARIANTS: Readonly<Record<string, string>> = {
  // Some standards-compliant Chromium/PingFang PDFs expose U+2EA0 (the
  // radical glyph) where the visible source character is U+6C11. NFKC does
  // not fold this one, and leaving it untouched breaks common rules such as
  // “人民币”. Keep this evidence-backed repair separate from generic OCR.
  '⺠': '民',
}

export function normalizePdfTextForReview(value: string): string {
  return value
    // PDF font maps may emit CJK compatibility ideographs/radicals (for
    // example `⽅` instead of `方`). Compatibility normalization keeps
    // business-rule matching stable without changing the source artifact.
    .normalize('NFKC')
    .replace(/[⺠]/gu, (character) => CJK_RADICAL_GLYPH_VARIANTS[character] || character)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textFromItems(items: unknown[]): string {
  let text = ''
  for (const item of items) {
    if (!isTextItem(item)) continue
    text += item.str
    if (item.hasEOL && !text.endsWith('\n')) text += '\n'
  }
  return normalizePdfTextForReview(text)
}

function meaningfulCharacterCount(text: string): number {
  return Array.from(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length
}

function unavailableReason(
  text: string,
  pageTexts: ExtractedPageText[],
): PdfTextUnavailableReason | null {
  const content = Array.from(text.replace(/\s/gu, ''))
  if (content.length === 0) return 'NO_TEXT'
  if (!/[\p{L}\p{N}]/u.test(text)) return 'NO_TEXT'

  // A PDF parser must never leak object dictionaries or compressed bytes into
  // the contract body. These markers were the signature of the old UTF-8
  // binary fallback.
  if (/%PDF-\d|\/FlateDecode\b|\b(?:endstream|startxref|xref)\b/u.test(text)) {
    return 'UNRELIABLE_TEXT'
  }

  const replacementCount = content.filter((character) => character === '\uFFFD').length
  const controlCount = content.filter((character) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(character)).length
  if (replacementCount > Math.max(2, Math.floor(content.length * 0.01))) {
    return 'UNRELIABLE_TEXT'
  }
  if (controlCount > Math.max(1, Math.floor(content.length * 0.005))) {
    return 'UNRELIABLE_TEXT'
  }

  const meaningfulByPage = pageTexts.map((page) => meaningfulCharacterCount(page.text))
  const sparseRasterPageCount = pageTexts.filter(
    (page, index) => page.hasRasterImage && meaningfulByPage[index] < 24,
  ).length
  // A logo or illustrated cover is not evidence that the whole document needs
  // OCR. Stop only when raster-heavy low-text pages dominate the document; the
  // aggregate coverage check below still catches sparse mixed documents.
  if (sparseRasterPageCount / pageTexts.length >= 0.8) {
    return 'INSUFFICIENT_TEXT_COVERAGE'
  }
  const meaningfulTotal = meaningfulByPage.reduce((sum, count) => sum + count, 0)
  if (pageTexts.length > 1 && meaningfulTotal < pageTexts.length * 12) {
    return 'INSUFFICIENT_TEXT_COVERAGE'
  }

  // Broken ToUnicode maps often collapse most glyphs to one repeated
  // character. Treating that output as reviewable contract text is worse than
  // stopping for OCR/manual preparation. Short headings are exempt because a
  // repeated character can be legitimate there.
  if (content.length >= 64) {
    const counts = new Map<string, number>()
    for (const character of content) {
      counts.set(character, (counts.get(character) || 0) + 1)
    }
    const dominantCount = Math.max(...counts.values())
    if (dominantCount / content.length > 0.45) return 'UNRELIABLE_TEXT'
  }

  return null
}

function mergePages(pageTexts: ExtractedPageText[]): Pick<Extract<PdfTextExtraction, { status: 'TEXT' }>, 'text' | 'pages'> {
  let text = ''
  const pages: ExtractedPdfPage[] = []

  for (const [index, page] of pageTexts.entries()) {
    if (index > 0) text += '\n\n'
    const start = text.length
    text += page.text
    pages.push({
      page: index + 1,
      start,
      end: page.text ? text.length - 1 : start,
      text: page.text,
    })
  }

  return { text, pages }
}

/**
 * Extract page-aware PDF text using a real PDF parser.
 *
 * PDF.js handles object streams, Flate compression, content streams and font
 * maps. We deliberately keep OCR outside this function: an image-only PDF or
 * an unreliable text map returns UNAVAILABLE, while a malformed/encrypted PDF
 * throws and cannot be promoted to READY.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtraction> {
  let loadingTask: { destroy(): Promise<void> } | null = null
  let document: { destroy(): Promise<void> } | null = null

  try {
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    loadingTask = getDocument({
      data: Uint8Array.from(bytes),
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: true,
      verbosity: 0,
    })
    const pdf = await (loadingTask as ReturnType<typeof getDocument>).promise
    document = pdf

    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1) {
      throw new Error('PDF 没有可读取的页面')
    }

    const imageOperators = new Set([
      OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup,
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageXObjectRepeat,
    ])
    const pageTexts: ExtractedPageText[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      try {
        const content = await page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        })
        const text = textFromItems(content.items)
        let hasRasterImage = false
        if (meaningfulCharacterCount(text) < 24) {
          const operators = await page.getOperatorList()
          hasRasterImage = operators.fnArray.some((operator) => imageOperators.has(operator))
        }
        pageTexts.push({ text, hasRasterImage })
      } finally {
        page.cleanup()
      }
    }

    const merged = mergePages(pageTexts)
    const reason = unavailableReason(merged.text, pageTexts)
    if (reason) {
      return {
        status: 'UNAVAILABLE',
        pageCount: pdf.numPages,
        text: null,
        pages: null,
        reason,
      }
    }

    return {
      status: 'TEXT',
      pageCount: pdf.numPages,
      text: merged.text,
      pages: merged.pages,
      reason: null,
    }
  } catch (error) {
    if (error instanceof PdfTextExtractionError) throw error
    throw new PdfTextExtractionError('PDF 解析失败，未生成可审核正文', {
      cause: error instanceof Error ? error : undefined,
    })
  } finally {
    if (document) {
      await document.destroy().catch(() => undefined)
    } else if (loadingTask) {
      await loadingTask.destroy().catch(() => undefined)
    }
  }
}
