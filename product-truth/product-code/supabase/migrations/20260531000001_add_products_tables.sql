-- Migration: Add product categories and products tables for price list management
-- REQ:F001

-- Product categories (hierarchical)
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    parent_id UUID REFERENCES product_categories(id),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Products
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

-- Indexes
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_categories_parent ON product_categories(parent_id);

-- Enable RLS
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow authenticated read products"
    ON products FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read categories"
    ON product_categories FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated manage products"
    ON products FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated manage categories"
    ON product_categories FOR ALL
    TO authenticated
    USING (true);

-- Insert sample categories
INSERT INTO product_categories (name, code, sort_order) VALUES
('软件服务', 'SOFTWARE', 1),
('硬件设备', 'HARDWARE', 2),
('咨询服务', 'CONSULTING', 3)
ON CONFLICT (code) DO NOTHING;

-- Insert sample products
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
