-- Migration: 20260625000001_normalize_contract_rules_v2_seed.sql
-- PURPOSE: Normalize contract_rules_v2 preset rules to active R001-R015 per organization.
-- REQ: F027 / UM01

WITH default_rules (
  code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority
) AS (
  VALUES
    ('R001', '首期款比例', '合同首付款占合同总额的比例，低于25%为红线', 'ratio',
      '>=', 30::decimal, 'percent', 'auto_approve',
      '<', 30::decimal, 'percent', 'suggest_counterparty', '延长质保期 6 个月',
      '<', 25::decimal, 'percent', 'block', '首期款比例低于25%，必须修改合同',
      100),
    ('R002', '付款周期', '付款账期应在30-90天，超过180天为红线', 'duration',
      '<=', 90::decimal, 'day', 'auto_approve',
      '>', 90::decimal, 'day', 'suggest_counterparty', '提供银行保函',
      '>', 180::decimal, 'day', 'block', '账期超过180天，必须修改合同',
      90),
    ('R003', '质保金比例', '质保金比例应在5%-10%，超过20%为红线', 'ratio',
      '<=', 10::decimal, 'percent', 'auto_approve',
      '>', 10::decimal, 'percent', 'suggest_counterparty', '提高违约赔偿倍数',
      '>', 20::decimal, 'percent', 'block', '质保金比例超过20%，必须修改合同',
      80),
    ('R004', '质保期', '质保期应在1-3年，超过5年为红线', 'duration',
      '<=', 1095::decimal, 'day', 'auto_approve',
      '>', 1095::decimal, 'day', 'suggest_counterparty', '增加首年免费维护',
      '>', 1825::decimal, 'day', 'block', '质保期超过5年，必须修改合同',
      70),
    ('R005', '违约金上限', '违约金上限应在合同额10%-20%，超过30%为红线', 'ratio',
      '<=', 20::decimal, 'percent', 'auto_approve',
      '>', 20::decimal, 'percent', 'suggest_counterparty', '降低违约金比例',
      '>', 30::decimal, 'percent', 'block', '违约金超过30%，必须修改合同',
      85),
    ('R006', '滞纳金比例', '滞纳金应控制在日万分之五以内，超过千分之一为红线', 'ratio',
      '<=', 0.05::decimal, 'percent', 'auto_approve',
      '>', 0.05::decimal, 'percent', 'suggest_counterparty', '降低滞纳金比例',
      '>', 0.1::decimal, 'percent', 'block', '滞纳金比例过高，必须修改合同',
      75),
    ('R007', '自动续约条款', '自动续约条款需提前30-60天通知，少于15天为红线', 'duration',
      '>=', 30::decimal, 'day', 'auto_approve',
      '<', 30::decimal, 'day', 'suggest_counterparty', '延长通知期',
      '<', 15::decimal, 'day', 'block', '自动续约通知期过短，必须修改合同',
      60),
    ('R008', '单方解除权', '单方解除权通知期应在30-90天，少于7天为红线', 'duration',
      '>=', 30::decimal, 'day', 'auto_approve',
      '<', 30::decimal, 'day', 'suggest_counterparty', '延长解除通知期',
      '<', 7::decimal, 'day', 'block', '单方解除通知期过短，必须修改合同',
      65),
    ('R009', '知识产权归属', '定制开发成果知识产权归属需明确约定', 'text',
      'contains', 0::decimal, 'text', 'auto_approve',
      'contains', 0::decimal, 'text', 'suggest_counterparty', '明确知识产权归属',
      'contains', 0::decimal, 'text', 'block', '知识产权归属未明确，必须修改合同',
      95),
    ('R010', '保密期限', '保密期限应在2-5年，超过10年为红线', 'duration',
      '<=', 1825::decimal, 'day', 'auto_approve',
      '>', 1825::decimal, 'day', 'suggest_counterparty', '缩短保密期限',
      '>', 3650::decimal, 'day', 'block', '保密期限超过10年，必须修改合同',
      55),
    ('R011', '竞业限制', '竞业限制期限应在6-24个月，超过36个月为红线', 'duration',
      '<=', 720::decimal, 'day', 'auto_approve',
      '>', 720::decimal, 'day', 'suggest_counterparty', '缩短竞业限制期',
      '>', 1095::decimal, 'day', 'block', '竞业限制超过36个月，必须修改合同',
      50),
    ('R012', '争议解决方式', '争议解决方式应优先选择己方所在地法院或仲裁', 'text',
      'contains', 0::decimal, 'text', 'auto_approve',
      'contains', 0::decimal, 'text', 'suggest_counterparty', '明确争议解决地',
      'contains', 0::decimal, 'text', 'block', '争议解决方式未明确，必须修改合同',
      92),
    ('R013', '不可抗力范围', '不可抗力范围不应包含商业风险', 'text',
      'contains', 0::decimal, 'text', 'auto_approve',
      'contains', 0::decimal, 'text', 'suggest_counterparty', '明确不可抗力范围',
      'contains', 0::decimal, 'text', 'block', '不可抗力范围包含商业风险，必须修改合同',
      88),
    ('R014', '合同期限', '合同期限应在1-3年，超过5年为红线', 'duration',
      '<=', 1095::decimal, 'day', 'auto_approve',
      '>', 1095::decimal, 'day', 'suggest_counterparty', '缩短合同期限',
      '>', 1825::decimal, 'day', 'block', '合同期限超过5年，必须修改合同',
      72),
    ('R015', '变更流程', '合同变更需书面形式并经双方授权代表签字', 'text',
      'contains', 0::decimal, 'text', 'auto_approve',
      'contains', 0::decimal, 'text', 'suggest_counterparty', '完善变更流程',
      'contains', 0::decimal, 'text', 'block', '合同变更流程缺失，必须修改合同',
      96)
)
INSERT INTO contract_rules_v2 (
  org_id, code, name, description, category,
  level_a_operator, level_a_threshold, level_a_unit, level_a_action,
  level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
  level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
  priority, is_active, updated_at
)
SELECT
  o.id,
  r.code, r.name, r.description, r.category,
  r.level_a_operator, r.level_a_threshold, r.level_a_unit, r.level_a_action,
  r.level_b_operator, r.level_b_threshold, r.level_b_unit, r.level_b_action, r.level_b_counterparty,
  r.level_c_operator, r.level_c_threshold, r.level_c_unit, r.level_c_action, r.level_c_message,
  r.priority, true, NOW()
FROM organizations o
CROSS JOIN default_rules r
ON CONFLICT (org_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  level_a_operator = EXCLUDED.level_a_operator,
  level_a_threshold = EXCLUDED.level_a_threshold,
  level_a_unit = EXCLUDED.level_a_unit,
  level_a_action = EXCLUDED.level_a_action,
  level_b_operator = EXCLUDED.level_b_operator,
  level_b_threshold = EXCLUDED.level_b_threshold,
  level_b_unit = EXCLUDED.level_b_unit,
  level_b_action = EXCLUDED.level_b_action,
  level_b_counterparty = EXCLUDED.level_b_counterparty,
  level_c_operator = EXCLUDED.level_c_operator,
  level_c_threshold = EXCLUDED.level_c_threshold,
  level_c_unit = EXCLUDED.level_c_unit,
  level_c_action = EXCLUDED.level_c_action,
  level_c_message = EXCLUDED.level_c_message,
  priority = EXCLUDED.priority,
  is_active = true,
  updated_at = NOW();

UPDATE contract_rules_v2
SET is_active = false, updated_at = NOW()
WHERE code IN ('RULE-01-01', 'RULE-01-02', 'RULE-01-03')
  AND EXISTS (
    SELECT 1
    FROM contract_rules_v2 canonical
    WHERE canonical.org_id = contract_rules_v2.org_id
      AND canonical.code BETWEEN 'R001' AND 'R015'
  );
