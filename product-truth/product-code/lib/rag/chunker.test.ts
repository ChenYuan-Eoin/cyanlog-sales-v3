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

  it('splits long single-newline text extracted from PDFs', () => {
    const chunker = new DocumentChunker({ strategy: 'paragraph', chunkSize: 6000, overlap: 400 })
    const text = Array.from({ length: 520 }, (_, index) => (
      `标书正文 ${index + 1}：评分标准、技术要求、商务条款、时间节点和合同约束需要被云模型分块解析。`
    )).join('\n')

    const chunks = chunker.chunk(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.content.length <= 6000)).toBe(true)
  })

  it('splits an oversized paragraph without hanging when overlap is configured', () => {
    const chunker = new DocumentChunker({ strategy: 'paragraph', chunkSize: 1000, overlap: 100 })
    const chunks = chunker.chunk('A'.repeat(2600))

    expect(chunks.length).toBe(3)
    expect(chunks.every((chunk) => chunk.content.length <= 1000)).toBe(true)
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
