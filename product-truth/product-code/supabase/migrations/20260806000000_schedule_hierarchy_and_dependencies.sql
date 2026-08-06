-- Migration: 20260806000000_schedule_hierarchy_and_dependencies.sql
-- F018 日程中心（WP11）：子任务层级 + 依赖关系（关键路径自动计算的数据基础）
-- 前向兼容：只新增列与表，不改写既有 agenda_items 数据。

-- 1) 子任务层级：parent_id 自引用（删除父任务时子任务提升为根，不孤儿化丢失）
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES agenda_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_items_parent ON agenda_items (parent_id);

-- 2) 依赖边：agenda 依赖 depends_on（用于关键路径计算；禁止自依赖）
CREATE TABLE IF NOT EXISTS agenda_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id UUID NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agenda_id, depends_on_id),
  CHECK (agenda_id <> depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_dependencies_agenda ON agenda_dependencies (agenda_id);
CREATE INDEX IF NOT EXISTS idx_agenda_dependencies_depends ON agenda_dependencies (depends_on_id);

ALTER TABLE agenda_dependencies ENABLE ROW LEVEL SECURITY;

-- 依赖只允许在用户自己的日程之间建立/查看
CREATE POLICY deps_select_own ON agenda_dependencies FOR SELECT
  USING (
    agenda_id IN (SELECT id FROM agenda_items WHERE assignee_id = auth.uid() OR created_by = auth.uid())
    OR depends_on_id IN (SELECT id FROM agenda_items WHERE assignee_id = auth.uid() OR created_by = auth.uid())
  );

CREATE POLICY deps_insert_own ON agenda_dependencies FOR INSERT
  WITH CHECK (
    agenda_id IN (SELECT id FROM agenda_items WHERE assignee_id = auth.uid() OR created_by = auth.uid())
    AND depends_on_id IN (SELECT id FROM agenda_items WHERE assignee_id = auth.uid() OR created_by = auth.uid())
  );

CREATE POLICY deps_delete_own ON agenda_dependencies FOR DELETE
  USING (
    agenda_id IN (SELECT id FROM agenda_items WHERE assignee_id = auth.uid() OR created_by = auth.uid())
  );

COMMENT ON COLUMN agenda_items.parent_id IS '父任务 id（子任务层级，F018/WP11）';
COMMENT ON TABLE agenda_dependencies IS '任务依赖边（关键路径自动计算，F018/WP11）';
