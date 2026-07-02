-- Migration: 20260702090000_contract_rule_publication_gate.sql
-- PURPOSE: Separate rule drafting from formal publication for F009/F006.
-- Contract review production rules must come from config-center published
-- snapshots. Saving a rule must not silently publish it into SkillBundle input.

ALTER TABLE contract_rules_v2
  ADD COLUMN IF NOT EXISTS business_domain TEXT DEFAULT 'contract_review',
  ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'yellow',
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS translation_status TEXT DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS translation_notes JSONB DEFAULT '[]'::jsonb;

ALTER TABLE contract_rules_v2
  ALTER COLUMN published_at DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rules_v2_risk_level_check'
      AND conrelid = 'contract_rules_v2'::regclass
  ) THEN
    ALTER TABLE contract_rules_v2
      ADD CONSTRAINT contract_rules_v2_risk_level_check
      CHECK (risk_level IN ('green', 'yellow', 'red'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rules_v2_lifecycle_status_check'
      AND conrelid = 'contract_rules_v2'::regclass
  ) THEN
    ALTER TABLE contract_rules_v2
      ADD CONSTRAINT contract_rules_v2_lifecycle_status_check
      CHECK (lifecycle_status IN ('draft', 'needs_translation', 'ready_to_publish', 'published', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rules_v2_translation_status_check'
      AND conrelid = 'contract_rules_v2'::regclass
  ) THEN
    ALTER TABLE contract_rules_v2
      ADD CONSTRAINT contract_rules_v2_translation_status_check
      CHECK (translation_status IN ('not_started', 'needs_ai_translation', 'ready', 'failed'));
  END IF;
END $$;

UPDATE contract_rules_v2
SET
  business_domain = COALESCE(NULLIF(business_domain, ''), 'contract_review'),
  risk_level = CASE
    WHEN risk_level IN ('green', 'yellow', 'red') THEN risk_level
    WHEN level_c_action IN ('block', 'block_or_escalate') THEN 'red'
    WHEN level_b_action IN ('suggest_counterparty', 'negotiate_with_counterparty', 'manual_review') THEN 'yellow'
    ELSE 'yellow'
  END,
  lifecycle_status = CASE
    WHEN is_active IS FALSE THEN 'archived'
    WHEN published_at IS NOT NULL THEN 'published'
    ELSE 'draft'
  END,
  translation_status = CASE
    WHEN engine_type IN ('semantic', 'hybrid') AND NULLIF(semantic_prompt, '') IS NULL THEN 'needs_ai_translation'
    WHEN COALESCE(message_template, '{}'::jsonb) = '{}'::jsonb THEN 'needs_ai_translation'
    ELSE 'ready'
  END,
  translation_notes = COALESCE(translation_notes, '[]'::jsonb);

UPDATE contract_rule_snapshots AS snapshot
SET config_snapshot = COALESCE(snapshot.config_snapshot, '{}'::jsonb)
  || jsonb_build_object(
    'business_domain', rule.business_domain,
    'risk_level', rule.risk_level,
    'lifecycle_status', CASE
      WHEN snapshot.status = 'published' THEN 'published'
      WHEN rule.is_active IS FALSE THEN 'archived'
      ELSE rule.lifecycle_status
    END,
    'translation_status', rule.translation_status,
    'translation_notes', rule.translation_notes,
    'published_at', CASE
      WHEN snapshot.status = 'published' THEN COALESCE(rule.published_at, snapshot.released_at)
      ELSE NULL
    END
  )
FROM contract_rules_v2 AS rule
WHERE snapshot.rule_id = rule.id;

CREATE INDEX IF NOT EXISTS idx_rules_v2_business_domain ON contract_rules_v2(business_domain);
CREATE INDEX IF NOT EXISTS idx_rules_v2_risk_level ON contract_rules_v2(risk_level);
CREATE INDEX IF NOT EXISTS idx_rules_v2_lifecycle_status ON contract_rules_v2(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_rules_v2_published_active
  ON contract_rules_v2(org_id, lifecycle_status, is_active)
  WHERE lifecycle_status = 'published' AND is_active = true;
