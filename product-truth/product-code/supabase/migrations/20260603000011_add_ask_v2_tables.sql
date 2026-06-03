-- Migration: 20260603000011_add_ask_v2_tables.sql
-- PURPOSE: F005 ASK v2 升级 - 新增 ask_items, ask_responses, ask_audit_logs, ask_role_assignments, report_versions
-- REQ: F005
-- Feature Packet: F005-contract-ASK-upgrade.md (v2)
--
-- 交叉验证：
-- - 本文件与 feature-packets/F005-contract-ASK-upgrade.md 第 3 节数据模型逐行对齐
-- - 与 合同审核.md 第 8 章 v2 状态机对齐
-- - no_ask_reason 仅存在于 report_versions 表（0 风险是报告级，不是 ASK 级）

-- =====================================================
-- 1. ask_items 表（ASK 主表，3 状态：pending/responded/closed）
-- =====================================================
CREATE TABLE IF NOT EXISTS ask_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  ask_code        TEXT NOT NULL,                -- ASK-001, ASK-002
  clause_ref      TEXT,                          -- "合同第 3 条"
  risk_name       TEXT NOT NULL,                 -- "付款节奏偏离"
  initial_level   TEXT NOT NULL CHECK (initial_level IN ('red','yellow','green')),
  question_type   TEXT NOT NULL CHECK (question_type IN ('commercial','financial','legal','technical','compliance')),
  required_roles  TEXT[] NOT NULL,               -- ['sales','finance']
  question_text   TEXT NOT NULL,
  qualified_std   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','responded','closed')),
  trigger_user_id UUID NOT NULL REFERENCES users(id),
  response_id     UUID,                          -- 1:1 一次回答
  closed_by       UUID REFERENCES users(id),
  closed_reason   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_id, ask_code)
);

-- =====================================================
-- 2. ask_responses 表（业务回应，1:1 一次回答）
-- =====================================================
CREATE TABLE IF NOT EXISTS ask_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id          UUID NOT NULL UNIQUE REFERENCES ask_items(id) ON DELETE CASCADE,  -- 1:1
  responder_id    UUID NOT NULL REFERENCES users(id),
  responder_role  TEXT NOT NULL,                 -- 冗余
  responder_name  TEXT NOT NULL,                 -- 冗余，入报显示
  response_text   TEXT NOT NULL,
  attachments     JSONB,                         -- nullable，无 default
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- 3. ask_audit_logs 表（关键事件审计）
-- =====================================================
CREATE TABLE IF NOT EXISTS ask_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id          UUID REFERENCES ask_items(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL,                 -- 冗余
  actor_id        UUID NOT NULL REFERENCES users(id),
  actor_role      TEXT NOT NULL,
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('created','responded','closed','reopened','report_generated','no_ask_marked')),
  from_status     TEXT,
  to_status       TEXT,
  payload         JSONB,                         -- nullable，无 default
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- 4. ask_role_assignments 表（多角色分发）
-- =====================================================
CREATE TABLE IF NOT EXISTS ask_role_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id          UUID NOT NULL REFERENCES ask_items(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  assignee_id     UUID REFERENCES users(id),
  UNIQUE(ask_id, role, assignee_id)
);

-- =====================================================
-- 5. report_versions 表（rolling 报告版本）
-- =====================================================
CREATE TABLE IF NOT EXISTS report_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,              -- 1, 2, 3, ...
  trigger_event   TEXT NOT NULL
                    CHECK (trigger_event IN ('initial_generate','ask_responded','ask_reopened','ask_closed','standard_marked')),
  trigger_ask_id  UUID REFERENCES ask_items(id),  -- 哪个 ASK 触发了这次升版
  trigger_user_id UUID REFERENCES users(id),
  no_ask_reason   TEXT,                          -- 0 风险时填（报告级）
  report_data     JSONB NOT NULL,                -- 完整报告快照（无 default）
  report_file_url TEXT,                          -- Word 批注文件 URL
  is_current      BOOLEAN NOT NULL DEFAULT false,-- 是否最新版本
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_id, version)
);

-- =====================================================
-- 6. 索引（与 feature-packet 对齐）
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ask_items_contract ON ask_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_ask_items_status ON ask_items(status);
CREATE INDEX IF NOT EXISTS idx_ask_items_trigger ON ask_items(trigger_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_ask ON ask_audit_logs(ask_id);
CREATE INDEX IF NOT EXISTS idx_audit_contract ON ask_audit_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON ask_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_versions_contract ON report_versions(contract_id);
CREATE INDEX IF NOT EXISTS idx_report_versions_current ON report_versions(contract_id, is_current) WHERE is_current = true;

-- =====================================================
-- 7. 外键约束：ask_items.response_id -> ask_responses.id
--    （解决循环依赖：ask_responses.ask_id -> ask_items.id）
-- =====================================================
ALTER TABLE ask_items
  ADD CONSTRAINT fk_ask_items_response
  FOREIGN KEY (response_id) REFERENCES ask_responses(id) ON DELETE SET NULL;

-- =====================================================
-- 8. 触发器：ask_items 自动更新 updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ask_items_updated_at
  BEFORE UPDATE ON ask_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 9. RLS 策略
-- =====================================================
ALTER TABLE ask_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ask_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ask_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ask_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;

-- ask_items: 所有者读取（基于合同的 created_by）
CREATE POLICY "Owner reads ask_items" ON ask_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = ask_items.contract_id
      AND contracts.created_by = auth.uid()
    )
  );

-- ask_items: 所有认证用户可创建/更新（ASK 生成 + 回应录入 + 关闭）
CREATE POLICY "Authenticated create ask_items" ON ask_items
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update ask_items" ON ask_items
  FOR UPDATE TO authenticated USING (true);

-- ask_responses: 所有者读取
CREATE POLICY "Owner reads ask_responses" ON ask_responses
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM ask_items ai
      JOIN contracts c ON c.id = ai.contract_id
      WHERE ai.id = ask_responses.ask_id
      AND c.created_by = auth.uid()
    )
  );

-- ask_responses: 所有认证用户可创建
CREATE POLICY "Authenticated create ask_responses" ON ask_responses
  FOR INSERT TO authenticated WITH CHECK (true);

-- ask_audit_logs: 所有者读取
CREATE POLICY "Owner reads ask_audit_logs" ON ask_audit_logs
  FOR SELECT TO authenticated USING (
    contract_id IN (SELECT id FROM contracts WHERE created_by = auth.uid())
    OR actor_id = auth.uid()
  );

-- ask_audit_logs: 所有认证用户可创建
CREATE POLICY "Authenticated create ask_audit_logs" ON ask_audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- ask_role_assignments: 所有者读取
CREATE POLICY "Owner reads ask_role_assignments" ON ask_role_assignments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM ask_items ai
      JOIN contracts c ON c.id = ai.contract_id
      WHERE ai.id = ask_role_assignments.ask_id
      AND c.created_by = auth.uid()
    )
  );

-- ask_role_assignments: 所有认证用户可创建
CREATE POLICY "Authenticated create ask_role_assignments" ON ask_role_assignments
  FOR INSERT TO authenticated WITH CHECK (true);

-- report_versions: 所有者读取
CREATE POLICY "Owner reads report_versions" ON report_versions
  FOR SELECT TO authenticated USING (
    contract_id IN (SELECT id FROM contracts WHERE created_by = auth.uid())
  );

-- report_versions: 所有认证用户可创建
CREATE POLICY "Authenticated create report_versions" ON report_versions
  FOR INSERT TO authenticated WITH CHECK (true);
