import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { generateDraftDocx } from './draft-docx'

describe('generateDraftDocx', () => {
  it('creates an editable DOCX package with title and body text', async () => {
    const buffer = await generateDraftDocx({
      title: 'ONES 服务合同草案',
      content: '第一条 服务内容\n第二条 付款安排',
    })

    const zip = await JSZip.loadAsync(buffer)
    const documentXml = await zip.file('word/document.xml')?.async('string')
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string')

    expect(contentTypesXml).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    expect(documentXml).toContain('ONES 服务合同草案')
    expect(documentXml).toContain('第一条 服务内容')
    expect(documentXml).toContain('第二条 付款安排')
  })
})
