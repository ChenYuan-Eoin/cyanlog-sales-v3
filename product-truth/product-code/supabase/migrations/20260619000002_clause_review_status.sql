-- Migration: 20260619000002_clause_review_status.sql
-- PURPOSE: 条款审核工作台 - 添加法务审核状态字段

ALTER TABLE contract_clauses
ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'passed', 'attention', 'must_fix', 'skipped')),
ADD COLUMN IF NOT EXISTS review_notes TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_contract_clauses_review_status ON contract_clauses(review_status);
CREATE INDEX IF NOT EXISTS idx_contract_clauses_reviewed_by ON contract_clauses(reviewed_by);

-- 默认设置：已有的高风险条款自动标记为 must_fix
UPDATE contract_clauses
SET review_status = CASE
  WHEN risk_level = 'critical' THEN 'must_fix'
  WHEN risk_level = 'high' THEN 'attention'
  WHEN risk_level IN ('low', 'medium') THEN 'passed'
  ELSE 'pending'
END
WHERE review_status = 'pending' AND created_at < NOW() - INTERVAL '1 day';
