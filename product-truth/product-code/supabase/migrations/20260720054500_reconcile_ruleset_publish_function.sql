-- Remove the untracked five-argument Preview experiment so the repository has
-- one auditable RuleSet publication protocol. SkillBundle compilation remains
-- a downstream consumer of published snapshots, not a side effect of publish.

DROP FUNCTION IF EXISTS public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT, JSONB);

ALTER FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  TO service_role;
