-- Migration: 20260618000001_seed_contract_rules_v2.sql
-- PURPOSE: 导入15条核心合同审核规则（柔性化3级阈值）
-- REQ: F005 / F006
-- Note: ONES 15 条款 + 用户决策 → 实际导入15条，UI隐藏3条作为备选

-- ═══════════════════════════════════════════════════════════════
-- 1. 确保规则集表存在
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contract_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, code)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. 插入默认规则集（严格-默认）
-- ═══════════════════════════════════════════════════════════════

INSERT INTO contract_rule_sets (id, org_id, code, name, description, is_default, is_system)
VALUES (
  gen_random_uuid(),
  NULL, -- 系统级默认规则集
  'STRICT_DEFAULT',
  '严格（默认）',
  '适用于大多数合同的标准严格规则集',
  true,
  true
)
ON CONFLICT (org_id, code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 3. 插入15条核心规则（3级阈值）
-- ═══════════════════════════════════════════════════════════════

-- 获取默认规则集ID
DO $$
DECLARE
  v_rule_set_id UUID;
BEGIN
  SELECT id INTO v_rule_set_id FROM contract_rule_sets WHERE code = 'STRICT_DEFAULT' AND org_id IS NULL;

  -- 如果规则集不存在，使用NULL
  IF v_rule_set_id IS NULL THEN
    v_rule_set_id := NULL;
  END IF;

  -- 1. 付款节奏 (PAYMENT_SCHEDULE)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'PAYMENT_SCHEDULE', '付款节奏', '首付款比例检查', 'structured', 'payment', 'yellow',
    '{"field": "first_payment_ratio", "operator": ">=", "value": 30, "unit": "percent"}'::jsonb,
    '{"message": "首付款比例低于30%", "threshold_lower": 30, "threshold_recommended": "30-100", "threshold_red_line": 25}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 2. 终止退款 (EARLY_TERMINATION_REFUND)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'EARLY_TERMINATION_REFUND', '终止退款', '提前终止合同退款条款检查', 'structured', 'termination', 'red',
    '{"field": "termination_refund", "operator": "in", "value": ["不退款", "仅退未消耗"]}'::jsonb,
    '{"message": "终止退款条款过于严苛", "threshold_lower": "不退款", "threshold_recommended": "仅退未消耗", "threshold_red_line": "全额退款"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 3. 税率 (TAX_RATE)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'TAX_RATE', '税率', '税率适用检查', 'structured', 'tax', 'red',
    '{"field": "tax_rate", "operator": "in", "value": [13, 6]}'::jsonb,
    '{"message": "税率错套", "threshold_lower": "13%/6%", "threshold_recommended": "13%软件/6%订阅", "threshold_red_line": "错套"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 4. 默示验收期 (DEFAULT_ACCEPTANCE_PERIOD)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'DEFAULT_ACCEPTANCE_PERIOD', '默示验收期', '验收期天数检查', 'structured', 'acceptance', 'yellow',
    '{"field": "acceptance_period_days", "operator": "<=", "value": 30, "unit": "days"}'::jsonb,
    '{"message": "默示验收期过长", "threshold_lower": 5, "threshold_recommended": "7-15", "threshold_red_line": 30}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 5. 验收不通过 (ACCEPTANCE_FAILURE)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'ACCEPTANCE_FAILURE', '验收不通过', '验收失败处理方式检查', 'structured', 'acceptance', 'red',
    '{"field": "acceptance_failure_action", "operator": "in", "value": ["整改重交", "2次后解除"]}'::jsonb,
    '{"message": "验收不通过处理过于严苛", "threshold_lower": "整改重交", "threshold_recommended": "2次后解除", "threshold_red_line": "直接解除"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 6. 违约金 (LIQUIDATED_DAMAGES)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'LIQUIDATED_DAMAGES', '违约金', '违约金比例上限检查', 'structured', 'breach', 'yellow',
    '{"field": "liquidated_damages_ratio", "operator": "<=", "value": 100, "unit": "percent"}'::jsonb,
    '{"message": "违约金比例过高", "threshold_lower": "≤50%", "threshold_recommended": "50-100%", "threshold_red_line": ">100%"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 7. 间接损失 (CONSEQUENTIAL_LOSS)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'CONSEQUENTIAL_LOSS', '间接损失', '间接损失责任承担检查', 'semantic', 'liability', 'red',
    '{"pattern": "间接损失|间接损害赔偿|consequential damages", "exclude": "明确排除"}'::jsonb,
    '{"message": "间接损失责任不明确", "threshold_lower": "明确排除", "threshold_recommended": "需补", "threshold_red_line": "承担间接"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 8. 责任 Cap (LIABILITY_CAP)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'LIABILITY_CAP', '责任 Cap', '责任上限检查', 'structured', 'liability', 'red',
    '{"field": "liability_cap_ratio", "operator": "<=", "value": 100, "unit": "percent"}'::jsonb,
    '{"message": "责任上限过高", "threshold_lower": "≤50%", "threshold_recommended": "50-100%", "threshold_red_line": ">100%"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 9. 保密期 (CONFIDENTIALITY_PERIOD)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'CONFIDENTIALITY_PERIOD', '保密期', '保密期限检查', 'structured', 'confidentiality', 'yellow',
    '{"field": "confidentiality_years", "operator": "in", "value": [3, 5, 7]}'::jsonb,
    '{"message": "保密期设置不合理", "threshold_lower": "5年", "threshold_recommended": "3-7年", "threshold_red_line": "单向/永久"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 10. 主体·收款·金额 (PARTY_AND_AMOUNT)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'PARTY_AND_AMOUNT', '主体·收款·金额', '合同主体和金额一致性检查', 'structured', 'general', 'red',
    '{"field": "party_amount_match", "operator": "eq", "value": true}'::jsonb,
    '{"message": "合同主体或金额不一致", "threshold_lower": "全对", "threshold_recommended": "旧版模板", "threshold_red_line": "错主体"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 11. IP 归属 (IP_OWNERSHIP)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'IP_OWNERSHIP', 'IP 归属', '知识产权归属检查', 'semantic', 'ip', 'red',
    '{"pattern": "知识产权|IP归属|著作权|专利权", "position": "ones_retained|client"}'::jsonb,
    '{"message": "IP归属条款不利", "threshold_lower": "ONES保留", "threshold_recommended": "二次开发让", "threshold_red_line": "客户主张"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 12. 数据安全 (DATA_SECURITY)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate
  ) VALUES (
    NULL, 'DATA_SECURITY', '数据安全', '数据安全条款检查', 'semantic', 'data', 'red',
    '{"pattern": "数据安全|数据保护|数据泄露|个人信息", "exclude": "加密本地化"}'::jsonb,
    '{"message": "数据安全条款不足", "threshold_lower": "客户所有", "threshold_recommended": "加密本地化", "threshold_red_line": "AI训练无授权"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 13. SLA (UI隐藏3条之一，作为备选)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate,
    is_hidden
  ) VALUES (
    NULL, 'SLA', 'SLA', '服务可用性承诺检查', 'structured', 'service', 'yellow',
    '{"field": "sla_uptime", "operator": ">=", "value": 99.5, "unit": "percent"}'::jsonb,
    '{"message": "SLA承诺过高", "threshold_lower": "99.5%", "threshold_recommended": "99.9%", "threshold_red_line": "承诺可用性"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0,
    true
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 14. 续约 (UI隐藏3条之一，作为备选)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate,
    is_hidden
  ) VALUES (
    NULL, 'RENEWAL', '续约', '续约条款检查', 'semantic', 'subscription', 'yellow',
    '{"pattern": "续约|续签|续费|自动续期", "type": "renewal_clause"}'::jsonb,
    '{"message": "续约条款不利", "threshold_lower": "书面", "threshold_recommended": "自动续期+通知", "threshold_red_line": "永久锁价"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0,
    true
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

  -- 15. 争议解决 (UI隐藏3条之一，作为备选)
  INSERT INTO contract_rules (
    org_id, rule_code, name, description, rule_type, category, level,
    condition_config, message_config,
    scope, contract_types, priority, version, status,
    trigger_count, total_evaluations, hit_rate,
    is_hidden
  ) VALUES (
    NULL, 'DISPUTE_RESOLUTION', '争议解决', '争议解决方式和管辖地检查', 'structured', 'general', 'red',
    '{"field": "dispute_resolution", "operator": "in", "value": ["深圳SCIA", "北京", "上海"]}'::jsonb,
    '{"message": "争议解决条款不利", "threshold_lower": "深圳SCIA", "threshold_recommended": "北京上海", "threshold_red_line": "境外"}'::jsonb,
    'org', '{}', 100, 1, 'published', 0, 0, 0,
    true
  ) ON CONFLICT (org_id, rule_code) WHERE rule_code IS NOT NULL DO NOTHING;

END $$;

-- ═══════════════════════════════════════════════════════════════
-- 4. 添加 is_hidden 字段（如果不存在）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE contract_rules
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 5. 创建规则集与规则关联表
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contract_rule_set_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id UUID NOT NULL REFERENCES contract_rule_sets(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES contract_rules(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rule_set_id, rule_id)
);

-- 建立默认关联
INSERT INTO contract_rule_set_rules (rule_set_id, rule_id, sort_order)
SELECT
  (SELECT id FROM contract_rule_sets WHERE code = 'STRICT_DEFAULT' AND org_id IS NULL),
  id,
  CASE rule_code
    WHEN 'PAYMENT_SCHEDULE' THEN 1
    WHEN 'EARLY_TERMINATION_REFUND' THEN 2
    WHEN 'TAX_RATE' THEN 3
    WHEN 'DEFAULT_ACCEPTANCE_PERIOD' THEN 4
    WHEN 'ACCEPTANCE_FAILURE' THEN 5
    WHEN 'LIQUIDATED_DAMAGES' THEN 6
    WHEN 'CONSEQUENTIAL_LOSS' THEN 7
    WHEN 'LIABILITY_CAP' THEN 8
    WHEN 'CONFIDENTIALITY_PERIOD' THEN 9
    WHEN 'PARTY_AND_AMOUNT' THEN 10
    WHEN 'IP_OWNERSHIP' THEN 11
    WHEN 'DATA_SECURITY' THEN 12
    WHEN 'SLA' THEN 13
    WHEN 'RENEWAL' THEN 14
    WHEN 'DISPUTE_RESOLUTION' THEN 15
  END
FROM contract_rules
WHERE org_id IS NULL
  AND rule_code IN ('PAYMENT_SCHEDULE', 'EARLY_TERMINATION_REFUND', 'TAX_RATE',
    'DEFAULT_ACCEPTANCE_PERIOD', 'ACCEPTANCE_FAILURE', 'LIQUIDATED_DAMAGES',
    'CONSEQUENTIAL_LOSS', 'LIABILITY_CAP', 'CONFIDENTIALITY_PERIOD',
    'PARTY_AND_AMOUNT', 'IP_OWNERSHIP', 'DATA_SECURITY', 'SLA', 'RENEWAL', 'DISPUTE_RESOLUTION')
ON CONFLICT (rule_set_id, rule_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 6. 添加审计日志触发器（保存即生效）
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contract_rule_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES contract_rules(id),
  org_id UUID REFERENCES organizations(id),
  action TEXT NOT NULL, -- 'create' | 'update' | 'publish' | 'rollback' | 'delete'
  change_summary TEXT,
  old_value JSONB,
  new_value JSONB,
  performed_by UUID REFERENCES users(id),
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_audit_rule ON contract_rule_audit_logs(rule_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_audit_org ON contract_rule_audit_logs(org_id);

-- 审计触发器
CREATE OR REPLACE FUNCTION audit_contract_rule_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO contract_rule_audit_logs (
      rule_id, org_id, action, change_summary, old_value, new_value, performed_by
    ) VALUES (
      NEW.id, NEW.org_id, 'update',
      format('规则 %s 已更新（保存即生效）', NEW.name),
      row_to_json(OLD),
      row_to_json(NEW),
      COALESCE(current_setting('app.current_user_id', true), NEW.updated_by::text)::uuid
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_rule_update ON contract_rules;
CREATE TRIGGER trg_audit_rule_update
  AFTER UPDATE ON contract_rules
  FOR EACH ROW
  EXECUTE FUNCTION audit_contract_rule_change();

-- ═══════════════════════════════════════════════════════════════
-- 7. 注释
-- ═══════════════════════════════════════════════════════════════

COMMENT ON TABLE contract_rules IS '合同审核15条核心规则（柔性化3级阈值）';
COMMENT ON TABLE contract_rule_sets IS '规则集（多套可重叠）';
COMMENT ON TABLE contract_rule_set_rules IS '规则集与规则关联';
COMMENT ON TABLE contract_rule_audit_logs IS '规则变更审计日志（保存即生效）';
COMMENT ON COLUMN contract_rules.is_hidden IS 'UI是否隐藏（3条备选规则）';
COMMENT ON COLUMN contract_rules.message_config IS '3级阈值配置JSON：threshold_lower/ threshold_recommended/ threshold_red_line';
