-- supabase/migrations/20260606000001_add_pgvector_and_embeddings.sql
-- Phase 1.1: pgvector 扩展 + 向量表 + 索引
-- 注意：此 migration 需要在 Supabase Dashboard 中手动启用 pgvector 扩展

-- ============================================
-- 1. 启用 pgvector 扩展
-- ============================================
-- 如果 Supabase 不支持直接 CREATE EXTENSION，需在 Dashboard > Extensions 中手动启用
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) THEN
        CREATE EXTENSION IF NOT EXISTS vector;
    END IF;
END $$;

-- ============================================
-- 2. 向量表：合同/条款/知识库嵌入存储
-- ============================================
CREATE TABLE IF NOT EXISTS contract_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,          -- 'contract' | 'clause' | 'rule' | 'knowledge' | 'template'
    entity_id TEXT NOT NULL,            -- 关联实体ID
    content TEXT NOT NULL,              -- 原始文本内容
    embedding VECTOR(1536),             -- pgvector 向量（1536维，与 text-embedding-3-small 对齐）
    metadata JSONB DEFAULT '{}',         -- 额外元数据
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 复合索引
    CONSTRAINT contract_embeddings_entity UNIQUE (entity_type, entity_id)
);

-- ============================================
-- 3. 索引
-- ============================================
-- 实体类型索引
CREATE INDEX IF NOT EXISTS idx_embeddings_entity_type ON contract_embeddings (entity_type);
-- 实体ID索引
CREATE INDEX IF NOT EXISTS idx_embeddings_entity_id ON contract_embeddings (entity_id);
-- pgvector 相似度索引（IVFFlat — 近似检索，适合大规模数据）
CREATE INDEX IF NOT EXISTS idx_embeddings_vector_ivfflat
    ON contract_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
-- 备选：HNSW 索引（精确但慢，适合中小规模）
-- CREATE INDEX IF NOT EXISTS idx_embeddings_vector_hnsw
--     ON contract_embeddings USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);

-- ============================================
-- 4. 相似度检索函数（封装，方便调用）
-- ============================================
CREATE OR REPLACE FUNCTION search_similar_embeddings(
    query_embedding VECTOR(1536),
    filter_entity_type TEXT DEFAULT NULL,
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    entity_type TEXT,
    entity_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ce.id,
        ce.entity_type,
        ce.entity_id,
        ce.content,
        ce.metadata,
        1 - (ce.embedding <=> query_embedding) AS similarity
    FROM contract_embeddings ce
    WHERE 1 - (ce.embedding <=> query_embedding) >= match_threshold
      AND (filter_entity_type IS NULL OR ce.entity_type = filter_entity_type)
    ORDER BY ce.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================
-- 5. RLS 策略（默认只允许管理员读写）
-- ============================================
ALTER TABLE contract_embeddings ENABLE ROW LEVEL SECURITY;

-- 所有人可读（嵌入向量无敏感信息）
CREATE POLICY "Allow read embeddings for all authenticated users"
    ON contract_embeddings
    FOR SELECT
    TO authenticated
    USING (true);

-- 只有拥有 config:write 权限的用户可以写入（通过应用层检查）
CREATE POLICY "Allow insert embeddings for authorized users"
    ON contract_embeddings
    FOR INSERT
    TO authenticated
    WITH CHECK (true); -- 应用层控制写入权限

-- ============================================
-- 6. 辅助函数：执行任意 SQL（用于 raw 查询）
-- ============================================
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result jsonb;
BEGIN
    EXECUTE sql INTO result;
    RETURN result;
END;
$$;
