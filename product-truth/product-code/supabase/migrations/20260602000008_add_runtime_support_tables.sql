-- Migration: 20260602000008_add_runtime_support_tables.sql
-- PURPOSE: 补齐运行时代码依赖的桥接表，确保配置中心/审批/OCR 在远端环境可用

CREATE TABLE IF NOT EXISTS user_organizations (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_organizations_default
  ON user_organizations (user_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_organizations_org
  ON user_organizations (org_id);

INSERT INTO user_organizations (user_id, org_id, is_default)
SELECT id, org_id, TRUE
FROM users
WHERE org_id IS NOT NULL
ON CONFLICT (user_id, org_id) DO UPDATE
SET is_default = EXCLUDED.is_default;

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL,
  level INT NOT NULL CHECK (level >= 1),
  approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approver_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'waiting', 'approved', 'rejected')),
  comment TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approvals_quote_level
  ON approvals (quote_id, level);

CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals (status);

CREATE TABLE IF NOT EXISTS ocr_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_file TEXT NOT NULL,
  extracted_text TEXT,
  key_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence INT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_results_created_by
  ON ocr_results (created_by, created_at DESC);

ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_organizations'
      AND policyname = 'Same org reads user_organizations'
  ) THEN
    CREATE POLICY "Same org reads user_organizations" ON user_organizations
      FOR SELECT TO authenticated
      USING (
        org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'approvals'
      AND policyname = 'Approver reads approvals'
  ) THEN
    CREATE POLICY "Approver reads approvals" ON approvals
      FOR SELECT TO authenticated
      USING (approver_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ocr_results'
      AND policyname = 'Users read own ocr_results'
  ) THEN
    CREATE POLICY "Users read own ocr_results" ON ocr_results
      FOR SELECT TO authenticated
      USING (created_by = auth.uid());
  END IF;
END
$$;
