import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { generateWordDocument } from './word-generator'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'

const tempFiles: string[] = []

async function writeMinimalDocx(filePath: string, text: string | string[]) {
  const paragraphs = Array.isArray(text) ? text : [text]
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Types xmlns="${CT_NS}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    '</Types>',
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${REL_NS}">`,
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`,
    ...paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`),
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    '</w:body></w:document>',
  ].join(''))
  zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:t>源文件页脚</w:t></w:r></w:p></w:ftr>`)
  zip.file('word/_rels/document.xml.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${REL_NS}">`,
    '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    '</Relationships>',
  ].join(''))

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(filePath, buffer)
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
})

describe('generateWordDocument', () => {
  it('writes native Word comments into a writable docx', async () => {
    const inputPath = path.join(os.tmpdir(), `ones-input-${Date.now()}.docx`)
    tempFiles.push(inputPath)
    await writeMinimalDocx(inputPath, '付款周期为 120 天，质保期为 24 个月。')

    const result = await generateWordDocument(inputPath, {
      risks: [],
      annotations: [
        {
          id: 'annotation-1',
          start_offset: 0,
          end_offset: 10,
          selected_text: '付款周期为 120 天',
          comment: '【红线风险】付款周期过长\nRiskFinding: 11111111-1111-4111-8111-111111111111',
          category: 'risk_finding',
          priority: 'urgent',
          status: 'open',
          author_id: null,
          created_at: new Date('2026-06-30T00:00:00Z').toISOString(),
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.outputPath).toBeTruthy()
    expect(result.mode).toBe('source_comments')
    tempFiles.push(result.outputPath!)

    const outputZip = await JSZip.loadAsync(fs.readFileSync(result.outputPath!))
    const commentsXml = await outputZip.file('word/comments.xml')?.async('string')
    const documentXml = await outputZip.file('word/document.xml')?.async('string')
    const relsXml = await outputZip.file('word/_rels/document.xml.rels')?.async('string')
    const footerXml = await outputZip.file('word/footer1.xml')?.async('string')

    expect(commentsXml).toContain('ONES 业务运营')
    expect(commentsXml).toContain('付款周期过长')
    expect(documentXml).toContain('<w:commentRangeStart')
    expect(documentXml).toContain('<w:commentReference')
    expect(relsXml).toContain('/relationships/comments')
    expect(relsXml).toContain('/relationships/footer')
    expect(footerXml).toContain('源文件页脚')
  })

  it('does not masquerade a generated report as source-file comments in strict mode', async () => {
    const result = await generateWordDocument('/tmp/missing-ones-source.docx', {
      risks: [
        {
          level: 'red',
          title: '付款节奏',
          description: '首期比例低于标准',
          suggestion: '补充首期付款安排',
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.outputPath).toBeUndefined()
    expect(result.error).toContain('缺少可写入批注的源文件')
  })

  it('blocks export when a risk annotation needs manual source positioning', async () => {
    const inputPath = path.join(os.tmpdir(), `ones-input-manual-${Date.now()}.docx`)
    tempFiles.push(inputPath)
    await writeMinimalDocx(inputPath, '付款周期为 120 天，质保期为 24 个月。')

    const result = await generateWordDocument(inputPath, {
      risks: [],
      annotations: [
        {
          id: 'annotation-manual',
          start_offset: 0,
          end_offset: 0,
          selected_text: '',
          comment: '【需人工定位】【红线风险】付款周期过长\nLocationStatus: manual_required',
          category: 'risk_finding',
          priority: 'urgent',
          status: 'open',
          author_id: null,
          created_at: new Date('2026-06-30T00:00:00Z').toISOString(),
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('需人工定位')
    expect(result.outputPath).toBeUndefined()
  })

  it('blocks export when the same evidence text appears in multiple places without source range', async () => {
    const inputPath = path.join(os.tmpdir(), `ones-input-duplicate-${Date.now()}.docx`)
    tempFiles.push(inputPath)
    await writeMinimalDocx(inputPath, [
      '付款周期为 120 天，甲方提出账期。',
      '付款周期为 120 天，乙方接受账期。',
    ])

    const result = await generateWordDocument(inputPath, {
      risks: [],
      annotations: [
        {
          id: 'annotation-duplicate',
          start_offset: 0,
          end_offset: 0,
          selected_text: '付款周期为 120 天',
          comment: '【红线风险】付款周期过长',
          category: 'risk_finding',
          priority: 'urgent',
          status: 'open',
          author_id: null,
          created_at: new Date('2026-06-30T00:00:00Z').toISOString(),
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('证据原文不唯一')
    expect(result.outputPath).toBeUndefined()
  })
})
