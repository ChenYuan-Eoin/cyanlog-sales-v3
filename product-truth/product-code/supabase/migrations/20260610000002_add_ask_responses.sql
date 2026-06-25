-- Migration: 20260610000002_add_ask_responses.sql
-- PURPOSE: F005 两段式 ASK 清单 - ask_responses 回应表
-- Refs: product-truth/feature-packets/F005-contract-ASK-upgrade.md

-- ============================================
-- ASK 回应表 (ask_responses) - 1:1 一次回答
-- ============================================
CREATE TABLE IF NOT EXISTS ask_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id UUID NOT NULL UNIQUE REFERENCES ask_items(id) ON DELETE CASCADE,  -- 1:1 强制

  -- 回应人信息（冗余入报）
  responder_id UUID NOT NULL REFERENCES auth.users(id),
  responder_role TEXT NOT NULL,                    -- 冗余，入报显示
  responder_name TEXT NOT NULL,                    -- 冗余，入报显示

  -- 回应内容
  response_text TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,           -- [{name, url, type}]

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ask_responses_ask ON ask_responses(ask_id);
CREATE INDEX IF NOT EXISTS idx_ask_responses_responder ON ask_responses(responder_id);

-- 注释
COMMENT ON TABLE ask_responses IS 'ASK 回应表 - 1:1 一次回答 (F005)';
COMMENT ON COLUMN ask_responses.responder_role IS '回应人角色（冗余，用于报告中显示）';
COMMENT ON COLUMN ask_responses.responder_name IS '回应人姓名（冗余，用于报告中显示）';

-- RLS
ALTER TABLE ask_responses ENABLE ROW LEVEL SECURITY;

-- 策略：组织内成员可见
DROP POLICY IF EXISTS ask_responses_org_policy ON ask_responses;
CREATE POLICY ask_responses_org_policy ON ask_responses
  USING (EXISTS (
    SELECT 1 FROM ask_items ai
    JOIN contracts c ON ai.contract_id = c.id
    JOIN users contract_owner ON contract_owner.id = c.created_by
    WHERE ai.id = ask_responses.ask_id
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
