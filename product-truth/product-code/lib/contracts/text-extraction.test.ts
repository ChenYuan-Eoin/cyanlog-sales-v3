import { describe, expect, it } from 'vitest'
import { extractContractText, isLikelyReadableContractText } from './text-extraction'

describe('extractContractText', () => {
  it('extracts literal text from simple PDF streams', () => {
    const pdf = Buffer.from('%PDF-1.4\nBT\n(第一条 付款期限为30日) Tj\n(第二条 违约责任) Tj\nET\n%%EOF', 'utf8')

    expect(extractContractText(pdf, 'contract.pdf', 'application/pdf')).toContain('第一条 付款期限为30日')
    expect(extractContractText(pdf, 'contract.pdf', 'application/pdf')).toContain('第二条 违约责任')
  })

  it('returns null when no extractable text exists', () => {
    expect(extractContractText(Buffer.from('%PDF-1.4\n%%EOF'), 'scan.pdf', 'application/pdf')).toBeNull()
  })

  it('rejects encoded PDF artifacts instead of treating them as evidence text', () => {
    const pdf = Buffer.from('%PDF-1.4\nBT\n(ÚØëü n#ÜCóS$±vÁ N\ri»êiÀöAOHr4ÙUù gÓÆ0nR) Tj\nET\n%%EOF', 'latin1')

    expect(extractContractText(pdf, 'encoded.pdf', 'application/pdf')).toBeNull()
    expect(isLikelyReadableContractText('ÚØëü n#ÜCóS$±vÁ N\ri»êiÀöAOHr4ÙUù gÓÆ0nR')).toBe(false)
  })

  it('accepts readable Chinese or English contract text', () => {
    expect(isLikelyReadableContractText('第一条 付款期限为30日')).toBe(true)
    expect(isLikelyReadableContractText('Section 1 payment term is 30 days')).toBe(true)
  })
})
