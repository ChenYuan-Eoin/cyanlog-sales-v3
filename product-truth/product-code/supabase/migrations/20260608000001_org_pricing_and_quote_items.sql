-- Migration: 20260608000001_org_pricing_and_quote_items.sql
-- PURPOSE: 组织级价盘、阶梯价、报价明细快照、多组织规则隔离

-- 1. products / categories 增加 org_id，消除全局表语义
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tier_pricing_enabled BOOLEAN NOT NULL DEFAULT false;

WITH fallback_org AS (
  SELECT id
  FROM organizations
  ORDER BY created_at NULLS FIRST, id
  LIMIT 1
)
UPDATE products p
SET org_id = COALESCE(
  p.org_id,
  (SELECT u.org_id FROM users u WHERE u.id = p.created_by),
  (SELECT id FROM fallback_org)
)
WHERE p.org_id IS NULL;

ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

WITH fallback_org AS (
  SELECT id
  FROM organizations
  ORDER BY created_at NULLS FIRST, id
  LIMIT 1
)
UPDATE product_categories pc
SET org_id = COALESCE(
  pc.org_id,
  (SELECT p.org_id FROM products p WHERE p.category_id = pc.id AND p.org_id IS NOT NULL LIMIT 1),
  (SELECT id FROM fallback_org)
)
WHERE pc.org_id IS NULL;

ALTER TABLE products
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE product_categories
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_code_key;
ALTER TABLE product_categories DROP CONSTRAINT IF EXISTS product_categories_code_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_org_code_key'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_org_code_key UNIQUE (org_id, code);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_categories_org_code_key'
  ) THEN
    ALTER TABLE product_categories
      ADD CONSTRAINT product_categories_org_code_key UNIQUE (org_id, code);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_products_org_id ON products(org_id);
CREATE INDEX IF NOT EXISTS idx_products_org_status ON products(org_id, status);
CREATE INDEX IF NOT EXISTS idx_product_categories_org_id ON product_categories(org_id);

-- 2. 阶梯价表
CREATE TABLE IF NOT EXISTS product_price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_from INT NOT NULL,
  qty_to INT NULL,
  unit_price DECIMAL(15, 2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_price_tiers_qty_range_check CHECK (qty_from >= 1 AND (qty_to IS NULL OR qty_to > qty_from)),
  CONSTRAINT product_price_tiers_qty_from_key UNIQUE (product_id, qty_from)
);

CREATE INDEX IF NOT EXISTS idx_product_price_tiers_product_id ON product_price_tiers(product_id);

DROP TRIGGER IF EXISTS update_product_price_tiers_updated_at ON product_price_tiers;
CREATE TRIGGER update_product_price_tiers_updated_at
  BEFORE UPDATE ON product_price_tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE product_price_tiers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_price_tiers'
      AND policyname = 'Product price tiers org access'
  ) THEN
    CREATE POLICY "Product price tiers org access" ON product_price_tiers
      FOR ALL TO authenticated
      USING (
        product_id IN (
          SELECT id
          FROM products
          WHERE org_id IN (
            SELECT org_id
            FROM user_organizations
            WHERE user_id = auth.uid()
          )
        )
      );
  END IF;
END
$$;

-- 3. rules 增加 org_id，避免跨组织共享审核规则
ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

WITH fallback_org AS (
  SELECT id
  FROM organizations
  ORDER BY created_at NULLS FIRST, id
  LIMIT 1
)
UPDATE rules r
SET org_id = COALESCE(
  r.org_id,
  (SELECT u.org_id FROM users u WHERE u.id = r.created_by),
  (SELECT id FROM fallback_org)
)
WHERE r.org_id IS NULL;

ALTER TABLE rules
  ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rules_org_enabled ON rules(org_id, enabled);

DROP POLICY IF EXISTS "Rules read for authenticated" ON rules;
DROP POLICY IF EXISTS "Rules create for admin" ON rules;
DROP POLICY IF EXISTS "Rules update for admin" ON rules;
DROP POLICY IF EXISTS "Rules delete for admin" ON rules;

CREATE POLICY "Rules read for authenticated" ON rules
  FOR SELECT TO authenticated USING (
    org_id IN (
      SELECT org_id
      FROM user_organizations
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Rules create for admin" ON rules
  FOR INSERT TO authenticated WITH CHECK (
    org_id IN (
      SELECT org_id
      FROM user_organizations
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = auth.uid() AND r.code IN ('SUPER_ADMIN', 'SALES_OPS')
    )
  );

CREATE POLICY "Rules update for admin" ON rules
  FOR UPDATE TO authenticated USING (
    org_id IN (
      SELECT org_id
      FROM user_organizations
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = auth.uid() AND r.code IN ('SUPER_ADMIN', 'SALES_OPS')
    )
  );

CREATE POLICY "Rules delete for admin" ON rules
  FOR DELETE TO authenticated USING (
    org_id IN (
      SELECT org_id
      FROM user_organizations
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = auth.uid() AND r.code IN ('SUPER_ADMIN', 'SALES_OPS')
    )
  );

-- 4. quotes / quote_items 增加组织和快照字段
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS discount_rate DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(6, 4) NOT NULL DEFAULT 0;

WITH fallback_org AS (
  SELECT id
  FROM organizations
  ORDER BY created_at NULLS FIRST, id
  LIMIT 1
)
UPDATE quotes q
SET org_id = COALESCE(
  q.org_id,
  (SELECT u.org_id FROM users u WHERE u.id = q.created_by),
  (SELECT id FROM fallback_org)
)
WHERE q.org_id IS NULL;

ALTER TABLE quotes
  ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_org_created_at ON quotes(org_id, created_at DESC);

ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_code TEXT,
  ADD COLUMN IF NOT EXISTS specification TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS pricing_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tier_range TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_quote_items_product_id ON quote_items(product_id);

DROP TRIGGER IF EXISTS update_quote_items_updated_at ON quote_items;
CREATE TRIGGER update_quote_items_updated_at
  BEFORE UPDATE ON quote_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_items_pricing_source_check'
  ) THEN
    ALTER TABLE quote_items
      ADD CONSTRAINT quote_items_pricing_source_check
      CHECK (pricing_source IN ('base', 'tier', 'manual'));
  END IF;
END
$$;

DROP POLICY IF EXISTS "Owner reads quotes" ON quotes;
CREATE POLICY "Quote org stakeholders read" ON quotes
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    AND org_id IN (
      SELECT org_id
      FROM user_organizations
      WHERE user_id = auth.uid()
    )
  );
