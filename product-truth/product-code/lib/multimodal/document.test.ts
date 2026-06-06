import { describe, it, expect } from 'vitest'
import { parseMultimodalDocument, extractVisualInsights } from './document'

describe('parseMultimodalDocument', () => {
  it('should parse document with text only', async () => {
    const result = await parseMultimodalDocument([
      { text: '合同第1条：付款方式月结30天' },
    ])
    expect(result.totalPages).toBe(1)
    expect(result.fullText).toContain('付款方式')
    expect(result.allVisualElements).toHaveLength(0)
  })

  it('should handle multiple pages', async () => {
    const result = await parseMultimodalDocument([
      { text: '第1页内容' },
      { text: '第2页内容' },
    ])
    expect(result.totalPages).toBe(2)
    expect(result.pages).toHaveLength(2)
  })
})

describe('extractVisualInsights', () => {
  it('should extract insights from document', () => {
    const doc = {
      totalPages: 1,
      pages: [{
        pageNumber: 1,
        text: 'test',
        visualElements: [
          { type: 'stamp' as const, location: 'bottom', content: '公章' },
          { type: 'signature' as const, location: 'bottom-right', content: '签名' },
        ],
      }],
      fullText: 'test',
      allVisualElements: [
        { type: 'stamp' as const, location: 'bottom', content: '公章' },
        { type: 'signature' as const, location: 'bottom-right', content: '签名' },
      ],
    }

    const insights = extractVisualInsights(doc)
    expect(insights.hasStamp).toBe(true)
    expect(insights.hasSignature).toBe(true)
    expect(insights.hasHandwriting).toBe(false)
  })
})
