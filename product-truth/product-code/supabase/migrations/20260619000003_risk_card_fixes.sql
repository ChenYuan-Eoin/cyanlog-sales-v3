-- Migration: 20260619000003_risk_card_fixes.sql
-- PURPOSE: 风险卡片一键修复历史表
-- REQ: F005v2 TC-09

CREATE TABLE IF NOT EXISTS contract_risk_card_fixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_card_id UUID NOT NULL REFERENCES contract_risk_cards(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  fixed_by UUID NOT NULL REFERENCES users(id),
  fix_action JSONB DEFAULT '{}',                    -- 修复动作详情
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_card_fixes_card ON contract_risk_card_fixes(risk_card_id);
CREATE INDEX IF NOT EXISTS idx_risk_card_fixes_contract ON contract_risk_card_fixes(contract_id);
