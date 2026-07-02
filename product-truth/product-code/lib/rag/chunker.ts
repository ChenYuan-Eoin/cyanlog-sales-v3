// lib/rag/chunker.ts
// 文档分块 — 智能切分
// RAG的效果取决于分块质量，分块太大会丢失精度，太小会丢失上下文

export interface ChunkConfig {
  /** 分块策略 */
  strategy: 'fixed' | 'semantic' | 'paragraph'
  /** 块大小（字符） */
  chunkSize: number
  /** 重叠大小（字符） */
  overlap: number
}

export interface Chunk {
  index: number
  content: string
  metadata: Record<string, unknown>
}

/**
 * 文档分块器
 * 为什么需要分块？
 * - LLM上下文长度有限
 * - 检索精度取决于分块粒度
 * - 不同场景需要不同分块策略
 */
export class DocumentChunker {
  private config: ChunkConfig

  constructor(config: Partial<ChunkConfig> = {}) {
    this.config = {
      strategy: config.strategy || 'paragraph',
      chunkSize: config.chunkSize || 500,
      overlap: config.overlap || 50,
    }
  }

  private stepSize(): number {
    return Math.max(1, this.config.chunkSize - this.config.overlap)
  }

  /**
   * 分块
   */
  chunk(text: string, metadata: Record<string, unknown> = {}): Chunk[] {
    switch (this.config.strategy) {
      case 'fixed':
        return this.fixedChunk(text, metadata)
      case 'paragraph':
        return this.paragraphChunk(text, metadata)
      case 'semantic':
        return this.semanticChunk(text, metadata)
    }
  }

  /**
   * 固定大小分块
   */
  private fixedChunk(text: string, metadata: Record<string, unknown>): Chunk[] {
    const chunks: Chunk[] = []
    let index = 0
    const step = this.stepSize()

    for (let i = 0; i < text.length; i += step) {
      const content = text.slice(i, i + this.config.chunkSize)
      if (content.trim()) {
        chunks.push({ index: index++, content, metadata })
      }
    }

    return chunks
  }

  private splitOversizedUnit(text: string): string[] {
    const units: string[] = []
    const step = this.stepSize()
    for (let i = 0; i < text.length; i += step) {
      const content = text.slice(i, i + this.config.chunkSize).trim()
      if (content) units.push(content)
    }
    return units
  }

  private paragraphUnits(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .flatMap((paragraph) => {
        const trimmed = paragraph.trim()
        if (!trimmed) return []
        if (trimmed.length <= this.config.chunkSize) return [trimmed]

        const lines = trimmed
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)

        if (lines.length <= 1) {
          return this.splitOversizedUnit(trimmed)
        }

        return lines.flatMap((line) => (
          line.length > this.config.chunkSize
            ? this.splitOversizedUnit(line)
            : [line]
        ))
      })
  }

  /**
   * 段落分块（按换行/段落切分）
   */
  private paragraphChunk(text: string, metadata: Record<string, unknown>): Chunk[] {
    const units = this.paragraphUnits(text)
    const chunks: Chunk[] = []
    let index = 0
    let buffer = ''

    for (const unit of units) {
      const next = buffer ? `${buffer}\n\n${unit}` : unit
      if (next.length > this.config.chunkSize && buffer) {
        chunks.push({ index: index++, content: buffer.trim(), metadata })
        buffer = unit
      } else {
        buffer = next
      }
    }

    if (buffer.trim()) {
      chunks.push({ index: index++, content: buffer.trim(), metadata })
    }

    return chunks
  }

  /**
   * 语义分块（简化版：按句子分）
   */
  private semanticChunk(text: string, metadata: Record<string, unknown>): Chunk[] {
    // 简化版：按句号/问号/感叹号分
    const sentences = text.split(/([。！？.!?])/)
    const chunks: Chunk[] = []
    let index = 0
    let buffer = ''

    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i] + (sentences[i + 1] || '')

      if ((buffer + sentence).length > this.config.chunkSize && buffer) {
        chunks.push({ index: index++, content: buffer.trim(), metadata })
        buffer = ''
      }
      buffer += sentence
    }

    if (buffer.trim()) {
      chunks.push({ index: index++, content: buffer.trim(), metadata })
    }

    return chunks
  }
}
