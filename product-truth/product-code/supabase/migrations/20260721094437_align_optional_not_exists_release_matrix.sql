-- WP03 forward-only release-gate correction.
-- Keep the atomic publisher as the sole release authority while aligning its
-- acceptance obligations with the deterministic rule runtime.
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
  v_requires_missing_evidence BOOLEAN;
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

    -- Generic missing evidence is required only when an all-missing input can
    -- actually reach that runtime status. Required properties always do. When
    -- every property is optional, an explicit not_exists (or empty all-match)
    -- decision owns absence as a normal business branch and is already covered
    -- by the per-decision matrix above.
    SELECT
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_rule.rule_contract -> 'properties') AS property
        WHERE COALESCE(property -> 'required', 'true'::jsonb) <> 'false'::jsonb
      )
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_rule.rule_contract -> 'decisions') AS decision
        WHERE CASE
          WHEN decision ->> 'match' = 'any' THEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(decision -> 'conditions') AS condition
            WHERE condition ->> 'operator' = 'not_exists'
          )
          ELSE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(decision -> 'conditions') AS condition
            WHERE condition ->> 'operator' IS DISTINCT FROM 'not_exists'
          )
        END
      )
    INTO v_requires_missing_evidence;

    IF v_requires_missing_evidence AND NOT EXISTS (
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

REVOKE ALL ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  TO service_role;
