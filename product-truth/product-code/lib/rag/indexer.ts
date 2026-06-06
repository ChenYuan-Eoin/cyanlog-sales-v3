// lib/rag/indexer.ts
// 增量索引器 — 只更新变更部分，对比版本删除过期添加新内容

import { DocumentChunker } from './chunker'
import { generateEmbeddings } from '@/lib/vector-store/embeddings'
import { upsertVectors, deleteVectors } from '@/lib/vector-store/pgvector'

/**
 * 索引任务
 */
export interface IndexTask {
  entityType: 'contract' | 'clause' | 'rule' | 'knowledge'
  entityId: string
  content: string
  metadata?: Record<string, unknown>
}

/**
 * 增量索引器
 * 增量索引的核心是"对比版本，删除过期，添加新内容"
 */
export class IncrementalIndexer {
  private chunker: DocumentChunker

  constructor() {
    this.chunker = new DocumentChunker({ strategy: 'paragraph', chunkSize: 500, overlap: 50 })
  }

  /**
   * 索引任务（增量）
   */
  async index(task: IndexTask): Promise<{ chunkCount: number; removed: number }> {
    // 1. 删除旧版本
    const removed = await deleteVectors({
      entityType: task.entityType,
      entityId: task.entityId,
    })

    // 2. 分块
    const chunks = this.chunker.chunk(task.content, task.metadata || {})

    // 3. 生成Embedding
    const embeddings = await generateEmbeddings(chunks.map((c) => c.content))

    // 4. 入库
    await upsertVectors(
      chunks.map((chunk, i) => ({
        id: `${task.entityType}_${task.entityId}_${chunk.index}`,
        entityType: task.entityType,
        entityId: task.entityId,
        content: chunk.content,
        embedding: embeddings[i] || [],
        metadata: { ...task.metadata, chunkIndex: chunk.index },
      }))
    )

    return { chunkCount: chunks.length, removed }
  }
}

/**
 * 全局索引器
 */
export const globalIndexer = new IncrementalIndexer()
