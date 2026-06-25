-- Migration: 20260610000004_add_report_versions.sql
-- PURPOSE: F005 两段式 ASK 清单 - report_versions 报告版本表
-- Refs: product-truth/feature-packets/F005-contract-ASK-upgrade.md

-- ============================================
-- 报告版本表 (report_versions) - rolling 报告
-- ============================================
CREATE TABLE IF NOT EXISTS report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,

  -- 版本信息
  version INTEGER NOT NULL,                        -- 1, 2, 3, ...

  -- 触发事件
  trigger_event TEXT NOT NULL,
  -- 'initial_generate' | 'ask_responded' | 'ask_reopened' | 'ask_closed' | 'standard_marked'

  -- 触发来源
  trigger_ask_id UUID REFERENCES ask_items(id),    -- 哪个 ASK 触发了这次升版
  trigger_user_id UUID REFERENCES auth.users(id),  -- 谁触发的

  -- 0 风险说明（v2 新增）
  no_ask_reason TEXT,                              -- 'standard_contract' | 'low_complexity' | 'no_trigger_conditions' | 'manual_override'
  no_ask_explanation TEXT,                         -- 详细说明

  -- 报告内容
  report_data JSONB NOT NULL,                      -- 完整报告快照(含 ASK + 回应)
  report_file_url TEXT,                            -- Word 批注文件 URL

  -- 是否最新版本
  is_current BOOLEAN NOT NULL DEFAULT false,

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_report_versions_contract ON report_versions(contract_id);
CREATE INDEX IF NOT EXISTS idx_report_versions_current ON report_versions(contract_id, is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_report_versions_ask ON report_versions(trigger_ask_id);

-- 唯一约束：一个合同内 version 唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_versions_contract_version ON report_versions(contract_id, version);

-- 唯一约束：一个合同只有一个 is_current=true
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_versions_unique_current ON report_versions(contract_id) WHERE is_current = true;

-- 注释
COMMENT ON TABLE report_versions IS '报告版本表 - rolling 报告 (F005)';
COMMENT ON COLUMN report_versions.trigger_event IS '触发事件: initial_generate | ask_responded | ask_reopened | ask_closed | standard_marked';
COMMENT ON COLUMN report_versions.no_ask_reason IS '0 风险原因: standard_contract(标准合同) | low_complexity(低复杂度) | no_trigger_conditions(未触发) | manual_override(手动标记)';
COMMENT ON COLUMN report_versions.is_current IS '是否最新版本，true 表示当前有效版本';

-- RLS
ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;

-- 策略：组织内成员可见
DROP POLICY IF EXISTS report_versions_org_policy ON report_versions;
CREATE POLICY report_versions_org_policy ON report_versions
  USING (EXISTS (
    SELECT 1 FROM contracts c
    JOIN users contract_owner ON contract_owner.id = c.created_by
    WHERE c.id = report_versions.contract_id
      AND (
        c.created_by = auth.uid()
        OR
        EXISTS (
          SELECT 1
          FROM user_organizations uo
          WHERE uo.org_id = contract_owner.org_id
            AND uo.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM users u
          WHERE u.id = auth.uid()
            AND u.org_id = contract_owner.org_id
        )
      )
  ));

-- ============================================
-- 触发器：自动更新 is_current
-- ============================================
CREATE OR REPLACE FUNCTION update_report_version_current()
RETURNS TRIGGER AS $$
BEGIN
  -- 如果新插入的行 is_current=true，将同一合同的其他行设为 false
  IF NEW.is_current = true THEN
    UPDATE report_versions
    SET is_current = false
    WHERE contract_id = NEW.contract_id
      AND id != NEW.id
      AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_report_current ON report_versions;
CREATE TRIGGER trigger_update_report_current
  AFTER INSERT ON report_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_report_version_current();
