-- F049：海外/区域能力（价盘 region 维度 + 按地区税率矩阵 + 多币种）
-- 仅迁移 CN 现有业务值；其他区域由配置中心按业务口径维护，不伪造。
ALTER TABLE price_matrix
  ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'CN';

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'CN';

ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS region VARCHAR(10) NOT NULL DEFAULT 'CN';

CREATE TABLE IF NOT EXISTS regional_tax_rates (
  org_id UUID NOT NULL REFERENCES organizations(id),
  region VARCHAR(10) NOT NULL,
  software_rate NUMERIC(6,4) NOT NULL DEFAULT 0.13,
  service_rate NUMERIC(6,4) NOT NULL DEFAULT 0.06,
  tax_inclusive BOOLEAN NOT NULL DEFAULT false,
  currency VARCHAR(3) NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, region)
);

ALTER TABLE regional_tax_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "regional_tax_rates_org_access" ON regional_tax_rates;
CREATE POLICY "regional_tax_rates_org_access" ON regional_tax_rates
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid()));

-- 迁移现有业务值到 CN（软件 13% / 服务 6% / 不含税 / CNY）
INSERT INTO regional_tax_rates (org_id, region, software_rate, service_rate, tax_inclusive, currency, status)
SELECT o.id, 'CN', 0.13, 0.06, false, 'CNY', 'PUBLISHED'
FROM organizations o
ON CONFLICT (org_id, region) DO NOTHING;
