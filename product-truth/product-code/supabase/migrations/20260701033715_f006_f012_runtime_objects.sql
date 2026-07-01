-- F006/F012: real runtime objects for contract review.
-- These objects convert published rule/config assets into immutable review-run
-- evidence instead of synthetic display-only identifiers.

CREATE TABLE IF NOT EXISTS model_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL DEFAULT 'CONTRACT_REVIEW_DEFAULT',
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived')),
  is_current BOOLEAN NOT NULL DEFAULT true,
  provider_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  routing_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms INTEGER NOT NULL DEFAULT 45000,
  fallback_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_config_ids UUID[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  published_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_policies_current
  ON model_policies(org_id, key)
  WHERE status = 'published' AND is_current = true;

CREATE INDEX IF NOT EXISTS idx_model_policies_org_status
  ON model_policies(org_id, status, is_current);

ALTER TABLE model_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads model_policies" ON model_policies;
CREATE POLICY "Same org reads model_policies" ON model_policies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = model_policies.org_id
        AND uo.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS contract_skill_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL DEFAULT 'CONTRACT_REVIEW_DEFAULT',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'compiled', 'published', 'archived')),
  is_current BOOLEAN NOT NULL DEFAULT true,
  rule_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  template_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_policy_id UUID REFERENCES model_policies(id) ON DELETE RESTRICT,
  eval_case_ids TEXT[] NOT NULL DEFAULT '{}',
  release_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_from JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_hash TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  published_by UUID REFERENCES users(id),
  compiled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_skill_bundles_current
  ON contract_skill_bundles(org_id, key)
  WHERE status = 'published' AND is_current = true;

CREATE INDEX IF NOT EXISTS idx_contract_skill_bundles_org_status
  ON contract_skill_bundles(org_id, status, is_current);

CREATE INDEX IF NOT EXISTS idx_contract_skill_bundles_model_policy
  ON contract_skill_bundles(model_policy_id);

ALTER TABLE contract_skill_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads contract_skill_bundles" ON contract_skill_bundles;
CREATE POLICY "Same org reads contract_skill_bundles" ON contract_skill_bundles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = contract_skill_bundles.org_id
        AND uo.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS model_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  review_id UUID REFERENCES contract_reviews(id) ON DELETE CASCADE,
  skill_bundle_id UUID REFERENCES contract_skill_bundles(id) ON DELETE SET NULL,
  model_policy_id UUID REFERENCES model_policies(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'contract_review',
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'degraded')),
  degraded BOOLEAN NOT NULL DEFAULT false,
  fallback_reason TEXT,
  latency_ms INTEGER,
  request_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_invocations_review
  ON model_invocations(review_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_invocations_contract
  ON model_invocations(contract_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_invocations_policy
  ON model_invocations(model_policy_id);

ALTER TABLE model_invocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads model_invocations" ON model_invocations;
CREATE POLICY "Same org reads model_invocations" ON model_invocations
  FOR SELECT
  USING (
    org_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM user_organizations uo
      WHERE uo.org_id = model_invocations.org_id
        AND uo.user_id = auth.uid()
    )
  );

ALTER TABLE contract_reviews
  ADD COLUMN IF NOT EXISTS skill_bundle_id UUID REFERENCES contract_skill_bundles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_policy_id UUID REFERENCES model_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_snapshot_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS model_invocation_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_trigger TEXT,
  ADD COLUMN IF NOT EXISTS parent_review_id UUID REFERENCES contract_reviews(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contract_reviews_skill_bundle
  ON contract_reviews(skill_bundle_id);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_model_policy
  ON contract_reviews(model_policy_id);

CREATE INDEX IF NOT EXISTS idx_contract_reviews_parent
  ON contract_reviews(parent_review_id);

DROP TRIGGER IF EXISTS update_model_policies_updated_at ON model_policies;
CREATE TRIGGER update_model_policies_updated_at
  BEFORE UPDATE ON model_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contract_skill_bundles_updated_at ON contract_skill_bundles;
CREATE TRIGGER update_contract_skill_bundles_updated_at
  BEFORE UPDATE ON contract_skill_bundles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
