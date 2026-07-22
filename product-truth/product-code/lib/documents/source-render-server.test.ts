// @vitest-environment node

import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

vi.mock('./source-render', () => ({
  extractPdfText: vi.fn(),
  extractRenderedPageMap: vi.fn(),
  sourceRenderMode: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { extractPdfText, extractRenderedPageMap, sourceRenderMode } from './source-render'
import {
  ensureContractPageMap,
  verifyContractReviewSource,
  type SourceContractRecord,
} from './source-render-server'

const storagePath = 'contract-1/source.docx'

async function wordPackage(text: string) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>`,
    '</w:document>',
  ].join(''))
  return zip.generateAsync({ type: 'nodebuffer' })
}

function pageMapQuery(data: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  }
}

function arrangeSource(source: Uint8Array, storedPageMap: unknown = null) {
  const query = pageMapQuery(storedPageMap)
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never)
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
    download: vi.fn().mockResolvedValue({ data: new Blob([Uint8Array.from(source).buffer]), error: null }),
  } as never)
  return query
}

function contract(filename: string, parsedText: string): SourceContractRecord {
  return {
    id: 'contract-1',
    filename,
    storage_path: storagePath,
    parsed_text: parsedText,
  }
}

describe('ensureContractPageMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sourceRenderMode).mockReturnValue('word')
  })

  it('rejects a self-consistent legacy Word page map when current source bytes project different text', async () => {
    const source = await wordPackage('真实\t正文')
    const legacyText = '真实正文'
    const stored = {
      storage_path: storagePath,
      source_hash: createHash('sha256').update(source).digest('hex'),
      source_text_hash: createHash('sha256').update(legacyText).digest('hex'),
      render_mode: 'browser-ooxml',
      page_count: 1,
      locator: 'provisional',
      page_map: [{ page: 1, start: 0, end: legacyText.length - 1, locator: 'provisional' }],
    }
    arrangeSource(source, stored)

    await expect(ensureContractPageMap(contract('source.docx', legacyText)))
      .rejects.toThrow('当前源文件正文与数据库解析文本不一致')
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('contracts')
  })
})

describe('verifyContractReviewSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts DOCX with exact current-body identity while keeping the locator provisional', async () => {
    const source = await wordPackage('合同正文')
    const query = arrangeSource(source)

    const result = await verifyContractReviewSource(contract('source.docx', '合同正文'))

    expect(result).toMatchObject({
      source_hash: createHash('sha256').update(source).digest('hex'),
      source_text_hash: createHash('sha256').update('合同正文').digest('hex'),
      render_mode: 'browser-ooxml',
      locator: 'provisional',
      page_count: 1,
    })
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({
      contract_id: 'contract-1',
      render_mode: 'browser-ooxml',
      locator: 'provisional',
    }), { onConflict: 'contract_id' })
  })

  it('rejects DOCX when database text is not the projection of the stored bytes', async () => {
    arrangeSource(await wordPackage('真实正文'))
    await expect(verifyContractReviewSource(contract('source.docx', '旧正文')))
      .rejects.toThrow('当前源文件正文与数据库解析文本不一致')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('rejects legacy DOC before downloading or creating a review identity', async () => {
    await expect(verifyContractReviewSource(contract('source.doc', '合同正文')))
      .rejects.toThrow('请先另存为 DOCX')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('accepts PDF only when extracted text matches and every page is rendered', async () => {
    const source = Buffer.from('%PDF-controlled')
    const query = arrangeSource(source)
    vi.mocked(extractPdfText).mockResolvedValue('PDF 合同正文')
    vi.mocked(extractRenderedPageMap).mockResolvedValue({
      page_count: 1,
      locator: 'rendered',
      pages: [{ page: 1, start: 0, end: 7, locator: 'rendered' }],
    })

    const result = await verifyContractReviewSource(contract('source.pdf', 'PDF 合同正文'))

    expect(result).toMatchObject({ render_mode: 'native-pdf', locator: 'rendered' })
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({
      render_mode: 'native-pdf',
      locator: 'rendered',
    }), { onConflict: 'contract_id' })
  })

  it('rejects PDF when page text cannot be authoritatively aligned', async () => {
    const source = Buffer.from('%PDF-controlled')
    arrangeSource(source)
    vi.mocked(extractPdfText).mockResolvedValue('PDF 合同正文')
    vi.mocked(extractRenderedPageMap).mockResolvedValue({
      page_count: 1,
      locator: 'provisional',
      pages: [{ page: 1, start: 0, end: 7, locator: 'provisional' }],
    })

    await expect(verifyContractReviewSource(contract('source.pdf', 'PDF 合同正文')))
      .rejects.toThrow('无法与当前源文件逐页对应')
  })
})
