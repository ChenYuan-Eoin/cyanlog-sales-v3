// lib/vector-store/types.ts
// 向量存储类型定义 — 轻量实现，基于 Supabase pgvector 扩展

/**
 * 向量维度 — 与 text-embedding-3-small 对齐（1536维）
 * 支持降级到 384 维（text-embedding-3-small 的缩减版）
 */
export const EMBEDDING_DIMENSIONS = {
  FULL: 1536,
  COMPACT: 384,
} as const

export type EmbeddingDimension = (typeof EMBEDDING_DIMENSIONS)[keyof typeof EMBEDDING_DIMENSIONS]

/**
 * 向量记录 — 存储在 pgvector 表中
 */
export interface VectorRecord {
  id: string
  /** 关联实体类型: contract, clause, rule, knowledge, etc. */
  entityType: string
  /** 关联实体ID */
  entityId: string
  /** 文本内容（原始片段） */
  content: string
  /** 向量嵌入（pgvector 类型） */
  embedding: number[]
  /** 元数据 */
  metadata: Record<string, unknown>
  /** 创建时间 */
  createdAt: string
}

/**
 * 相似度检索结果
 */
export interface SimilarityResult {
  id: string
  entityType: string
  entityId: string
  content: string
  /** 余弦相似度得分 0-1 */
  similarity: number
  metadata: Record<string, unknown>
}

/**
 * 检索请求参数
 */
export interface VectorSearchRequest {
  /** 查询向量 */
  embedding: number[]
  /** 实体类型过滤 */
  entityType?: string
  /** 关联实体ID过滤 */
  entityId?: string
  /** Top-K 数量 */
  topK?: number
  /** 相似度阈值 0-1 */
  threshold?: number
  /** 额外过滤条件 */
  filters?: Record<string, unknown>
}

/**
 * 向量索引配置
 */
export interface VectorIndexConfig {
  /** 索引类型: ivfflat（近似）/ hnsw（精确但慢） */
  indexType: 'ivfflat' | 'hnsw'
  /** 列表数（ivfflat 参数） */
  lists?: number
  /** 邻居数（hnsw 参数） */
  m?: number
  /**  ef_construction（hnsw 参数） */
  efConstruction?: number
}

/**
 * Embedding 生成配置
 */
export interface EmbeddingConfig {
  /** 模型标识 */
  model: string
  /** 维度 */
  dimensions: EmbeddingDimension
  /** 批次大小 */
  batchSize?: number
  /** 超时毫秒 */
  timeoutMs?: number
}

/**
 * 文档分块配置
 */
export interface ChunkConfig {
  /** 分块策略 */
  strategy: 'fixed' | 'semantic' | 'paragraph'
  /** 块大小（token/字符） */
  chunkSize: number
  /** 重叠大小 */
  overlap: number
  /** 分隔符（语义分块用） */
  separators?: string[]
}
