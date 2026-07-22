import { describe, expect, it } from 'vitest'
import {
  alignRenderedPageTexts,
  attachRenderedLineBoxes,
  extractPdfText,
  extractRenderedPageMap,
  libreOfficeSecurityProfileXml,
  parsePdfLineGeometry,
  renderPdfPageToPng,
  resolveLibreOfficePath,
  sourceRenderMode,
  wordReviewPdfExportFilter,
} from './source-render'

const BLANK_PDF = Buffer.from(
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgNzIgNzIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTEzIDAwMDAwIG4gCjAwMDAwMDAxNjIgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA1Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCj4+CnN0YXJ0eHJlZgoyNTQKJSVFT0YK',
  'base64'
)

describe('source document render mode', () => {
  it('renders PDF directly and every supported Word format through the authenticated PDF pipeline', () => {
    expect(sourceRenderMode('合同.pdf', 'application/octet-stream')).toBe('pdf')
    expect(sourceRenderMode('合同.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word')
    expect(sourceRenderMode('合同.doc', 'application/msword')).toBe('word')
    expect(sourceRenderMode('合同.docm', 'application/vnd.ms-word.document.macroEnabled.12')).toBe('word')
  })

  it('rejects unrelated formats instead of faking a preview', () => {
    expect(sourceRenderMode('合同.txt', 'text/plain')).toBe('unsupported')
  })

  it('uses an explicit LibreOffice path before probing system locations', () => {
    expect(resolveLibreOfficePath('/runtime/soffice', () => false)).toBe('/runtime/soffice')
  })

  it('disables macros and active content in the isolated conversion profile', () => {
    const profile = libreOfficeSecurityProfileXml()
    expect(profile).toContain('DisableMacrosExecution')
    expect(profile).toContain('<value>true</value>')
    expect(profile).toContain('MacroSecurityLevel')
    expect(profile).toContain('<value>3</value>')
    expect(profile).toContain('DisableActiveContent')
  })

  it('renders existing Word comments in the review-preview margin', () => {
    expect(wordReviewPdfExportFilter()).toBe(
      'pdf:writer_pdf_Export:{"ExportNotesInMargin":{"type":"boolean","value":"true"}}'
    )
  })

  it('builds a rendered page map that can locate a risk on page 50', () => {
    const pageTexts = Array.from({ length: 50 }, (_, index) => `第${String(index + 1).padStart(2, '0')}页 唯一条款${index + 1} ${'履约内容'.repeat(20)}`)
    const source = pageTexts.join('\n')
    const map = alignRenderedPageTexts(source, pageTexts)
    const page50Start = source.indexOf('第50页')
    expect(map).toMatchObject({ page_count: 50, locator: 'rendered' })
    expect(map.pages.find((page) => page50Start >= page.start && page50Start <= page.end)?.page).toBe(50)
  })

  it('binds PDF line geometry back to immutable source offsets', () => {
    const source = '第一条 付款安排：首付款为30%。\n第二条 验收安排。'
    const pageMap = alignRenderedPageTexts(source, [source])
    const geometry = parsePdfLineGeometry(`
      <html><body><page width="600" height="800">
        <line xMin="60" yMin="120" xMax="360" yMax="144">
          <word xMin="60" yMin="120" xMax="110" yMax="144">第一条</word>
          <word xMin="120" yMin="120" xMax="360" yMax="144">付款安排：首付款为30%。</word>
        </line>
      </page></body></html>
    `)
    const mapped = attachRenderedLineBoxes(source, pageMap, geometry)
    expect(mapped.pages[0].line_boxes?.[0]).toMatchObject({
      start: 0,
      left: 10,
      top: 15,
      width: 50,
      height: 3,
    })
  })

  it('uses the PDFium worker for empty scan text, page identity, and PNG rendering', async () => {
    await expect(extractPdfText(BLANK_PDF)).resolves.toBe('')
    await expect(extractRenderedPageMap(BLANK_PDF, '')).resolves.toMatchObject({
      page_count: 1,
      locator: 'provisional',
      pages: [{ page: 1, start: 0, end: 0, locator: 'provisional' }],
    })
    const png = await renderPdfPageToPng(BLANK_PDF, 1, 144)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBe(144)
    expect(png.readUInt32BE(20)).toBe(144)
  })
})
