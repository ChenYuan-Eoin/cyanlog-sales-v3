-- F006: 合同规则引擎 - 增强规则表结构
-- Created: 2026-06-14

-- 1. 增强 contract_rules 表
ALTER TABLE IF EXISTS contract_rules
  -- 规则分类
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'legal',
  ADD COLUMN IF NOT EXISTS rule_code TEXT,

  -- 结构化规则条件
  ADD COLUMN IF NOT EXISTS condition_config JSONB DEFAULT '{}',

  -- 语义规则条件
  ADD COLUMN IF NOT EXISTS semantic_condition TEXT,

  -- 输出消息
  ADD COLUMN IF NOT EXISTS message_config JSONB DEFAULT '{}',

  -- 生效范围
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'org',
  ADD COLUMN IF NOT EXISTS contract_types TEXT[] DEFAULT '{}',

  -- 优先级与组合
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS group_operator TEXT,

  -- 版本管理
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID,

  -- 统计字段（实时更新）
  ADD COLUMN IF NOT EXISTS trigger_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_evaluations INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hit_rate NUMERIC(5,2) DEFAULT 0;

-- 添加唯一约束：组织内规则编码唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_rules_org_code
  ON contract_rules(org_id, rule_code)
  WHERE rule_code IS NOT NULL;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_contract_rules_type ON contract_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_contract_rules_category ON contract_rules(category);
CREATE INDEX IF NOT EXISTS idx_contract_rules_status ON contract_rules(status);
CREATE INDEX IF NOT EXISTS idx_contract_rules_scope ON contract_rules(scope);
CREATE INDEX IF NOT EXISTS idx_contract_rules_group ON contract_rules(group_id);
CREATE INDEX IF NOT EXISTS idx_contract_rules_priority ON contract_rules(priority DESC);

-- 2. 创建规则版本表
CREATE TABLE IF NOT EXISTS contract_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES contract_rules(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),

  version INTEGER NOT NULL,
  content JSONB NOT NULL,

  -- 变更信息
  change_type TEXT NOT NULL DEFAULT 'update', -- 'create' | 'update' | 'rollback' | 'archive'
  change_summary TEXT,
  rollback_from_version INTEGER,

  -- 生效信息
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  published_at TIMESTAMPTZ,
  published_by UUID,

  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(rule_id, version)
);

CREATE INDEX IF NOT EXISTS idx_rule_versions_rule ON contract_rule_versions(rule_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_rule_versions_published ON contract_rule_versions(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_rule_versions_org ON contract_rule_versions(org_id);

-- 3. 创建规则测试用例表
CREATE TABLE IF NOT EXISTS contract_rule_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES contract_rules(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),

  name TEXT NOT NULL,
  description TEXT,

  -- 测试输入
  test_input TEXT NOT NULL,
  input_type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'contract_file' | 'ocr_result'

  -- 预期输出
  expected_result JSONB NOT NULL,

  -- 实际输出（执行后填充）
  actual_result JSONB,
  passed BOOLEAN,

  -- 元数据
  category TEXT DEFAULT 'positive', -- 'positive' | 'negative' | 'edge_case'
  tags TEXT[] DEFAULT '{}',

  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rule_test_cases_rule ON contract_rule_test_cases(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_test_cases_org ON contract_rule_test_cases(org_id);
CREATE INDEX IF NOT EXISTS idx_rule_test_cases_category ON contract_rule_test_cases(category);

-- 4. 创建规则执行日志表
CREATE TABLE IF NOT EXISTS contract_rule_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES contract_rules(id),
  org_id UUID REFERENCES organizations(id),

  -- 执行规则版本
  rule_version INTEGER NOT NULL DEFAULT 1,

  triggered BOOLEAN NOT NULL,
  extracted_value TEXT,
  execution_time INTEGER, -- 毫秒

  -- 执行结果详情
  result_details JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_exec_rule ON contract_rule_execution_logs(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_exec_contract ON contract_rule_execution_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_rule_exec_org ON contract_rule_execution_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_rule_exec_triggered ON contract_rule_execution_logs(triggered) WHERE triggered = true;

-- 5. 创建规则统计汇总表（每日更新）
CREATE TABLE IF NOT EXISTS contract_rule_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES contract_rules(id),
  org_id UUID REFERENCES organizations(id),

  stat_date DATE NOT NULL,

  -- 触发统计
  total_evaluations INTEGER NOT NULL DEFAULT 0,
  triggered_count INTEGER NOT NULL DEFAULT 0,
  hit_rate NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- 执行性能
  avg_execution_time INTEGER,
  max_execution_time INTEGER,

  -- 风险分布
  red_count INTEGER DEFAULT 0,
  yellow_count INTEGER DEFAULT 0,
  green_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(rule_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_rule_stats_rule ON contract_rule_stats(rule_id, stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_rule_stats_org ON contract_rule_stats(org_id);
CREATE INDEX IF NOT EXISTS idx_rule_stats_date ON contract_rule_stats(stat_date DESC);

-- 6. 创建规则统计每日聚合函数
CREATE OR REPLACE FUNCTION aggregate_rule_stats(p_date DATE)
RETURNS void AS $$
BEGIN
  INSERT INTO contract_rule_stats (
    rule_id, org_id, stat_date, total_evaluations, triggered_count, hit_rate,
    avg_execution_time, max_execution_time, red_count, yellow_count, green_count
  )
  SELECT
    rel.rule_id,
    rel.org_id,
    p_date,
    COUNT(*) as total_evaluations,
    COUNT(*) FILTER (WHERE rel.triggered = true) as triggered_count,
    ROUND(COUNT(*) FILTER (WHERE rel.triggered = true) * 100.0 / COUNT(*), 2) as hit_rate,
    ROUND(AVG(rel.execution_time))::integer as avg_execution_time,
    MAX(rel.execution_time) as max_execution_time,
    COUNT(*) FILTER (WHERE rel.triggered = true AND cr.level = 'red') as red_count,
    COUNT(*) FILTER (WHERE rel.triggered = true AND cr.level = 'yellow') as yellow_count,
    COUNT(*) FILTER (WHERE rel.triggered = true AND cr.level = 'green') as green_count
  FROM contract_rule_execution_logs rel
  LEFT JOIN contract_rules cr ON rel.rule_id = cr.id
  WHERE DATE(rel.created_at) = p_date
  GROUP BY rel.rule_id, rel.org_id
  ON CONFLICT (rule_id, stat_date) DO UPDATE SET
    total_evaluations = EXCLUDED.total_evaluations,
    triggered_count = EXCLUDED.triggered_count,
    hit_rate = EXCLUDED.hit_rate,
    avg_execution_time = EXCLUDED.avg_execution_time,
    max_execution_time = EXCLUDED.max_execution_time,
    red_count = EXCLUDED.red_count,
    yellow_count = EXCLUDED.yellow_count,
    green_count = EXCLUDED.green_count;
END;
$$ LANGUAGE plpgsql;

-- 7. 创建规则执行结果更新触发器（实时更新主表统计）
CREATE OR REPLACE FUNCTION update_rule_stats_on_execution()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE contract_rules
  SET
    total_evaluations = total_evaluations + 1,
    trigger_count = trigger_count + CASE WHEN NEW.triggered THEN 1 ELSE 0 END,
    hit_rate = ROUND((trigger_count + CASE WHEN NEW.triggered THEN 1 ELSE 0 END) * 100.0 / (total_evaluations + 1), 2)
  WHERE id = NEW.rule_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_rule_stats ON contract_rule_execution_logs;
CREATE TRIGGER trg_update_rule_stats
  AFTER INSERT ON contract_rule_execution_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_rule_stats_on_execution();

-- 8. 创建规则版本创建触发器
CREATE OR REPLACE FUNCTION create_rule_version_on_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS NULL OR OLD.status != 'published') THEN
    INSERT INTO contract_rule_versions (
      rule_id, org_id, version, content, change_type, status, published_at, published_by, created_by
    ) VALUES (
      NEW.id,
      NEW.org_id,
      NEW.version,
      jsonb_build_object(
        'name', NEW.name,
        'rule_type', NEW.rule_type,
        'category', NEW.category,
        'condition_config', NEW.condition_config,
        'semantic_condition', NEW.semantic_condition,
        'message_config', NEW.message_config,
        'scope', NEW.scope,
        'contract_types', NEW.contract_types,
        'priority', NEW.priority,
        'group_id', NEW.group_id,
        'group_operator', NEW.group_operator,
        'level', NEW.level
      ),
      'update',
      'published',
      NOW(),
      NEW.published_by,
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_version_on_publish ON contract_rules;
CREATE TRIGGER trg_create_version_on_publish
  AFTER UPDATE ON contract_rules
  FOR EACH ROW
  WHEN (NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published')
  EXECUTE FUNCTION create_rule_version_on_publish();
