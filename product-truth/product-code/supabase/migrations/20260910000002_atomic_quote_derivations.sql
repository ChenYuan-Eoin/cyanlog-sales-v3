-- REQ: WP10 release blocker D-WP10-RELEASE-001
-- Apply after 20260820000002. Target + trace are one transaction; service role only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.quote_derivations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_quote_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_derivations, public.order_drafts, public.seal_requests,
  public.tender_quote_packages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.quote_derivations, public.order_drafts, public.seal_requests,
  public.tender_quote_packages TO service_role;

CREATE OR REPLACE FUNCTION public.persist_quote_derivation_v1(
  p_org_id uuid, p_actor_id uuid, p_quote_id uuid, p_version_id uuid,
  p_type text, p_target jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_id uuid;
  frozen_total numeric;
  current_total numeric;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND (
      u.org_id = p_org_id OR EXISTS (
        SELECT 1 FROM public.user_organizations m
        WHERE m.user_id = u.id AND m.org_id = p_org_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'DERIVE_ACTOR_INVALID' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE((v.header->>'total_amount')::numeric, 0), COALESCE(q.total_amount, 0)
    INTO frozen_total, current_total
    FROM public.quotes q JOIN public.quote_versions v ON v.quote_id = q.id
    WHERE q.id = p_quote_id AND q.org_id = p_org_id AND v.id = p_version_id
    FOR SHARE OF q, v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DERIVE_SOURCE_INVALID' USING ERRCODE = '42501';
  END IF;
  -- Match the existing assertVersionMatchesQuote cent-rounding tolerance.
  IF abs(round(frozen_total, 2) - round(current_total, 2)) > 0.01 THEN
    RAISE EXCEPTION 'VERSION_DRIFT' USING ERRCODE = '23514';
  END IF;
  target_id := (p_target->>'id')::uuid;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'DERIVE_TARGET_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_type = 'order' THEN
    INSERT INTO public.order_drafts (
      id, org_id, created_by, quote_id, source_version_id, order_no, customer_name,
      currency, subtotal, discount_amount, tax_amount, total_amount, business_params, status
    ) VALUES (
      target_id, p_org_id, p_actor_id, p_quote_id, p_version_id,
      p_target->>'order_no', p_target->>'customer_name', p_target->>'currency',
      (p_target->>'subtotal')::numeric, (p_target->>'discount_amount')::numeric,
      (p_target->>'tax_amount')::numeric, frozen_total, p_target->'business_params', 'draft'
    );
  ELSIF p_type = 'seal' THEN
    INSERT INTO public.seal_requests (
      id, org_id, created_by, quote_id, source_version_id, reason, customer_name,
      total_amount, business_params, status
    ) VALUES (
      target_id, p_org_id, p_actor_id, p_quote_id, p_version_id, p_target->>'reason',
      p_target->>'customer_name', frozen_total, p_target->'business_params', 'pending'
    );
  ELSIF p_type = 'tender' THEN
    INSERT INTO public.tender_quote_packages (
      id, org_id, created_by, quote_id, source_version_id, title, package_data, status
    ) VALUES (
      target_id, p_org_id, p_actor_id, p_quote_id, p_version_id,
      p_target->>'title', p_target->'package_data', 'draft'
    );
  ELSE
    RAISE EXCEPTION 'DERIVE_TYPE_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.quote_derivations (
    org_id, quote_id, version_id, derivation_type, target_id, created_by
  ) VALUES (p_org_id, p_quote_id, p_version_id, p_type, target_id, p_actor_id);
  RETURN target_id;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_quote_derivation_v1(uuid,uuid,uuid,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_quote_derivation_v1(uuid,uuid,uuid,uuid,text,jsonb)
  TO service_role;
COMMIT;
