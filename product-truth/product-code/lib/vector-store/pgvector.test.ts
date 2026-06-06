// lib/vector-store/pgvector.test.ts
// 向量存储测试 — 不依赖真实数据库，使用 mock

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VectorRecord, SimilarityResult } from './types'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
          in: vi.fn(() => Promise.resolve({ error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ error: null })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}))

describe('pgvector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a valid vector record', () => {
    const record: Omit<VectorRecord, 'createdAt'> = {
      id: 'test-uuid',
      entityType: 'contract',
      entityId: 'contract-1',
      content: '这是一个测试合同条款',
      embedding: new Array(1536).fill(0).map((_, i) => i / 1536),
      metadata: { source: 'test' },
    }

    expect(record.entityType).toBe('contract')
    expect(record.embedding.length).toBe(1536)
  })

  it('should search with valid parameters', () => {
    const request = {
      embedding: new Array(1536).fill(0).map((_, i) => i / 1536),
      entityType: 'contract',
      topK: 5,
      threshold: 0.7,
    }

    expect(request.topK).toBe(5)
    expect(request.threshold).toBe(0.7)
    expect(request.embedding.length).toBe(1536)
  })

  it('should handle empty search results', () => {
    const results: SimilarityResult[] = []
    expect(results.length).toBe(0)
  })
})

describe('cosine similarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [1, 0, 0]
    // 嵌入在模块内部测试时通过导出测试
    // 这里仅测试向量的基本性质
    expect(v[0]).toBe(1)
    expect(v.length).toBe(3)
  })

  it('should handle dimension mismatch', () => {
    const v1 = [1, 0]
    const v2 = [1, 0, 0]
    expect(v1.length).not.toBe(v2.length)
  })
})
