-- F006 legacy contract_rules enhancement.
--
-- The active contract review engine now uses contract_rules_v2. The legacy
-- enhancement originally assumed an older contract_rules table shape and ran
-- before the later F005 migration that introduced a different contract_rules
-- table, which made remote migration replay fail. Keep this migration as a
-- recorded compatibility no-op so later contract_rules_v2 migrations can run.

do $$
begin
  raise notice 'Skipping legacy contract_rules enhancement; contract_rules_v2 is the active rules table.';
end $$;
