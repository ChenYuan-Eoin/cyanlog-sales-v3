import { describe, expect, it } from 'vitest'
import {
  CONTRACT_SOURCE_ACCEPT,
  canonicalContractSourceMime,
  contractSourceFormatFromFilename,
  inspectContractSource,
} from './source-format'

describe('contract source format', () => {
  it('has one accepted-format list for all upload surfaces', () => {
    expect(CONTRACT_SOURCE_ACCEPT).toBe('.pdf,.doc,.docx,.docm')
    expect(contractSourceFormatFromFilename('扫描件.PDF')).toBe('pdf')
    expect(contractSourceFormatFromFilename('带宏合同.docm')).toBe('docm')
    expect(contractSourceFormatFromFilename('photo.png')).toBeNull()
  })

  it('accepts generic browser MIME only when the file signature matches', () => {
    expect(inspectContractSource('a.pdf', 'application/octet-stream', Buffer.from('%PDF-1.7'))).toMatchObject({
      ok: true,
      format: 'pdf',
      mimeType: 'application/pdf',
    })
    expect(inspectContractSource('a.pdf', 'application/octet-stream', Buffer.from('not pdf'))).toMatchObject({ ok: false })
  })

  it('rejects extension/MIME disagreements and standalone images', () => {
    expect(inspectContractSource('a.docx', 'application/pdf')).toMatchObject({ ok: false, format: 'docx' })
    expect(inspectContractSource('a.png', 'image/png')).toMatchObject({ ok: false, format: null })
  })

  it('keeps DOCM distinct and prevents macro packages entering the DOCX path', () => {
    const zipWithMacroEntry = Buffer.from('PK\u0003\u0004word/vbaProject.bin')
    expect(inspectContractSource('a.docx', canonicalContractSourceMime('docx'), zipWithMacroEntry)).toMatchObject({ ok: false })
    expect(inspectContractSource('a.docm', canonicalContractSourceMime('docm'), zipWithMacroEntry)).toMatchObject({
      ok: true,
      format: 'docm',
    })
    expect(inspectContractSource(
      'browser.docm',
      'APPLICATION/VND.MS-WORD.DOCUMENT.MACROENABLED.12',
      zipWithMacroEntry
    )).toMatchObject({ ok: true, mimeType: canonicalContractSourceMime('docm') })
  })
})
