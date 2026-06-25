-- Legacy seed compatibility no-op.
--
-- This migration originally inserted old contract_rules rows using legacy
-- columns such as rule_code/rule_type/level/status. The active rule engine and
-- admin UI use contract_rules_v2, which is created and normalized by later
-- migrations. Keeping this migration as a no-op preserves migration order while
-- preventing old-schema data from blocking the v2 seed.

do $$
begin
  raise notice 'Skipping legacy contract_rules seed; contract_rules_v2 migrations provide R001-R015.';
end $$;
