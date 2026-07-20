-- The initial Preview migration was applied before the trigger function's
-- search_path was pinned.  Keep a forward-only audit record for that live
-- Preview while fresh databases already receive the hardened definition.
ALTER FUNCTION public.update_contract_rule_problem_categories_updated_at()
  SET search_path = pg_catalog, public;
