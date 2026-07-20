-- Make rule drafting, selected-rule acceptance and RuleSet publication one
-- auditable control plane. Apply to isolated Preview before any Production use.

ALTER TABLE public.contract_rule_test_runs
  ADD COLUMN IF NOT EXISTS case_kind TEXT NOT NULL DEFAULT 'legacy_unasserted',
  ADD COLUMN IF NOT EXISTS expected_status TEXT,
  ADD COLUMN IF NOT EXISTS expected_outcome TEXT,
  ADD COLUMN IF NOT EXISTS expected_decision_id TEXT,
  ADD COLUMN IF NOT EXISTS assertion_passed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rule_snapshot_id UUID REFERENCES public.contract_rule_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_contract_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS evaluator_revision TEXT;

UPDATE public.contract_rule_test_runs
SET
  expected_status = COALESCE(expected_status, result_status),
  expected_outcome = COALESCE(expected_outcome, outcome)
WHERE expected_status IS NULL OR expected_outcome IS NULL;

ALTER TABLE public.contract_rule_test_runs
  ALTER COLUMN expected_status SET NOT NULL,
  ALTER COLUMN expected_outcome SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_rule_test_runs_case_kind_check'
      AND conrelid = 'public.contract_rule_test_runs'::regclass
  ) THEN
    ALTER TABLE public.contract_rule_test_runs
      ADD CONSTRAINT contract_rule_test_runs_case_kind_check
      CHECK (case_kind IN ('risk', 'pass', 'missing_evidence', 'value_conflict', 'unit_conflict', 'legacy_unasserted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_rule_test_runs_expected_status_check'
      AND conrelid = 'public.contract_rule_test_runs'::regclass
  ) THEN
    ALTER TABLE public.contract_rule_test_runs
      ADD CONSTRAINT contract_rule_test_runs_expected_status_check
      CHECK (expected_status IN ('decided', 'missing_evidence', 'no_decision'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_rule_test_runs_expected_outcome_check'
      AND conrelid = 'public.contract_rule_test_runs'::regclass
  ) THEN
    ALTER TABLE public.contract_rule_test_runs
      ADD CONSTRAINT contract_rule_test_runs_expected_outcome_check
      CHECK (expected_outcome IN ('pass', 'negotiate', 'block', 'manual_review'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_rule_test_runs_contract_sha256_check'
      AND conrelid = 'public.contract_rule_test_runs'::regclass
  ) THEN
    ALTER TABLE public.contract_rule_test_runs
      ADD CONSTRAINT contract_rule_test_runs_contract_sha256_check
      CHECK (rule_contract_sha256 IS NULL OR rule_contract_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_rule_test_runs_asserted_matrix
  ON public.contract_rule_test_runs(
    org_id,
    rule_id,
    rule_version,
    case_kind,
    expected_decision_id,
    evaluator_revision,
    created_at DESC
  );

-- RuleSnapshot publication is insert-only: the accepted draft and its
-- published release may share one logical version, but history for the same
-- (rule, version, status) must remain unique.
DROP INDEX IF EXISTS public.uq_contract_rule_snapshots_rule_version;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_rule_snapshots_rule_version_status
  ON public.contract_rule_snapshots(rule_id, version, status);

-- Published RuleSetSnapshots are immutable history. The sole mutable mother is
-- an explicit pointer on the RuleSet projection, never a snapshot status flip.
DROP INDEX IF EXISTS public.uq_contract_rule_set_snapshots_current_published;
ALTER TABLE public.contract_rule_sets
  ADD COLUMN IF NOT EXISTS current_snapshot_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rule_sets_current_snapshot_id_fkey'
      AND conrelid = 'public.contract_rule_sets'::regclass
  ) THEN
    ALTER TABLE public.contract_rule_sets
      ADD CONSTRAINT contract_rule_sets_current_snapshot_id_fkey
      FOREIGN KEY (current_snapshot_id)
      REFERENCES public.contract_rule_set_snapshots(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Backfill only the mutable pointer. Every historical published snapshot stays
-- byte-for-byte unchanged and remains available for audit/replay.
WITH ranked_published AS (
  SELECT
    snapshot.id,
    snapshot.org_id,
    snapshot.rule_set_id,
    row_number() OVER (
      PARTITION BY snapshot.org_id, snapshot.rule_set_id
      ORDER BY
        snapshot.released_at DESC NULLS LAST,
        snapshot.created_at DESC,
        snapshot.version DESC,
        snapshot.id DESC
    ) AS published_rank
  FROM public.contract_rule_set_snapshots AS snapshot
  WHERE snapshot.status = 'published'
)
UPDATE public.contract_rule_sets AS rule_set
SET current_snapshot_id = ranked.id
FROM ranked_published AS ranked
WHERE ranked.published_rank = 1
  AND rule_set.id = ranked.rule_set_id
  AND rule_set.org_id = ranked.org_id
  AND rule_set.current_snapshot_id IS NULL;

CREATE OR REPLACE FUNCTION public.validate_contract_rule_set_current_snapshot_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.current_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.contract_rule_set_snapshots AS snapshot
  WHERE snapshot.id = NEW.current_snapshot_id
    AND snapshot.org_id = NEW.org_id
    AND snapshot.rule_set_id = NEW.id
    AND snapshot.status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RULE_SET_CURRENT_SNAPSHOT_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_contract_rule_set_current_snapshot_v1
  ON public.contract_rule_sets;
CREATE TRIGGER validate_contract_rule_set_current_snapshot_v1
  BEFORE INSERT OR UPDATE OF current_snapshot_id, org_id, id
  ON public.contract_rule_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contract_rule_set_current_snapshot_v1();

-- Must match ruleContractSha256() in the server: object keys are sorted,
-- arrays keep order, and whitespace outside JSON strings is omitted.
CREATE OR REPLACE FUNCTION public.canonical_jsonb_text_v1(p_value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result TEXT;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(
        string_agg(
          to_jsonb(entry.key)::TEXT || ':' || public.canonical_jsonb_text_v1(entry.value),
          ',' ORDER BY entry.key COLLATE "C"
        ),
        ''
      ) || '}'
      INTO v_result
      FROM jsonb_each(p_value) AS entry;
      RETURN v_result;
    WHEN 'array' THEN
      SELECT '[' || COALESCE(
        string_agg(
          public.canonical_jsonb_text_v1(element.value),
          ',' ORDER BY element.ordinality
        ),
        ''
      ) || ']'
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS element(value, ordinality);
      RETURN v_result;
    ELSE
      RETURN p_value::TEXT;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_contract_rule_draft_v1(
  p_org_id UUID,
  p_user_id UUID,
  p_rule_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.contract_rules_v2%ROWTYPE;
  v_previous public.contract_rules_v2%ROWTYPE;
  v_rule_set public.contract_rule_sets%ROWTYPE;
  v_rule_set_id UUID := (p_payload ->> 'rule_set_id')::UUID;
  v_locked_rule_set_id UUID;
  v_problem_category_id UUID := (p_payload ->> 'problem_category_id')::UUID;
  v_version INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_contract_sha256 TEXT;
BEGIN
  IF jsonb_typeof(p_payload -> 'rule_contract') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'RULE_CANONICAL_CONTRACT_MISSING';
  END IF;

  IF p_rule_id IS NULL THEN
    v_locked_rule_set_id := v_rule_set_id;
  ELSE
    SELECT rule_set_id INTO v_locked_rule_set_id
    FROM public.contract_rules_v2
    WHERE id = p_rule_id AND org_id = p_org_id;
    IF NOT FOUND OR v_locked_rule_set_id IS NULL THEN RAISE EXCEPTION 'RULE_NOT_FOUND'; END IF;
  END IF;

  -- Every control-plane mutation locks its actual RuleSet before any member Rule.
  -- This serializes publish/save/archive membership changes in one order.
  SELECT * INTO v_rule_set
  FROM public.contract_rule_sets
  WHERE id = v_locked_rule_set_id AND org_id = p_org_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RULE_SET_NOT_FOUND'; END IF;

  IF p_rule_id IS NULL THEN
    -- New rows have no child row to lock. The parent RuleSet is already
    -- locked; acquire the terminal Category lock before inserting the Rule.
    PERFORM 1 FROM public.contract_rule_problem_categories
    WHERE id = v_problem_category_id AND org_id = p_org_id AND is_active = true
    FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RULE_PROBLEM_CATEGORY_NOT_FOUND'; END IF;

    v_version := 1;
    INSERT INTO public.contract_rules_v2 (
      org_id, rule_set_id, problem_category_id, code, name, description,
      business_domain, risk_level, category, engine_type, target_field,
      clause_category, field_hints, semantic_prompt, message_template,
      rule_contract, applicable_scenarios, scope,
      level_a_operator, level_a_threshold, level_a_unit, level_a_action,
      level_b_operator, level_b_threshold, level_b_unit, level_b_action,
      level_b_counterparty, level_c_operator, level_c_threshold,
      level_c_unit, level_c_action, level_c_message, approval_roles,
      version, priority, is_active, lifecycle_status, translation_status,
      translation_notes, published_at, published_by, created_by, created_at,
      updated_at
    ) VALUES (
      p_org_id, v_rule_set_id, v_problem_category_id,
      p_payload ->> 'code', p_payload ->> 'name', NULLIF(p_payload ->> 'description', ''),
      COALESCE(NULLIF(p_payload ->> 'business_domain', ''), 'contract_review'),
      COALESCE(NULLIF(p_payload ->> 'risk_level', ''), 'yellow'),
      p_payload ->> 'category', COALESCE(p_payload ->> 'engine_type', 'structured'),
      p_payload ->> 'target_field', p_payload ->> 'clause_category',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'field_hints', '[]'::jsonb))),
      NULLIF(p_payload ->> 'semantic_prompt', ''),
      COALESCE(p_payload -> 'message_template', '{}'::jsonb), p_payload -> 'rule_contract',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'applicable_scenarios', '[]'::jsonb))),
      COALESCE(p_payload ->> 'scope', 'org'),
      p_payload ->> 'level_a_operator', COALESCE(NULLIF(p_payload ->> 'level_a_threshold', '')::NUMERIC, 0),
      p_payload ->> 'level_a_unit', p_payload ->> 'level_a_action',
      p_payload ->> 'level_b_operator', COALESCE(NULLIF(p_payload ->> 'level_b_threshold', '')::NUMERIC, 0),
      p_payload ->> 'level_b_unit', p_payload ->> 'level_b_action', p_payload ->> 'level_b_counterparty',
      p_payload ->> 'level_c_operator', COALESCE(NULLIF(p_payload ->> 'level_c_threshold', '')::NUMERIC, 0),
      p_payload ->> 'level_c_unit', p_payload ->> 'level_c_action', p_payload ->> 'level_c_message',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'approval_roles', '[]'::jsonb))),
      v_version, COALESCE(NULLIF(p_payload ->> 'priority', '')::INTEGER, 100),
      COALESCE((p_payload ->> 'is_active')::BOOLEAN, true),
      'ready_to_publish', 'ready', '[]'::jsonb, NULL, NULL, p_user_id, v_now, v_now
    )
    RETURNING * INTO v_rule;
  ELSE
    SELECT * INTO v_previous
    FROM public.contract_rules_v2
    WHERE id = p_rule_id AND org_id = p_org_id AND rule_set_id = v_locked_rule_set_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'RULE_NOT_FOUND'; END IF;
    IF NULLIF(p_payload ->> 'version', '') IS NULL
      OR (p_payload ->> 'version')::INTEGER IS DISTINCT FROM v_previous.version THEN
      RAISE EXCEPTION 'RULE_DRAFT_VERSION_CONFLICT';
    END IF;
    IF v_previous.rule_set_id IS DISTINCT FROM v_rule_set_id THEN
      RAISE EXCEPTION 'RULE_SET_MOVE_REQUIRES_EXPLICIT_MIGRATION';
    END IF;

    -- Existing mutations use the full lock order RuleSet -> Rule -> Category.
    PERFORM 1 FROM public.contract_rule_problem_categories
    WHERE id = v_problem_category_id AND org_id = p_org_id AND is_active = true
    FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RULE_PROBLEM_CATEGORY_NOT_FOUND'; END IF;

    SELECT GREATEST(
      COALESCE(MAX(snapshot.version), 0),
      COALESCE(v_previous.version, 0)
    ) + 1
    INTO v_version
    FROM public.contract_rule_snapshots AS snapshot
    WHERE snapshot.rule_id = v_previous.id;
    UPDATE public.contract_rules_v2
    SET
      problem_category_id = v_problem_category_id,
      name = p_payload ->> 'name',
      description = NULLIF(p_payload ->> 'description', ''),
      business_domain = COALESCE(NULLIF(p_payload ->> 'business_domain', ''), 'contract_review'),
      risk_level = COALESCE(NULLIF(p_payload ->> 'risk_level', ''), 'yellow'),
      category = p_payload ->> 'category',
      engine_type = COALESCE(p_payload ->> 'engine_type', 'structured'),
      target_field = p_payload ->> 'target_field',
      clause_category = p_payload ->> 'clause_category',
      field_hints = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'field_hints', '[]'::jsonb))),
      semantic_prompt = NULLIF(p_payload ->> 'semantic_prompt', ''),
      message_template = COALESCE(p_payload -> 'message_template', '{}'::jsonb),
      rule_contract = p_payload -> 'rule_contract',
      applicable_scenarios = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'applicable_scenarios', '[]'::jsonb))),
      scope = COALESCE(p_payload ->> 'scope', 'org'),
      level_a_operator = p_payload ->> 'level_a_operator',
      level_a_threshold = COALESCE(NULLIF(p_payload ->> 'level_a_threshold', '')::NUMERIC, 0),
      level_a_unit = p_payload ->> 'level_a_unit',
      level_a_action = p_payload ->> 'level_a_action',
      level_b_operator = p_payload ->> 'level_b_operator',
      level_b_threshold = COALESCE(NULLIF(p_payload ->> 'level_b_threshold', '')::NUMERIC, 0),
      level_b_unit = p_payload ->> 'level_b_unit',
      level_b_action = p_payload ->> 'level_b_action',
      level_b_counterparty = p_payload ->> 'level_b_counterparty',
      level_c_operator = p_payload ->> 'level_c_operator',
      level_c_threshold = COALESCE(NULLIF(p_payload ->> 'level_c_threshold', '')::NUMERIC, 0),
      level_c_unit = p_payload ->> 'level_c_unit',
      level_c_action = p_payload ->> 'level_c_action',
      level_c_message = p_payload ->> 'level_c_message',
      approval_roles = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload -> 'approval_roles', '[]'::jsonb))),
      version = v_version,
      priority = COALESCE(NULLIF(p_payload ->> 'priority', '')::INTEGER, 100),
      is_active = COALESCE((p_payload ->> 'is_active')::BOOLEAN, true),
      lifecycle_status = 'ready_to_publish',
      translation_status = 'ready',
      translation_notes = '[]'::jsonb,
      published_at = NULL,
      published_by = NULL,
      updated_at = v_now
    WHERE id = p_rule_id AND org_id = p_org_id
    RETURNING * INTO v_rule;
  END IF;

  v_contract_sha256 := encode(
    extensions.digest(
      convert_to(public.canonical_jsonb_text_v1(v_rule.rule_contract), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.contract_rule_snapshots (
    rule_id, version, config_snapshot, released_by, released_at,
    release_note, status
  ) VALUES (
    v_rule.id, v_rule.version,
    to_jsonb(v_rule) || jsonb_build_object(
      '_release_evidence', jsonb_build_object(
        'rule_contract_sha256', v_contract_sha256,
        'evaluator_revision', 'rule-contract-v1-20260720'
      )
    ),
    NULL, NULL,
    CASE WHEN p_rule_id IS NULL
      THEN '创建 rule_contract v1 规则草稿，待测试后随规则集发布'
      ELSE '保存 rule_contract v1 规则草稿，待测试后随规则集发布'
    END,
    'draft'
  );

  UPDATE public.contract_rule_sets
  SET lifecycle_status = 'ready_to_publish', translation_status = 'ready', updated_at = v_now
  WHERE id = v_rule_set_id AND org_id = p_org_id;

  RETURN to_jsonb(v_rule);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_contract_rule_draft_v1(
  p_org_id UUID,
  p_user_id UUID,
  p_rule_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.contract_rules_v2%ROWTYPE;
  v_rule_set public.contract_rule_sets%ROWTYPE;
  v_rule_set_id UUID;
  v_version INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_contract_sha256 TEXT;
BEGIN
  -- Discover the immutable parent id without taking the child lock, then take
  -- the shared control-plane lock order: RuleSet -> Rule.
  SELECT rule_set_id INTO v_rule_set_id
  FROM public.contract_rules_v2
  WHERE id = p_rule_id AND org_id = p_org_id;
  IF NOT FOUND OR v_rule_set_id IS NULL THEN RAISE EXCEPTION 'RULE_NOT_FOUND'; END IF;

  SELECT * INTO v_rule_set
  FROM public.contract_rule_sets
  WHERE id = v_rule_set_id AND org_id = p_org_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RULE_SET_NOT_FOUND'; END IF;

  SELECT * INTO v_rule
  FROM public.contract_rules_v2
  WHERE id = p_rule_id AND org_id = p_org_id AND rule_set_id = v_rule_set_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RULE_NOT_FOUND'; END IF;

  SELECT GREATEST(
    COALESCE(MAX(snapshot.version), 0),
    COALESCE(v_rule.version, 0)
  ) + 1
  INTO v_version
  FROM public.contract_rule_snapshots AS snapshot
  WHERE snapshot.rule_id = v_rule.id;

  UPDATE public.contract_rules_v2
  SET
    is_active = false,
    version = v_version,
    lifecycle_status = 'ready_to_publish',
    translation_status = 'ready',
    published_at = NULL,
    published_by = NULL,
    updated_at = v_now
  WHERE id = p_rule_id AND org_id = p_org_id
  RETURNING * INTO v_rule;

  v_contract_sha256 := encode(
    extensions.digest(
      convert_to(public.canonical_jsonb_text_v1(v_rule.rule_contract), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.contract_rule_snapshots (
    rule_id, version, config_snapshot, released_by, released_at,
    release_note, status
  ) VALUES (
    v_rule.id, v_rule.version,
    to_jsonb(v_rule) || jsonb_build_object(
      '_release_evidence', jsonb_build_object(
        'rule_contract_sha256', v_contract_sha256,
        'evaluator_revision', 'rule-contract-v1-20260720'
      )
    ),
    NULL, NULL,
    '申请随规则集统一停用', 'draft'
  );

  UPDATE public.contract_rule_sets
  SET lifecycle_status = 'ready_to_publish', translation_status = 'ready', updated_at = v_now
  WHERE id = v_rule_set_id AND org_id = p_org_id;

  RETURN to_jsonb(v_rule);
END;
$$;

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
  v_rule_test_results JSONB;
  v_test_results JSONB := '{}'::jsonb;
  v_problem_categories JSONB := '[]'::jsonb;
  v_rule_contract_sha256 TEXT;
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
      COALESCE(snapshot.rule_snapshot_ids, ARRAY[]::UUID[])
    INTO v_previous_document_ids, v_current_rule_snapshot_ids
    FROM public.contract_rule_set_snapshots AS snapshot
    WHERE snapshot.id = v_set.current_snapshot_id
      AND snapshot.rule_set_id = p_rule_set_id
      AND snapshot.org_id = p_org_id
      AND snapshot.status = 'published';
    IF NOT FOUND THEN RAISE EXCEPTION 'RULE_SET_CURRENT_SNAPSHOT_INVALID'; END IF;
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
      v_acceptance_snapshot_id := v_snapshot_id;
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

    -- Draft and unchanged published rules use one explicit acceptance source:
    -- the accepted draft for a new release, or the exact RuleSnapshot named by
    -- the current RuleSetSnapshot for an unchanged member.
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

CREATE OR REPLACE FUNCTION public.update_contract_rule_problem_category_v1(
  p_org_id UUID,
  p_user_id UUID,
  p_category_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category public.contract_rule_problem_categories%ROWTYPE;
  v_updated public.contract_rule_problem_categories%ROWTYPE;
  v_next_name TEXT;
  v_next_description TEXT;
  v_next_sort_order INTEGER;
  v_next_is_active BOOLEAN;
  v_semantic_change BOOLEAN;
  v_pending_rule_set_count INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'RULE_CATEGORY_PAYLOAD_INVALID';
  END IF;

  -- Category is the last lock in the control plane. First lock every RuleSet
  -- currently affected, then its member Rules, both in deterministic order.
  PERFORM rule_set.id
  FROM public.contract_rule_sets AS rule_set
  WHERE rule_set.org_id = p_org_id
    AND rule_set.id IN (
      SELECT DISTINCT rule.rule_set_id
      FROM public.contract_rules_v2 AS rule
      WHERE rule.org_id = p_org_id
        AND rule.problem_category_id = p_category_id
        AND rule.is_active = true
        AND rule.rule_set_id IS NOT NULL
    )
  ORDER BY rule_set.id
  FOR UPDATE;

  PERFORM rule.id
  FROM public.contract_rules_v2 AS rule
  WHERE rule.org_id = p_org_id
    AND rule.problem_category_id = p_category_id
    AND rule.is_active = true
  ORDER BY rule.rule_set_id NULLS LAST, rule.id
  FOR UPDATE;

  SELECT * INTO v_category
  FROM public.contract_rule_problem_categories
  WHERE id = p_category_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RULE_PROBLEM_CATEGORY_NOT_FOUND'; END IF;

  v_next_name := CASE
    WHEN p_payload ? 'name' THEN NULLIF(p_payload ->> 'name', '')
    ELSE v_category.name
  END;
  v_next_description := CASE
    WHEN p_payload ? 'description' THEN NULLIF(p_payload ->> 'description', '')
    ELSE v_category.description
  END;
  v_next_sort_order := CASE
    WHEN p_payload ? 'sort_order' THEN (p_payload ->> 'sort_order')::INTEGER
    ELSE v_category.sort_order
  END;
  v_next_is_active := CASE
    WHEN p_payload ? 'is_active' THEN (p_payload ->> 'is_active')::BOOLEAN
    ELSE v_category.is_active
  END;

  IF v_next_name IS NULL THEN RAISE EXCEPTION 'RULE_CATEGORY_NAME_REQUIRED'; END IF;

  IF v_next_is_active = false AND EXISTS (
    SELECT 1 FROM public.contract_rules_v2 AS rule
    WHERE rule.org_id = p_org_id
      AND rule.problem_category_id = p_category_id
      AND rule.is_active = true
  ) THEN
    RAISE EXCEPTION 'RULE_CATEGORY_ACTIVE_REFERENCES';
  END IF;

  v_semantic_change := v_next_name IS DISTINCT FROM v_category.name
    OR v_next_description IS DISTINCT FROM v_category.description;

  UPDATE public.contract_rule_problem_categories
  SET
    name = v_next_name,
    description = v_next_description,
    sort_order = v_next_sort_order,
    is_active = v_next_is_active,
    updated_at = v_now
  WHERE id = p_category_id AND org_id = p_org_id
  RETURNING * INTO v_updated;

  IF v_semantic_change THEN
    -- Only the mutable release projection becomes pending. Existing
    -- RuleSetSnapshots remain untouched and keep their frozen category meaning.
    UPDATE public.contract_rule_sets AS rule_set
    SET lifecycle_status = 'ready_to_publish', updated_at = v_now
    WHERE rule_set.org_id = p_org_id
      AND rule_set.id IN (
        SELECT DISTINCT rule.rule_set_id
        FROM public.contract_rules_v2 AS rule
        WHERE rule.org_id = p_org_id
          AND rule.problem_category_id = p_category_id
          AND rule.is_active = true
          AND rule.rule_set_id IS NOT NULL
      );
    GET DIAGNOSTICS v_pending_rule_set_count = ROW_COUNT;
  END IF;

  RETURN to_jsonb(v_updated) || jsonb_build_object(
    'updated_by', p_user_id,
    'referenced_rule_sets_pending', v_pending_rule_set_count > 0,
    'pending_rule_set_count', v_pending_rule_set_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_contract_rule_draft_v1(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_contract_rule_draft_v1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_contract_rule_problem_category_v1(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_jsonb_text_v1(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_contract_rule_set_current_snapshot_v1()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_contract_rule_draft_v1(UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_contract_rule_draft_v1(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_contract_rule_problem_category_v1(UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.canonical_jsonb_text_v1(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_contract_rule_set_current_snapshot_v1() TO service_role;
