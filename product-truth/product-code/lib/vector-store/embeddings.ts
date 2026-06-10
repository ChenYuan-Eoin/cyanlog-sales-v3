// lib/vector-store/embeddings.ts
// Embedding 生成 — 支持本地模型降级，零国内模型依赖
// 使用 ai SDK 的 embed 函数，兼容 OpenAI + 本地模型

import { createOpenAI } from '@ai-sdk/openai'
import { embed, embedMany } from 'ai'
import type { EmbeddingConfig } from './types'

/**
 * 默认配置 — 使用本地模型（LM Studio/Ollama）
 * 不依赖任何国内模型
 */
const DEFAULT_CONFIG: EmbeddingConfig = {
  model: 'text-embedding-3-small',
  dimensions: 1536,
  batchSize: 10,
  timeoutMs: 10000,
}

/**
 * 生成单条文本的 Embedding
 * 降级链：本地模型 → 云端OpenAI → 哈希模拟
 */
export async function generateEmbedding(
  text: string,
  config?: Partial<EmbeddingConfig>
): Promise<number[]> {
  const merged = { ...DEFAULT_CONFIG, ...config }

  // 尝试本地模型
  try {
    const localEmbedding = await tryLocalEmbedding(text, merged)
    if (localEmbedding) return localEmbedding
  } catch (err) {
    console.warn('[Embedding] Local model failed:', err instanceof Error ? err.message : err)
  }

  // 尝试云端 OpenAI（通过中转站）
  try {
    const cloudEmbedding = await tryCloudEmbedding(text, merged)
    if (cloudEmbedding) return cloudEmbedding
  } catch (err) {
    console.warn('[Embedding] Cloud model failed:', err instanceof Error ? err.message : err)
  }

  // 最终降级：哈希模拟（确定性伪随机，保证相同文本得到相同向量）
  console.warn('[Embedding] All providers failed, falling back to hash simulation')
  return hashEmbedding(text, merged.dimensions)
}

/**
 * 批量生成 Embedding
 * 支持分批处理，避免单次请求过大
 */
export async function generateEmbeddings(
  texts: string[],
  config?: Partial<EmbeddingConfig>
): Promise<number[][]> {
  const merged = { ...DEFAULT_CONFIG, ...config }
  const batchSize = merged.batchSize || 10
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    try {
      // 尝试批量 API
      const embeddings = await tryBatchEmbedding(batch, merged)
      results.push(...embeddings)
    } catch {
      // 降级到单条逐个生成
      const singleEmbeddings = await Promise.all(
        batch.map((text) => generateEmbedding(text, config))
      )
      results.push(...singleEmbeddings)
    }
  }

  return results
}

/**
 * 尝试本地模型生成 Embedding
 */
async function tryLocalEmbedding(
  text: string,
  config: EmbeddingConfig
): Promise<number[] | null> {
  const localUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:1234/v1'

  // 检查本地模型是否可用
  const isAvailable = await checkLocalModelHealth(localUrl)
  if (!isAvailable) return null

  const local = createOpenAI({
    baseURL: localUrl,
    apiKey: 'not-needed',
  })

  const { embedding } = await embed({
    model: local.textEmbeddingModel('local-embedding'),
    value: text.substring(0, 8000), // 限制长度
  })

  // 如果维度不匹配，截取或填充
  return adjustDimensions(embedding, config.dimensions)
}

/**
 * 尝试云端 OpenAI 生成 Embedding
 */
async function tryCloudEmbedding(
  text: string,
  config: EmbeddingConfig
): Promise<number[] | null> {
  const gatewayUrl = process.env.AI_GATEWAY_URL
  const gatewayKey = process.env.AI_GATEWAY_API_KEY

  if (!gatewayUrl || !gatewayKey) return null

  const gateway = createOpenAI({
    baseURL: gatewayUrl,
    apiKey: gatewayKey,
  })

  const { embedding } = await embed({
    model: gateway.textEmbeddingModel(config.model),
    value: text.substring(0, 8000),
  })

  return adjustDimensions(embedding, config.dimensions)
}

/**
 * 尝试批量 Embedding API
 */
async function tryBatchEmbedding(
  texts: string[],
  config: EmbeddingConfig
): Promise<number[][]> {
  const localUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:1234/v1'

  const isAvailable = await checkLocalModelHealth(localUrl)
  if (!isAvailable) {
    throw new Error('Local model not available for batch embedding')
  }

  const local = createOpenAI({
    baseURL: localUrl,
    apiKey: 'not-needed',
  })

  const { embeddings } = await embedMany({
    model: local.textEmbeddingModel('local-embedding'),
    values: texts.map((t) => t.substring(0, 8000)),
  })

  return embeddings.map((e) => adjustDimensions(e, config.dimensions))
}

/**
 * 检查本地模型健康状态
 */
async function checkLocalModelHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(`${url}/models`, {
      method: 'GET',
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

/**
 * 调整向量维度（截取或零填充）
 */
function adjustDimensions(embedding: number[], targetDim: number): number[] {
  if (embedding.length === targetDim) return embedding

  if (embedding.length > targetDim) {
    return embedding.slice(0, targetDim)
  }

  // 零填充
  return [...embedding, ...new Array(targetDim - embedding.length).fill(0)]
}

/**
 * 哈希模拟 Embedding — 最终降级方案
 * 使用确定性哈希生成伪随机向量，保证相同文本得到相同向量
 * 并归一化，使可作为余弦相似度输入
 */
function hashEmbedding(text: string, dimensions: number): number[] {
  const vector: number[] = []
  const seed = hashCode(text)

  // 使用 xorshift 伪随机生成器，确保确定性
  let state = seed >>> 0
  for (let i = 0; i < dimensions; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    // 转为 [-1, 1] 范围
    vector.push((state % 2000) / 1000 - 1)
  }

  // 归一化
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (norm > 0) {
    return vector.map((v) => v / norm)
  }

  return vector
}

/**
 * 简单字符串哈希（FNV-1a 变体）
 */
function hashCode(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
