-- =====================================================
-- Cyanlog Sales Platform - 初始数据库迁移
-- 生成时间: 2026-05-31
-- 对应: Account.md, 报价中心.md, 合同审核.md
-- =====================================================

-- -----------------------------------------------------
-- 1. Account 模块（认证与权限）
-- -----------------------------------------------------

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  password_hash VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 第三方身份映射（支持多平台）
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  feishu_union_id VARCHAR(255),
  feishu_tenant_key VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  UNIQUE(provider, provider_user_id)
);

-- 部门表
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  parent_id UUID REFERENCES departments(id),
  leader_id UUID REFERENCES users(id),
  external_id VARCHAR(255),
  source VARCHAR(50) DEFAULT 'manual',
  path TEXT,
  level INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户-部门关联
CREATE TABLE IF NOT EXISTS user_departments (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  PRIMARY KEY (user_id, department_id)
);

-- 角色表
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  permissions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户角色
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- -----------------------------------------------------
-- 2. 报价中心模块
-- -----------------------------------------------------

-- 报价单
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  subtotal DECIMAL(15,2) DEFAULT 0,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  status TEXT DEFAULT 'DRAFT',
  valid_until DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 报价单项
CREATE TABLE IF NOT EXISTS quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) DEFAULT 0,
  line_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- -----------------------------------------------------
-- 3. 合同审核模块
-- -----------------------------------------------------

-- 合同
CREATE TABLE IF NOT EXISTS contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  parsed_text TEXT,
  ocr_result JSONB, -- F008: OCR 解析结果（extracted_data + confidence）
  ocr_status TEXT DEFAULT 'PENDING', -- F008: PENDING/PARSING/COMPLETED/FAILED
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 审核结果
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

-- -----------------------------------------------------
-- Token 表（用于登出失效）
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------
-- 4. 触发器（自动更新 updated_at）
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- 5. RLS（行级安全）
-- -----------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------
-- 6. 初始角色数据
-- -----------------------------------------------------

INSERT INTO roles (code, name, permissions) VALUES
  ('SUPER_ADMIN', '超级管理员', '["*"]'),
  ('SALES_MANAGER', '销售经理', '["quote:*", "contract:view", "customer:*", "report:view"]'),
  ('SALES', '销售', '["quote:create", "quote:update_own", "contract:view", "customer:view", "customer:create"]'),
  ('LEGAL', '法务', '["contract:*", "quote:view", "customer:view"]'),
  ('SALES_OPS', '销售运营', '["config:*", "user:view", "role:view", "report:*"]'),
  ('FINANCE', '财务', '["quote:view", "contract:view", "payment:*", "report:view"]'),
  ('READONLY', '只读用户', '["quote:view", "contract:view", "customer:view"]');