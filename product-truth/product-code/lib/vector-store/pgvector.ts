// lib/vector-store/pgvector.ts
// pgvector 向量存储 — 纯 SQL 实现，零额外依赖
// 基于 Supabase 原生 pgvector 扩展

import { supabaseAdmin } from '@/lib/supabase'
import type { VectorRecord, SimilarityResult, VectorSearchRequest, VectorIndexConfig } from './types'

/** 向量表名 */
const VECTOR_TABLE = 'contract_embeddings'

/**
 * 确保 pgvector 扩展已启用
 * 需要在 migration 中执行: CREATE EXTENSION IF NOT EXISTS vector;
 */
export async function ensurePgvectorExtension(): Promise<void> {
  const { error } = await supabaseAdmin.rpc('enable_pgvector_extension')
  if (error) {
    // 如果 RPC 不存在，尝试直接执行 SQL
    const { error: sqlError } = await supabaseAdmin
      .from('_extension_check')
      .select('*')
      .limit(0)
    if (sqlError) {
      console.warn('[pgvector] Extension check skipped, ensure it in migrations')
    }
  }
}

/**
 * 插入向量记录
 */
export async function insertVector(record: Omit<VectorRecord, 'createdAt'>): Promise<VectorRecord> {
  const now = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from(VECTOR_TABLE)
    .insert({
      id: record.id,
      entity_type: record.entityType,
      entity_id: record.entityId,
      content: record.content,
      embedding: `[${record.embedding.join(',')}]`, // pgvector 格式: [1,2,3,...]
      metadata: record.metadata,
      created_at: now,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`[pgvector] Insert failed: ${error.message}`)
  }

  return mapRowToRecord(data)
}

/**
 * 批量插入向量记录（幂等 — 先删除再插入）
 */
export async function upsertVectors(records: Omit<VectorRecord, 'createdAt'>[]): Promise<void> {
  if (records.length === 0) return

  const now = new Date().toISOString()

  // 按 entityId 分组，先删除旧记录
  const entityIds = Array.from(new Set(records.map((r) => r.entityId)))
  await supabaseAdmin
    .from(VECTOR_TABLE)
    .delete()
    .in('entity_id', entityIds)

  // 批量插入
  const rows = records.map((record) => ({
    id: record.id,
    entity_type: record.entityType,
    entity_id: record.entityId,
    content: record.content,
    embedding: `[${record.embedding.join(',')}]`,
    metadata: record.metadata,
    created_at: now,
  }))

  const { error } = await supabaseAdmin.from(VECTOR_TABLE).insert(rows)
  if (error) {
    throw new Error(`[pgvector] Batch insert failed: ${error.message}`)
  }
}

/**
 * 余弦相似度检索 — 核心 RAG 能力
 * 使用 pgvector 的 <=> 操作符（L2距离），或 <#>（内积）
 * 对于归一化向量，内积 = 余弦相似度
 */
export async function searchSimilar(
  request: VectorSearchRequest
): Promise<SimilarityResult[]> {
  const { embedding, entityType, topK = 5, threshold = 0.7 } = request

  const embeddingStr = `[${embedding.join(',')}]`

  // 使用 raw SQL 调用 pgvector 的相似度检索
  // 1 - (embedding <=> query_embedding) 将 L2 距离转为相似度
  // 或使用内积: embedding <#> query_embedding
  const query = `
    SELECT
      id,
      entity_type,
      entity_id,
      content,
      metadata,
      1 - (embedding <=> '${embeddingStr}'::vector) as similarity
    FROM ${VECTOR_TABLE}
    WHERE 1 - (embedding <=> '${embeddingStr}'::vector) >= ${threshold}
    ${entityType ? `AND entity_type = '${entityType}'` : ''}
    ORDER BY embedding <=> '${embeddingStr}'::vector
    LIMIT ${topK}
  `

  const { data, error } = await supabaseAdmin.rpc('exec_sql', { sql: query })

  if (error) {
    // 如果 RPC 不存在，降级到 Supabase 查询（不带相似度排序，仅过滤）
    console.warn('[pgvector] Falling back to basic query:', error.message)
    return fallbackBasicSearch(request)
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    content: row.content as string,
    similarity: row.similarity as number,
    metadata: row.metadata as Record<string, unknown>,
  }))
}

/**
 * 降级方案：不用 pgvector 操作符，仅按 entity_type 过滤 + 内存计算相似度
 * 适用于 pgvector 扩展未启用或 exec_sql RPC 未配置的情况
 */
async function fallbackBasicSearch(request: VectorSearchRequest): Promise<SimilarityResult[]> {
  const { embedding, entityType, topK = 5, threshold = 0.7 } = request

  let query = supabaseAdmin
    .from(VECTOR_TABLE)
    .select('id, entity_type, entity_id, content, embedding, metadata')

  if (entityType) {
    query = query.eq('entity_type', entityType)
  }

  const { data, error } = await query.limit(topK * 10) // 多拉取一些，内存过滤

  if (error) {
    throw new Error(`[pgvector] Fallback search failed: ${error.message}`)
  }

  const results: SimilarityResult[] = []

  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const rowEmbedding = parseEmbedding(row.embedding)
    if (!rowEmbedding) continue

    const similarity = cosineSimilarity(embedding, rowEmbedding)
    if (similarity >= threshold) {
      results.push({
        id: row.id as string,
        entityType: row.entity_type as string,
        entityId: row.entity_id as string,
        content: row.content as string,
        similarity,
        metadata: row.metadata as Record<string, unknown>,
      })
    }
  }

  // 按相似度排序，取 topK
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}

/**
 * 删除向量记录
 */
export async function deleteVectors(filters: {
  entityType?: string
  entityId?: string
}): Promise<number> {
  let query = supabaseAdmin.from(VECTOR_TABLE).delete()

  if (filters.entityType) {
    query = query.eq('entity_type', filters.entityType)
  }
  if (filters.entityId) {
    query = query.eq('entity_id', filters.entityId)
  }

  const { error } = await query

  if (error) {
    throw new Error(`[pgvector] Delete failed: ${error.message}`)
  }

  // Supabase 不返回删除计数，这里返回 0 表示成功
  return 0
}

/**
 * 获取向量统计
 */
export async function getVectorStats(): Promise<{
  total: number
  byEntityType: Record<string, number>
}> {
  const { data, error } = await supabaseAdmin
    .from(VECTOR_TABLE)
    .select('entity_type', { count: 'exact' })

  if (error) {
    throw new Error(`[pgvector] Stats failed: ${error.message}`)
  }

  const byEntityType: Record<string, number> = {}
  for (const row of (data || []) as Array<{ entity_type: string }>) {
    byEntityType[row.entity_type] = (byEntityType[row.entity_type] || 0) + 1
  }

  return {
    total: data?.length || 0,
    byEntityType,
  }
}

/**
 * 创建向量索引（IVFFlat 或 HNSW）
 */
export async function createVectorIndex(config: VectorIndexConfig): Promise<void> {
  const { indexType, lists = 100, m = 16, efConstruction = 64 } = config

  let sql: string
  if (indexType === 'ivfflat') {
    sql = `CREATE INDEX IF NOT EXISTS idx_contract_embeddings_ivfflat ON ${VECTOR_TABLE} USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists})`
  } else {
    sql = `CREATE INDEX IF NOT EXISTS idx_contract_embeddings_hnsw ON ${VECTOR_TABLE} USING hnsw (embedding vector_cosine_ops) WITH (m = ${m}, ef_construction = ${efConstruction})`
  }

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql })
  if (error) {
    console.warn('[pgvector] Index creation skipped (exec_sql not available):', error.message)
  }
}

// ─── 工具函数 ──────────────────────────────────────────

function mapRowToRecord(row: Record<string, unknown>): VectorRecord {
  return {
    id: row.id as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    content: row.content as string,
    embedding: parseEmbedding(row.embedding) || [],
    metadata: (row.metadata as Record<string, unknown>) || {},
    createdAt: row.created_at as string,
  }
}

/**
 * 解析 pgvector 格式字符串为数字数组
 * 格式: [1.0,2.0,3.0,...] 或 {1.0,2.0,3.0,...}
 */
function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.map(Number)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !Number.isNaN(n))
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !Number.isNaN(n))
    }
  }
  return null
}

/**
 * 余弦相似度计算
 * 假设向量已归一化，内积即余弦相似度
 * 未归一化时: dot(a,b) / (|a| * |b|)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  return dot / denom
}
