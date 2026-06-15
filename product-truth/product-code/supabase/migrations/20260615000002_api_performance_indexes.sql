-- Migration: 添加 products 和 configs API 性能索引
-- Purpose: 优化产品列表和配置列表查询
-- Date: 2026-06-15

-- 1. products 表索引优化
-- 加速按组织查询产品（主查询）
CREATE INDEX IF NOT EXISTS idx_products_org_created
  ON products(org_id, created_at DESC);

-- 加速按组织和分类查询
CREATE INDEX IF NOT EXISTS idx_products_org_category
  ON products(org_id, category_id)
  WHERE category_id IS NOT NULL;

-- 加速按状态查询
CREATE INDEX IF NOT EXISTS idx_products_org_status
  ON products(org_id, status);

-- 加速搜索查询
CREATE INDEX IF NOT EXISTS idx_products_org_name
  ON products(org_id, name);

CREATE INDEX IF NOT EXISTS idx_products_org_code
  ON products(org_id, code);

-- 2. configs 表索引优化
-- 加速按组织和类型查询配置
CREATE INDEX IF NOT EXISTS idx_configs_org_type_key
  ON configs(org_id, type, key);

-- 加速按组织和状态查询
CREATE INDEX IF NOT EXISTS idx_configs_org_status
  ON configs(org_id, status);

-- 3. product_categories 表索引优化
-- 加速按组织查询分类
CREATE INDEX IF NOT EXISTS idx_product_categories_org
  ON product_categories(org_id);

-- 4. product_price_tiers 表索引优化
-- 加速按产品查询阶梯价
CREATE INDEX IF NOT EXISTS idx_product_tiers_product
  ON product_price_tiers(product_id);

-- 添加注释
COMMENT ON INDEX idx_products_org_created IS '优化产品列表分页查询';
COMMENT ON INDEX idx_products_org_category IS '优化按分类筛选产品';
COMMENT ON INDEX idx_configs_org_type_key IS '优化配置中心列表查询';
COMMENT ON INDEX idx_product_tiers_product IS '优化产品阶梯价查询';
