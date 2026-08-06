-- Migration: 20260806010000_calendar_subscriptions.sql
-- F018 日程中心（WP11）：iCal 订阅 token（苹果/谷歌日历同步）
CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_user ON calendar_subscriptions (user_id);

ALTER TABLE calendar_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cs_select_own ON calendar_subscriptions FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON TABLE calendar_subscriptions IS 'iCal 订阅 token（F018/WP11）';
