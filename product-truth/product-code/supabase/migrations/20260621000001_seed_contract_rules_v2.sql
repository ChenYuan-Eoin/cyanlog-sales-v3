-- Migration: 20260621000001_seed_contract_rules_v2.sql
-- PURPOSE: 将15条合同审核规则预置到 contract_rules_v2（属性化规则表）
-- REQ: 验收清单 #7 — 审核规则表有预置数据

-- ═══════════════════════════════════════════════════════════════
-- 1. 补充预置15条规则到 contract_rules_v2
-- ═══════════════════════════════════════════════════════════════
-- 基于 F005 v2 设计，将原有 contract_rules 的15条规则映射到属性化结构

DO $$
DECLARE
  v_org_id UUID;
BEGIN
  -- 获取第一个组织ID（多租户场景下取默认组织）
  SELECT id INTO v_org_id FROM organizations LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization found, skipping contract_rules_v2 seed';
    RETURN;
  END IF;

  -- R001: 首付款比例 (ratio)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R001', '首付款比例', '首付款比例应在30%-50%之间，低于20%为红线', 'ratio',
    '>=', 30, 'percent', 'auto_approve',
    '<', 30, 'percent', 'suggest_counterparty', '延长质保期6个月',
    '<', 20, 'percent', 'block', '首付款比例低于20%，必须修改合同',
    100, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R002: 付款周期 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R002', '付款周期', '付款周期应在30-90天，超过180天为红线', 'duration',
    '<=', 90, 'day', 'auto_approve',
    '>', 90, 'day', 'suggest_counterparty', '提供银行保函',
    '>', 180, 'day', 'block', '账期超过180天，必须修改合同',
    90, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R003: 质保金比例 (ratio)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R003', '质保金比例', '质保金比例应在5%-10%，超过20%为红线', 'ratio',
    '<=', 10, 'percent', 'auto_approve',
    '>', 10, 'percent', 'suggest_counterparty', '提高违约赔偿倍数',
    '>', 20, 'percent', 'block', '质保金比例超过20%，必须修改合同',
    80, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R004: 质保期 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R004', '质保期', '质保期应在1-3年，超过5年为红线', 'duration',
    '<=', 1095, 'day', 'auto_approve',
    '>', 1095, 'day', 'suggest_counterparty', '增加首年免费维护',
    '>', 1825, 'day', 'block', '质保期超过5年，必须修改合同',
    70, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R005: 违约金上限 (ratio)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R005', '违约金上限', '违约金上限应在合同额10%-20%，超过30%为红线', 'ratio',
    '<=', 20, 'percent', 'auto_approve',
    '>', 20, 'percent', 'suggest_counterparty', '降低违约金比例',
    '>', 30, 'percent', 'block', '违约金超过30%，必须修改合同',
    85, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R006: 滞纳金比例 (ratio)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R006', '滞纳金比例', '滞纳金应控制在日万分之五以内，超过千分之一为红线', 'ratio',
    '<=', 0.05, 'percent', 'auto_approve',
    '>', 0.05, 'percent', 'suggest_counterparty', '降低滞纳金比例',
    '>', 0.1, 'percent', 'block', '滞纳金比例过高，必须修改合同',
    75, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R007: 自动续约条款 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R007', '自动续约条款', '自动续约条款需提前30-60天通知，少于15天为红线', 'duration',
    '>=', 30, 'day', 'auto_approve',
    '<', 30, 'day', 'suggest_counterparty', '增加提前通知天数',
    '<', 15, 'day', 'block', '自动续约通知期少于15天，必须修改合同',
    60, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R008: 单方解除权 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R008', '单方解除权', '单方解除权通知期应在30-90天，少于7天为红线', 'duration',
    '>=', 30, 'day', 'auto_approve',
    '<', 30, 'day', 'suggest_counterparty', '增加提前通知天数',
    '<', 7, 'day', 'block', '单方解除权通知期少于7天，必须修改合同',
    65, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R009: 知识产权归属 (text/enum 类型)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R009', '知识产权归属', '定制开发成果知识产权归属需明确约定', 'text',
    'contains', NULL, 'text', 'auto_approve',
    '=', NULL, 'text', 'suggest_counterparty', '增加知识产权归属条款',
    '=', NULL, 'text', 'block', '未约定知识产权归属，必须修改合同',
    50, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R010: 保密期限 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R010', '保密期限', '保密期限应在2-5年，超过10年为红线', 'duration',
    '<=', 1825, 'day', 'auto_approve',
    '>', 1825, 'day', 'suggest_counterparty', '缩短保密期限',
    '>', 3650, 'day', 'block', '保密期限超过10年，必须修改合同',
    55, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R011: 竞业限制 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R011', '竞业限制', '竞业限制期限应在6-24个月，超过36个月为红线', 'duration',
    '<=', 720, 'day', 'auto_approve',
    '>', 720, 'day', 'suggest_counterparty', '缩短竞业限制期限',
    '>', 1095, 'day', 'block', '竞业限制超过36个月，必须修改合同',
    45, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R012: 争议解决方式 (text/enum 类型)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R012', '争议解决方式', '争议解决方式应优先选择己方所在地法院/仲裁', 'text',
    'contains', NULL, 'text', 'auto_approve',
    '=', NULL, 'text', 'suggest_counterparty', '改为己方所在地管辖',
    '=', NULL, 'text', 'block', '争议解决方式对己方不利，必须修改合同',
    40, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R013: 不可抗力范围 (text/enum 类型)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R013', '不可抗力范围', '不可抗力范围不应包含商业风险', 'text',
    'contains', NULL, 'text', 'auto_approve',
    '=', NULL, 'text', 'suggest_counterparty', '缩小不可抗力范围',
    '=', NULL, 'text', 'block', '不可抗力范围包含商业风险，必须修改合同',
    35, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R014: 合同期限 (duration)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R014', '合同期限', '合同期限应在1-3年，超过5年为红线', 'duration',
    '<=', 1095, 'day', 'auto_approve',
    '>', 1095, 'day', 'suggest_counterparty', '缩短合同期限',
    '>', 1825, 'day', 'block', '合同期限超过5年，必须修改合同',
    95, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  -- R015: 变更流程 (text/enum 类型)
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    priority, is_active
  ) VALUES (
    v_org_id, 'R015', '变更流程', '合同变更需书面形式并经双方授权代表签字', 'text',
    'contains', NULL, 'text', 'auto_approve',
    '=', NULL, 'text', 'suggest_counterparty', '增加书面变更要求',
    '=', NULL, 'text', 'block', '合同变更流程不明确，必须修改合同',
    30, true
  ) ON CONFLICT (org_id, code) DO NOTHING;

  RAISE NOTICE 'Contract rules v2 seed completed: 15 rules inserted for org %', v_org_id;
END $$;
