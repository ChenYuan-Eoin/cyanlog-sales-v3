-- Migration: 20260625162638_contract_rule_engine_alignment.sql
-- PURPOSE: Align F005/F009 contract rule control-plane, execution evidence, and review cards.

ALTER TABLE contract_rules_v2
  ADD COLUMN IF NOT EXISTS engine_type TEXT DEFAULT 'structured',
  ADD COLUMN IF NOT EXISTS target_field TEXT,
  ADD COLUMN IF NOT EXISTS clause_category TEXT,
  ADD COLUMN IF NOT EXISTS field_hints TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS semantic_prompt TEXT,
  ADD COLUMN IF NOT EXISTS message_template JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);

UPDATE contract_rules_v2
SET engine_type = COALESCE(engine_type, 'structured')
WHERE engine_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rules_v2_engine_type_check'
      AND conrelid = 'contract_rules_v2'::regclass
  ) THEN
    ALTER TABLE contract_rules_v2
      ADD CONSTRAINT contract_rules_v2_engine_type_check
      CHECK (engine_type IN ('structured', 'semantic', 'hybrid'));
  END IF;
END $$;

ALTER TABLE contract_risk_cards
  ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES contract_rules_v2(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_code TEXT,
  ADD COLUMN IF NOT EXISTS rule_version INTEGER,
  ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_risk_cards_rule ON contract_risk_cards(rule_id);
CREATE INDEX IF NOT EXISTS idx_risk_cards_rule_code ON contract_risk_cards(rule_code);

WITH rule_metadata(code, engine_type, target_field, clause_category, field_hints, semantic_prompt) AS (
  VALUES
    ('R001', 'structured', 'first_payment_rate', 'payment',
      ARRAY['首付', '首付款', '首期款', '预付款', '定金'],
      NULL),
    ('R002', 'structured', 'payment_term_days', 'payment',
      ARRAY['账期', '付款期限', '付款周期', '付款日', '工作日内付款'],
      NULL),
    ('R003', 'structured', 'warranty_deposit_rate', 'payment',
      ARRAY['质保金', '质量保证金', '保证金比例', '质保金比例'],
      NULL),
    ('R004', 'structured', 'warranty_days', 'quality',
      ARRAY['质保期', '保修期', '质量保证期', '售后服务期'],
      NULL),
    ('R005', 'structured', 'penalty_rate', 'breach',
      ARRAY['违约金', '违约责任', '赔偿上限', '违约金上限'],
      NULL),
    ('R006', 'structured', 'late_fee_rate', 'payment',
      ARRAY['滞纳金', '逾期付款违约金', '逾期利息', '日万分之'],
      NULL),
    ('R007', 'structured', 'auto_renew_notice_days', 'termination',
      ARRAY['自动续约', '续约通知', '提前通知续约', '续期'],
      NULL),
    ('R008', 'structured', 'termination_notice_days', 'termination',
      ARRAY['单方解除', '解除通知', '提前通知解除', '终止通知'],
      NULL),
    ('R009', 'semantic', 'ip_ownership_clause', 'ip',
      ARRAY['知识产权', '著作权', '专利', '源代码', '定制开发成果', '技术成果归属'],
      '审查合同是否明确约定定制开发成果、源代码、文档、专利或著作权等知识产权归属；判不出或缺失时视为红线风险。'),
    ('R010', 'structured', 'confidentiality_days', 'confidentiality',
      ARRAY['保密期限', '保密义务', '保密期', '保密条款'],
      NULL),
    ('R011', 'structured', 'non_compete_days', 'non_compete',
      ARRAY['竞业限制', '竞业禁止', '不竞争', '限制期限'],
      NULL),
    ('R012', 'semantic', 'dispute_resolution_clause', 'dispute',
      ARRAY['争议解决', '仲裁', '管辖法院', '诉讼', '己方所在地'],
      '审查合同是否明确争议解决方式、管辖地或仲裁机构；未明确或明显偏向对方时视为风险。'),
    ('R013', 'semantic', 'force_majeure_scope', 'liability',
      ARRAY['不可抗力', '商业风险', '市场变化', '经营困难', '政策变化'],
      '审查不可抗力范围是否将商业风险、市场变化或经营困难不当纳入免责范围。'),
    ('R014', 'structured', 'contract_term_days', 'term',
      ARRAY['合同期限', '有效期', '合作期限', '履行期限'],
      NULL),
    ('R015', 'semantic', 'change_process_clause', 'change',
      ARRAY['合同变更', '书面形式', '授权代表', '双方签字', '补充协议'],
      '审查合同变更流程是否要求书面形式并经双方授权代表签署；缺失时视为流程风险。')
)
UPDATE contract_rules_v2 AS rule
SET
  engine_type = meta.engine_type,
  target_field = meta.target_field,
  clause_category = meta.clause_category,
  field_hints = meta.field_hints,
  semantic_prompt = meta.semantic_prompt,
  message_template = COALESCE(rule.message_template, '{}'::jsonb),
  published_at = COALESCE(rule.published_at, rule.updated_at, NOW())
FROM rule_metadata AS meta
WHERE rule.code = meta.code;

INSERT INTO contract_rule_snapshots (
  rule_id,
  version,
  config_snapshot,
  released_at,
  release_note,
  status,
  created_at
)
SELECT
  rule.id,
  COALESCE(rule.version, 1),
  to_jsonb(rule),
  COALESCE(rule.published_at, rule.updated_at, NOW()),
  'Initial published snapshot generated during F009 alignment',
  'published',
  NOW()
FROM contract_rules_v2 AS rule
WHERE rule.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM contract_rule_snapshots AS snapshot
    WHERE snapshot.rule_id = rule.id
      AND snapshot.version = COALESCE(rule.version, 1)
  );
