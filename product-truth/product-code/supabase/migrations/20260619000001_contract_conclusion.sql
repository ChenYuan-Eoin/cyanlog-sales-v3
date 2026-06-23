-- Migration: 20260619000001_contract_conclusion.sql
-- PURPOSE: 合同审核结论字段（通过/驳回/转交）

ALTER TABLE contracts
ADD COLUMN IF NOT EXISTS conclusion TEXT CHECK (conclusion IN ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED')),
ADD COLUMN IF NOT EXISTS conclusion_reason TEXT,
ADD COLUMN IF NOT EXISTS concluded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS concluded_by UUID REFERENCES users(id);

-- 现有数据默认为 PENDING
UPDATE contracts
SET conclusion = 'PENDING'
WHERE conclusion IS NULL;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_contracts_conclusion ON contracts(conclusion);
