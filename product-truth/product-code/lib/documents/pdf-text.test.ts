// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { normalizePdfTextForReview } from './pdf-text'

describe('normalizePdfTextForReview', () => {
  it('normalizes compatibility glyphs used by searchable Chinese PDFs', () => {
    expect(normalizePdfTextForReview('甲⽅应支付⼈⺠币伍万元')).toBe('甲方应支付人民币伍万元')
  })

  it('keeps line boundaries while removing trailing spaces and excessive blank lines', () => {
    expect(normalizePdfTextForReview('第一条  \r\n\r\n\r\n付款期限')).toBe('第一条\n\n付款期限')
  })
})
