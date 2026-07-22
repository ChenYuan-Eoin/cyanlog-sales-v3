-- P0: privileged RPCs are internal server capabilities, not public APIs.
-- Both consumers use supabaseAdmin/service_role in server-only modules.
-- This migration changes function ACLs only and contains no data mutation.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $p0_rpc_preflight$
DECLARE
  missing_functions text[];
BEGIN
  SELECT array_agg(target.identity ORDER BY target.identity)
  INTO missing_functions
  FROM unnest(ARRAY[
    'public.exec_sql(text)',
    'public.claim_contract_analysis_job(text,interval)'
  ]::text[]) AS target(identity)
  WHERE to_regprocedure(target.identity) IS NULL;

  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'P0 RPC preflight failed; missing functions: %', missing_functions;
  END IF;
END
$p0_rpc_preflight$;

REVOKE ALL ON FUNCTION public.exec_sql(text)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_contract_analysis_job(text, interval)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.exec_sql(text)
TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_contract_analysis_job(text, interval)
TO service_role;

DO $p0_rpc_postcondition$
DECLARE
  invalid_functions text[];
BEGIN
  WITH targets(identity) AS (
    SELECT unnest(ARRAY[
      'public.exec_sql(text)',
      'public.claim_contract_analysis_job(text,interval)'
    ]::text[])
  ), function_catalog AS (
    SELECT targets.identity, function_proc.oid, function_proc.proacl,
           function_proc.proowner
    FROM targets
    JOIN pg_proc function_proc
      ON function_proc.oid = to_regprocedure(targets.identity)
  )
  SELECT array_agg(function_catalog.identity ORDER BY function_catalog.identity)
  INTO invalid_functions
  FROM function_catalog
  WHERE EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              function_catalog.proacl,
              acldefault('f', function_catalog.proowner)
            )
          ) AS public_acl
          WHERE public_acl.grantee = 0
            AND public_acl.privilege_type = 'EXECUTE'
        )
     OR has_function_privilege('anon', function_catalog.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', function_catalog.oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', function_catalog.oid, 'EXECUTE');

  IF invalid_functions IS NOT NULL THEN
    RAISE EXCEPTION 'P0 RPC postcondition failed for functions: %', invalid_functions;
  END IF;
END
$p0_rpc_postcondition$;

RESET statement_timeout;
RESET lock_timeout;

-- Emergency rollback reference (manual security regression, not an exact inverse):
-- GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;
-- Do not restore PUBLIC execution. Prefer a dedicated authenticated wrapper if
-- a future product flow genuinely needs browser access.
