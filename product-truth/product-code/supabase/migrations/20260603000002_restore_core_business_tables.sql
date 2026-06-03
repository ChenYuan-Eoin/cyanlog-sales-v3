-- Migration: 20260603000002_restore_core_business_tables.sql
-- PURPOSE: 恢复被 20260602000001_org_model.sql 删除但未重建的核心业务表

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  subtotal DECIMAL(15, 2) DEFAULT 0,
  tax_amount DECIMAL(15, 2) DEFAULT 0,
  discount_amount DECIMAL(15, 2) DEFAULT 0,
  total_amount DECIMAL(15, 2) DEFAULT 0,
  status TEXT DEFAULT 'DRAFT',
  valid_until TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
  discount DECIMAL(15, 2) DEFAULT 0,
  line_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  parsed_text TEXT,
  ocr_result JSONB,
  ocr_status TEXT DEFAULT 'PENDING',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  results JSONB,
  ai_result JSONB,
  rule_version INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('structured', 'semantic')),
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('red', 'yellow', 'green')),
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  parent_id UUID REFERENCES product_categories(id),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  category_id UUID REFERENCES product_categories(id),
  specification TEXT,
  unit VARCHAR(50),
  base_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
  cost_price DECIMAL(15, 2) DEFAULT 0,
  min_price DECIMAL(15, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'discontinued')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_contracts_created_by ON contracts(created_by);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contract_reviews_contract_id ON contract_reviews(contract_id);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);
CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON product_categories(parent_id);

DROP TRIGGER IF EXISTS update_quotes_updated_at ON quotes;
CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;
CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rules_updated_at ON rules;
CREATE TRIGGER update_rules_updated_at
  BEFORE UPDATE ON rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.approvals') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'approvals_quote_id_fkey'
    ) THEN
    ALTER TABLE approvals
      ADD CONSTRAINT approvals_quote_id_fkey
      FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.approvals') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'approvals'
        AND policyname = 'Quote stakeholders read approvals'
    ) THEN
    CREATE POLICY "Quote stakeholders read approvals" ON approvals
      FOR SELECT TO authenticated
      USING (
        quote_id IN (
          SELECT id FROM quotes WHERE created_by = auth.uid()
        )
        OR approver_id = auth.uid()
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes' AND policyname = 'Owner reads quotes'
  ) THEN
    CREATE POLICY "Owner reads quotes" ON quotes
      FOR SELECT TO authenticated
      USING (created_by = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_items' AND policyname = 'Owner reads quote_items'
  ) THEN
    CREATE POLICY "Owner reads quote_items" ON quote_items
      FOR SELECT TO authenticated
      USING (
        quote_id IN (
          SELECT id FROM quotes WHERE created_by = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contracts' AND policyname = 'Owner reads contracts'
  ) THEN
    CREATE POLICY "Owner reads contracts" ON contracts
      FOR SELECT TO authenticated
      USING (created_by = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contract_reviews' AND policyname = 'Owner reads contract_reviews'
  ) THEN
    CREATE POLICY "Owner reads contract_reviews" ON contract_reviews
      FOR SELECT TO authenticated
      USING (
        contract_id IN (
          SELECT id FROM contracts WHERE created_by = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rules' AND policyname = 'Allow authenticated read rules'
  ) THEN
    CREATE POLICY "Allow authenticated read rules"
      ON rules FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rules' AND policyname = 'Allow authenticated create rules'
  ) THEN
    CREATE POLICY "Allow authenticated create rules"
      ON rules FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rules' AND policyname = 'Allow authenticated update rules'
  ) THEN
    CREATE POLICY "Allow authenticated update rules"
      ON rules FOR UPDATE TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rules' AND policyname = 'Allow authenticated delete rules'
  ) THEN
    CREATE POLICY "Allow authenticated delete rules"
      ON rules FOR DELETE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'Allow authenticated read products'
  ) THEN
    CREATE POLICY "Allow authenticated read products"
      ON products FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'Allow authenticated manage products'
  ) THEN
    CREATE POLICY "Allow authenticated manage products"
      ON products FOR ALL TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_categories' AND policyname = 'Allow authenticated read categories'
  ) THEN
    CREATE POLICY "Allow authenticated read categories"
      ON product_categories FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_categories' AND policyname = 'Allow authenticated manage categories'
  ) THEN
    CREATE POLICY "Allow authenticated manage categories"
      ON product_categories FOR ALL TO authenticated USING (true);
  END IF;
END
$$;

INSERT INTO rules (name, description, rule_type, risk_level, enabled, config)
SELECT *
FROM (
  VALUES
    (
      '付款账期检查',
      '账期超过90天触发红灯警告',
      'structured',
      'red',
      true,
      '{"field": "账期", "operator": "gt", "value": 90}'::jsonb
    ),
    (
      '违约金比例检查',
      '违约金超过5%触发黄灯警告',
      'structured',
      'yellow',
      true,
      '{"field": "违约金", "operator": "gt", "value": 5}'::jsonb
    ),
    (
      '合同期限合理性',
      '检查合同期限是否合理',
      'semantic',
      'yellow',
      true,
      '{"prompt": "检查合同期限条款是否存在明显不合理之处，如期限过长或过短"}'::jsonb
    )
) AS seed(name, description, rule_type, risk_level, enabled, config)
WHERE NOT EXISTS (
  SELECT 1 FROM rules WHERE rules.name = seed.name
);

INSERT INTO product_categories (name, code, sort_order)
SELECT *
FROM (
  VALUES
    ('软件服务', 'SOFTWARE', 1),
    ('硬件设备', 'HARDWARE', 2),
    ('咨询服务', 'CONSULTING', 3)
) AS seed(name, code, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM product_categories WHERE product_categories.code = seed.code
);

INSERT INTO products (name, code, category_id, specification, unit, base_price, cost_price, status)
SELECT
  '企业版SaaS授权',
  'P001',
  (SELECT id FROM product_categories WHERE code = 'SOFTWARE' LIMIT 1),
  '年度授权，支持100用户',
  '年',
  50000.00,
  30000.00,
  'active'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE code = 'P001');
