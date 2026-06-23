-- Migration: 20260619000004_seed_contract_rules.sql
-- PURPOSE: 预置合同审核规则（15条红黄绿标准）
-- REQ: F005v2, F006

-- 先创建默认规则集
INSERT INTO contract_rule_sets (org_id, name, code, description, applicable_scenario, priority, is_default, is_active)
SELECT
  id as org_id,
  '默认规则集',
  'default',
  '系统预置的标准合同审核规则',
  '通用合同审核',
  0,
  true,
  true
FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

-- 预置15条标准规则
WITH default_rule_set AS (
  SELECT crs.id as rule_set_id, crs.org_id
  FROM contract_rule_sets crs
  WHERE crs.code = 'default'
  AND crs.is_default = true
)
INSERT INTO contract_rules (
  rule_set_id, org_id, code, name, category, description,
  threshold_lower_bound, threshold_recommended_min, threshold_recommended_max, threshold_red_line,
  applicable_to_contract_types, is_active
)
SELECT
  drs.rule_set_id,
  drs.org_id,
  rule.code,
  rule.name,
  rule.category,
  rule.description,
  rule.threshold_lower_bound,
  rule.threshold_recommended_min,
  rule.threshold_recommended_max,
  rule.threshold_red_line,
  ARRAY['买断', '订阅']::text[],
  true
FROM default_rule_set drs
CROSS JOIN LATERAL (VALUES
  ('R001', '首付款比例', 'payment', '首付款比例应在30%-50%之间，低于20%为红线', 0.2, 0.3, 0.5, 0.8, '%'),
  ('R002', '付款周期', 'payment', '付款周期应在30-90天，超过180天为红线', 30, 30, 90, 180, '天'),
  ('R003', '质保金比例', 'quality', '质保金比例应在5%-10%，超过20%为红线', 0, 0.05, 0.1, 0.2, '%'),
  ('R004', '质保期', 'quality', '质保期应在1-3年，超过5年为红线', 90, 365, 1095, 1825, '天'),
  ('R005', '违约金上限', 'penalty', '违约金上限应在合同额10%-20%，超过30%为红线', 0.05, 0.1, 0.2, 0.3, '%'),
  ('R006', '滞纳金比例', 'penalty', '滞纳金应控制在日万分之五以内，超过千分之一为红线', 0, 0.0003, 0.0005, 0.001, '日费率'),
  ('R007', '自动续约条款', 'term', '自动续约条款需提前30-60天通知，少于15天为红线', 15, 30, 60, 90, '天'),
  ('R008', '单方解除权', 'term', '单方解除权通知期应在30-90天，少于7天为红线', 7, 30, 90, 180, '天'),
  ('R009', '知识产权归属', 'ip', '定制开发成果知识产权归属需明确约定', null, null, null, null, 'enum'),
  ('R010', '保密期限', 'confidentiality', '保密期限应在2-5年，超过10年为红线', 365, 730, 1825, 3650, '天'),
  ('R011', '竞业限制', 'confidentiality', '竞业限制期限应在6-24个月，超过36个月为红线', 0, 180, 720, 1095, '天'),
  ('R012', '争议解决方式', 'dispute', '争议解决方式应优先选择己方所在地法院/仲裁', null, null, null, null, 'enum'),
  ('R013', '不可抗力范围', 'force_majeure', '不可抗力范围不应包含商业风险', null, null, null, null, 'enum'),
  ('R014', '合同期限', 'term', '合同期限应在1-3年，超过5年为红线', 90, 365, 1095, 1825, '天'),
  ('R015', '变更流程', 'process', '合同变更需书面形式并经双方授权代表签字', null, null, null, null, 'enum')
) AS rule(code, name, category, description, threshold_lower_bound, threshold_recommended_min, threshold_recommended_max, threshold_red_line, threshold_unit)
ON CONFLICT (rule_set_id, code) DO NOTHING;
