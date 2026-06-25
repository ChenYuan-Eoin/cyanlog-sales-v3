-- Migration: 20260610000003_add_ask_audit_logs.sql
-- PURPOSE: F005 两段式 ASK 清单 - ask_audit_logs 审计表
-- Refs: product-truth/feature-packets/F005-contract-ASK-upgrade.md

-- ============================================
-- ASK 审计日志表 (ask_audit_logs) - 关键事件审计
-- ============================================
CREATE TABLE IF NOT EXISTS ask_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id UUID REFERENCES ask_items(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,

  -- 操作人
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  actor_role TEXT NOT NULL,

  -- 事件类型
  event_type TEXT NOT NULL,
  -- 'created' | 'responded' | 'closed' | 'reopened' | 'report_generated' | 'no_ask_marked'

  -- 状态流转
  from_status TEXT,
  to_status TEXT,

  -- 额外信息
  payload JSONB DEFAULT '{}'::jsonb,

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_audit_ask ON ask_audit_logs(ask_id);
CREATE INDEX IF NOT EXISTS idx_audit_contract ON ask_audit_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON ask_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event ON ask_audit_logs(event_type);

-- 注释
COMMENT ON TABLE ask_audit_logs IS 'ASK 审计日志表 - who/when/what (F005)';
COMMENT ON COLUMN ask_audit_logs.event_type IS '事件类型: created | responded | closed | reopened | report_generated | no_ask_marked';
COMMENT ON COLUMN ask_audit_logs.payload IS '额外信息，如关闭原因、报告版本等';

-- RLS
ALTER TABLE ask_audit_logs ENABLE ROW LEVEL SECURITY;

-- 策略：组织内成员可见
DROP POLICY IF EXISTS ask_audit_logs_org_policy ON ask_audit_logs;
CREATE POLICY ask_audit_logs_org_policy ON ask_audit_logs
  USING (EXISTS (
    SELECT 1 FROM contracts c
    JOIN users contract_owner ON contract_owner.id = c.created_by
    WHERE c.id = ask_audit_logs.contract_id
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
