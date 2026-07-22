-- P0: close unintended Data API access to contract service tables.
--
-- Repository dependency audit found these tables are consumed only through
-- server-side service_role paths. They intentionally have no anon/authenticated
-- policies, so enabling RLS and revoking public API roles is fail-closed.
-- This migration contains no data mutation.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $p0_preflight$
DECLARE
  missing_tables text[];
BEGIN
  SELECT array_agg(target.table_name ORDER BY target.table_name)
  INTO missing_tables
  FROM unnest(ARRAY[
    'contract_items',
    'contract_signatures',
    'contract_drafts',
    'contract_template_params',
    'contract_risk_cards',
    'contract_ai_chats',
    'contract_comparisons',
    'comparison_diffs',
    'contract_rules_v2',
    'contract_rule_snapshots',
    'contract_risk_card_fixes'
  ]::text[]) AS target(table_name)
  WHERE to_regclass(format('public.%I', target.table_name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'P0 RLS preflight failed; missing public tables: %', missing_tables;
  END IF;
END
$p0_preflight$;

ALTER TABLE public.contract_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_template_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_risk_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_rules_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_rule_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_risk_card_fixes ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.contract_items,
  public.contract_signatures,
  public.contract_drafts,
  public.contract_template_params,
  public.contract_risk_cards,
  public.contract_ai_chats,
  public.contract_comparisons,
  public.comparison_diffs,
  public.contract_rules_v2,
  public.contract_rule_snapshots,
  public.contract_risk_card_fixes
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.contract_items,
  public.contract_signatures,
  public.contract_drafts,
  public.contract_template_params,
  public.contract_risk_cards,
  public.contract_ai_chats,
  public.contract_comparisons,
  public.comparison_diffs,
  public.contract_rules_v2,
  public.contract_rule_snapshots,
  public.contract_risk_card_fixes
TO service_role;

DO $p0_postcondition$
DECLARE
  invalid_tables text[];
BEGIN
  WITH targets(table_name) AS (
    SELECT unnest(ARRAY[
      'contract_items',
      'contract_signatures',
      'contract_drafts',
      'contract_template_params',
      'contract_risk_cards',
      'contract_ai_chats',
      'contract_comparisons',
      'comparison_diffs',
      'contract_rules_v2',
      'contract_rule_snapshots',
      'contract_risk_card_fixes'
    ]::text[])
  )
  SELECT array_agg(targets.table_name ORDER BY targets.table_name)
  INTO invalid_tables
  FROM targets
  JOIN pg_class table_class
    ON table_class.oid = to_regclass(format('public.%I', targets.table_name))
  WHERE NOT table_class.relrowsecurity
     OR EXISTS (
       SELECT 1
       FROM aclexplode(
         COALESCE(table_class.relacl, acldefault('r', table_class.relowner))
       ) AS public_acl
       WHERE public_acl.grantee = 0
     )
     OR EXISTS (
       SELECT 1
       FROM information_schema.role_table_grants role_grant
       WHERE role_grant.table_schema = 'public'
         AND role_grant.table_name = targets.table_name
         AND role_grant.grantee IN ('anon', 'authenticated')
     )
     OR NOT has_table_privilege('service_role', format('public.%I', targets.table_name), 'SELECT')
     OR NOT has_table_privilege('service_role', format('public.%I', targets.table_name), 'INSERT')
     OR NOT has_table_privilege('service_role', format('public.%I', targets.table_name), 'UPDATE')
     OR NOT has_table_privilege('service_role', format('public.%I', targets.table_name), 'DELETE');

  IF invalid_tables IS NOT NULL THEN
    RAISE EXCEPTION 'P0 RLS postcondition failed for tables: %', invalid_tables;
  END IF;
END
$p0_postcondition$;

RESET statement_timeout;
RESET lock_timeout;

-- Emergency rollback reference (manual security regression, not an exact inverse):
-- 1. ALTER TABLE each target DISABLE ROW LEVEL SECURITY;
-- 2. GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE each target TO anon, authenticated;
-- Prefer adding narrowly scoped ownership policies over using this rollback.
