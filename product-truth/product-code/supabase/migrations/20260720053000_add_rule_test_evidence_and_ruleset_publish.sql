-- Persist selected-rule sandbox evidence and publish a whole RuleSet atomically.
-- Production remains read-only; this migration is first verified on isolated Preview.

CREATE TABLE IF NOT EXISTS contract_rule_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES contract_rules_v2(id) ON DELETE CASCADE,
  rule_version INTEGER NOT NULL CHECK (rule_version > 0),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  result_status TEXT NOT NULL CHECK (result_status IN ('decided', 'missing_evidence', 'no_decision')),
  outcome TEXT NOT NULL CHECK (outcome IN ('pass', 'negotiate', 'block', 'manual_review')),
  result_json JSONB NOT NULL,
  tested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_rule_test_runs_rule_version
  ON contract_rule_test_runs(org_id, rule_id, rule_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_rule_test_runs_tested_by
  ON contract_rule_test_runs(tested_by);

ALTER TABLE contract_rule_test_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contract_rule_test_runs FROM anon, authenticated;
GRANT ALL ON TABLE contract_rule_test_runs TO service_role;

CREATE OR REPLACE FUNCTION publish_contract_rule_set_v1(
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
  v_set contract_rule_sets%ROWTYPE;
  v_rule contract_rules_v2%ROWTYPE;
  v_rule_count INTEGER := 0;
  v_snapshot_id UUID;
  v_snapshot_ids UUID[] := ARRAY[]::UUID[];
  v_set_version INTEGER;
  v_set_snapshot_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT *
  INTO v_set
  FROM contract_rule_sets
  WHERE id = p_rule_set_id
    AND org_id = p_org_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RULE_SET_NOT_FOUND';
  END IF;

  FOR v_rule IN
    SELECT *
    FROM contract_rules_v2
    WHERE org_id = p_org_id
      AND rule_set_id = p_rule_set_id
      AND is_active = true
    ORDER BY code
    FOR UPDATE
  LOOP
    v_rule_count := v_rule_count + 1;

    IF v_rule.lifecycle_status = 'ready_to_publish'
      AND v_rule.translation_status = 'ready' THEN
      IF v_rule.problem_category_id IS NULL OR v_rule.rule_contract IS NULL THEN
        RAISE EXCEPTION 'RULE_CANONICAL_CONTRACT_MISSING:%', v_rule.code;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM contract_rule_test_runs test_run
        WHERE test_run.org_id = p_org_id
          AND test_run.rule_id = v_rule.id
          AND test_run.rule_version = v_rule.version
          AND test_run.result_status = 'decided'
      ) THEN
        RAISE EXCEPTION 'RULE_TEST_EVIDENCE_MISSING:%', v_rule.code;
      END IF;

      SELECT snapshot.id
      INTO v_snapshot_id
      FROM contract_rule_snapshots snapshot
      WHERE snapshot.rule_id = v_rule.id
        AND snapshot.version = v_rule.version
        AND snapshot.status = 'draft'
      ORDER BY snapshot.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'RULE_DRAFT_SNAPSHOT_MISSING:%', v_rule.code;
      END IF;

      UPDATE contract_rule_snapshots
      SET status = 'rolled_back'
      WHERE rule_id = v_rule.id
        AND status = 'published';

      UPDATE contract_rule_snapshots
      SET
        status = 'published',
        released_by = p_user_id,
        released_at = v_now,
        release_note = COALESCE(p_release_note, '规则集统一发布'),
        config_snapshot = config_snapshot || jsonb_build_object(
          'lifecycle_status', 'published',
          'translation_status', 'ready',
          'published_by', p_user_id,
          'published_at', v_now,
          'updated_at', v_now
        )
      WHERE id = v_snapshot_id;

      UPDATE contract_rules_v2
      SET
        lifecycle_status = 'published',
        translation_status = 'ready',
        published_by = p_user_id,
        published_at = v_now,
        updated_at = v_now
      WHERE id = v_rule.id
        AND org_id = p_org_id;
    ELSIF v_rule.lifecycle_status = 'published'
      AND v_rule.translation_status = 'ready'
      AND v_rule.published_at IS NOT NULL THEN
      SELECT snapshot.id
      INTO v_snapshot_id
      FROM contract_rule_snapshots snapshot
      WHERE snapshot.rule_id = v_rule.id
        AND snapshot.version = v_rule.version
        AND snapshot.status = 'published'
      ORDER BY snapshot.released_at DESC NULLS LAST, snapshot.created_at DESC
      LIMIT 1;

      IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'RULE_PUBLISHED_SNAPSHOT_MISSING:%', v_rule.code;
      END IF;
    ELSE
      RAISE EXCEPTION 'RULE_NOT_READY:%', v_rule.code;
    END IF;

    v_snapshot_ids := array_append(v_snapshot_ids, v_snapshot_id);
    v_snapshot_id := NULL;
  END LOOP;

  IF v_rule_count = 0 THEN
    RAISE EXCEPTION 'RULE_SET_EMPTY';
  END IF;

  v_set_version := CASE
    WHEN v_set.published_at IS NULL THEN GREATEST(v_set.version, 1)
    ELSE GREATEST(v_set.version, 1) + 1
  END;

  UPDATE contract_rule_set_snapshots
  SET status = 'rolled_back'
  WHERE rule_set_id = p_rule_set_id
    AND org_id = p_org_id
    AND status = 'published';

  INSERT INTO contract_rule_set_snapshots (
    org_id,
    rule_set_id,
    version,
    status,
    rule_snapshot_ids,
    document_snapshot_ids,
    config_snapshot,
    test_results,
    released_by,
    released_at,
    release_note
  ) VALUES (
    p_org_id,
    p_rule_set_id,
    v_set_version,
    'published',
    v_snapshot_ids,
    ARRAY[]::UUID[],
    jsonb_build_object(
      'code', v_set.code,
      'name', v_set.name,
      'description', v_set.description,
      'applicable_scenario', v_set.applicable_scenario,
      'rule_count', v_rule_count
    ),
    jsonb_build_object(
      'gate', 'same_version_selected_rule_test_evidence',
      'rule_count', v_rule_count
    ),
    p_user_id,
    v_now,
    COALESCE(p_release_note, '规则集统一发布')
  )
  RETURNING id INTO v_set_snapshot_id;

  UPDATE contract_rule_sets
  SET
    version = v_set_version,
    lifecycle_status = 'published',
    translation_status = 'ready',
    published_by = p_user_id,
    published_at = v_now,
    release_note = COALESCE(p_release_note, '规则集统一发布'),
    updated_at = v_now
  WHERE id = p_rule_set_id
    AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'rule_set_id', p_rule_set_id,
    'rule_set_snapshot_id', v_set_snapshot_id,
    'version', v_set_version,
    'rule_count', v_rule_count,
    'rule_snapshot_ids', v_snapshot_ids,
    'published_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT) TO service_role;
