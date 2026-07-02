-- Migration: 20260702104500_demote_unverified_skill_bundles.sql
-- PURPOSE: A SkillBundle without passed eval evidence must not be represented
-- as a formal published review bundle.

UPDATE contract_skill_bundles
SET
  status = 'compiled',
  is_current = false,
  published_at = NULL,
  published_by = NULL,
  release_meta = COALESCE(release_meta, '{}'::jsonb)
    || jsonb_build_object(
      'official_review_allowed', false,
      'review_gate_status', 'compiled_not_formal',
      'demotion_reason', 'eval_not_passed_or_missing'
    ),
  updated_at = NOW()
WHERE status = 'published'
  AND (
    compiled_from->'eval_results'->>'status' IS DISTINCT FROM 'passed'
    OR release_meta->>'official_review_allowed' IS DISTINCT FROM 'true'
  );
