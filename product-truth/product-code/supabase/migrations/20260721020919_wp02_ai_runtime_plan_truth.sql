-- WP02: bind every real model attempt to one immutable, organization-scoped
-- execution plan.  Legacy ModelPolicy columns remain readable for historical
-- evidence, but they are not the source of truth for plan-linked invocations.

CREATE TABLE IF NOT EXISTS public.ai_runtime_plan_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  business_use_point_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  route_policy_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_runtime_plan_snapshots_use_point_id_check
    CHECK (business_use_point_id ~ '^[a-z][a-z0-9._-]{1,99}$'),
  CONSTRAINT ai_runtime_plan_snapshots_application_id_check
    CHECK (application_id ~ '^[a-z][a-z0-9._-]{1,99}$'),
  CONSTRAINT ai_runtime_plan_snapshots_route_policy_id_check
    CHECK (route_policy_id ~ '^[a-z][a-z0-9._-]{1,99}$'),
  CONSTRAINT ai_runtime_plan_snapshots_snapshot_object_check
    CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT ai_runtime_plan_snapshots_sha256_check
    CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_runtime_plan_snapshots_org_sha256_key
    UNIQUE (org_id, snapshot_sha256),
  -- This key lets invocation FKs prove that their org and three routing asset
  -- identities came from the same frozen plan instead of five unrelated IDs.
  CONSTRAINT ai_runtime_plan_snapshots_runtime_identity_key
    UNIQUE (
      org_id,
      id,
      business_use_point_id,
      application_id,
      route_policy_id
    )
);

COMMENT ON TABLE public.ai_runtime_plan_snapshots IS
  'Insert-only, redacted AI runtime plans compiled from published WP01 assets.';
COMMENT ON COLUMN public.ai_runtime_plan_snapshots.snapshot IS
  'Redacted canonical plan JSON. Provider credentials and other secrets are forbidden by the writer contract.';
COMMENT ON COLUMN public.ai_runtime_plan_snapshots.snapshot_sha256 IS
  'Lowercase SHA-256 of the canonical redacted plan JSON, calculated by the server resolver.';

CREATE INDEX IF NOT EXISTS idx_ai_runtime_plan_snapshots_org_use_point_created
  ON public.ai_runtime_plan_snapshots(
    org_id,
    business_use_point_id,
    created_at DESC,
    id
  );

CREATE INDEX IF NOT EXISTS idx_ai_runtime_plan_snapshots_org_application_route
  ON public.ai_runtime_plan_snapshots(
    org_id,
    application_id,
    route_policy_id,
    created_at DESC,
    id
  );

-- RLS is the organization read boundary.  Mutations are server-only and the
-- table grants intentionally omit UPDATE/DELETE even for service_role.
ALTER TABLE public.ai_runtime_plan_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads ai_runtime_plan_snapshots"
  ON public.ai_runtime_plan_snapshots;
CREATE POLICY "Same org reads ai_runtime_plan_snapshots"
  ON public.ai_runtime_plan_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organizations AS membership
      WHERE membership.org_id = ai_runtime_plan_snapshots.org_id
        AND membership.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service role inserts ai_runtime_plan_snapshots"
  ON public.ai_runtime_plan_snapshots;
CREATE POLICY "Service role inserts ai_runtime_plan_snapshots"
  ON public.ai_runtime_plan_snapshots
  FOR INSERT
  TO service_role
  WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public.ai_runtime_plan_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_runtime_plan_snapshots TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ai_runtime_plan_snapshots TO service_role;

-- Privileges and RLS are not enough for an audit object because the table owner
-- bypasses both.  Reject UPDATE and DELETE at the storage boundary as well.
CREATE OR REPLACE FUNCTION public.reject_ai_runtime_plan_snapshot_mutation_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'AI_RUNTIME_PLAN_SNAPSHOT_IMMUTABLE'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS reject_ai_runtime_plan_snapshot_mutation_v1
  ON public.ai_runtime_plan_snapshots;
CREATE TRIGGER reject_ai_runtime_plan_snapshot_mutation_v1
  BEFORE UPDATE OR DELETE
  ON public.ai_runtime_plan_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_ai_runtime_plan_snapshot_mutation_v1();

REVOKE ALL PRIVILEGES
  ON FUNCTION public.reject_ai_runtime_plan_snapshot_mutation_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- A plan-linked model_invocation is one actual HTTP model attempt.  Rule
-- evaluation, template rendering and manual work must not write these columns
-- or fabricate a model_invocations row.
ALTER TABLE public.model_invocations
  ADD COLUMN IF NOT EXISTS plan_snapshot_id UUID,
  ADD COLUMN IF NOT EXISTS business_use_point_id TEXT,
  ADD COLUMN IF NOT EXISTS application_id TEXT,
  ADD COLUMN IF NOT EXISTS route_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS model_catalog_entry_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_connection_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_no INTEGER,
  ADD COLUMN IF NOT EXISTS input_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS output_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS total_tokens BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_runtime_plan_fields_check'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_runtime_plan_fields_check
      CHECK (
        (
          plan_snapshot_id IS NULL
          AND business_use_point_id IS NULL
          AND application_id IS NULL
          AND route_policy_id IS NULL
          AND model_catalog_entry_id IS NULL
          AND provider_connection_id IS NULL
          AND attempt_no IS NULL
        )
        OR
        (
          plan_snapshot_id IS NOT NULL
          AND org_id IS NOT NULL
          AND business_use_point_id IS NOT NULL
          AND application_id IS NOT NULL
          AND route_policy_id IS NOT NULL
          AND model_catalog_entry_id IS NOT NULL
          AND provider_connection_id IS NOT NULL
          AND attempt_no IS NOT NULL
          AND business_use_point_id ~ '^[a-z][a-z0-9._-]{1,99}$'
          AND application_id ~ '^[a-z][a-z0-9._-]{1,99}$'
          AND route_policy_id ~ '^[a-z][a-z0-9._-]{1,99}$'
          AND model_catalog_entry_id ~ '^[a-z][a-z0-9._-]{1,99}$'
          AND provider_connection_id ~ '^[a-z][a-z0-9._-]{1,99}$'
          AND attempt_no >= 1
          AND btrim(provider) <> ''
          AND btrim(model) <> ''
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_token_accounting_check'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_token_accounting_check
      CHECK (
        (
          input_tokens IS NULL
          AND output_tokens IS NULL
          AND total_tokens IS NULL
        )
        OR
        (
          input_tokens IS NOT NULL
          AND output_tokens IS NOT NULL
          AND total_tokens IS NOT NULL
          AND input_tokens >= 0
          AND output_tokens >= 0
          AND total_tokens >= 0
          AND total_tokens = input_tokens + output_tokens
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_latency_nonnegative_check'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_latency_nonnegative_check
      CHECK (latency_ms IS NULL OR latency_ms >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_completed_usage_check'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_completed_usage_check
      CHECK (
        plan_snapshot_id IS NULL
        OR status NOT IN ('completed', 'degraded')
        OR (
          input_tokens IS NOT NULL
          AND output_tokens IS NOT NULL
          AND total_tokens IS NOT NULL
          AND total_tokens > 0
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_runtime_plan_identity_fkey'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_runtime_plan_identity_fkey
      FOREIGN KEY (
        org_id,
        plan_snapshot_id,
        business_use_point_id,
        application_id,
        route_policy_id
      )
      REFERENCES public.ai_runtime_plan_snapshots (
        org_id,
        id,
        business_use_point_id,
        application_id,
        route_policy_id
      )
      ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE public.contract_reviews
  ADD COLUMN IF NOT EXISTS plan_snapshot_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_reviews_plan_snapshot_id_fkey'
      AND conrelid = 'public.contract_reviews'::regclass
  ) THEN
    ALTER TABLE public.contract_reviews
      ADD CONSTRAINT contract_reviews_plan_snapshot_id_fkey
      FOREIGN KEY (plan_snapshot_id)
      REFERENCES public.ai_runtime_plan_snapshots(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_reviews_id_plan_snapshot_key'
      AND conrelid = 'public.contract_reviews'::regclass
  ) THEN
    ALTER TABLE public.contract_reviews
      ADD CONSTRAINT contract_reviews_id_plan_snapshot_key
      UNIQUE (id, plan_snapshot_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_review_plan_snapshot_fkey'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_review_plan_snapshot_fkey
      FOREIGN KEY (review_id, plan_snapshot_id)
      REFERENCES public.contract_reviews(id, plan_snapshot_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- A ReviewRun can acquire its plan once, before the first linked invocation.
-- Rebinding or clearing a non-null plan would make historical evidence drift.
CREATE OR REPLACE FUNCTION public.validate_contract_review_plan_snapshot_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_contract_org_id UUID;
  v_snapshot_org_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.plan_snapshot_id IS NOT NULL
      AND NEW.plan_snapshot_id IS DISTINCT FROM OLD.plan_snapshot_id
    THEN
      RAISE EXCEPTION 'CONTRACT_REVIEW_PLAN_SNAPSHOT_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.plan_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.contract_id IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_REVIEW_PLAN_REQUIRES_CONTRACT'
      USING ERRCODE = '23514';
  END IF;

  SELECT contract.org_id
  INTO v_contract_org_id
  FROM public.contracts AS contract
  WHERE contract.id = NEW.contract_id;

  SELECT plan.org_id
  INTO v_snapshot_org_id
  FROM public.ai_runtime_plan_snapshots AS plan
  WHERE plan.id = NEW.plan_snapshot_id;

  IF v_contract_org_id IS NULL
    OR v_snapshot_org_id IS NULL
    OR v_contract_org_id IS DISTINCT FROM v_snapshot_org_id
  THEN
    RAISE EXCEPTION 'CONTRACT_REVIEW_PLAN_ORG_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_contract_review_plan_snapshot_v1
  ON public.contract_reviews;
CREATE TRIGGER validate_contract_review_plan_snapshot_v1
  BEFORE INSERT OR UPDATE OF contract_id, plan_snapshot_id
  ON public.contract_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contract_review_plan_snapshot_v1();

REVOKE ALL PRIVILEGES
  ON FUNCTION public.validate_contract_review_plan_snapshot_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- ReviewRun -> invocation uses the leading review_id index. Invocation ->
-- ReviewRun uses its primary id / review_id FK; the GIN index preserves the
-- legacy explicit invocation-id array lookup without making it the new truth.
CREATE INDEX IF NOT EXISTS idx_model_invocations_review_plan_attempt
  ON public.model_invocations(
    review_id,
    plan_snapshot_id,
    attempt_no,
    created_at DESC,
    id
  )
  WHERE review_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_model_invocations_plan_created
  ON public.model_invocations(plan_snapshot_id, created_at DESC, id)
  WHERE plan_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_model_invocations_runtime_candidate
  ON public.model_invocations(
    org_id,
    business_use_point_id,
    model_catalog_entry_id,
    provider_connection_id,
    created_at DESC,
    id
  )
  WHERE plan_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contract_reviews_plan_snapshot
  ON public.contract_reviews(plan_snapshot_id, created_at DESC, id)
  WHERE plan_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contract_reviews_model_invocation_ids_gin
  ON public.contract_reviews
  USING GIN (model_invocation_ids)
  WHERE cardinality(model_invocation_ids) > 0;

-- The old policy exposed org-less legacy evidence to every authenticated user.
-- Audit rows now require an explicit organization membership.  Only the server
-- may insert; neither browser roles nor service_role can mutate/delete history.
ALTER TABLE public.model_invocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads model_invocations"
  ON public.model_invocations;
CREATE POLICY "Same org reads model_invocations"
  ON public.model_invocations
  FOR SELECT
  TO authenticated
  USING (
    org_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_organizations AS membership
      WHERE membership.org_id = model_invocations.org_id
        AND membership.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service role inserts model_invocations"
  ON public.model_invocations;
CREATE POLICY "Service role inserts model_invocations"
  ON public.model_invocations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public.model_invocations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.model_invocations TO authenticated;
GRANT SELECT, INSERT ON TABLE public.model_invocations TO service_role;

COMMENT ON COLUMN public.contract_reviews.plan_snapshot_id IS
  'Immutable WP02 execution plan selected for this ReviewRun.';
COMMENT ON COLUMN public.model_invocations.plan_snapshot_id IS
  'Frozen execution plan used by this real provider attempt; NULL denotes legacy evidence.';
COMMENT ON COLUMN public.model_invocations.model_policy_id IS
  'Legacy read-only compatibility pointer; never used to resolve a WP02 plan-linked invocation.';
