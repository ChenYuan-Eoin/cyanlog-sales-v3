-- WP03 post-apply reconciliation.
--
-- The first quarantine migration derived invalid snapshot ids from the live
-- RuleSet current pointers. The historical v21 SkillBundle was compiled from
-- older RuleSnapshot/RuleSetSnapshot generations, so its immutable content was
-- correctly preserved but its mutable `is_current` marker was not removed.
--
-- This forward-only repair changes only the current pointer and `updated_at`.
-- It never rewrites bundle content or any published snapshot. Identity is
-- relation-based; generated ids are deliberately not hard-coded.

DO $$
DECLARE
  v_invalid_bundle_ids UUID[] := ARRAY[]::UUID[];
  v_invalid_identity_count INTEGER := 0;
  v_channel_total_count INTEGER := 0;
  v_channel_count INTEGER := 0;
  v_deleted_channel_count INTEGER := 0;
  v_demoted_bundle_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(bundle.id ORDER BY bundle.id), ARRAY[]::UUID[])
  INTO v_invalid_bundle_ids
  FROM public.contract_skill_bundles AS bundle
  WHERE bundle.is_current = true
    AND bundle.status = 'published'
    AND bundle.compiled_identity_generation IS NULL
    AND (
      EXISTS (
        SELECT 1
        FROM unnest(bundle.rule_snapshot_ids) AS member(rule_snapshot_id)
        JOIN public.contract_rule_snapshots AS rule_snapshot
          ON rule_snapshot.id = member.rule_snapshot_id
         AND rule_snapshot.status = 'published'
        JOIN public.contract_rules_v2 AS rule
          ON rule.id = rule_snapshot.rule_id
         AND rule.org_id = bundle.org_id
        JOIN public.contract_rule_sets AS scenario
          ON scenario.id = rule.rule_set_id
         AND scenario.org_id = rule.org_id
        WHERE rule.code ~ '^R0(0[1-9]|1[0-5])$'
          AND rule.rule_contract IS NULL
          AND scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
          AND scenario.metadata ->> 'work_package' = 'WP03'
          AND scenario.metadata ->> 'membership_state'
            = 'canonical_rule_contract_confirmation_required'
          AND (
            rule_snapshot.config_snapshot -> 'rule_contract' IS NULL
            OR rule_snapshot.config_snapshot -> 'rule_contract' = 'null'::JSONB
          )
          AND EXISTS (
            SELECT 1
            FROM public.contract_rule_snapshots AS confirmation_draft
            WHERE confirmation_draft.rule_id = rule.id
              AND confirmation_draft.status = 'draft'
              AND confirmation_draft.config_snapshot
                    -> '_draft_origin' ->> 'work_package' = 'WP03'
              AND confirmation_draft.config_snapshot
                    -> '_draft_origin' ->> 'kind'
                    = 'canonical_rule_contract_confirmation'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM unnest(bundle.rule_set_snapshot_ids) AS member(rule_set_snapshot_id)
        JOIN public.contract_rule_set_snapshots AS rule_set_snapshot
          ON rule_set_snapshot.id = member.rule_set_snapshot_id
         AND rule_set_snapshot.org_id = bundle.org_id
         AND rule_set_snapshot.status = 'published'
        JOIN public.contract_rule_sets AS rule_set
          ON rule_set.id = rule_set_snapshot.rule_set_id
         AND rule_set.org_id = rule_set_snapshot.org_id
        WHERE rule_set.is_active = false
          AND rule_set.lifecycle_status = 'archived'
          AND rule_set.metadata -> 'wp03_projection_status' ->> 'state' IN (
            'superseded_category_shaped_ruleset',
            'controlled_acceptance_canary_archived'
          )
      )
    );

  IF cardinality(v_invalid_bundle_ids) > 0 THEN
    SELECT count(DISTINCT (bundle.org_id, bundle.key))
    INTO v_invalid_identity_count
    FROM public.contract_skill_bundles AS bundle
    WHERE bundle.id = ANY(v_invalid_bundle_ids);

    SELECT count(*)
    INTO v_channel_total_count
    FROM public.contract_skill_bundle_channels AS channel
    WHERE channel.channel = 'preview_candidate'
      AND EXISTS (
        SELECT 1
        FROM public.contract_skill_bundles AS invalid_bundle
        WHERE invalid_bundle.id = ANY(v_invalid_bundle_ids)
          AND invalid_bundle.org_id = channel.org_id
          AND invalid_bundle.key = channel.key
      );

    SELECT count(*)
    INTO v_channel_count
    FROM public.contract_skill_bundle_channels AS channel
    JOIN public.contract_skill_bundles AS candidate
      ON candidate.id = channel.bundle_id
     AND candidate.org_id = channel.org_id
     AND candidate.key = channel.key
     AND candidate.version = channel.bundle_version
    WHERE channel.channel = 'preview_candidate'
      AND candidate.status = 'published'
      AND candidate.is_current = false
      AND candidate.release_meta ->> 'stage' = 'candidate'
      AND candidate.release_meta ->> 'release_eligible' = 'false'
      AND candidate.output_schema ->> 'manifest_hash'
        = 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
      AND EXISTS (
        SELECT 1
        FROM public.contract_skill_bundles AS invalid_bundle
        WHERE invalid_bundle.id = ANY(v_invalid_bundle_ids)
          AND invalid_bundle.org_id = channel.org_id
          AND invalid_bundle.key = channel.key
      );

    IF v_channel_total_count IS DISTINCT FROM v_channel_count
      OR v_channel_count > v_invalid_identity_count
    THEN
      RAISE EXCEPTION 'WP03_PREVIEW_CANDIDATE_CHANNEL_IDENTITY_CONFLICT';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.contract_skill_bundle_channels AS channel
      JOIN public.contract_reviews AS review
        ON review.skill_bundle_id = channel.bundle_id
       AND review.rule_version = channel.bundle_version
      JOIN public.contract_analysis_jobs AS job
        ON job.review_id = review.id
       AND job.contract_id = review.contract_id
      WHERE channel.channel = 'preview_candidate'
        AND job.status IN ('preparing', 'queued', 'running')
        AND EXISTS (
          SELECT 1
          FROM public.contract_skill_bundles AS invalid_bundle
          WHERE invalid_bundle.id = ANY(v_invalid_bundle_ids)
            AND invalid_bundle.org_id = channel.org_id
            AND invalid_bundle.key = channel.key
        )
    ) THEN
      RAISE EXCEPTION 'WP03_PREVIEW_CANDIDATE_HAS_ACTIVE_REVIEW';
    END IF;

    DELETE FROM public.contract_skill_bundle_channels AS channel
    USING public.contract_skill_bundles AS candidate
    WHERE candidate.id = channel.bundle_id
      AND candidate.org_id = channel.org_id
      AND candidate.key = channel.key
      AND candidate.version = channel.bundle_version
      AND channel.channel = 'preview_candidate'
      AND candidate.status = 'published'
      AND candidate.is_current = false
      AND candidate.release_meta ->> 'stage' = 'candidate'
      AND candidate.release_meta ->> 'release_eligible' = 'false'
      AND candidate.output_schema ->> 'manifest_hash'
        = 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
      AND EXISTS (
        SELECT 1
        FROM public.contract_skill_bundles AS invalid_bundle
        WHERE invalid_bundle.id = ANY(v_invalid_bundle_ids)
          AND invalid_bundle.org_id = channel.org_id
          AND invalid_bundle.key = channel.key
      );
    GET DIAGNOSTICS v_deleted_channel_count = ROW_COUNT;
    IF v_deleted_channel_count IS DISTINCT FROM v_channel_count THEN
      RAISE EXCEPTION 'WP03_PREVIEW_CANDIDATE_CHANNEL_DELETE_MISMATCH';
    END IF;
  END IF;

  UPDATE public.contract_skill_bundles AS bundle
  SET
    is_current = false,
    updated_at = clock_timestamp()
  WHERE bundle.is_current = true
    AND bundle.status = 'published'
    AND bundle.compiled_identity_generation IS NULL
    AND (
      -- Historical bundles compiled from the quarantined R001-R015 rules.
      EXISTS (
        SELECT 1
        FROM unnest(bundle.rule_snapshot_ids) AS member(rule_snapshot_id)
        JOIN public.contract_rule_snapshots AS rule_snapshot
          ON rule_snapshot.id = member.rule_snapshot_id
         AND rule_snapshot.status = 'published'
        JOIN public.contract_rules_v2 AS rule
          ON rule.id = rule_snapshot.rule_id
         AND rule.org_id = bundle.org_id
        JOIN public.contract_rule_sets AS scenario
          ON scenario.id = rule.rule_set_id
         AND scenario.org_id = rule.org_id
        WHERE rule.code ~ '^R0(0[1-9]|1[0-5])$'
          AND rule.rule_contract IS NULL
          AND scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
          AND scenario.metadata ->> 'work_package' = 'WP03'
          AND scenario.metadata ->> 'membership_state'
            = 'canonical_rule_contract_confirmation_required'
          AND (
            rule_snapshot.config_snapshot -> 'rule_contract' IS NULL
            OR rule_snapshot.config_snapshot -> 'rule_contract' = 'null'::JSONB
          )
          AND EXISTS (
            SELECT 1
            FROM public.contract_rule_snapshots AS confirmation_draft
            WHERE confirmation_draft.rule_id = rule.id
              AND confirmation_draft.status = 'draft'
              AND confirmation_draft.config_snapshot
                    -> '_draft_origin' ->> 'work_package' = 'WP03'
              AND confirmation_draft.config_snapshot
                    -> '_draft_origin' ->> 'kind'
                    = 'canonical_rule_contract_confirmation'
          )
      )
      OR
      -- Historical bundles compiled from RuleSets that WP03 archived under an
      -- explicit projection status, including the controlled canary.
      EXISTS (
        SELECT 1
        FROM unnest(bundle.rule_set_snapshot_ids) AS member(rule_set_snapshot_id)
        JOIN public.contract_rule_set_snapshots AS rule_set_snapshot
          ON rule_set_snapshot.id = member.rule_set_snapshot_id
         AND rule_set_snapshot.org_id = bundle.org_id
         AND rule_set_snapshot.status = 'published'
        JOIN public.contract_rule_sets AS rule_set
          ON rule_set.id = rule_set_snapshot.rule_set_id
         AND rule_set.org_id = rule_set_snapshot.org_id
        WHERE rule_set.is_active = false
          AND rule_set.lifecycle_status = 'archived'
          AND rule_set.metadata -> 'wp03_projection_status' ->> 'state' IN (
            'superseded_category_shaped_ruleset',
            'controlled_acceptance_canary_archived'
          )
      )
    );
  GET DIAGNOSTICS v_demoted_bundle_count = ROW_COUNT;
  IF v_demoted_bundle_count IS DISTINCT FROM cardinality(v_invalid_bundle_ids) THEN
    RAISE EXCEPTION 'WP03_CURRENT_SKILL_BUNDLE_DEMOTION_MISMATCH';
  END IF;

  -- Fail closed if any current bundle still consumes the quarantined product
  -- projections. The assertion intentionally ignores generation so a future
  -- compiler regression cannot leave a generation=1 bundle current either.
  IF EXISTS (
    SELECT 1
    FROM public.contract_skill_bundles AS bundle
    WHERE bundle.is_current = true
      AND bundle.status = 'published'
      AND (
        EXISTS (
          SELECT 1
          FROM unnest(bundle.rule_snapshot_ids) AS member(rule_snapshot_id)
          JOIN public.contract_rule_snapshots AS rule_snapshot
            ON rule_snapshot.id = member.rule_snapshot_id
           AND rule_snapshot.status = 'published'
          JOIN public.contract_rules_v2 AS rule
            ON rule.id = rule_snapshot.rule_id
           AND rule.org_id = bundle.org_id
          JOIN public.contract_rule_sets AS scenario
            ON scenario.id = rule.rule_set_id
           AND scenario.org_id = rule.org_id
          WHERE rule.code ~ '^R0(0[1-9]|1[0-5])$'
            AND rule.rule_contract IS NULL
            AND scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
            AND scenario.metadata ->> 'work_package' = 'WP03'
            AND scenario.metadata ->> 'membership_state'
              = 'canonical_rule_contract_confirmation_required'
            AND (
              rule_snapshot.config_snapshot -> 'rule_contract' IS NULL
              OR rule_snapshot.config_snapshot -> 'rule_contract' = 'null'::JSONB
            )
            AND EXISTS (
              SELECT 1
              FROM public.contract_rule_snapshots AS confirmation_draft
              WHERE confirmation_draft.rule_id = rule.id
                AND confirmation_draft.status = 'draft'
                AND confirmation_draft.config_snapshot
                      -> '_draft_origin' ->> 'work_package' = 'WP03'
                AND confirmation_draft.config_snapshot
                      -> '_draft_origin' ->> 'kind'
                      = 'canonical_rule_contract_confirmation'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM unnest(bundle.rule_set_snapshot_ids) AS member(rule_set_snapshot_id)
          JOIN public.contract_rule_set_snapshots AS rule_set_snapshot
            ON rule_set_snapshot.id = member.rule_set_snapshot_id
           AND rule_set_snapshot.org_id = bundle.org_id
           AND rule_set_snapshot.status = 'published'
          JOIN public.contract_rule_sets AS rule_set
            ON rule_set.id = rule_set_snapshot.rule_set_id
           AND rule_set.org_id = rule_set_snapshot.org_id
          WHERE rule_set.is_active = false
            AND rule_set.lifecycle_status = 'archived'
            AND rule_set.metadata -> 'wp03_projection_status' ->> 'state' IN (
              'superseded_category_shaped_ruleset',
              'controlled_acceptance_canary_archived'
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'WP03_QUARANTINED_CURRENT_SKILL_BUNDLE_REMAINS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contract_skill_bundle_channels AS channel
    JOIN public.contract_skill_bundles AS candidate
      ON candidate.id = channel.bundle_id
     AND candidate.org_id = channel.org_id
     AND candidate.key = channel.key
     AND candidate.version = channel.bundle_version
    WHERE channel.channel = 'preview_candidate'
      AND candidate.status = 'published'
      AND candidate.is_current = false
      AND candidate.release_meta ->> 'stage' = 'candidate'
      AND candidate.release_meta ->> 'release_eligible' = 'false'
      AND candidate.output_schema ->> 'manifest_hash'
        = 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
      AND EXISTS (
        SELECT 1
        FROM public.contract_skill_bundles AS invalid_bundle
        WHERE invalid_bundle.id = ANY(v_invalid_bundle_ids)
          AND invalid_bundle.org_id = channel.org_id
          AND invalid_bundle.key = channel.key
      )
  ) THEN
    RAISE EXCEPTION 'WP03_PREVIEW_CANDIDATE_CHANNEL_REMAINS';
  END IF;
END;
$$;
