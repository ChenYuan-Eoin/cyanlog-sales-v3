// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  extractCurrentWordText,
  MAX_DOCUMENT_XML_BYTES,
  MAX_DOCUMENT_XML_DEPTH,
  MAX_DOCUMENT_XML_ELEMENTS,
  MAX_EXTRACTED_TEXT_CHARS,
  WordSourceTextError,
} from './source-text'

const envelope = (body: string) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  `<w:body>${body}</w:body></w:document>`,
].join('')

const contentTypes = (format: 'docx' | 'docm') => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  `<Override PartName="/word/document.xml" ContentType="${format === 'docm'
    ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'}"/>`,
  '</Types>',
].join('')

const rootRelationships = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  '</Relationships>',
].join('')

async function packageWith(
  documentXml?: string,
  extras?: Record<string, string | Uint8Array>,
  format: 'docx' | 'docm' = 'docx',
  omitted: string[] = []
) {
  const zip = new JSZip()
  if (!omitted.includes('[Content_Types].xml')) zip.file('[Content_Types].xml', contentTypes(format))
  if (!omitted.includes('_rels/.rels')) zip.file('_rels/.rels', rootRelationships)
  if (documentXml !== undefined && !omitted.includes('word/document.xml')) zip.file('word/document.xml', documentXml)
  for (const [path, value] of Object.entries(extras || {})) zip.file(path, value)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('extractCurrentWordText', () => {
  it('keeps current and inserted text while decoding entities and structural breaks', async () => {
    const source = await packageWith(envelope([
      '<w:p><w:r><w:t>A &amp; B &lt;C&gt;</w:t></w:r><w:tab/>',
      '<w:ins><w:r><w:t>&#x4E2D;&#25991;</w:t></w:r></w:ins><w:br/>',
      '<w:del><w:r><w:t>deleted t</w:t><w:delText>deleted text</w:delText></w:r></w:del>',
      '<w:r><w:t>尾\r\n行</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>第二段</w:t></w:r></w:p>',
    ].join('')))

    await expect(extractCurrentWordText(source)).resolves.toBe('A & B <C>\t中文\n尾\n行\n第二段')
  })

  it('reads only document.xml and never includes comments or macro bytes', async () => {
    const source = await packageWith(
      envelope('<w:p><w:r><w:t>正文</w:t></w:r></w:p>'),
      {
        'word/comments.xml': '<w:comments><w:t>不可进入正文的批注</w:t></w:comments>',
        'word/vbaProject.bin': new TextEncoder().encode('never execute or extract this macro'),
      }
    )
    await expect(extractCurrentWordText(source)).resolves.toBe('正文')
  })

  it('binds the declared DOCX/DOCM format to the main-document content type', async () => {
    const docx = await packageWith(envelope('<w:p><w:r><w:t>DOCX</w:t></w:r></w:p>'))
    const docm = await packageWith(envelope('<w:p><w:r><w:t>DOCM</w:t></w:r></w:p>'), {}, 'docm')
    await expect(extractCurrentWordText(docx, 'docx')).resolves.toBe('DOCX')
    await expect(extractCurrentWordText(docm, 'docm')).resolves.toBe('DOCM')
    await expect(extractCurrentWordText(docm, 'docx')).rejects.toMatchObject({ code: 'DOCUMENT_FORMAT_MISMATCH' })
  })

  it('requires the OPC metadata parts and a unique internal package-root main relationship', async () => {
    const body = envelope('<w:p><w:r><w:t>正文</w:t></w:r></w:p>')
    await expect(extractCurrentWordText(await packageWith(body, {}, 'docx', ['_rels/.rels']))).rejects.toMatchObject({
      code: 'MISSING_PACKAGE_PART',
    })
    const external = rootRelationships.replace('Target="word/document.xml"', 'Target="https://example.test/document.xml" TargetMode="External"')
    await expect(extractCurrentWordText(await packageWith(body, { '_rels/.rels': external }))).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
    })
    const duplicate = rootRelationships.replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    await expect(extractCurrentWordText(await packageWith(body, { '_rels/.rels': duplicate }))).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
    })
  })

  it('rejects a non-Word document root namespace and ambiguous central-directory paths', async () => {
    const wrongRoot = envelope('<w:p><w:r><w:t>正文</w:t></w:r></w:p>').replace(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'urn:not-word'
    )
    await expect(extractCurrentWordText(await packageWith(wrongRoot))).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_XML' })
    const body = envelope('<w:p><w:r><w:t>正文</w:t></w:r></w:p>')
    await expect(extractCurrentWordText(await packageWith(body.replace('正文', '裸 & 实体')))).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT_XML',
    })
    await expect(extractCurrentWordText(await packageWith(body.replace('</w:document>', '<w:body><w:p><w:r><w:t>重复</w:t></w:r></w:p></w:body></w:document>')))).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT_XML',
    })
    await expect(extractCurrentWordText(await packageWith(body, { 'WORD/document.xml': body }))).rejects.toMatchObject({
      code: 'AMBIGUOUS_PACKAGE',
    })
    await expect(extractCurrentWordText(await packageWith(body, { 'word//shadow.xml': '<x/>' }))).rejects.toMatchObject({
      code: 'AMBIGUOUS_PACKAGE',
    })
  })

  it('rejects packages with missing or empty document bodies', async () => {
    await expect(extractCurrentWordText(await packageWith())).rejects.toMatchObject({
      code: 'MISSING_DOCUMENT_XML',
    })
    await expect(extractCurrentWordText(await packageWith(envelope('<w:p/>')))).rejects.toMatchObject({
      code: 'EMPTY_DOCUMENT_TEXT',
    })
  })

  it('rejects an oversized uncompressed document.xml before extraction', async () => {
    const source = await packageWith(envelope(`<w:p><w:r><w:t>${'x'.repeat(MAX_DOCUMENT_XML_BYTES)}</w:t></w:r></w:p>`))
    await expect(extractCurrentWordText(source)).rejects.toBeInstanceOf(WordSourceTextError)
    await expect(extractCurrentWordText(source)).rejects.toMatchObject({ code: 'DOCUMENT_XML_TOO_LARGE' })
  })

  it('bounds XML depth, element count, and projected output against floods', async () => {
    const deep = `${'<w:ins>'.repeat(MAX_DOCUMENT_XML_DEPTH)}<w:t>x</w:t>${'</w:ins>'.repeat(MAX_DOCUMENT_XML_DEPTH)}`
    await expect(extractCurrentWordText(await packageWith(envelope(deep)))).rejects.toMatchObject({
      code: 'DOCUMENT_XML_TOO_COMPLEX',
    })
    const elements = `<w:p>${'<w:r/>'.repeat(MAX_DOCUMENT_XML_ELEMENTS)}</w:p>`
    await expect(extractCurrentWordText(await packageWith(envelope(elements)))).rejects.toMatchObject({
      code: 'DOCUMENT_XML_TOO_COMPLEX',
    })
    const text = 'x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 1)
    await expect(extractCurrentWordText(await packageWith(envelope(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)))).rejects.toMatchObject({
      code: 'DOCUMENT_TEXT_TOO_LARGE',
    })
  })

  it('extracts the controlled revisions fixture as current contract text', async () => {
    const fixture = fileURLToPath(new URL('../../output/evidence/g5/controlled-revisions-comments-proof.docx', import.meta.url))
    const text = await extractCurrentWordText(await readFile(fixture), 'docx')
    expect(text).toContain('系统服务合同')
    expect(text).toContain('30 天')
    expect(text).toContain('12 个月')
    expect(text).toContain('SLA')
    expect(text).not.toContain('120 天')
    expect(text).not.toContain('24 个月')
  })
})
