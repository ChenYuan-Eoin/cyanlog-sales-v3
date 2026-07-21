-- Finish the WP03 controlled-canary quarantine without touching history.
--
-- The first WP03 migration archived the exact acceptance RuleSet and its only
-- live Rule, but the navigation-only problem category remained active.  That
-- left a test category visible beside the 13 product categories.  Archive only
-- the category that is still provably owned by that controlled canary.

DO $$
DECLARE
  v_category RECORD;
BEGIN
  -- This is a one-row reconciliation, but its authority depends on the exact
  -- RuleSet -> Rule -> Category identity.  Block concurrent control-plane
  -- writes for the short transaction so the cardinality proof cannot change
  -- between validation and archive.  Reads remain available.
  LOCK TABLE public.contract_rule_sets IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.contract_rules_v2 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.contract_rule_problem_categories IN SHARE ROW EXCLUSIVE MODE;

  -- A matching active code is not sufficient authority.  Stop if its name,
  -- reference cardinality, rule identity, or archived RuleSet identity differs
  -- from the known controlled acceptance asset.
  IF EXISTS (
    SELECT 1
    FROM public.contract_rule_problem_categories AS category
    WHERE category.code = 'acceptance_29685647'
      AND category.is_active = true
      AND (
        category.name IS DISTINCT FROM '商业门槛验收 29685647（草稿）'
        OR (
          SELECT count(*)
          FROM public.contract_rules_v2 AS rule
          WHERE rule.org_id = category.org_id
            AND rule.problem_category_id = category.id
        ) <> 1
        OR (
          SELECT count(*)
          FROM public.contract_rules_v2 AS rule
          JOIN public.contract_rule_sets AS rule_set
            ON rule_set.id = rule.rule_set_id
           AND rule_set.org_id = rule.org_id
          WHERE rule.org_id = category.org_id
            AND rule.problem_category_id = category.id
            AND rule.code = 'MIN_COMMERCIAL_29685647'
            AND rule.is_active = false
            AND rule.lifecycle_status = 'archived'
            AND rule_set.code = 'F009_ACCEPT_29685647'
            AND rule_set.is_active = false
            AND rule_set.lifecycle_status = 'archived'
            AND rule_set.metadata -> 'wp03_projection_status' ->> 'state'
              = 'controlled_acceptance_canary_archived'
        ) <> 1
      )
  ) THEN
    RAISE EXCEPTION 'WP03_CANARY_CATEGORY_IDENTITY_CONFLICT';
  END IF;

  FOR v_category IN
    SELECT category.id, category.org_id
    FROM public.contract_rule_problem_categories AS category
    WHERE category.code = 'acceptance_29685647'
      AND category.name = '商业门槛验收 29685647（草稿）'
      AND category.is_active = true
      AND EXISTS (
        SELECT 1
        FROM public.contract_rules_v2 AS rule
        JOIN public.contract_rule_sets AS rule_set
          ON rule_set.id = rule.rule_set_id
         AND rule_set.org_id = rule.org_id
        WHERE rule.org_id = category.org_id
          AND rule.problem_category_id = category.id
          AND rule.code = 'MIN_COMMERCIAL_29685647'
          AND rule.is_active = false
          AND rule.lifecycle_status = 'archived'
          AND rule_set.code = 'F009_ACCEPT_29685647'
          AND rule_set.is_active = false
          AND rule_set.lifecycle_status = 'archived'
          AND rule_set.metadata -> 'wp03_projection_status' ->> 'state'
            = 'controlled_acceptance_canary_archived'
      )
    ORDER BY category.org_id, category.id
    FOR UPDATE
  LOOP
    -- Re-check the full identity under the write-excluding locks.  Keeping the
    -- assertion next to the mutation makes this migration safe even if its
    -- outer discovery query is refactored later.
    IF (
      SELECT count(*)
      FROM public.contract_rules_v2 AS rule
      WHERE rule.org_id = v_category.org_id
        AND rule.problem_category_id = v_category.id
    ) <> 1 OR (
      SELECT count(*)
      FROM public.contract_rules_v2 AS rule
      JOIN public.contract_rule_sets AS rule_set
        ON rule_set.id = rule.rule_set_id
       AND rule_set.org_id = rule.org_id
      WHERE rule.org_id = v_category.org_id
        AND rule.problem_category_id = v_category.id
        AND rule.code = 'MIN_COMMERCIAL_29685647'
        AND rule.is_active = false
        AND rule.lifecycle_status = 'archived'
        AND rule_set.code = 'F009_ACCEPT_29685647'
        AND rule_set.is_active = false
        AND rule_set.lifecycle_status = 'archived'
        AND rule_set.metadata -> 'wp03_projection_status' ->> 'state'
          = 'controlled_acceptance_canary_archived'
    ) <> 1 THEN
      RAISE EXCEPTION 'WP03_CANARY_CATEGORY_IDENTITY_CONFLICT';
    END IF;

    UPDATE public.contract_rule_problem_categories AS category
    SET is_active = false,
        updated_at = clock_timestamp()
    WHERE category.id = v_category.id
      AND category.org_id = v_category.org_id
      AND category.is_active = true;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.contract_rule_problem_categories AS category
    WHERE category.code = 'acceptance_29685647'
      AND category.is_active = true
  ) THEN
    RAISE EXCEPTION 'WP03_CANARY_CATEGORY_REMAINS_ACTIVE';
  END IF;
END;
$$;
