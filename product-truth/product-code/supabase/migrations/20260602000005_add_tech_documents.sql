-- Migration: 20260602000005_add_tech_documents.sql
-- PURPOSE: F016 技术文档库 (产品说明书/技术白皮书/API文档/部署手册)
-- Refs: product-truth/01-business-truth/知识库管理.md#4

CREATE TABLE IF NOT EXISTS tech_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                          -- 文档标题
  doc_type TEXT NOT NULL,                       -- 类型: PRODUCT_SPEC / TECH_WHITEPAPER / API_DOC / DEPLOY_MANUAL
  version TEXT NOT NULL DEFAULT 'v1.0.0',       -- 版本号 (semver)
  content TEXT,                                 -- Markdown 内容
  file_url TEXT,                                -- 附件 URL（如 PDF）
  tags TEXT[] DEFAULT '{}',                     -- 标签
  is_published BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否发布
  view_count INTEGER NOT NULL DEFAULT 0,        -- 查看次数
  created_by UUID,                              -- 创建人
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_tech_documents_doc_type ON tech_documents (doc_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_documents_published ON tech_documents (is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_documents_tags ON tech_documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_tech_documents_created_at ON tech_documents (created_at DESC);

-- 注释
COMMENT ON TABLE tech_documents IS '技术文档库 (F016) - 产品说明书/白皮书/API/部署手册';
COMMENT ON COLUMN tech_documents.doc_type IS '类型: PRODUCT_SPEC | TECH_WHITEPAPER | API_DOC | DEPLOY_MANUAL';
COMMENT ON COLUMN tech_documents.version IS 'semver: v{major}.{minor}.{patch}';

-- RLS
ALTER TABLE tech_documents ENABLE ROW LEVEL SECURITY;
