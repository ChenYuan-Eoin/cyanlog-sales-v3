-- Migration: 20260610000005_add_ask_role_assignments.sql
-- PURPOSE: F005 两段式 ASK 清单 - ask_role_assignments 角色分配表
-- Refs: product-truth/feature-packets/F005-contract-ASK-upgrade.md

-- ============================================
-- ASK 角色分配表 (ask_role_assignments) - 多角色分发
-- ============================================
CREATE TABLE IF NOT EXISTS ask_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id UUID NOT NULL REFERENCES ask_items(id) ON DELETE CASCADE,

  -- 角色与指派人
  role TEXT NOT NULL,                              -- 'sales' | 'finance' | 'legal' | 'technical'
  assignee_id UUID REFERENCES auth.users(id),      -- 具体指派人（可选）

  -- 分配时间
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),      -- 谁分配的

  -- 唯一约束：一个ASK的一个角色只能有一条记录
  UNIQUE(ask_id, role)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ask_role_assignments_ask ON ask_role_assignments(ask_id);
CREATE INDEX IF NOT EXISTS idx_ask_role_assignments_role ON ask_role_assignments(role);
CREATE INDEX IF NOT EXISTS idx_ask_role_assignments_assignee ON ask_role_assignments(assignee_id);

-- 注释
COMMENT ON TABLE ask_role_assignments IS 'ASK 角色分配表 - 多角色分发 (F005)';
COMMENT ON COLUMN ask_role_assignments.role IS '角色: sales(销售) | finance(财务) | legal(法务) | technical(技术)';
COMMENT ON COLUMN ask_role_assignments.assignee_id IS '具体指派人，null表示按角色通知所有人';

-- RLS
ALTER TABLE ask_role_assignments ENABLE ROW LEVEL SECURITY;

-- 策略：组织内成员可见
DROP POLICY IF EXISTS ask_role_assignments_org_policy ON ask_role_assignments;
CREATE POLICY ask_role_assignments_org_policy ON ask_role_assignments
  USING (EXISTS (
    SELECT 1 FROM ask_items ai
    JOIN contracts c ON ai.contract_id = c.id
    JOIN users contract_owner ON contract_owner.id = c.created_by
    WHERE ai.id = ask_role_assignments.ask_id
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
