-- Migration: 20260602000007_add_agenda.sql
-- PURPOSE: F018 日程管理 + F019 提醒规则
-- Refs: product-truth/01-business-truth/日程管理.md

CREATE TABLE IF NOT EXISTS agenda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,                          -- 日程标题
  description TEXT,                             -- 详情
  agenda_type TEXT NOT NULL DEFAULT 'TASK',     -- 类型: TASK | MEETING | FOLLOW_UP | REMINDER
  start_at TIMESTAMPTZ NOT NULL,                -- 开始时间
  end_at TIMESTAMPTZ,                           -- 结束时间
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'PENDING',       -- 状态: PENDING | DONE | CANCELLED
  priority TEXT NOT NULL DEFAULT 'NORMAL',      -- 优先级: LOW | NORMAL | HIGH | URGENT
  related_type TEXT,                            -- 关联类型: QUOTE | CONTRACT | OPPORTUNITY
  related_id UUID,                              -- 关联对象 ID
  assignee_id UUID,                             -- 负责人
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS agenda_type TEXT NOT NULL DEFAULT 'TASK';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS assignee_id UUID;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agenda_items'
      AND column_name = 'start_time'
  ) THEN
    EXECUTE '
      UPDATE agenda_items
      SET start_at = COALESCE(start_at, start_time),
          end_at = COALESCE(end_at, end_time),
          assignee_id = COALESCE(assignee_id, user_id),
          created_by = COALESCE(created_by, user_id),
          updated_at = COALESCE(updated_at, created_at)
      WHERE start_at IS NULL
         OR end_at IS NULL
         OR assignee_id IS NULL
         OR created_by IS NULL
         OR updated_at IS NULL
    ';
  END IF;
END
$$;

-- 提醒规则（F019）
CREATE TABLE IF NOT EXISTS reminder_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                            -- 规则名称
  agenda_type TEXT,                              -- 适用类型（NULL = 全部）
  trigger_offset_minutes INTEGER NOT NULL,        -- 提前多少分钟提醒
  channel TEXT NOT NULL DEFAULT 'IN_APP',         -- 渠道: IN_APP | EMAIL
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 提醒日志（实际触发的提醒）
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id UUID NOT NULL,
  rule_id UUID,
  remind_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',         -- PENDING | SENT | FAILED
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS agenda_id UUID;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS rule_id UUID;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';

-- 索引
CREATE INDEX IF NOT EXISTS idx_agenda_items_start ON agenda_items (start_at);
CREATE INDEX IF NOT EXISTS idx_agenda_items_assignee ON agenda_items (assignee_id, start_at);
CREATE INDEX IF NOT EXISTS idx_agenda_items_status ON agenda_items (status, start_at);
CREATE INDEX IF NOT EXISTS idx_agenda_items_related ON agenda_items (related_type, related_id);

CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (status, remind_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_reminders_agenda ON reminders (agenda_id);

-- 注释
COMMENT ON TABLE agenda_items IS '日程项 (F018)';
COMMENT ON TABLE reminder_rules IS '提醒规则 (F019)';
COMMENT ON TABLE reminders IS '提醒日志';

-- RLS
ALTER TABLE agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

INSERT INTO reminder_rules (name, agenda_type, trigger_offset_minutes, channel, is_active)
SELECT '默认提前 30 分钟', NULL, 30, 'IN_APP', TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM reminder_rules
  WHERE name = '默认提前 30 分钟'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agenda_items'
      AND column_name = 'start_at'
  ) THEN
    ALTER TABLE agenda_items
      ALTER COLUMN start_at SET NOT NULL;
  END IF;
END
$$;
