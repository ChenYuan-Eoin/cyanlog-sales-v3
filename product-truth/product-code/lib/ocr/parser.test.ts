import { describe, expect, it } from 'vitest'
import { parseDocument } from './parser'

describe('parseDocument', () => {
  it('extracts text-layer PDF content for tender parsing', async () => {
    const pdf = Buffer.from('%PDF-1.4\nBT\n(招标编号：ZB-PDF-001) Tj\n(项目名称：长PDF云端解析项目) Tj\nET\n%%EOF', 'utf8')

    await expect(parseDocument(pdf, 'application/pdf', 'tender.pdf')).resolves.toContain('招标编号：ZB-PDF-001')
  })

  it('does not pretend scanned PDFs are parsed', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF', 'utf8')

    await expect(parseDocument(pdf, 'application/pdf', 'scan.pdf')).resolves.toContain('需要接入云端视觉 OCR')
  })
})
