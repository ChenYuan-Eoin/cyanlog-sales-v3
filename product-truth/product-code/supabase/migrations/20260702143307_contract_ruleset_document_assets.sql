-- Migration: 20260702143307_contract_ruleset_document_assets.sql
-- PURPOSE: Make RuleSetDocument a first-class F009 asset.
-- Rule documents are efficient editing/reference sources. They do not become
-- production audit facts until translated, confirmed, snapshotted, and compiled
-- into F006 SkillBundle evidence.

ALTER TABLE contract_rule_sets
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS release_note TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rule_sets_lifecycle_status_check'
      AND conrelid = 'contract_rule_sets'::regclass
  ) THEN
    ALTER TABLE contract_rule_sets
      ADD CONSTRAINT contract_rule_sets_lifecycle_status_check
      CHECK (lifecycle_status IN ('draft', 'needs_translation', 'ready_to_publish', 'published', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rule_sets_translation_status_check'
      AND conrelid = 'contract_rule_sets'::regclass
  ) THEN
    ALTER TABLE contract_rule_sets
      ADD CONSTRAINT contract_rule_sets_translation_status_check
      CHECK (translation_status IN ('not_started', 'needs_ai_translation', 'ready', 'failed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contract_rule_set_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_set_id UUID NOT NULL REFERENCES contract_rule_sets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'markdown'
    CHECK (source_type IN ('markdown', 'upload', 'github_reference', 'manual_note')),
  source_uri TEXT,
  content_markdown TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'translated', 'published', 'archived')),
  translation_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (translation_status IN ('not_started', 'needs_ai_translation', 'ready', 'failed')),
  translation_diff JSONB NOT NULL DEFAULT '[]'::jsonb,
  translation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_translation_invocation_id UUID REFERENCES model_invocations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, version)
);

CREATE INDEX IF NOT EXISTS idx_rule_set_documents_org
  ON contract_rule_set_documents(org_id, rule_set_id, status);

CREATE INDEX IF NOT EXISTS idx_rule_set_documents_latest
  ON contract_rule_set_documents(rule_set_id, version DESC);

CREATE TABLE IF NOT EXISTS contract_rule_set_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_set_id UUID NOT NULL REFERENCES contract_rule_sets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'rolled_back')),
  rule_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  document_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  test_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ,
  release_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, version, status)
);

CREATE INDEX IF NOT EXISTS idx_rule_set_snapshots_org
  ON contract_rule_set_snapshots(org_id, status, released_at DESC);

CREATE INDEX IF NOT EXISTS idx_rule_set_snapshots_rule_set
  ON contract_rule_set_snapshots(rule_set_id, version DESC);

ALTER TABLE contract_rules_v2
  ADD COLUMN IF NOT EXISTS rule_set_document_id UUID REFERENCES contract_rule_set_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS translation_diff JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS translated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS translated_by UUID REFERENCES users(id);

ALTER TABLE contract_skill_bundles
  ADD COLUMN IF NOT EXISTS rule_set_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS document_snapshot_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE contract_reviews
  ADD COLUMN IF NOT EXISTS rule_set_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rule_set_document_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_rules_v2_rule_set_id
  ON contract_rules_v2(rule_set_id);

CREATE INDEX IF NOT EXISTS idx_rules_v2_rule_set_document_id
  ON contract_rules_v2(rule_set_document_id);

ALTER TABLE contract_rule_set_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_rule_set_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads contract_rule_set_documents" ON contract_rule_set_documents;
CREATE POLICY "Same org reads contract_rule_set_documents" ON contract_rule_set_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_rule_set_documents.org_id
        AND uo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Same org writes contract_rule_set_documents" ON contract_rule_set_documents;
CREATE POLICY "Same org writes contract_rule_set_documents" ON contract_rule_set_documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_rule_set_documents.org_id
        AND uo.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_rule_set_documents.org_id
        AND uo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Same org reads contract_rule_set_snapshots" ON contract_rule_set_snapshots;
CREATE POLICY "Same org reads contract_rule_set_snapshots" ON contract_rule_set_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_rule_set_snapshots.org_id
        AND uo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Same org writes contract_rule_set_snapshots" ON contract_rule_set_snapshots;
CREATE POLICY "Same org writes contract_rule_set_snapshots" ON contract_rule_set_snapshots
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_rule_set_snapshots.org_id
        AND uo.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_rule_set_snapshots.org_id
        AND uo.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_contract_rule_set_documents_updated_at ON contract_rule_set_documents;
CREATE TRIGGER update_contract_rule_set_documents_updated_at
  BEFORE UPDATE ON contract_rule_set_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed one stable RuleSet per canonical clause category for each org, then
-- attach existing R001-R015 rules by clause_category. This reuses the old
-- contract_rule_sets table instead of creating a parallel rule asset system.
WITH canonical_rule_sets(code, name, description, sort_order) AS (
  VALUES
    ('PAYMENT', '付款与结算规则集', '付款比例、账期、付款触发条件与结算风险。', 10),
    ('TERMINATION', '终止与退款规则集', '终止、退款、解除权和未消耗费用处理。', 20),
    ('TAX', '税务与发票规则集', '税率、开票、发票类型和税务口径。', 30),
    ('ACCEPTANCE', '验收与交付规则集', '验收周期、默示验收、整改和交付边界。', 40),
    ('BREACH', '违约责任规则集', '违约金、滞纳金、单向责任和赔偿边界。', 50),
    ('LIABILITY', '责任边界规则集', '间接损失、责任上限和免责边界。', 60),
    ('CONFIDENTIALITY', '保密义务规则集', '保密期限、保密范围和单向义务。', 70),
    ('BUSINESS_INTEGRITY', '主体与金额一致性规则集', '签约主体、收款主体、合同金额和附件一致性。', 80),
    ('IP', '知识产权规则集', '产品 IP、二开成果、客户许可和源代码边界。', 90),
    ('DATA_SECURITY', '数据安全规则集', '客户数据、训练授权、本地化和加密要求。', 100),
    ('SLA', 'SLA 与服务承诺规则集', '可用性、赔偿、服务边界和 7x24 承诺。', 110),
    ('RENEWAL', '续约与退出规则集', '自动续期、锁价、通知和退出机制。', 120),
    ('DISPUTE', '争议解决规则集', '管辖地、仲裁机构和涉外争议。', 130)
)
INSERT INTO contract_rule_sets (
  org_id,
  code,
  name,
  description,
  applicable_scenario,
  priority,
  is_default,
  is_active,
  lifecycle_status,
  translation_status,
  metadata
)
SELECT
  org.id,
  canonical.code,
  canonical.name,
  canonical.description,
  'standard_contract_review',
  canonical.sort_order,
  canonical.code = 'PAYMENT',
  true,
  'draft',
  'not_started',
  jsonb_build_object('source', 'F009 canonical seed', 'sort_order', canonical.sort_order)
FROM organizations org
CROSS JOIN canonical_rule_sets canonical
ON CONFLICT (org_id, code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  applicable_scenario = EXCLUDED.applicable_scenario,
  priority = EXCLUDED.priority,
  is_active = true,
  metadata = contract_rule_sets.metadata || EXCLUDED.metadata,
  updated_at = now();

WITH category_to_set(clause_category, code) AS (
  VALUES
    ('payment', 'PAYMENT'),
    ('termination', 'TERMINATION'),
    ('tax', 'TAX'),
    ('acceptance', 'ACCEPTANCE'),
    ('breach', 'BREACH'),
    ('liability', 'LIABILITY'),
    ('confidentiality', 'CONFIDENTIALITY'),
    ('business_integrity', 'BUSINESS_INTEGRITY'),
    ('ip', 'IP'),
    ('data_security', 'DATA_SECURITY'),
    ('sla', 'SLA'),
    ('renewal', 'RENEWAL'),
    ('dispute', 'DISPUTE')
)
UPDATE contract_rules_v2 AS rule
SET rule_set_id = rule_set.id
FROM category_to_set map
JOIN contract_rule_sets rule_set
  ON rule_set.code = map.code
WHERE rule.org_id = rule_set.org_id
  AND rule.clause_category = map.clause_category
  AND (rule.rule_set_id IS NULL OR rule.rule_set_id <> rule_set.id);

WITH seeded_docs AS (
  SELECT
    rule_set.org_id,
    rule_set.id AS rule_set_id,
    rule_set.name || ' 初始规则声明' AS title,
    concat(
      '# ', rule_set.name, E'\n\n',
      coalesce(rule_set.description, ''), E'\n\n',
      '- 来源：F009 canonical seed', E'\n',
      '- 用途：作为规则集文档资产的初始版本，后续可由配置中心 Markdown 文档维护并转译为 RuleUnit。', E'\n',
      '- 约束：正式审核仍以已发布 RuleSnapshot / SkillBundle 为准。'
    ) AS content_markdown
  FROM contract_rule_sets rule_set
  WHERE rule_set.code IN (
    'PAYMENT',
    'TERMINATION',
    'TAX',
    'ACCEPTANCE',
    'BREACH',
    'LIABILITY',
    'CONFIDENTIALITY',
    'BUSINESS_INTEGRITY',
    'IP',
    'DATA_SECURITY',
    'SLA',
    'RENEWAL',
    'DISPUTE'
  )
)
INSERT INTO contract_rule_set_documents (
  org_id,
  rule_set_id,
  title,
  source_type,
  content_markdown,
  content_hash,
  version,
  status,
  translation_status,
  translation_summary
)
SELECT
  seeded.org_id,
  seeded.rule_set_id,
  seeded.title,
  'manual_note',
  seeded.content_markdown,
  md5(seeded.content_markdown),
  1,
  'published',
  'ready',
  jsonb_build_object(
    'source', 'F009 canonical seed',
    'requires_field_level_confirmation', false,
    'note', 'Initial document asset only; executable facts still come from published RuleSnapshot.'
  )
FROM seeded_docs seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM contract_rule_set_documents existing
  WHERE existing.rule_set_id = seeded.rule_set_id
);

UPDATE contract_rule_sets AS rule_set
SET
  lifecycle_status = CASE
    WHEN rule_set.lifecycle_status = 'draft' THEN 'published'
    ELSE rule_set.lifecycle_status
  END,
  translation_status = CASE
    WHEN rule_set.translation_status = 'not_started' THEN 'ready'
    ELSE rule_set.translation_status
  END,
  published_at = COALESCE(rule_set.published_at, now()),
  release_note = COALESCE(rule_set.release_note, '初始规则集资产由现有规则和 F009 初始文档生成')
WHERE rule_set.code IN (
  'PAYMENT',
  'TERMINATION',
  'TAX',
  'ACCEPTANCE',
  'BREACH',
  'LIABILITY',
  'CONFIDENTIALITY',
  'BUSINESS_INTEGRITY',
  'IP',
  'DATA_SECURITY',
  'SLA',
  'RENEWAL',
  'DISPUTE'
)
AND EXISTS (
  SELECT 1
  FROM contract_rule_set_documents doc
  WHERE doc.rule_set_id = rule_set.id
    AND doc.status = 'published'
    AND doc.translation_status = 'ready'
);
