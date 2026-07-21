-- WP03 repairs the product hierarchy without inventing R001-R015 decisions.
--
-- The old data modeled one RuleSet per problem category. That reverses the
-- intended hierarchy: a RuleSet is a publishable business scenario, while
-- ProblemCategory only classifies problems inside it. R001-R015 also have no
-- user-confirmed rule_contract v1. Their current RuleSnapshots embed a stale
-- version and omit both problem_category_id and rule_contract.
--
-- Forward-only transition:
--   * keep every published RuleSnapshot and RuleSetSnapshot byte-for-byte;
--   * create one STANDARD_SALES_CONTRACT_REVIEW working RuleSet per org;
--   * move only the mutable R001-R015 projections into that scenario RuleSet;
--   * create new version-aligned draft snapshots explicitly awaiting business
--     confirmation (rule_contract remains NULL);
--   * archive only the obsolete category-shaped RuleSet projections while
--     retaining their current snapshot pointers for historical inspection;
--   * demote derived current SkillBundles that reference invalid snapshots.

DO $$
DECLARE
  v_org RECORD;
  v_scenario_set public.contract_rule_sets%ROWTYPE;
  v_rule public.contract_rules_v2%ROWTYPE;
  v_updated_rule public.contract_rules_v2%ROWTYPE;
  v_next_version INTEGER;
  v_old_rule_set_ids UUID[];
  v_affected_rule_ids UUID[];
  v_invalid_published_snapshot_ids UUID[];
  v_affected_legacy_set_snapshot_ids UUID[];
  v_problem_category_ids UUID[];
BEGIN
  FOR v_org IN
    SELECT DISTINCT rule.org_id
    FROM public.contract_rules_v2 AS rule
    WHERE rule.is_active = true
      AND rule.code ~ '^R0(0[1-9]|1[0-5])$'
      AND rule.rule_contract IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.contract_rule_snapshots AS migrated_draft
        WHERE migrated_draft.rule_id = rule.id
          AND migrated_draft.status = 'draft'
          AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'work_package' = 'WP03'
          AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'kind' = 'canonical_rule_contract_confirmation'
      )
    ORDER BY rule.org_id
  LOOP
    SELECT COALESCE(array_agg(DISTINCT rule.rule_set_id), ARRAY[]::UUID[])
    INTO v_old_rule_set_ids
    FROM public.contract_rules_v2 AS rule
    WHERE rule.org_id = v_org.org_id
      AND rule.is_active = true
      AND rule.code ~ '^R0(0[1-9]|1[0-5])$'
      AND rule.rule_contract IS NULL
      AND rule.rule_set_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.contract_rule_snapshots AS migrated_draft
        WHERE migrated_draft.rule_id = rule.id
          AND migrated_draft.status = 'draft'
          AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'work_package' = 'WP03'
          AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'kind' = 'canonical_rule_contract_confirmation'
      );

    SELECT COALESCE(array_agg(DISTINCT rule.problem_category_id), ARRAY[]::UUID[])
    INTO v_problem_category_ids
    FROM public.contract_rules_v2 AS rule
    WHERE rule.org_id = v_org.org_id
      AND rule.is_active = true
      AND rule.code ~ '^R0(0[1-9]|1[0-5])$'
      AND rule.rule_contract IS NULL
      AND rule.problem_category_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.contract_rule_snapshots AS migrated_draft
        WHERE migrated_draft.rule_id = rule.id
          AND migrated_draft.status = 'draft'
          AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'work_package' = 'WP03'
          AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'kind' = 'canonical_rule_contract_confirmation'
      );

    SELECT COALESCE(array_agg(DISTINCT rule_set.current_snapshot_id), ARRAY[]::UUID[])
    INTO v_affected_legacy_set_snapshot_ids
    FROM public.contract_rule_sets AS rule_set
    WHERE rule_set.org_id = v_org.org_id
      AND rule_set.id = ANY(v_old_rule_set_ids)
      AND rule_set.current_snapshot_id IS NOT NULL;

    -- A category-shaped legacy RuleSet may be retired only when every active
    -- member is part of this exact R001-R015/null-contract transition. A mixed
    -- set is evidence that the assumed product boundary is wrong, so fail the
    -- transaction instead of archiving unrelated rules.
    IF EXISTS (
      SELECT 1
      FROM public.contract_rules_v2 AS other_rule
      WHERE other_rule.org_id = v_org.org_id
        AND other_rule.rule_set_id = ANY(v_old_rule_set_ids)
        AND other_rule.is_active = true
        AND (
          other_rule.code ~ '^R0(0[1-9]|1[0-5])$'
          AND other_rule.rule_contract IS NULL
        ) IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'WP03_LEGACY_RULESET_MIXED_MEMBERSHIP:%', v_org.org_id;
    END IF;

    -- Never overwrite an independently created or already released scenario
    -- RuleSet. The transition may reuse only an exact, empty WP03 draft. Any
    -- member (including inactive rows), document, or historical snapshot is
    -- evidence that the same code already has another history, so fail closed.
    IF EXISTS (
      SELECT 1
      FROM public.contract_rule_sets AS existing_scenario
      WHERE existing_scenario.org_id = v_org.org_id
        AND existing_scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
        AND (
          existing_scenario.current_snapshot_id IS NULL
          AND existing_scenario.published_at IS NULL
          AND existing_scenario.published_by IS NULL
          AND existing_scenario.name = '标准销售合同审核'
          AND existing_scenario.description = '面向标准销售合同审核场景的发布边界；问题分类仅用于组织其中的具体规则。'
          AND existing_scenario.applicable_scenario = 'standard_sales_contract_review'
          AND existing_scenario.priority = 100
          AND existing_scenario.is_default = true
          AND existing_scenario.is_active = true
          AND existing_scenario.version = 1
          AND existing_scenario.lifecycle_status = 'needs_translation'
          AND existing_scenario.translation_status = 'needs_ai_translation'
          AND existing_scenario.release_note = 'WP03 重建场景规则集；R001-R015 待业务确认 rule_contract v1'
          AND existing_scenario.metadata ->> 'work_package' = 'WP03'
          AND existing_scenario.metadata ->> 'membership_state' = 'canonical_rule_contract_confirmation_required'
          AND existing_scenario.metadata ->> 'legacy_adapter_publish_forbidden' = 'true'
          AND NOT EXISTS (
            SELECT 1
            FROM public.contract_rules_v2 AS existing_member
            WHERE existing_member.org_id = existing_scenario.org_id
              AND existing_member.rule_set_id = existing_scenario.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.contract_rule_set_documents AS existing_document
            WHERE existing_document.org_id = existing_scenario.org_id
              AND existing_document.rule_set_id = existing_scenario.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.contract_rule_set_snapshots AS existing_snapshot
            WHERE existing_snapshot.org_id = existing_scenario.org_id
              AND existing_snapshot.rule_set_id = existing_scenario.id
          )
        ) IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'WP03_SCENARIO_RULESET_CONFLICT:%', v_org.org_id;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT snapshot.id ORDER BY snapshot.id), ARRAY[]::UUID[])
    INTO v_invalid_published_snapshot_ids
    FROM public.contract_rule_sets AS rule_set
    JOIN public.contract_rule_set_snapshots AS rule_set_snapshot
      ON rule_set_snapshot.id = rule_set.current_snapshot_id
     AND rule_set_snapshot.org_id = rule_set.org_id
     AND rule_set_snapshot.rule_set_id = rule_set.id
     AND rule_set_snapshot.status = 'published'
    CROSS JOIN LATERAL unnest(rule_set_snapshot.rule_snapshot_ids) AS member(snapshot_id)
    JOIN public.contract_rule_snapshots AS snapshot
      ON snapshot.id = member.snapshot_id
    JOIN public.contract_rules_v2 AS rule
      ON rule.id = snapshot.rule_id
     AND rule.org_id = rule_set.org_id
     AND rule.rule_set_id = rule_set.id
    WHERE rule.org_id = v_org.org_id
      AND rule.is_active = true
      AND rule.code ~ '^R0(0[1-9]|1[0-5])$'
      AND rule.rule_contract IS NULL
      AND snapshot.status = 'published'
      AND (
        snapshot.config_snapshot ->> 'version' IS DISTINCT FROM snapshot.version::TEXT
        OR NULLIF(snapshot.config_snapshot ->> 'problem_category_id', '') IS NULL
        OR snapshot.config_snapshot -> 'rule_contract' IS NULL
        OR snapshot.config_snapshot -> 'rule_contract' = 'null'::JSONB
      );

    IF cardinality(v_invalid_published_snapshot_ids) = 0 THEN
      -- Re-entry is excluded by the outer WP03-draft guard. Reaching this
      -- branch therefore means the eligible legacy projection no longer has
      -- the published evidence this migration was designed to quarantine.
      RAISE EXCEPTION 'WP03_EXPECTED_INVALID_PUBLISHED_SNAPSHOT_MISSING:%', v_org.org_id;
    END IF;

    INSERT INTO public.contract_rule_sets (
      org_id,
      name,
      code,
      description,
      applicable_scenario,
      priority,
      is_default,
      is_active,
      version,
      lifecycle_status,
      translation_status,
      published_at,
      published_by,
      release_note,
      metadata
    ) VALUES (
      v_org.org_id,
      '标准销售合同审核',
      'STANDARD_SALES_CONTRACT_REVIEW',
      '面向标准销售合同审核场景的发布边界；问题分类仅用于组织其中的具体规则。',
      'standard_sales_contract_review',
      100,
      true,
      true,
      1,
      'needs_translation',
      'needs_ai_translation',
      NULL,
      NULL,
      'WP03 重建场景规则集；R001-R015 待业务确认 rule_contract v1',
      jsonb_build_object(
        'work_package', 'WP03',
        'membership_state', 'canonical_rule_contract_confirmation_required',
        'legacy_adapter_publish_forbidden', true,
        'problem_category_ids', v_problem_category_ids,
        'historical_rule_set_ids', v_old_rule_set_ids,
        'historical_snapshots_preserved', true
      )
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      applicable_scenario = EXCLUDED.applicable_scenario,
      priority = EXCLUDED.priority,
      is_default = true,
      is_active = true,
      lifecycle_status = 'needs_translation',
      translation_status = 'needs_ai_translation',
      published_at = NULL,
      published_by = NULL,
      release_note = EXCLUDED.release_note,
      metadata = COALESCE(public.contract_rule_sets.metadata, '{}'::JSONB) || EXCLUDED.metadata,
      updated_at = clock_timestamp()
    RETURNING * INTO v_scenario_set;

    v_affected_rule_ids := ARRAY[]::UUID[];
    FOR v_rule IN
      SELECT rule.*
      FROM public.contract_rules_v2 AS rule
      WHERE rule.org_id = v_org.org_id
        AND rule.is_active = true
        AND rule.code ~ '^R0(0[1-9]|1[0-5])$'
        AND rule.rule_contract IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.contract_rule_snapshots AS migrated_draft
          WHERE migrated_draft.rule_id = rule.id
            AND migrated_draft.status = 'draft'
            AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'work_package' = 'WP03'
            AND migrated_draft.config_snapshot -> '_draft_origin' ->> 'kind' = 'canonical_rule_contract_confirmation'
        )
      ORDER BY rule.id
      FOR UPDATE
    LOOP
      SELECT GREATEST(
        COALESCE(MAX(snapshot.version), 0),
        COALESCE(v_rule.version, 0)
      ) + 1
      INTO v_next_version
      FROM public.contract_rule_snapshots AS snapshot
      WHERE snapshot.rule_id = v_rule.id;

      UPDATE public.contract_rules_v2
      SET
        rule_set_id = v_scenario_set.id,
        version = v_next_version,
        lifecycle_status = 'needs_translation',
        translation_status = 'needs_ai_translation',
        translation_notes = jsonb_build_array(jsonb_build_object(
          'code', 'WP03_CANONICAL_RULE_CONTRACT_CONFIRMATION_REQUIRED',
          'reason', 'Published snapshot lacks confirmed rule_contract v1 and cannot be upgraded from legacy fields automatically.',
          'required_action', 'Confirm business properties, deterministic decisions, missing-evidence outcome, and handling actions before RuleSet publication.',
          'observed_at', '2026-07-21T04:18:18Z'
        )),
        published_at = NULL,
        published_by = NULL,
        updated_at = clock_timestamp()
      WHERE id = v_rule.id
        AND org_id = v_rule.org_id
        AND version = v_rule.version
      RETURNING * INTO v_updated_rule;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'WP03_RULE_QUARANTINE_VERSION_CONFLICT:%', v_rule.code;
      END IF;

      INSERT INTO public.contract_rule_snapshots (
        rule_id,
        version,
        config_snapshot,
        released_by,
        released_at,
        release_note,
        status
      ) VALUES (
        v_updated_rule.id,
        v_updated_rule.version,
        to_jsonb(v_updated_rule) || jsonb_build_object(
          '_draft_origin', jsonb_build_object(
            'work_package', 'WP03',
            'kind', 'canonical_rule_contract_confirmation',
            'legacy_adapter_publish_forbidden', true,
            'invalid_published_snapshot_ids', v_invalid_published_snapshot_ids
          )
        ),
        NULL,
        NULL,
        'WP03 待业务确认：不得从旧 A/B/C 配置自动生成正式 rule_contract',
        'draft'
      );

      v_affected_rule_ids := array_append(v_affected_rule_ids, v_updated_rule.id);
    END LOOP;

    UPDATE public.contract_rule_sets AS old_set
    SET
      is_default = false,
      is_active = false,
      lifecycle_status = 'archived',
      metadata = COALESCE(old_set.metadata, '{}'::JSONB) || jsonb_build_object(
        'wp03_projection_status', jsonb_build_object(
          'state', 'superseded_category_shaped_ruleset',
          'superseded_by_rule_set_id', v_scenario_set.id,
          'historical_current_snapshot_preserved', true
        )
      ),
      updated_at = clock_timestamp()
    WHERE old_set.org_id = v_org.org_id
      AND old_set.id = ANY(v_old_rule_set_ids)
      AND old_set.id <> v_scenario_set.id;

    SELECT COALESCE(array_agg(rule.id ORDER BY rule.code), ARRAY[]::UUID[])
    INTO v_affected_rule_ids
    FROM public.contract_rules_v2 AS rule
    WHERE rule.org_id = v_org.org_id
      AND rule.rule_set_id = v_scenario_set.id
      AND rule.is_active = true
      AND rule.code ~ '^R0(0[1-9]|1[0-5])$';

    UPDATE public.contract_rule_sets AS scenario_set
    SET metadata = COALESCE(scenario_set.metadata, '{}'::JSONB) || jsonb_build_object(
      'rule_ids', v_affected_rule_ids,
      'rule_count', cardinality(v_affected_rule_ids)
    )
    WHERE scenario_set.id = v_scenario_set.id
      AND scenario_set.org_id = v_org.org_id;

    -- Bundle content remains byte-for-byte immutable. Only the mutable current
    -- pointer is removed, and only when the bundle explicitly names a
    -- quarantined RuleSnapshot or legacy RuleSetSnapshot.
    UPDATE public.contract_skill_bundles AS bundle
    SET is_current = false, updated_at = clock_timestamp()
    WHERE bundle.org_id = v_org.org_id
      AND bundle.is_current = true
      AND (
        bundle.rule_snapshot_ids && v_invalid_published_snapshot_ids
        OR bundle.rule_set_snapshot_ids && v_affected_legacy_set_snapshot_ids
      );
  END LOOP;
END;
$$;

-- Remove the known control-plane acceptance canary from product consumption.
-- Identity is derived from auditable code/metadata/current-snapshot relations;
-- generated UUIDs are deliberately not hard-coded. Any partial collision is a
-- stop condition rather than permission to archive an ambiguous asset.
DO $$
DECLARE
  v_canary_set public.contract_rule_sets%ROWTYPE;
  v_canary_rule public.contract_rules_v2%ROWTYPE;
  v_canary_set_snapshot public.contract_rule_set_snapshots%ROWTYPE;
  v_canary_rule_snapshot_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contract_rule_sets AS candidate
    WHERE candidate.code = 'F009_ACCEPT_29685647'
      AND candidate.is_active = true
      AND (
        candidate.metadata ->> 'created_from' IS DISTINCT FROM 'config_center_ruleset_api'
        OR candidate.current_snapshot_id IS NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.contract_rules_v2 AS candidate_rule
    WHERE candidate_rule.code = 'MIN_COMMERCIAL_29685647'
      AND candidate_rule.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.contract_rule_sets AS candidate_set
        WHERE candidate_set.id = candidate_rule.rule_set_id
          AND candidate_set.org_id = candidate_rule.org_id
          AND candidate_set.code = 'F009_ACCEPT_29685647'
          AND candidate_set.metadata ->> 'created_from' = 'config_center_ruleset_api'
          AND candidate_set.current_snapshot_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'WP03_CANARY_IDENTITY_CONFLICT';
  END IF;

  FOR v_canary_set IN
    SELECT candidate.*
    FROM public.contract_rule_sets AS candidate
    WHERE candidate.code = 'F009_ACCEPT_29685647'
      AND candidate.metadata ->> 'created_from' = 'config_center_ruleset_api'
      AND candidate.current_snapshot_id IS NOT NULL
      AND candidate.is_active = true
    ORDER BY candidate.org_id, candidate.id
    FOR UPDATE
  LOOP
    SELECT snapshot.* INTO v_canary_set_snapshot
    FROM public.contract_rule_set_snapshots AS snapshot
    WHERE snapshot.id = v_canary_set.current_snapshot_id
      AND snapshot.org_id = v_canary_set.org_id
      AND snapshot.rule_set_id = v_canary_set.id
      AND snapshot.status = 'published';
    IF NOT FOUND THEN RAISE EXCEPTION 'WP03_CANARY_CURRENT_SNAPSHOT_INVALID'; END IF;

    SELECT candidate_rule.* INTO v_canary_rule
    FROM public.contract_rules_v2 AS candidate_rule
    WHERE candidate_rule.org_id = v_canary_set.org_id
      AND candidate_rule.rule_set_id = v_canary_set.id
      AND candidate_rule.code = 'MIN_COMMERCIAL_29685647'
      AND candidate_rule.is_active = true
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WP03_CANARY_RULE_MISSING'; END IF;
    IF EXISTS (
      SELECT 1
      FROM public.contract_rules_v2 AS other_rule
      WHERE other_rule.org_id = v_canary_set.org_id
        AND other_rule.rule_set_id = v_canary_set.id
        AND other_rule.is_active = true
        AND other_rule.id <> v_canary_rule.id
    ) THEN
      RAISE EXCEPTION 'WP03_CANARY_MIXED_MEMBERSHIP';
    END IF;

    IF COALESCE(cardinality(v_canary_set_snapshot.rule_snapshot_ids), 0) <> 1
      OR cardinality(ARRAY(
        SELECT DISTINCT member.snapshot_id
        FROM unnest(v_canary_set_snapshot.rule_snapshot_ids) AS member(snapshot_id)
      )) <> 1
    THEN
      RAISE EXCEPTION 'WP03_CANARY_MIXED_SNAPSHOT_MEMBERSHIP';
    END IF;

    SELECT COALESCE(array_agg(member.snapshot_id), ARRAY[]::UUID[])
    INTO v_canary_rule_snapshot_ids
    FROM unnest(v_canary_set_snapshot.rule_snapshot_ids) AS member(snapshot_id)
    JOIN public.contract_rule_snapshots AS rule_snapshot
      ON rule_snapshot.id = member.snapshot_id
     AND rule_snapshot.rule_id = v_canary_rule.id
     AND rule_snapshot.status = 'published';
    IF cardinality(v_canary_rule_snapshot_ids) <> 1 THEN
      RAISE EXCEPTION 'WP03_CANARY_RULE_SNAPSHOT_INVALID';
    END IF;

    UPDATE public.contract_rules_v2
    SET is_active = false, lifecycle_status = 'archived', updated_at = clock_timestamp()
    WHERE id = v_canary_rule.id AND org_id = v_canary_rule.org_id;

    UPDATE public.contract_rule_sets
    SET
      is_active = false,
      is_default = false,
      lifecycle_status = 'archived',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'wp03_projection_status', jsonb_build_object(
          'state', 'controlled_acceptance_canary_archived',
          'historical_snapshots_and_test_runs_preserved', true
        )
      ),
      updated_at = clock_timestamp()
    WHERE id = v_canary_set.id AND org_id = v_canary_set.org_id;

    UPDATE public.contract_skill_bundles AS bundle
    SET is_current = false, updated_at = clock_timestamp()
    WHERE bundle.org_id = v_canary_set.org_id
      AND bundle.is_current = true
      AND (
        bundle.rule_snapshot_ids && v_canary_rule_snapshot_ids
        OR bundle.rule_set_snapshot_ids && ARRAY[v_canary_set_snapshot.id]
      );
  END LOOP;
END;
$$;

-- The original empty `default` container has no business meaning. Archive it
-- only under an exact empty-draft identity; a similarly named real asset is a
-- conflict and stops the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contract_rule_sets AS empty_default
    WHERE empty_default.is_active = true
      AND empty_default.code = 'default'
      AND EXISTS (
        SELECT 1
        FROM public.contract_rule_sets AS wp03_scenario
        WHERE wp03_scenario.org_id = empty_default.org_id
          AND wp03_scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
          AND wp03_scenario.metadata ->> 'work_package' = 'WP03'
      )
      AND (
        empty_default.name = '默认规则集'
        AND empty_default.description = '系统预置的标准合同审核规则'
        AND empty_default.applicable_scenario = '通用合同审核'
        AND empty_default.priority = 0
        AND empty_default.is_default = true
        AND empty_default.lifecycle_status = 'draft'
        AND empty_default.translation_status = 'not_started'
        AND empty_default.current_snapshot_id IS NULL
        AND empty_default.published_at IS NULL
        AND empty_default.metadata = '{}'::JSONB
        AND NOT EXISTS (
          SELECT 1 FROM public.contract_rules_v2 AS member
          WHERE member.org_id = empty_default.org_id
            AND member.rule_set_id = empty_default.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.contract_rule_set_documents AS document
          WHERE document.org_id = empty_default.org_id
            AND document.rule_set_id = empty_default.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.contract_rule_set_snapshots AS snapshot
          WHERE snapshot.org_id = empty_default.org_id
            AND snapshot.rule_set_id = empty_default.id
        )
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'WP03_EMPTY_DEFAULT_IDENTITY_CONFLICT';
  END IF;

  UPDATE public.contract_rule_sets AS empty_default
  SET
    is_active = false,
    is_default = false,
    lifecycle_status = 'archived',
    metadata = jsonb_build_object(
      'wp03_projection_status', jsonb_build_object(
        'state', 'empty_legacy_default_archived',
        'no_business_members_or_documents', true
      )
    ),
    updated_at = clock_timestamp()
  WHERE empty_default.is_active = true
    AND empty_default.code = 'default'
    AND EXISTS (
      SELECT 1
      FROM public.contract_rule_sets AS wp03_scenario
      WHERE wp03_scenario.org_id = empty_default.org_id
        AND wp03_scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
        AND wp03_scenario.metadata ->> 'work_package' = 'WP03'
    )
    AND empty_default.name = '默认规则集'
    AND empty_default.description = '系统预置的标准合同审核规则'
    AND empty_default.applicable_scenario = '通用合同审核'
    AND empty_default.priority = 0
    AND empty_default.is_default = true
    AND empty_default.lifecycle_status = 'draft'
    AND empty_default.translation_status = 'not_started'
    AND empty_default.current_snapshot_id IS NULL
    AND empty_default.published_at IS NULL
    AND empty_default.metadata = '{}'::JSONB
    AND NOT EXISTS (
      SELECT 1 FROM public.contract_rules_v2 AS member
      WHERE member.org_id = empty_default.org_id
        AND member.rule_set_id = empty_default.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.contract_rule_set_documents AS document
      WHERE document.org_id = empty_default.org_id
        AND document.rule_set_id = empty_default.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.contract_rule_set_snapshots AS snapshot
      WHERE snapshot.org_id = empty_default.org_id
        AND snapshot.rule_set_id = empty_default.id
    );

  IF EXISTS (
    SELECT 1
    FROM public.contract_rule_sets AS scenario
    WHERE scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'
      AND scenario.is_active = true
      AND scenario.metadata ->> 'work_package' = 'WP03'
    GROUP BY scenario.org_id
    HAVING (
      SELECT count(*)
      FROM public.contract_rule_sets AS active_default
      WHERE active_default.org_id = scenario.org_id
        AND active_default.is_active = true
        AND active_default.is_default = true
    ) <> 1
  ) THEN
    RAISE EXCEPTION 'WP03_ACTIVE_DEFAULT_CARDINALITY_INVALID';
  END IF;
END;
$$;

-- Existing SkillBundles may already be bound to ReviewRuns and are immutable,
-- including duplicate historical rows. Add the generation column without a
-- default first so every existing row remains NULL, then set the default only
-- for future inserts. The partial identity gate therefore resolves new races
-- without rewriting or conflicting with any historical bundle.
ALTER TABLE public.contract_skill_bundles
  ADD COLUMN IF NOT EXISTS compiled_identity_generation INTEGER;

-- Store the normalized identity only for new generations. Historical rows stay
-- NULL and cannot be reused under a coincidentally equal legacy hash.
ALTER TABLE public.contract_skill_bundles
  ADD COLUMN IF NOT EXISTS compiled_identity_payload JSONB;

ALTER TABLE public.contract_skill_bundles
  ALTER COLUMN compiled_identity_generation SET DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_skill_bundles_compiled_identity
  ON public.contract_skill_bundles (
    org_id,
    key,
    status,
    compiled_hash,
    compiled_identity_generation
  )
  WHERE status IN ('compiled', 'published')
    AND compiled_identity_generation = 1;

-- Persist/reuse a bundle and move the formal current pointer in one database
-- transaction. The advisory transaction lock closes the gap between clearing
-- the previous current row and inserting/promoting the next one; the future-row
-- unique identity is a second guard against an identical concurrent compile.
CREATE OR REPLACE FUNCTION public.persist_contract_skill_bundle_v1(
  p_org_id UUID,
  p_key TEXT,
  p_status TEXT,
  p_compiled_hash TEXT,
  p_payload JSONB,
  p_requested_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.contract_skill_bundles%ROWTYPE;
  v_inserted public.contract_skill_bundles%ROWTYPE;
  v_next_version INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_key TEXT := btrim(p_key);
  v_rule_snapshot_ids UUID[];
  v_rule_set_snapshot_ids UUID[];
  v_template_snapshot_ids UUID[];
  v_document_snapshot_ids UUID[];
  v_output_schema JSONB;
  v_model_policy_id UUID;
  v_eval_case_ids TEXT[];
  v_release_meta JSONB;
  v_identity_release_meta JSONB;
  v_compiled_from JSONB;
  v_identity_payload JSONB;
BEGIN
  IF p_status NOT IN ('compiled', 'published') THEN
    RAISE EXCEPTION 'SKILL_BUNDLE_STATUS_INVALID';
  END IF;
  IF COALESCE(v_key, '') = ''
    OR p_key IS DISTINCT FROM v_key
    OR p_compiled_hash !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(COALESCE(p_payload -> 'rule_snapshot_ids', '[]'::JSONB)) IS DISTINCT FROM 'array'
    OR jsonb_typeof(COALESCE(p_payload -> 'rule_set_snapshot_ids', '[]'::JSONB)) IS DISTINCT FROM 'array'
    OR jsonb_typeof(COALESCE(p_payload -> 'template_snapshot_ids', '[]'::JSONB)) IS DISTINCT FROM 'array'
    OR jsonb_typeof(COALESCE(p_payload -> 'document_snapshot_ids', '[]'::JSONB)) IS DISTINCT FROM 'array'
    OR jsonb_typeof(COALESCE(p_payload -> 'output_schema', '{}'::JSONB)) IS DISTINCT FROM 'object'
    OR jsonb_typeof(COALESCE(p_payload -> 'eval_case_ids', '[]'::JSONB)) IS DISTINCT FROM 'array'
    OR jsonb_typeof(COALESCE(p_payload -> 'release_meta', '{}'::JSONB)) IS DISTINCT FROM 'object'
    OR jsonb_typeof(COALESCE(p_payload -> 'compiled_from', '{}'::JSONB)) IS DISTINCT FROM 'object'
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_payload) AS payload_key(key)
      WHERE payload_key.key NOT IN (
        'rule_snapshot_ids',
        'rule_set_snapshot_ids',
        'template_snapshot_ids',
        'document_snapshot_ids',
        'output_schema',
        'model_policy_id',
        'eval_case_ids',
        'release_meta',
        'compiled_from'
      )
    )
  THEN
    RAISE EXCEPTION 'SKILL_BUNDLE_IDENTITY_INVALID';
  END IF;
  IF p_status = 'published'
    AND (
      p_payload -> 'release_meta' ->> 'official_review_allowed' IS DISTINCT FROM 'true'
      OR p_payload -> 'compiled_from' -> 'rule_translation_gate' ->> 'status' IS DISTINCT FROM 'ready'
      OR p_payload -> 'compiled_from' -> 'rule_set_snapshot_gate' ->> 'status' IS DISTINCT FROM 'ready'
      OR p_payload -> 'compiled_from' -> 'rule_set_document_gate' ->> 'status' IS DISTINCT FROM 'ready'
      OR p_payload -> 'compiled_from' -> 'eval_results' ->> 'rule_acceptance_status' IS DISTINCT FROM 'passed'
    )
  THEN
    RAISE EXCEPTION 'SKILL_BUNDLE_FORMAL_GATE_INVALID';
  END IF;

  v_rule_snapshot_ids := ARRAY(
    SELECT item.value::UUID
    FROM jsonb_array_elements_text(COALESCE(p_payload -> 'rule_snapshot_ids', '[]'::JSONB)) AS item(value)
  );
  v_rule_set_snapshot_ids := ARRAY(
    SELECT item.value::UUID
    FROM jsonb_array_elements_text(COALESCE(p_payload -> 'rule_set_snapshot_ids', '[]'::JSONB)) AS item(value)
  );
  v_template_snapshot_ids := ARRAY(
    SELECT item.value::UUID
    FROM jsonb_array_elements_text(COALESCE(p_payload -> 'template_snapshot_ids', '[]'::JSONB)) AS item(value)
  );
  v_document_snapshot_ids := ARRAY(
    SELECT item.value::UUID
    FROM jsonb_array_elements_text(COALESCE(p_payload -> 'document_snapshot_ids', '[]'::JSONB)) AS item(value)
  );
  v_output_schema := COALESCE(p_payload -> 'output_schema', '{}'::JSONB);
  v_model_policy_id := NULLIF(p_payload ->> 'model_policy_id', '')::UUID;
  v_eval_case_ids := ARRAY(
    SELECT item.value
    FROM jsonb_array_elements_text(COALESCE(p_payload -> 'eval_case_ids', '[]'::JSONB)) AS item(value)
  );
  v_release_meta := COALESCE(p_payload -> 'release_meta', '{}'::JSONB);
  -- Actor and wall-clock facts remain audit fields on the row. Every other
  -- release_meta field is content identity and must match on reuse.
  v_identity_release_meta := v_release_meta
    - 'compiled_by'
    - 'requested_by'
    - 'compiled_at'
    - 'published_at'
    - 'created_at'
    - 'updated_at';
  v_compiled_from := COALESCE(p_payload -> 'compiled_from', '{}'::JSONB);
  v_identity_payload := jsonb_build_object(
    'rule_snapshot_ids', to_jsonb(v_rule_snapshot_ids),
    'rule_set_snapshot_ids', to_jsonb(v_rule_set_snapshot_ids),
    'template_snapshot_ids', to_jsonb(v_template_snapshot_ids),
    'document_snapshot_ids', to_jsonb(v_document_snapshot_ids),
    'output_schema', v_output_schema,
    'model_policy_id', to_jsonb(v_model_policy_id),
    'eval_case_ids', to_jsonb(v_eval_case_ids),
    'release_meta', v_identity_release_meta,
    'compiled_from', v_compiled_from
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':' || v_key, 0)
  );

  SELECT bundle.* INTO v_existing
  FROM public.contract_skill_bundles AS bundle
  WHERE bundle.org_id = p_org_id
    AND bundle.key = v_key
    AND bundle.status = p_status
    AND bundle.compiled_hash = p_compiled_hash
    AND bundle.compiled_identity_generation = 1
  ORDER BY bundle.version DESC, bundle.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.compiled_identity_payload IS DISTINCT FROM v_identity_payload
      OR to_jsonb(v_existing.rule_snapshot_ids) IS DISTINCT FROM to_jsonb(v_rule_snapshot_ids)
      OR to_jsonb(v_existing.rule_set_snapshot_ids) IS DISTINCT FROM to_jsonb(v_rule_set_snapshot_ids)
      OR to_jsonb(v_existing.template_snapshot_ids) IS DISTINCT FROM to_jsonb(v_template_snapshot_ids)
      OR to_jsonb(v_existing.document_snapshot_ids) IS DISTINCT FROM to_jsonb(v_document_snapshot_ids)
      OR v_existing.output_schema IS DISTINCT FROM v_output_schema
      OR v_existing.model_policy_id IS DISTINCT FROM v_model_policy_id
      OR to_jsonb(v_existing.eval_case_ids) IS DISTINCT FROM to_jsonb(v_eval_case_ids)
      OR (v_existing.release_meta
          - 'compiled_by' - 'requested_by' - 'compiled_at'
          - 'published_at' - 'created_at' - 'updated_at') IS DISTINCT FROM v_identity_release_meta
      OR v_existing.compiled_from IS DISTINCT FROM v_compiled_from
    THEN
      RAISE EXCEPTION 'SKILL_BUNDLE_HASH_CONTENT_MISMATCH';
    END IF;
    IF p_status = 'published' AND v_existing.is_current IS NOT TRUE THEN
      UPDATE public.contract_skill_bundles AS current_bundle
      SET is_current = false, updated_at = v_now
      WHERE current_bundle.org_id = p_org_id
        AND current_bundle.key = v_key
        AND current_bundle.status = 'published'
        AND current_bundle.is_current = true
        AND current_bundle.id <> v_existing.id;

      UPDATE public.contract_skill_bundles AS reusable_bundle
      SET is_current = true, updated_at = v_now
      WHERE reusable_bundle.id = v_existing.id
      RETURNING * INTO v_existing;
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT COALESCE(MAX(bundle.version), 0) + 1
  INTO v_next_version
  FROM public.contract_skill_bundles AS bundle
  WHERE bundle.org_id = p_org_id AND bundle.key = v_key;

  IF p_status = 'published' THEN
    UPDATE public.contract_skill_bundles AS current_bundle
    SET is_current = false, updated_at = v_now
    WHERE current_bundle.org_id = p_org_id
      AND current_bundle.key = v_key
      AND current_bundle.status = 'published'
      AND current_bundle.is_current = true;
  END IF;

  INSERT INTO public.contract_skill_bundles (
    org_id,
    key,
    version,
    status,
    is_current,
    rule_snapshot_ids,
    rule_set_snapshot_ids,
    template_snapshot_ids,
    document_snapshot_ids,
    output_schema,
    model_policy_id,
    eval_case_ids,
    release_meta,
    compiled_from,
    compiled_hash,
    compiled_identity_generation,
    compiled_identity_payload,
    created_by,
    published_by,
    compiled_at,
    published_at
  ) VALUES (
    p_org_id,
    v_key,
    v_next_version,
    p_status,
    p_status = 'published',
    v_rule_snapshot_ids,
    v_rule_set_snapshot_ids,
    v_template_snapshot_ids,
    v_document_snapshot_ids,
    v_output_schema,
    v_model_policy_id,
    v_eval_case_ids,
    v_release_meta,
    v_compiled_from,
    p_compiled_hash,
    1,
    v_identity_payload,
    p_requested_by,
    CASE WHEN p_status = 'published' THEN p_requested_by ELSE NULL END,
    v_now,
    CASE WHEN p_status = 'published' THEN v_now ELSE NULL END
  )
  RETURNING * INTO v_inserted;

  RETURN to_jsonb(v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.persist_contract_skill_bundle_v1(
  UUID, TEXT, TEXT, TEXT, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_contract_skill_bundle_v1(
  UUID, TEXT, TEXT, TEXT, JSONB, UUID
) TO service_role;

-- Rebind unchanged published members to the exact accepted draft recorded
-- in immutable release evidence. A later RuleSet publication can therefore
-- reuse the unchanged members' frozen acceptance matrix while every changed
-- member must still present a complete current-version draft matrix.
CREATE OR REPLACE FUNCTION public.publish_contract_rule_set_v1(
  p_org_id UUID,
  p_rule_set_id UUID,
  p_user_id UUID,
  p_release_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_set public.contract_rule_sets%ROWTYPE;
  v_rule public.contract_rules_v2%ROWTYPE;
  v_rule_count INTEGER := 0;
  v_snapshot_id UUID;
  v_acceptance_snapshot_id UUID;
  v_is_new_rule_release BOOLEAN;
  v_snapshot_ids UUID[] := ARRAY[]::UUID[];
  v_current_rule_snapshot_ids UUID[] := ARRAY[]::UUID[];
  v_set_version INTEGER;
  v_set_snapshot_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_previous_document_ids UUID[] := ARRAY[]::UUID[];
  v_previous_test_results JSONB := '{}'::JSONB;
  v_rule_test_results JSONB;
  v_test_results JSONB := '{}'::jsonb;
  v_problem_categories JSONB := '[]'::jsonb;
  v_rule_contract_sha256 TEXT;
  v_release_contract_sha256 TEXT;
  v_release_evaluator_revision TEXT;
  v_has_unit BOOLEAN;
  v_requires_value_conflict BOOLEAN;
BEGIN
  SELECT * INTO v_set
  FROM public.contract_rule_sets
  WHERE id = p_rule_set_id AND org_id = p_org_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RULE_SET_NOT_FOUND'; END IF;

  IF v_set.current_snapshot_id IS NOT NULL THEN
    SELECT
      COALESCE(snapshot.document_snapshot_ids, ARRAY[]::UUID[]),
      COALESCE(snapshot.rule_snapshot_ids, ARRAY[]::UUID[]),
      COALESCE(snapshot.test_results, '{}'::JSONB)
    INTO v_previous_document_ids, v_current_rule_snapshot_ids, v_previous_test_results
    FROM public.contract_rule_set_snapshots AS snapshot
    WHERE snapshot.id = v_set.current_snapshot_id
      AND snapshot.rule_set_id = p_rule_set_id
      AND snapshot.org_id = p_org_id
      AND snapshot.status = 'published';
    IF NOT FOUND THEN RAISE EXCEPTION 'RULE_SET_CURRENT_SNAPSHOT_INVALID'; END IF;
    IF v_previous_test_results ->> 'gate' IS DISTINCT FROM 'snapshot_bound_latest_asserted_rule_matrix'
      OR jsonb_typeof(v_previous_test_results -> 'rule_runs') IS DISTINCT FROM 'object'
      OR COALESCE(v_previous_test_results ->> 'rule_count', '') !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION 'RULE_SET_FROZEN_ACCEPTANCE_INVALID';
    END IF;
    IF (v_previous_test_results ->> 'rule_count')::INTEGER
      IS DISTINCT FROM cardinality(v_current_rule_snapshot_ids)
    THEN
      RAISE EXCEPTION 'RULE_SET_FROZEN_ACCEPTANCE_INVALID';
    END IF;
  ELSIF v_set.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'RULE_SET_CURRENT_SNAPSHOT_MISSING';
  END IF;
  v_previous_document_ids := COALESCE(v_previous_document_ids, ARRAY[]::UUID[]);
  v_current_rule_snapshot_ids := COALESCE(v_current_rule_snapshot_ids, ARRAY[]::UUID[]);
  FOR v_rule IN
    SELECT * FROM public.contract_rules_v2
    WHERE org_id = p_org_id AND rule_set_id = p_rule_set_id AND is_active = true
    ORDER BY code
    FOR UPDATE
  LOOP
    v_rule_count := v_rule_count + 1;
    v_snapshot_id := NULL;
    v_acceptance_snapshot_id := NULL;
    v_is_new_rule_release := false;
    v_release_contract_sha256 := NULL;
    v_release_evaluator_revision := NULL;

    IF v_rule.lifecycle_status = 'ready_to_publish' AND v_rule.translation_status = 'ready' THEN
      IF v_rule.problem_category_id IS NULL OR v_rule.rule_contract IS NULL THEN
        RAISE EXCEPTION 'RULE_CANONICAL_CONTRACT_MISSING:%', v_rule.code;
      END IF;

      SELECT snapshot.id INTO v_acceptance_snapshot_id
      FROM public.contract_rule_snapshots snapshot
      WHERE snapshot.rule_id = v_rule.id
        AND snapshot.version = v_rule.version
        AND snapshot.status = 'draft'
        AND snapshot.config_snapshot -> 'rule_contract' = v_rule.rule_contract
      ORDER BY snapshot.created_at DESC
      LIMIT 1
      FOR UPDATE;
      IF v_acceptance_snapshot_id IS NULL THEN RAISE EXCEPTION 'RULE_DRAFT_SNAPSHOT_MISSING:%', v_rule.code; END IF;
      v_is_new_rule_release := true;
    ELSIF v_rule.lifecycle_status = 'published'
      AND v_rule.translation_status = 'ready'
      AND v_rule.published_at IS NOT NULL THEN
      IF v_rule.problem_category_id IS NULL OR v_rule.rule_contract IS NULL THEN
        RAISE EXCEPTION 'RULE_CANONICAL_CONTRACT_MISSING:%', v_rule.code;
      END IF;
      SELECT snapshot.id INTO v_snapshot_id
      FROM public.contract_rule_snapshots snapshot
      WHERE snapshot.id = ANY(v_current_rule_snapshot_ids)
        AND snapshot.rule_id = v_rule.id
        AND snapshot.version = v_rule.version
        AND snapshot.status = 'published'
        AND snapshot.config_snapshot -> 'rule_contract' = v_rule.rule_contract
      LIMIT 1;
      IF v_snapshot_id IS NULL THEN RAISE EXCEPTION 'RULE_PUBLISHED_SNAPSHOT_MISSING:%', v_rule.code; END IF;

      SELECT
        NULLIF(snapshot.config_snapshot -> '_release_evidence' ->> 'accepted_draft_snapshot_id', '')::UUID,
        NULLIF(snapshot.config_snapshot -> '_release_evidence' ->> 'rule_contract_sha256', ''),
        NULLIF(snapshot.config_snapshot -> '_release_evidence' ->> 'evaluator_revision', '')
      INTO
        v_acceptance_snapshot_id,
        v_release_contract_sha256,
        v_release_evaluator_revision
      FROM public.contract_rule_snapshots AS snapshot
      WHERE snapshot.id = v_snapshot_id;

      IF v_acceptance_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'RULE_PUBLISHED_ACCEPTANCE_BINDING_MISSING:%', v_rule.code;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.contract_rule_snapshots AS accepted_draft
        WHERE accepted_draft.id = v_acceptance_snapshot_id
          AND accepted_draft.rule_id = v_rule.id
          AND accepted_draft.version = v_rule.version
          AND accepted_draft.status = 'draft'
          AND accepted_draft.config_snapshot -> 'rule_contract' = v_rule.rule_contract
      ) THEN
        RAISE EXCEPTION 'RULE_PUBLISHED_ACCEPTANCE_DRAFT_INVALID:%', v_rule.code;
      END IF;
    ELSE
      RAISE EXCEPTION 'RULE_NOT_READY:%', v_rule.code;
    END IF;

    v_rule_contract_sha256 := encode(
      extensions.digest(
        convert_to(public.canonical_jsonb_text_v1(v_rule.rule_contract), 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    IF NOT v_is_new_rule_release AND (
      v_release_contract_sha256 IS DISTINCT FROM v_rule_contract_sha256
      OR v_release_evaluator_revision IS DISTINCT FROM 'rule-contract-v1-20260720'
    ) THEN
      RAISE EXCEPTION 'RULE_PUBLISHED_ACCEPTANCE_BINDING_INVALID:%', v_rule.code;
    END IF;

    IF v_is_new_rule_release THEN
      -- A changed member must pass the latest complete matrix bound to its
      -- exact current draft. Historical success never carries over a change.
      SELECT COALESCE(jsonb_agg(to_jsonb(frozen_run) ORDER BY frozen_run.case_kind), '[]'::jsonb)
      INTO v_rule_test_results
      FROM (
        SELECT *
        FROM (
          SELECT DISTINCT ON (test_run.case_kind, COALESCE(test_run.expected_decision_id, ''))
            test_run.id,
            test_run.case_kind,
            test_run.expected_status,
            test_run.expected_outcome,
            test_run.expected_decision_id,
            test_run.assertion_passed,
            test_run.result_status,
            test_run.outcome,
            test_run.source_sha256,
            test_run.rule_snapshot_id,
            test_run.rule_contract_sha256,
            test_run.evaluator_revision,
            test_run.created_at
          FROM public.contract_rule_test_runs AS test_run
          WHERE test_run.org_id = p_org_id
            AND test_run.rule_id = v_rule.id
            AND test_run.rule_version = v_rule.version
            AND test_run.case_kind <> 'legacy_unasserted'
            AND test_run.rule_snapshot_id = v_acceptance_snapshot_id
            AND test_run.rule_contract_sha256 = v_rule_contract_sha256
            AND test_run.evaluator_revision = 'rule-contract-v1-20260720'
          ORDER BY
            test_run.case_kind,
            COALESCE(test_run.expected_decision_id, ''),
            test_run.created_at DESC,
            test_run.id DESC
        ) AS latest_run
        WHERE latest_run.assertion_passed = true
      ) AS frozen_run;
    ELSE
      -- An unchanged member reuses only the matrix frozen by the current
      -- immutable RuleSetSnapshot. Appending, deleting or failing live test
      -- rows after publication cannot rewrite historical acceptance truth.
      v_rule_test_results := COALESCE(
        v_previous_test_results -> 'rule_runs' -> v_rule.id::TEXT,
        '[]'::JSONB
      );

      IF jsonb_typeof(v_rule_test_results) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'RULE_FROZEN_ACCEPTANCE_INVALID:%', v_rule.code;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_rule_test_results) AS frozen_run
        WHERE frozen_run ->> 'rule_snapshot_id' IS DISTINCT FROM v_acceptance_snapshot_id::TEXT
          OR frozen_run ->> 'rule_contract_sha256' IS DISTINCT FROM v_rule_contract_sha256
          OR frozen_run ->> 'evaluator_revision' IS DISTINCT FROM 'rule-contract-v1-20260720'
          OR frozen_run ->> 'assertion_passed' IS DISTINCT FROM 'true'
      ) THEN
        RAISE EXCEPTION 'RULE_FROZEN_ACCEPTANCE_INVALID:%', v_rule.code;
      END IF;
    END IF;

    -- Every configured decision branch is an acceptance obligation. A generic
    -- "some risk passed" record cannot prove a multi-decision rule.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_rule.rule_contract -> 'decisions') AS decision
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_rule_test_results) AS test_run
        WHERE test_run ->> 'case_kind' = CASE
            WHEN decision ->> 'outcome' = 'pass' THEN 'pass' ELSE 'risk'
          END
          AND test_run ->> 'expected_decision_id' = decision ->> 'id'
          AND test_run ->> 'expected_status' = 'decided'
          AND test_run ->> 'expected_outcome' = decision ->> 'outcome'
      )
    ) THEN
      RAISE EXCEPTION 'RULE_TEST_DECISION_MATRIX_MISSING:%', v_rule.code;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rule_test_results) AS test_run
      WHERE test_run ->> 'case_kind' = 'missing_evidence'
        AND test_run ->> 'expected_status' = 'missing_evidence'
        AND test_run ->> 'expected_outcome' = v_rule.rule_contract ->> 'missing_evidence_outcome'
    ) THEN
      RAISE EXCEPTION 'RULE_TEST_MISSING_EVIDENCE_MISSING:%', v_rule.code;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rule.rule_contract -> 'properties') property
      WHERE property ->> 'type' <> 'text'
        AND (
          property ->> 'type' <> 'enum'
          OR jsonb_array_length(COALESCE(property -> 'options', '[]'::jsonb)) >= 2
        )
    ) INTO v_requires_value_conflict;
    IF v_requires_value_conflict AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rule_test_results) AS test_run
      WHERE test_run ->> 'case_kind' = 'value_conflict'
        AND test_run ->> 'expected_status' = 'missing_evidence'
        AND test_run ->> 'expected_outcome' = v_rule.rule_contract ->> 'missing_evidence_outcome'
    ) THEN
      RAISE EXCEPTION 'RULE_TEST_VALUE_CONFLICT_MISSING:%', v_rule.code;
    END IF;

    -- Runtime only treats incompatible money currency as a hard unit conflict.
    -- Duration day/month/year is intentionally converted and must not be gated.
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rule.rule_contract -> 'properties') property
      WHERE property ->> 'type' = 'money' AND COALESCE(property ->> 'currency', '') <> ''
    ) INTO v_has_unit;
    IF v_has_unit AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rule_test_results) AS test_run
      WHERE test_run ->> 'case_kind' = 'unit_conflict'
        AND test_run ->> 'expected_status' = 'missing_evidence'
        AND test_run ->> 'expected_outcome' = v_rule.rule_contract ->> 'missing_evidence_outcome'
    ) THEN
      RAISE EXCEPTION 'RULE_TEST_UNIT_CONFLICT_MISSING:%', v_rule.code;
    END IF;

    IF v_is_new_rule_release THEN
      -- Publication is insert-only. The accepted draft remains immutable test
      -- evidence; a distinct published snapshot records that acceptance chain.
      INSERT INTO public.contract_rule_snapshots (
        rule_id, version, config_snapshot, released_by, released_at,
        release_note, status
      )
      SELECT
        snapshot.rule_id,
        snapshot.version,
        snapshot.config_snapshot || jsonb_build_object(
          'lifecycle_status', 'published',
          'translation_status', 'ready',
          'published_by', p_user_id,
          'published_at', v_now,
          'updated_at', v_now,
          '_release_evidence',
            COALESCE(snapshot.config_snapshot -> '_release_evidence', '{}'::jsonb)
            || jsonb_build_object(
              'accepted_draft_snapshot_id', snapshot.id,
              'rule_contract_sha256', v_rule_contract_sha256,
              'evaluator_revision', 'rule-contract-v1-20260720'
            )
        ),
        p_user_id,
        v_now,
        COALESCE(p_release_note, '规则集统一发布'),
        'published'
      FROM public.contract_rule_snapshots AS snapshot
      WHERE snapshot.id = v_acceptance_snapshot_id
        AND snapshot.rule_id = v_rule.id
        AND snapshot.version = v_rule.version
        AND snapshot.status = 'draft'
      RETURNING id INTO v_snapshot_id;
      IF v_snapshot_id IS NULL THEN RAISE EXCEPTION 'RULE_DRAFT_SNAPSHOT_MISSING:%', v_rule.code; END IF;

      UPDATE public.contract_rules_v2
      SET lifecycle_status = 'published', translation_status = 'ready',
          published_by = p_user_id, published_at = v_now, updated_at = v_now
      WHERE id = v_rule.id AND org_id = p_org_id;
    END IF;

    -- Rebuild from final active membership so removed rules cannot leave stale
    -- evidence inside the new RuleSetSnapshot.
    v_test_results := jsonb_set(v_test_results, ARRAY[v_rule.id::TEXT], v_rule_test_results, true);

    v_snapshot_ids := array_append(v_snapshot_ids, v_snapshot_id);
    v_snapshot_id := NULL;
  END LOOP;

  IF v_rule_count = 0 THEN RAISE EXCEPTION 'RULE_SET_EMPTY'; END IF;

  -- Inactive working rows are pending removals. They remain effective until
  -- this RuleSet publication replaces the membership pointer, then archive.
  UPDATE public.contract_rule_snapshots AS snapshot
  SET status = 'rolled_back', released_by = p_user_id, released_at = v_now,
      release_note = COALESCE(p_release_note, '随规则集统一停用')
  FROM public.contract_rules_v2 AS rule
  WHERE rule.org_id = p_org_id AND rule.rule_set_id = p_rule_set_id
    AND rule.is_active = false AND snapshot.rule_id = rule.id
    AND snapshot.version = rule.version AND snapshot.status = 'draft';

  UPDATE public.contract_rules_v2
  SET lifecycle_status = 'archived', updated_at = v_now
  WHERE org_id = p_org_id AND rule_set_id = p_rule_set_id AND is_active = false;

  -- Freeze the business taxonomy used by this exact membership. Historical
  -- RuleSet meaning must not drift when a live category is renamed later.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', category.id,
        'code', category.code,
        'name', category.name,
        'description', category.description
      )
      ORDER BY category.code
    ),
    '[]'::jsonb
  )
  INTO v_problem_categories
  FROM public.contract_rule_problem_categories AS category
  WHERE category.org_id = p_org_id
    AND category.id IN (
      SELECT DISTINCT rule.problem_category_id
      FROM public.contract_rules_v2 AS rule
      WHERE rule.org_id = p_org_id
        AND rule.rule_set_id = p_rule_set_id
        AND rule.is_active = true
        AND rule.problem_category_id IS NOT NULL
    );

  -- Live rows are mutable projections; immutable snapshots own the version
  -- sequence, including after rollback or recovery of a stale live counter.
  SELECT COALESCE(MAX(snapshot.version), 0) + 1
  INTO v_set_version
  FROM public.contract_rule_set_snapshots AS snapshot
  WHERE snapshot.rule_set_id = p_rule_set_id
    AND snapshot.org_id = p_org_id;

  INSERT INTO public.contract_rule_set_snapshots (
    org_id, rule_set_id, version, status, rule_snapshot_ids,
    document_snapshot_ids, config_snapshot, test_results,
    released_by, released_at, release_note
  ) VALUES (
    p_org_id, p_rule_set_id, v_set_version, 'published', v_snapshot_ids,
    v_previous_document_ids,
    jsonb_build_object(
      'code', v_set.code, 'name', v_set.name, 'description', v_set.description,
      'applicable_scenario', v_set.applicable_scenario, 'rule_count', v_rule_count,
      'problem_categories', v_problem_categories
    ),
    jsonb_build_object(
      'gate', 'snapshot_bound_latest_asserted_rule_matrix',
      'rule_count', v_rule_count,
      'rule_runs', v_test_results
    ),
    p_user_id, v_now, COALESCE(p_release_note, '规则集统一发布')
  )
  RETURNING id INTO v_set_snapshot_id;

  UPDATE public.contract_rule_sets
  SET version = v_set_version, lifecycle_status = 'published',
      translation_status = 'ready', published_by = p_user_id,
      published_at = v_now, release_note = COALESCE(p_release_note, '规则集统一发布'),
      current_snapshot_id = v_set_snapshot_id, updated_at = v_now
  WHERE id = p_rule_set_id AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'rule_set_id', p_rule_set_id, 'rule_set_snapshot_id', v_set_snapshot_id,
    'version', v_set_version, 'rule_count', v_rule_count,
    'rule_snapshot_ids', v_snapshot_ids, 'published_at', v_now
  );
END;
$$;
