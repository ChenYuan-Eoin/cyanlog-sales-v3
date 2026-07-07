import JSZip from 'jszip'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'

export interface DraftDocxInput {
  title: string
  content: string
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paragraph(line: string, style?: 'title') {
  const styleXml = style === 'title'
    ? '<w:pPr><w:pStyle w:val="Title"/></w:pPr>'
    : ''
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
}

function normalizeDraftLines(input: DraftDocxInput) {
  const title = input.title.trim() || '合同草稿'
  const lines = input.content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
  return { title, lines: lines.length > 0 ? lines : [''] }
}

export async function generateDraftDocx(input: DraftDocxInput): Promise<Buffer> {
  const { title, lines } = normalizeDraftLines(input)
  const zip = new JSZip()

  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Types xmlns="${CT_NS}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '</Types>',
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${REL_NS}">`,
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.file('word/_rels/document.xml.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${REL_NS}">`,
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.file('word/styles.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:styles xmlns:w="${W_NS}">`,
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>',
    '</w:styles>',
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`,
    paragraph(title, 'title'),
    ...lines.map((line) => paragraph(line)),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    '</w:body></w:document>',
  ].join(''))

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })
}
