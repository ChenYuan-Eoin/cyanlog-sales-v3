// @vitest-environment node

import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { prepareContractSource, SourcePreparationError } from './source-page-map'

function pdfObject(id: number, body: string | Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n`, 'ascii'),
    Buffer.isBuffer(body) ? body : Buffer.from(body, 'ascii'),
    Buffer.from('\nendobj\n', 'ascii'),
  ])
}

function compressedStream(content: Buffer): Buffer {
  const compressed = deflateSync(content)
  return Buffer.concat([
    Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'ascii'),
    compressed,
    Buffer.from('\nendstream', 'ascii'),
  ])
}

function escapePdfString(value: string): string {
  return value.replace(/([\\()])/g, '\\$1')
}

interface PdfFixturePage {
  text: string
  image: boolean
}

/** Build a structurally valid, xref-backed PDF with compressed page streams. */
function compressedPdf(pageInputs: Array<string | null | PdfFixturePage>): Buffer {
  const objects = new Map<number, Buffer>()
  const pageIds = pageInputs.map((_, index) => 5 + index * 2)
  objects.set(1, pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'))
  objects.set(2, pdfObject(2, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`))
  objects.set(3, pdfObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'))

  const image = deflateSync(Buffer.from([0x22, 0x66, 0xaa]))
  objects.set(4, pdfObject(4, Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`, 'ascii'),
    image,
    Buffer.from('\nendstream', 'ascii'),
  ])))

  for (const [index, input] of pageInputs.entries()) {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    const text = typeof input === 'string' ? input : input?.text || null
    const showImage = input === null || (typeof input === 'object' && input.image)
    const content = Buffer.from([
      showImage ? 'q\n100 0 0 100 72 600 cm\n/Im0 Do\nQ' : '',
      text ? `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfString(text)}) Tj\nET` : '',
    ].filter(Boolean).join('\n'), 'ascii')
    objects.set(pageId, pdfObject(pageId, [
      '<< /Type /Page /Parent 2 0 R',
      '/MediaBox [0 0 612 792]',
      '/Resources << /Font << /F1 3 0 R >> /XObject << /Im0 4 0 R >> >>',
      `/Contents ${contentId} 0 R >>`,
    ].join(' ')))
    objects.set(contentId, pdfObject(contentId, compressedStream(content)))
  }

  const objectCount = 4 + pageInputs.length * 2
  const parts: Uint8Array[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'binary')]
  const offsets = new Array<number>(objectCount + 1).fill(0)
  let offset = parts[0].length
  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects.get(id)
    if (!object) throw new Error(`Missing PDF object ${id}`)
    offsets[id] = offset
    parts.push(object)
    offset += object.length
  }

  const xrefOffset = offset
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('')
  parts.push(Buffer.from(xref, 'ascii'))
  return Buffer.concat(parts)
}

async function wordPackage(format: 'docx' | 'docm', body: string) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    `<Override PartName="/word/document.xml" ContentType="${format === 'docm'
      ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'}"/>`,
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
    `<w:body>${body}</w:body></w:document>`,
  ].join(''))
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('prepareContractSource', () => {
  it('uses current DOCX text: inserted text stays and deleted text is excluded', async () => {
    const bytes = await wordPackage('docx', [
      '<w:p><w:r><w:t>付款期限</w:t></w:r>',
      '<w:del><w:r><w:delText>120 天</w:delText></w:r></w:del>',
      '<w:ins><w:r><w:t>30 天</w:t></w:r></w:ins></w:p>',
    ].join(''))

    const result = await prepareContractSource(bytes, '合同.docx')

    expect(result).toMatchObject({
      status: 'READY',
      format: 'docx',
      renderMode: 'browser-ooxml',
      parsedText: '付款期限30 天',
      pageMap: { page_count: 1, locator: 'provisional' },
    })
    expect(result.parsedText).not.toContain('120 天')
    expect(result.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('keeps DOCM distinct while extracting only the current body', async () => {
    const bytes = await wordPackage('docm', '<w:p><w:r><w:t>含宏文档正文</w:t></w:r></w:p>')
    const result = await prepareContractSource(bytes, '合同.docm')
    expect(result).toMatchObject({ status: 'READY', format: 'docm', parsedText: '含宏文档正文' })
  })

  it('extracts a real compressed 50-page PDF and maps every page to exact merged-text offsets', async () => {
    const pageTexts = Array.from({ length: 50 }, (_, index) => {
      const page = String(index + 1).padStart(2, '0')
      return `PAGE-${page}-ANCHOR-${page} Contract review clause ${index + 1}`
    })
    const bytes = compressedPdf(pageTexts)
    const result = await prepareContractSource(bytes, 'contract.pdf', 'application/pdf')
    expect(result).toMatchObject({
      status: 'READY',
      renderMode: 'native-pdf',
      pageMap: {
        page_count: 50,
        locator: 'provisional',
      },
    })
    if (result.status !== 'READY') throw new Error('Expected a reviewable text PDF')
    expect(result.pageMap.pages).toHaveLength(50)
    expect(result.parsedText).toContain('PAGE-01-ANCHOR-01')
    expect(result.parsedText).toContain('PAGE-50-ANCHOR-50')
    expect(result.parsedText).not.toMatch(/%PDF|FlateDecode|endstream/)
    for (const [index, page] of result.pageMap.pages.entries()) {
      expect(result.parsedText.slice(page.start, page.end + 1)).toBe(pageTexts[index])
    }
  })

  it('preserves an image-only scanned PDF for OCR without fabricating text identity or a page map', async () => {
    const bytes = compressedPdf([null])
    const result = await prepareContractSource(bytes, 'scan.pdf', 'application/pdf')
    expect(result).toEqual(expect.objectContaining({
      status: 'AWAITING_OCR',
      reason: 'PDF_TEXT_UNAVAILABLE',
      parsedText: null,
      sourceTextHash: null,
      pageMap: null,
    }))
  })

  it('does not mistake image pages with only page-number text for a reviewable contract', async () => {
    const bytes = compressedPdf(Array.from({ length: 50 }, (_, index) => ({
      text: `Page ${index + 1}`,
      image: true,
    })))
    const result = await prepareContractSource(bytes, 'scan-with-page-numbers.pdf', 'application/pdf')

    expect(result).toEqual(expect.objectContaining({
      status: 'AWAITING_OCR',
      reason: 'PDF_TEXT_UNAVAILABLE',
      parsedText: null,
      sourceTextHash: null,
      pageMap: null,
    }))
  })

  it('keeps a document reviewable when one logo or illustrated cover is followed by searchable contract text', async () => {
    const pageTexts: PdfFixturePage[] = [
      { text: 'LOGO COVER', image: true },
      { text: 'Payment clause requires settlement within 30 days after acceptance.', image: false },
      { text: 'Confidentiality and arbitration clauses remain binding after termination.', image: false },
    ]
    const result = await prepareContractSource(
      compressedPdf(pageTexts),
      'contract-with-logo.pdf',
      'application/pdf',
    )

    expect(result).toMatchObject({
      status: 'READY',
      renderMode: 'native-pdf',
      pageMap: { page_count: 3 },
    })
    if (result.status !== 'READY') throw new Error('Expected searchable contract text')
    expect(result.parsedText).toContain('Payment clause')
    expect(result.parsedText).toContain('Confidentiality and arbitration')
  })

  it('does not promote a broken font map that collapses the body to one repeated glyph', async () => {
    const bytes = compressedPdf([`A${'x'.repeat(200)}B`])
    const result = await prepareContractSource(bytes, 'broken-font-map.pdf', 'application/pdf')

    expect(result).toEqual(expect.objectContaining({
      status: 'AWAITING_OCR',
      reason: 'PDF_TEXT_UNAVAILABLE',
      parsedText: null,
      sourceTextHash: null,
      pageMap: null,
    }))
  })

  it('preserves legacy DOC as conversion-required without fabricating review identity', async () => {
    const bytes = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const result = await prepareContractSource(bytes, 'legacy.doc')

    expect(result).toEqual(expect.objectContaining({
      status: 'AWAITING_CONVERSION',
      reason: 'LEGACY_DOC_REQUIRES_CONVERSION',
      format: 'doc',
      mimeType: 'application/msword',
      parsedText: null,
      sourceTextHash: null,
      renderMode: 'identity-only',
      pageMap: null,
    }))
    expect(result.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('fails closed on mismatched signatures', async () => {
    await expect(prepareContractSource(Buffer.from('not a pdf'), 'contract.pdf'))
      .rejects.toBeInstanceOf(SourcePreparationError)
  })

  it('fails closed when a PDF signature exists but the PDF structure cannot be parsed', async () => {
    await expect(prepareContractSource(Buffer.from('%PDF-1.7\nnot a document'), 'contract.pdf'))
      .rejects.toMatchObject({
        name: 'SourcePreparationError',
        code: 'PDF_PARSE_FAILED',
      })
  })
})
