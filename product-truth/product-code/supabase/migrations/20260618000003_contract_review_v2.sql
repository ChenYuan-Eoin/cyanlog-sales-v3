-- Migration: 20260618000003_contract_review_v2.sql
-- PURPOSE: Phase 2 - 风险卡片 + AI 对话 + 比对任务
-- REQ: F005v2

-- ═══════════════════════════════════════════════════════════════
-- 1. 风险卡片表 (contract_risk_cards)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_risk_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  review_id UUID REFERENCES contract_reviews(id) ON DELETE CASCADE,

  -- 风险信息
  level TEXT NOT NULL CHECK (level IN ('red', 'yellow', 'green', 'white')),
  title TEXT NOT NULL,
  description TEXT,
  suggestion TEXT,                                    -- 修复建议
  auto_fixable BOOLEAN DEFAULT false,               -- 是否支持一键修复
  fix_action JSONB,                                 -- 一键修复的自动化动作

  -- 位置信息
  clause_ref TEXT,                                  -- 关联条款编号, e.g. "第2条"
  position_start INTEGER,                          -- 在原文中的起始位置
  position_end INTEGER,                             -- 在原文中的结束位置

  -- 来源
  detected_by TEXT DEFAULT 'ai',                    -- ai / rule / manual
  confidence DECIMAL(3,2),                         -- AI 置信度

  -- 状态
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'accepted', 'ignored')),
  fixed_by UUID REFERENCES users(id),
  fixed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_cards_contract ON contract_risk_cards(contract_id);
CREATE INDEX IF NOT EXISTS idx_risk_cards_review ON contract_risk_cards(review_id);
CREATE INDEX IF NOT EXISTS idx_risk_cards_level ON contract_risk_cards(level);
CREATE INDEX IF NOT EXISTS idx_risk_cards_status ON contract_risk_cards(status);

-- ═══════════════════════════════════════════════════════════════
-- 2. AI 对话记录表 (contract_ai_chats)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_ai_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  -- 对话内容
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,

  -- 引用上下文
  context JSONB,                                    -- {referenced_clauses: [], risk_ids: []}

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chats_contract ON contract_ai_chats(contract_id);
CREATE INDEX IF NOT EXISTS idx_ai_chats_user ON contract_ai_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chats_created ON contract_ai_chats(created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 3. 比对任务表 (contract_comparisons)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),

  -- 比对双方
  baseline_type TEXT NOT NULL CHECK (baseline_type IN ('template', 'previous_version', 'uploaded')),
  baseline_doc_id UUID,                             -- 基准文档 ID
  compare_doc_id UUID,                              -- 对比文档 ID

  -- AI 解读
  ai_summary TEXT,                                  -- AI 变更总结
  ai_recommendation TEXT,                           -- AI 建议

  -- 状态
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comparisons_contract ON contract_comparisons(contract_id);
CREATE INDEX IF NOT EXISTS idx_comparisons_status ON contract_comparisons(status);

-- ═══════════════════════════════════════════════════════════════
-- 4. 比对差异项表 (comparison_diffs)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS comparison_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id UUID NOT NULL REFERENCES contract_comparisons(id) ON DELETE CASCADE,

  -- 差异类型
  diff_type TEXT NOT NULL CHECK (diff_type IN ('deleted', 'added', 'modified', 'moved')),

  -- 位置信息
  baseline_position JSONB,
  compare_position JSONB,

  -- 内容
  baseline_text TEXT,
  compare_text TEXT,

  -- 语义分析
  semantic_change TEXT,                             -- AI 语义解读
  risk_level TEXT CHECK (risk_level IN ('red', 'yellow', 'green')),

  -- 排序
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diffs_comparison ON comparison_diffs(comparison_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. 触发器：自动更新 updated_at
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_contract_risk_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_risk_cards_updated_at ON contract_risk_cards;
CREATE TRIGGER tr_risk_cards_updated_at
  BEFORE UPDATE ON contract_risk_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_risk_cards_updated_at();
