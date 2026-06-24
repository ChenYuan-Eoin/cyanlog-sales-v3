-- Migration: 2026-06-24
-- PURPOSE: 补充 contract_rules_v2 预置规则（R002-R015）
-- 背景：20260618000004_contract_rules_v2.sql 中的 R002-R015 含有 echo 语法，
--       PostgreSQL 不识别，导致仅3条规则（RULE-01-01/02/03）成功插入
-- REQ: B7, A2

-- R002: 付款周期
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
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R003', '质保金比例', '质保金比例应在5%-10%，超过20%为红线', 'ratio',
  '<=', 10, 'percent', 'auto_approve',
  '>', 10, 'percent', 'suggest_counterparty', '提高违约赔偿倍数',
  '>', 20, 'percent', 'block', '质保金比例超过20%，必须修改合同',
  80, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R003');

-- R004: 质保期
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R004', '质保期', '质保期应在1-3年，超过5年为红线', 'duration',
  '<=', 1095, 'day', 'auto_approve',
  '>', 1095, 'day', 'suggest_counterparty', '增加首年免费维护',
  '>', 1825, 'day', 'block', '质保期超过5年，必须修改合同',
  70, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R004');

-- R005: 违约金上限
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R005', '违约金上限', '违约金上限应在合同额10%-20%，超过30%为红线', 'ratio',
  '<=', 20, 'percent', 'auto_approve',
  '>', 20, 'percent', 'suggest_counterparty', '降低违约金比例',
  '>', 30, 'percent', 'block', '违约金超过30%，必须修改合同',
  85, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R005');

-- R006: 滞纳金比例
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R006', '滞纳金比例', '滞纳金应控制在日万分之五以内，超过千分之一为红线', 'ratio',
  '<=', 0.05, 'percent', 'auto_approve',
  '>', 0.05, 'percent', 'suggest_counterparty', '降低滞纳金比例',
  '>', 0.1, 'percent', 'block', '滞纳金比例过高，必须修改合同',
  75, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R006');

-- R007: 自动续约条款
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R007', '自动续约条款', '自动续约条款需提前30-60天通知，少于15天为红线', 'duration',
  '>=', 30, 'day', 'auto_approve',
  '<', 30, 'day', 'suggest_counterparty', '延长通知期',
  '<', 15, 'day', 'block', '自动续约通知期过短，必须修改合同',
  60, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R007');

-- R008: 单方解除权
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R008', '单方解除权', '单方解除权通知期应在30-90天，少于7天为红线', 'duration',
  '>=', 30, 'day', 'auto_approve',
  '<', 30, 'day', 'suggest_counterparty', '延长解除通知期',
  '<', 7, 'day', 'block', '单方解除通知期过短，必须修改合同',
  65, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R008');

-- R009: 知识产权归属
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R009', '知识产权归属', '定制开发成果知识产权归属需明确约定', 'text',
  'contains', 0, 'percent', 'auto_approve',
  'contains', 0, 'percent', 'suggest_counterparty', '明确知识产权归属',
  'contains', 0, 'percent', 'block', '知识产权归属未明确，必须修改合同',
  95, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R009');

-- R010: 保密期限
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R010', '保密期限', '保密期限应在2-5年，超过10年为红线', 'duration',
  '<=', 1825, 'day', 'auto_approve',
  '>', 1825, 'day', 'suggest_counterparty', '缩短保密期限',
  '>', 3650, 'day', 'block', '保密期限超过10年，必须修改合同',
  55, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R010');

-- R011: 竞业限制
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R011', '竞业限制', '竞业限制期限应在6-24个月，超过36个月为红线', 'duration',
  '<=', 720, 'day', 'auto_approve',
  '>', 720, 'day', 'suggest_counterparty', '缩短竞业限制期',
  '>', 1095, 'day', 'block', '竞业限制超过36个月，必须修改合同',
  50, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R011');

-- R012: 争议解决方式
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R012', '争议解决方式', '争议解决方式应优先选择己方所在地法院/仲裁', 'text',
  'contains', 0, 'percent', 'auto_approve',
  'contains', 0, 'percent', 'suggest_counterparty', '明确争议解决地',
  'contains', 0, 'percent', 'block', '争议解决方式未明确，必须修改合同',
  92, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R012');

-- R013: 不可抗力范围
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R013', '不可抗力范围', '不可抗力范围不应包含商业风险', 'text',
  'contains', 0, 'percent', 'auto_approve',
  'contains', 0, 'percent', 'suggest_counterparty', '明确不可抗力范围',
  'contains', 0, 'percent', 'block', '不可抗力范围包含商业风险，必须修改合同',
  88, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R013');

-- R014: 合同期限
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R014', '合同期限', '合同期限应在1-3年，超过5年为红线', 'duration',
  '<=', 1095, 'day', 'auto_approve',
  '>', 1095, 'day', 'suggest_counterparty', '缩短合同期限',
  '>', 1825, 'day', 'block', '合同期限超过5年，必须修改合同',
  72, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R014');

-- R015: 变更流程
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, created_at
)
SELECT
  o.id, 'R015', '变更流程', '合同变更需书面形式并经双方授权代表签字', 'text',
  'contains', 0, 'percent', 'auto_approve',
  'contains', 0, 'percent', 'suggest_counterparty', '完善变更流程',
  'contains', 0, 'percent', 'block', '合同变更流程缺失，必须修改合同',
  96, true, NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM contract_rules_v2 v2 WHERE v2.code = 'R015');
