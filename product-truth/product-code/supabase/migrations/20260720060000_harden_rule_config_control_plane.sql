-- Rule configuration is a server-side control plane. Browser roles must not
-- bypass the Next.js fresh permission checks through the Supabase Data API.

ALTER TABLE public.contract_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_rule_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_rule_set_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_rule_set_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.contract_rule_sets,
  public.contract_rule_snapshots,
  public.contract_rule_set_documents,
  public.contract_rule_set_snapshots
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.contract_rule_sets,
  public.contract_rule_snapshots,
  public.contract_rule_set_documents,
  public.contract_rule_set_snapshots
TO service_role;

-- SECURITY DEFINER publication is intentionally server-only. Revoking from
-- service_role first makes the final allowlist explicit and repeatable.
REVOKE ALL PRIVILEGES ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  TO service_role;

ALTER FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)
  SET search_path = pg_catalog, public;
