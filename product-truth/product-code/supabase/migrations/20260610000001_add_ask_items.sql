-- Migration: 20260610000001_add_ask_items.sql
-- PURPOSE: F005 两段式 ASK 清单 - ask_items 主表
-- Refs: product-truth/feature-packets/F005-contract-ASK-upgrade.md

-- ============================================
-- ASK 主表 (ask_items)
-- ============================================
CREATE TABLE IF NOT EXISTS ask_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,

  -- ASK 编码与基本信息
  ask_code TEXT NOT NULL,                          -- ASK-001, ASK-002
  clause_ref TEXT,                                 -- "合同第 3 条"
  risk_name TEXT NOT NULL,                         -- "付款节奏偏离"

  -- 风险等级与分类
  initial_level TEXT NOT NULL CHECK (initial_level IN ('red', 'yellow', 'green')),
  question_type TEXT NOT NULL,                     -- 'commercial' | 'financial' | 'legal' | 'technical' | 'compliance'
  required_roles TEXT[] NOT NULL DEFAULT '{}',     -- ['sales', 'finance']

  -- ASK 内容
  question_text TEXT NOT NULL,                     -- 必问问题
  qualified_std TEXT NOT NULL,                     -- 合格标准

  -- 状态 (3 状态: pending/responded/closed)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'closed')),

  -- 触发与回应
  trigger_user_id UUID NOT NULL REFERENCES auth.users(id),  -- 谁上传谁触发
  response_id UUID REFERENCES ask_responses(id),             -- 1:1 关联回应

  -- 关闭信息
  closed_by UUID REFERENCES auth.users(id),
  closed_reason TEXT,

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ask_items_contract ON ask_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_ask_items_status ON ask_items(status);
CREATE INDEX IF NOT EXISTS idx_ask_items_trigger ON ask_items(trigger_user_id);
CREATE INDEX IF NOT EXISTS idx_ask_items_response ON ask_items(response_id);

-- 唯一约束：一个合同内 ask_code 唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_ask_items_contract_code ON ask_items(contract_id, ask_code);

-- 注释
COMMENT ON TABLE ask_items IS 'ASK 主表 - 条款/风险/必问/状态 (F005)';
COMMENT ON COLUMN ask_items.status IS '状态: pending(待回应) | responded(已回应) | closed(已关闭)';
COMMENT ON COLUMN ask_items.initial_level IS '初始风险等级: red(高) | yellow(中) | green(低)';
COMMENT ON COLUMN ask_items.question_type IS '问题类型: commercial(商务) | financial(财务) | legal(法务) | technical(技术) | compliance(合规)';

-- RLS
ALTER TABLE ask_items ENABLE ROW LEVEL SECURITY;

-- 策略：组织内成员可见
CREATE POLICY ask_items_org_policy ON ask_items
  USING (EXISTS (
    SELECT 1 FROM contracts c
    JOIN organization_members om ON c.org_id = om.org_id
    WHERE c.id = ask_items.contract_id AND om.user_id = auth.uid()
  ));
