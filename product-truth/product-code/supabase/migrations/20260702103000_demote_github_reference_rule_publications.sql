-- Migration: 20260702103000_demote_github_reference_rule_publications.sql
-- PURPOSE: GitHub skill assets are reference/import/eval inputs, not the
-- production rule source. Any historical auto-published GitHub-derived rule
-- without a human publisher is demoted back to a config-center draft.

WITH github_reference_rules AS (
  SELECT id
  FROM contract_rules_v2
  WHERE published_by IS NULL
    AND (
      message_template->'source'->>'repo' = 'suoyidev/ones-internal-skills'
      OR semantic_prompt ILIKE '%suoyidev/ones-internal-skills%'
    )
)
UPDATE contract_rules_v2 AS rule
SET
  lifecycle_status = 'draft',
  translation_status = 'needs_ai_translation',
  translation_notes = COALESCE(rule.translation_notes, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'at', NOW(),
      'source', '20260702103000_demote_github_reference_rule_publications',
      'note', 'GitHub-derived rules are reference drafts only. Production publication requires config-center AI translation, eval, and manual publish.'
    )),
  published_at = NULL,
  updated_at = NOW()
FROM github_reference_rules AS ref
WHERE rule.id = ref.id
  AND (
    rule.lifecycle_status = 'published'
    OR rule.translation_status = 'ready'
    OR rule.published_at IS NOT NULL
  );

WITH github_reference_snapshots AS (
  SELECT snapshot.id
  FROM contract_rule_snapshots AS snapshot
  JOIN contract_rules_v2 AS rule ON rule.id = snapshot.rule_id
  WHERE snapshot.released_by IS NULL
    AND snapshot.status = 'published'
    AND (
      snapshot.config_snapshot->'message_template'->'source'->>'repo' = 'suoyidev/ones-internal-skills'
      OR rule.message_template->'source'->>'repo' = 'suoyidev/ones-internal-skills'
      OR rule.semantic_prompt ILIKE '%suoyidev/ones-internal-skills%'
    )
)
UPDATE contract_rule_snapshots AS snapshot
SET
  status = 'draft',
  released_at = NULL,
  release_note = CASE
    WHEN COALESCE(snapshot.release_note, '') ILIKE '%demoted to reference draft%' THEN snapshot.release_note
    ELSE COALESCE(snapshot.release_note || ' | ', '') || 'demoted to reference draft; not a production publication'
  END,
  config_snapshot = COALESCE(snapshot.config_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'lifecycle_status', 'draft',
      'translation_status', 'needs_ai_translation',
      'published_at', NULL,
      'reference_asset_only', true
    )
FROM github_reference_snapshots AS ref
WHERE snapshot.id = ref.id;
