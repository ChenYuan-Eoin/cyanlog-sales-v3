-- Migration: 20260602000004_add_case_library.sql
-- PURPOSE: F015 案例库管理 (成功/失败案例)
-- Refs: product-truth/01-business-truth/知识库管理.md#3

CREATE TABLE IF NOT EXISTS case_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                          -- 案例名称
  customer_name TEXT NOT NULL,                  -- 客户名称
  industry TEXT NOT NULL,                       -- 行业 (金融/政府/医疗/教育/企业)
  product TEXT NOT NULL,                        -- 产品 (安全/云/大数据/AI)
  amount NUMERIC(15, 2),                       -- 项目金额
  duration_months INTEGER,                     -- 项目周期（月）
  difficulty TEXT NOT NULL DEFAULT 'MEDIUM',    -- 难度 (EASY/MEDIUM/HARD)
  outcome TEXT NOT NULL,                        -- 结果 (SUCCESS/FAILURE)
  background TEXT,                              -- 背景
  challenge TEXT,                               -- 挑战
  solution TEXT,                                -- 解决方案
  success_factors TEXT,                         -- 关键成功因素
  lessons_learned TEXT,                         -- 经验教训
  tags TEXT[] DEFAULT '{}',                     -- 标签
  is_published BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否发布
  view_count INTEGER NOT NULL DEFAULT 0,        -- 查看次数
  created_by UUID,                              -- 创建人
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按结果/行业/产品过滤
CREATE INDEX IF NOT EXISTS idx_case_library_outcome ON case_library (outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_library_industry ON case_library (industry, outcome);
CREATE INDEX IF NOT EXISTS idx_case_library_product ON case_library (product, outcome);
CREATE INDEX IF NOT EXISTS idx_case_library_difficulty ON case_library (difficulty);

-- 索引：标签数组 GIN 索引
CREATE INDEX IF NOT EXISTS idx_case_library_tags ON case_library USING GIN (tags);

-- 索引：按时间倒序（默认列表）
CREATE INDEX IF NOT EXISTS idx_case_library_created_at ON case_library (created_at DESC);

-- 注释
COMMENT ON TABLE case_library IS '案例库 - 成功/失败案例管理 (F015)';
COMMENT ON COLUMN case_library.outcome IS '结果: SUCCESS | FAILURE';
COMMENT ON COLUMN case_library.difficulty IS '难度: EASY | MEDIUM | HARD';

-- RLS: 不对外暴露，仅 service_role 可访问
ALTER TABLE case_library ENABLE ROW LEVEL SECURITY;
