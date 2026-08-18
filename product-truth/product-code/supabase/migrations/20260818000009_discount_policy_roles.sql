-- F051：每角色折扣上限（机制；无种子，业务数值由配置中心按角色维护）
CREATE TABLE IF NOT EXISTS discount_policies (
  org_id UUID NOT NULL REFERENCES organizations(id),
  role_code VARCHAR(50) NOT NULL,
  max_discount NUMERIC(6,4) NOT NULL,          -- 常规上限（0-1，超出需审批）
  hard_cap NUMERIC(6,4),                        -- 硬顶（0-1，超出阻断；NULL=不设硬顶）
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, role_code)
);

ALTER TABLE discount_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discount_policies_org_access" ON discount_policies;
CREATE POLICY "discount_policies_org_access" ON discount_policies
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid()));
