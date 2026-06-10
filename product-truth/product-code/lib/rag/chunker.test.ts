import { describe, it, expect } from 'vitest'
import { DocumentChunker } from './chunker'

describe('DocumentChunker', () => {
  it('should chunk by paragraph', () => {
    const chunker = new DocumentChunker({ strategy: 'paragraph', chunkSize: 100, overlap: 0 })
    const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。'
    const chunks = chunker.chunk(text)

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].index).toBe(0)
  })

  it('should chunk by fixed size', () => {
    const chunker = new DocumentChunker({ strategy: 'fixed', chunkSize: 50, overlap: 10 })
    const text = 'A'.repeat(200)
    const chunks = chunker.chunk(text)

    expect(chunks.length).toBeGreaterThan(3)
  })

  it('should handle empty text', () => {
    const chunker = new DocumentChunker()
    const chunks = chunker.chunk('')
    expect(chunks).toHaveLength(0)
  })

  it('should include metadata', () => {
    const chunker = new DocumentChunker()
    const chunks = chunker.chunk('测试内容', { source: 'test' })
    expect(chunks[0].metadata.source).toBe('test')
  })
})
