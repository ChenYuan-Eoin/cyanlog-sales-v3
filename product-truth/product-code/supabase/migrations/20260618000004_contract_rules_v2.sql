-- Migration: 20260618000004_contract_rules_v2.sql
-- PURPOSE: 阻塞项3 — 属性化规则存储（Tier 1 可索引性）
-- 评审要求："规则不应存为大字段，而是存为属性化的列"

-- ═══════════════════════════════════════════════════════════════
-- 1. 属性化规则表 (contract_rules_v2)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_rules_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_set_id UUID,                                   -- 关联规则集

  -- 基本属性
  code TEXT NOT NULL,                                 -- e.g. "RULE-01-01"
  name TEXT NOT NULL,                                 -- 显示名称
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('ratio', 'amount', 'duration', 'enum', 'text')),

  -- 适用条件
  applicable_scenarios TEXT[] DEFAULT '{}',
  scope TEXT DEFAULT 'org' CHECK (scope IN ('org', 'dept', 'user')),

  -- Level A (🟢 通过)
  level_a_operator TEXT NOT NULL CHECK (level_a_operator IN ('>=', '<=', '=', '>', '<', 'contains', 'in')),
  level_a_threshold DECIMAL(20, 6),                   -- 阈值（统一使用 DECIMAL）
  level_a_unit TEXT DEFAULT 'percent',                -- 单位：percent/amount/day/month
  level_a_action TEXT DEFAULT 'auto_approve',         -- 动作

  -- Level B (🟡 偏离)
  level_b_operator TEXT NOT NULL CHECK (level_b_operator IN ('>=', '<=', '=', '>', '<', 'contains', 'in')),
  level_b_threshold DECIMAL(20, 6),
  level_b_unit TEXT DEFAULT 'percent',
  level_b_action TEXT DEFAULT 'suggest_counterparty',
  level_b_counterparty TEXT,                          -- 建议换取的对价

  -- Level C (🔴 红线)
  level_c_operator TEXT NOT NULL CHECK (level_c_operator IN ('>=', '<=', '=', '>', '<', 'contains', 'in')),
  level_c_threshold DECIMAL(20, 6),
  level_c_unit TEXT DEFAULT 'percent',
  level_c_action TEXT DEFAULT 'block',
  level_c_message TEXT,                               -- 红线提示文案

  -- 审批路由绑定
  approval_roles TEXT[] DEFAULT '{}',                   -- ['finance', 'legal', 'delivery']

  -- 话术库引用
  script_id UUID,                                     -- 关联话术库

  -- 版本与状态
  version INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 唯一约束
  UNIQUE(org_id, code)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_rules_v2_org ON contract_rules_v2(org_id);
CREATE INDEX IF NOT EXISTS idx_rules_v2_active ON contract_rules_v2(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rules_v2_category ON contract_rules_v2(category);
CREATE INDEX IF NOT EXISTS idx_rules_v2_priority ON contract_rules_v2(priority DESC);

-- ═══════════════════════════════════════════════════════════════
-- 2. 规则版本快照表 (contract_rule_snapshots)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_rule_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES contract_rules_v2(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,

  -- 完整的规则配置快照（JSONB 用于归档，非查询）
  config_snapshot JSONB NOT NULL,

  -- 审计信息
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ,
  release_note TEXT,

  -- 灰度信息
  is_gray_release BOOLEAN DEFAULT false,
  gray_end_at TIMESTAMPTZ,

  -- 状态
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'rolled_back')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_snapshots_rule ON contract_rule_snapshots(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_snapshots_version ON contract_rule_snapshots(version);
CREATE INDEX IF NOT EXISTS idx_rule_snapshots_status ON contract_rule_snapshots(status);

-- ═══════════════════════════════════════════════════════════════
-- 3. 触发器：自动更新 updated_at
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_contract_rules_v2_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_rules_v2_updated_at ON contract_rules_v2;
CREATE TRIGGER tr_rules_v2_updated_at
  BEFORE UPDATE ON contract_rules_v2
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_rules_v2_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 4. 从旧表迁移数据（如果旧表存在且有数据）
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- 检查旧表是否存在
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rules') THEN
    -- 迁移已有的结构化规则
    INSERT INTO contract_rules_v2 (
      org_id, code, name, description, category,
      level_a_operator, level_a_threshold, level_a_unit, level_a_action,
      level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
      level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
      priority, is_active, created_at
    )
    SELECT
      r.org_id,
      r.code,
      r.name,
      r.description,
      COALESCE(r.category, 'text'),
      '>=', 0, 'percent', 'auto_approve',          -- Level A 默认值
      '<', 0, 'percent', 'suggest_counterparty',   -- Level B 默认值
      r.level_c_threshold || '%',                     -- Level B 对价
      '<', COALESCE(r.threshold_red_line, 0), 'percent', 'block',   -- Level C
      CASE WHEN r.risk_level = 'red' THEN '金额低于红线标准'
           WHEN r.risk_level = 'yellow' THEN '金额偏离建议区间'
           ELSE '金额在合规范围内' END,            -- Level C 消息
      COALESCE(r.sort_order, 100),
      COALESCE(r.is_active, true),
      COALESCE(r.created_at, NOW())
    FROM rules r
    WHERE NOT EXISTS (
      SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = r.code
    )
    ON CONFLICT (org_id, code) DO NOTHING;

    RAISE NOTICE 'Rules migration completed from rules table to contract_rules_v2';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 5. Seed: 默认规则（付款节奏 — 首期款比例）
-- ═══════════════════════════════════════════════════════════════
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id,
  'RULE-01-01',
  '首期款比例',
  '合同首付款占合同总额的比例',
  'ratio',
  '>=', 300000, 'percent', 'auto_approve',       -- Level A: >= 30%
  '<', 300000, 'percent', 'suggest_counterparty', '延长质保期 6 个月',  -- Level B: < 30%
  '<', 250000, 'percent', 'block', '首期款比例低于 25%，必须修改合同',  -- Level C: < 25%
  100,
  true,
  NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'RULE-01-01'
);

-- Seed: 账期上限
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id,
  'RULE-01-02',
  '账期上限',
  '付款账期不得超过 90 个工作日',
  'duration',
  '<=', 90000, 'day', 'auto_approve',       -- Level A: <= 90 天
  '>', 90000, 'day', 'suggest_counterparty', '提供银行保函',  -- Level B: > 90 天
  '>', 180000, 'day', 'block', '账期超过 180 天，必须修改合同',  -- Level C: > 180 天
  90,
  true,
  NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'RULE-01-02'
);

-- Seed: 违约金比例
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id,
  'RULE-01-03',
  '违约金比例',
  '违约金不得超过合同总额的 10%',
  'ratio',
  '<=', 100000, 'percent', 'auto_approve',       -- Level A: <= 10%
  '>', 100000, 'percent', 'suggest_counterparty', '提高违约赔偿倍数',  -- Level B: > 10%
  '>', 200000, 'percent', 'block', '违约金超过 20%，必须修改合同',  -- Level C: > 20%
  80,
  true,
  NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'RULE-01-03'
);

-- ═══════════════════════════════════════════════════════════════
-- 6. Seed: 扩展规则（R002-R015，共12条）
-- ═══════════════════════════════════════════════════════════════

-- R002: 付款周期
echo "Inserting R002...";
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R002', '付款周期', '付款账期应在30-90天，超过180天为红线', 'duration',
  '<=', 90, 'day', 'auto_approve',
  '>', 90, 'day', 'suggest_counterparty', '提供银行保函',
  '>', 180, 'day', 'block', '账期超过180天，必须修改合同',
  90, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R002');

-- R003: 质保金比例
INSERT INTO contract_rules_v2 (org_id, code, name, description, category, level_a_operator, level_a_threshold, level_a_unit, level_a_action, level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty, level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message, priority, is_active, created_at)
SELECT o.id, 'R003', '质保金比例', '质保金比例应在5%-10%，超过20%为红线', 'ratio',
  '<=', 10, 'percent', 'auto_approve', '>', 10, 'percent', 'suggest_counterparty', '提高违约赔偿倍数', '>', 20, 'percent', 'block', '质保金比例超过20%，必须修改合同',
  80, true, NOW() FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R003');

-- R004: 质保期
INSERT INTO contract_rules_v2 (org_id, code, name, description, category, level_a_operator, level_a_threshold, level_a_unit, level_a_action, level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty, level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message, priority, is_active, created_at)
SELECT o.id, 'R004', '质保期', '质保期应在1-3年，超过5年为红线', 'duration',
  '<=', 1095, 'day', 'auto_approve', '>', 1095, 'day', 'suggest_counterparty', '增加首年免费维护', '>', 1825, 'day', 'block', '质保期超过5年，必须修改合同',
  70, true, NOW() FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R004');

-- R005: 违约金上限
INSERT INTO contract_rules_v2 (org_id, code, name, description, category, level_a_operator, level_a_threshold, level_a_unit, level_a_action, level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty, level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message, priority, is_active, created_at)
SELECT o.id, 'R005', '违约金上限', '违约金上限应在合同额10%-20%，超过30%为红线', 'ratio',
  '<=', 20, 'percent', 'auto_approve', '>', 20, 'percent', 'suggest_counterparty', '降低违约金比例', '>', 30, 'percent', 'block', '违约金超过30%，必须修改合同',
  85, true, NOW() FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R005');

-- R006: 滞纳金比例
INSERT INTO contract_rules_v2 (org_id, code, name, description, category, level_a_operator, level_a_threshold, level_a_unit, level_a_action, level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty, level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message, priority, is_active, created_at)
SELECT o.id, 'R006', '滞纳金比例', '滞纳金应控制在日万分之五以内，超过千分之一为红线', 'ratio',
  '<=', 0.05, 'percent', 'auto_approve', '>', 0.05, 'percent', 'suggest_counterparty', '降低滞纳金比例', '>', 0.1, 'percent', 'block', '滞纳金比例过高，必须修改合同',
  75, true, NOW() FROM organizations o WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R006');
