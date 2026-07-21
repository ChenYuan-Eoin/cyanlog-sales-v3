import { createHash } from 'node:crypto'
import {
  inspectContractSource,
  type ContractSourceFormat,
} from './source-format'
import { extractPdfText, PdfTextExtractionError } from './pdf-text'
import { extractCurrentWordText, WordSourceTextError } from './source-text'

export type SourcePreparationStatus = 'READY' | 'AWAITING_OCR' | 'AWAITING_CONVERSION'
export type SourceRenderMode = 'native-pdf' | 'browser-ooxml' | 'identity-only'

export interface ProvisionalSourcePage {
  page: number
  start: number
  end: number
  locator: 'provisional'
}

export interface ProvisionalSourcePageMap {
  page_count: number
  locator: 'provisional'
  pages: ProvisionalSourcePage[]
}

interface PreparedSourceBase {
  format: ContractSourceFormat
  mimeType: string
  sourceHash: string
}

export type PreparedContractSource =
  | (PreparedSourceBase & {
      format: Exclude<ContractSourceFormat, 'doc'>
      status: 'READY'
      parsedText: string
      sourceTextHash: string
      pageMap: ProvisionalSourcePageMap
      reason: null
      renderMode: Exclude<SourceRenderMode, 'identity-only'>
    })
  | (PreparedSourceBase & {
      format: 'pdf'
      status: 'AWAITING_OCR'
      parsedText: null
      sourceTextHash: null
      pageMap: null
      reason: 'PDF_TEXT_UNAVAILABLE'
      renderMode: 'native-pdf'
    })
  | (PreparedSourceBase & {
      format: 'doc'
      status: 'AWAITING_CONVERSION'
      parsedText: null
      sourceTextHash: null
      pageMap: null
      reason: 'LEGACY_DOC_REQUIRES_CONVERSION'
      renderMode: 'identity-only'
    })

export class SourcePreparationError extends Error {
  constructor(
    readonly code: 'INVALID_SOURCE' | 'LEGACY_DOC_REQUIRES_CONVERSION' | 'PDF_PARSE_FAILED' | 'WORD_TEXT_INVALID',
    message: string,
  ) {
    super(message)
    this.name = 'SourcePreparationError'
  }
}

function pdfPageMap(
  extraction: Extract<Awaited<ReturnType<typeof extractPdfText>>, { status: 'TEXT' }>,
): ProvisionalSourcePageMap {
  return {
    page_count: extraction.pageCount,
    // The page boundaries are exact for extracted PDF text. The locator stays
    // provisional because these are character offsets, not rendered geometry.
    locator: 'provisional',
    pages: extraction.pages.map((page) => ({
      page: page.page,
      start: page.start,
      end: page.end,
      locator: 'provisional',
    })),
  }
}

function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex')
}

function wholeDocumentPageMap(text: string): ProvisionalSourcePageMap {
  return {
    page_count: 1,
    locator: 'provisional',
    pages: [{
      page: 1,
      start: 0,
      end: Math.max(0, text.length - 1),
      locator: 'provisional',
    }],
  }
}

/**
 * Build the source identity from the exact bytes that will be persisted.
 *
 * Word pagination is deliberately provisional because browser OOXML layout is
 * not Word pagination. PDF parsing preserves actual PDF page boundaries as
 * character ranges. Empty or unreliable PDF text is preserved for OCR, but it
 * is not promoted to a review identity.
 */
export async function prepareContractSource(
  bytes: Uint8Array,
  fileName: string,
  mimeType?: string | null,
): Promise<PreparedContractSource> {
  const inspection = inspectContractSource(fileName, mimeType, bytes)
  if (!inspection.ok || !inspection.format || !inspection.mimeType) {
    throw new SourcePreparationError(
      'INVALID_SOURCE',
      inspection.error || '合同源文件格式无效',
    )
  }
  if (inspection.format === 'doc') {
    return {
      status: 'AWAITING_CONVERSION',
      reason: 'LEGACY_DOC_REQUIRES_CONVERSION',
      format: 'doc',
      mimeType: inspection.mimeType,
      sourceHash: sha256(bytes),
      sourceTextHash: null,
      parsedText: null,
      renderMode: 'identity-only',
      pageMap: null,
    }
  }

  const sourceHash = sha256(bytes)
  if (inspection.format === 'pdf') {
    let extraction: Awaited<ReturnType<typeof extractPdfText>>
    try {
      extraction = await extractPdfText(bytes)
    } catch (error) {
      if (error instanceof PdfTextExtractionError) {
        throw new SourcePreparationError('PDF_PARSE_FAILED', error.message)
      }
      throw error
    }
    if (extraction.status === 'UNAVAILABLE') {
      return {
        status: 'AWAITING_OCR',
        reason: 'PDF_TEXT_UNAVAILABLE',
        format: 'pdf',
        mimeType: inspection.mimeType,
        sourceHash,
        sourceTextHash: null,
        parsedText: null,
        renderMode: 'native-pdf',
        pageMap: null,
      }
    }
    return {
      status: 'READY',
      reason: null,
      format: 'pdf',
      mimeType: inspection.mimeType,
      sourceHash,
      sourceTextHash: sha256(extraction.text),
      parsedText: extraction.text,
      renderMode: 'native-pdf',
      pageMap: pdfPageMap(extraction),
    }
  }

  try {
    const parsedText = await extractCurrentWordText(bytes, inspection.format)
    return {
      status: 'READY',
      reason: null,
      format: inspection.format,
      mimeType: inspection.mimeType,
      sourceHash,
      sourceTextHash: sha256(parsedText),
      parsedText,
      renderMode: 'browser-ooxml',
      pageMap: wholeDocumentPageMap(parsedText),
    }
  } catch (error) {
    if (error instanceof WordSourceTextError) {
      throw new SourcePreparationError('WORD_TEXT_INVALID', error.message)
    }
    throw error
  }
}
