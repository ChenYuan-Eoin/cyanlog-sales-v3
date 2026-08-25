-- WP10 阶段1：产品线隔离（ONES 为第一套种子数据；换客户/产品线只配数据）
-- 原则：product_line 挂在 products（产品目录），价盘/版本/税率/规则通过产品目录继承产品线
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_line VARCHAR(50) NOT NULL DEFAULT 'ONES';

CREATE INDEX IF NOT EXISTS idx_products_product_line ON products(org_id, product_line);
