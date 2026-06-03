-- Migration: 20260602000006_add_business_qualifications.sql
-- PURPOSE: F017 商务资质库 (企业资质/人员资质/业绩证明/合作伙伴)
-- Refs: product-truth/01-business-truth/知识库管理.md#5

CREATE TABLE IF NOT EXISTS business_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                          -- 资质名称
  qual_type TEXT NOT NULL,                      -- 类型: ENTERPRISE | PERSONNEL | PERFORMANCE | PARTNER
  cert_no TEXT,                                 -- 证书编号
  issuer TEXT,                                  -- 颁发机构
  issued_at DATE,                               -- 颁发日期
  expires_at DATE,                              -- 到期日期（NULL = 长期）
  file_url TEXT,                                -- 证书扫描件 URL
  notes TEXT,                                   -- 备注
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_business_qualifications_type ON business_qualifications (qual_type);
CREATE INDEX IF NOT EXISTS idx_business_qualifications_expires ON business_qualifications (expires_at);

-- 注释
COMMENT ON TABLE business_qualifications IS '商务资质库 (F017)';
COMMENT ON COLUMN business_qualifications.qual_type IS '类型: ENTERPRISE | PERSONNEL | PERFORMANCE | PARTNER';
COMMENT ON COLUMN business_qualifications.expires_at IS '到期日期，NULL 表示长期';

-- RLS
ALTER TABLE business_qualifications ENABLE ROW LEVEL SECURITY;
