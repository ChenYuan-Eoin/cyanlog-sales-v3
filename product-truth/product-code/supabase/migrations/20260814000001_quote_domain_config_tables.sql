-- ============================================================
-- F027-F036 报价域配置对象强类型表（阶段 0 配置地基）
-- Date: 2026-08-14
-- 原则：机制与数据分离；配置中心唯一控制面；org 级隔离；版本化
-- 说明：status 复用 config_status 枚举（DRAFT/PUBLISHED/ARCHIVED）
-- ============================================================

-- 1. products 扩展：ONES 产品目录属性（O1）
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb;

-- 2. 版本能力矩阵（O2）
CREATE TABLE IF NOT EXISTS product_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_code VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  deployments JSONB NOT NULL DEFAULT '[]'::jsonb,      -- PUBLIC_CLOUD/PRIVATE/HA
  auth_modes JSONB NOT NULL DEFAULT '[]'::jsonb,       -- SUB_YEAR/SUB_3YEAR/ONETIME
  term_options JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 12/36/null(永久)
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,     -- {ha, xinchuang, onetime, migration}
  mutex JSONB NOT NULL DEFAULT '{}'::jsonb,            -- 能力互斥
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_versions_org_code_key UNIQUE (org_id, version_code)
);

-- 3. 多维价盘（O3）
CREATE TABLE IF NOT EXISTS price_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version_code VARCHAR(20) NOT NULL,
  deployment VARCHAR(20) NOT NULL,
  auth_mode VARCHAR(20) NOT NULL,
  term_months INT,                                     -- 12/36；买断为 NULL(永久)
  currency VARCHAR(3) NOT NULL DEFAULT 'CNY',
  qty_from INT NOT NULL,
  qty_to INT,                                          -- NULL=上不封顶；10,000+ 档无价
  unit_price NUMERIC(15,2),                            -- 区间单账号刊例价（边际）；10,000+ 为 NULL
  list_price NUMERIC(15,2),                            -- 累计刊例价；10,000+ 为 NULL
  sort_order INT NOT NULL DEFAULT 0,
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_matrix_range_check CHECK (qty_from >= 1 AND (qty_to IS NULL OR qty_to > qty_from)),
  CONSTRAINT price_matrix_org_key UNIQUE (org_id, product_id, version_code, deployment, auth_mode, term_months, currency, qty_from)
);
CREATE TABLE IF NOT EXISTS price_matrix_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matrix_id UUID NOT NULL REFERENCES price_matrix(id) ON DELETE CASCADE,
  version INT NOT NULL,
  value JSONB NOT NULL,
  status config_status NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_matrix_versions_key UNIQUE (matrix_id, version)
);

-- 4. 业务参数（O4）
CREATE TABLE IF NOT EXISTS business_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  param_key VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_type VARCHAR(20) NOT NULL DEFAULT 'number',     -- number/string/bool/date/json
  unit VARCHAR(20),
  category VARCHAR(50) NOT NULL,                       -- pricing/approval/maintenance/gift/customer/payment/tax/quote
  is_secret BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_params_org_key UNIQUE (org_id, param_key)
);
CREATE TABLE IF NOT EXISTS business_param_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  param_id UUID NOT NULL REFERENCES business_params(id) ON DELETE CASCADE,
  version INT NOT NULL,
  value JSONB NOT NULL,
  status config_status NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_param_versions_key UNIQUE (param_id, version)
);

-- 5. 审批规则/链/节点（O5；roles 表已存在，节点只引用 roles.id）
CREATE TABLE IF NOT EXISTS approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  mode VARCHAR(20) NOT NULL DEFAULT 'serial' CHECK (mode IN ('serial','parallel')),
  quorum VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (quorum IN ('all','any')),
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approval_chains_org_code_key UNIQUE (org_id, code)
);
CREATE TABLE IF NOT EXISTS approval_chain_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chain_id UUID NOT NULL REFERENCES approval_chains(id) ON DELETE CASCADE,
  ord INT NOT NULL,
  assignee_type VARCHAR(20) NOT NULL CHECK (assignee_type IN ('role','org','user','relation')),
  assignee_value TEXT NOT NULL,                        -- role_id/org_id/user_id/relation 标识；禁止人名
  condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  skip_on_unchanged BOOLEAN NOT NULL DEFAULT true,
  timeout_hours INT,
  escalation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approval_chain_nodes_ord_key UNIQUE (chain_id, ord)
);
CREATE TABLE IF NOT EXISTS approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  scene VARCHAR(50) NOT NULL,                          -- QUOTE_DISCOUNT/MAINT_DISCOUNT/UPGRADE_DISCOUNT
  condition JSONB NOT NULL DEFAULT '{}'::jsonb,        -- {discount:{gte,lt}} 比较器组合
  chain_id UUID NOT NULL REFERENCES approval_chains(id) ON DELETE RESTRICT,
  priority INT NOT NULL DEFAULT 10,                    -- 多条命中取最小 priority（最严）
  enabled BOOLEAN NOT NULL DEFAULT true,
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approval_rules_org_code_key UNIQUE (org_id, code)
);

-- 6. 字段字典（O6）
CREATE TABLE IF NOT EXISTS field_dictionaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_key VARCHAR(100) NOT NULL,
  business_name VARCHAR(200) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'input',         -- system/input/config/computed
  transform_rule VARCHAR(20) NOT NULL DEFAULT 'direct',-- direct/formula/semantic/conditional/capture
  output_classification VARCHAR(20) NOT NULL DEFAULT 'financial', -- header/software/financial/clause/internal
  is_external BOOLEAN NOT NULL DEFAULT false,          -- false=隐藏，永不进入输出流
  data_type VARCHAR(20) NOT NULL DEFAULT 'string',
  options JSONB,
  default_value JSONB,
  remark TEXT,
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_dictionaries_org_key UNIQUE (org_id, field_key)
);
CREATE TABLE IF NOT EXISTS field_dictionary_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dict_id UUID NOT NULL REFERENCES field_dictionaries(id) ON DELETE CASCADE,
  version INT NOT NULL,
  value JSONB NOT NULL,
  status config_status NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_dictionary_versions_key UNIQUE (dict_id, version)
);

-- 7. 输出模板（O7）
CREATE TABLE IF NOT EXISTS output_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  doc_type VARCHAR(20) NOT NULL CHECK (doc_type IN ('standard','customer')),
  scene VARCHAR(50),
  match_rule JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {v_type, deploy, auth} 条件
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,        -- field_key[]，必须 ⊆ 已发布字段字典
  content_ref TEXT,                                    -- 模板文件/内容引用（本地托管）
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT output_templates_org_code_key UNIQUE (org_id, code)
);
CREATE TABLE IF NOT EXISTS output_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES output_templates(id) ON DELETE CASCADE,
  version INT NOT NULL,
  value JSONB NOT NULL,
  status config_status NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT output_template_versions_key UNIQUE (template_id, version)
);

-- 8. 条款映射（O8）
CREATE TABLE IF NOT EXISTS clause_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(100) NOT NULL,
  match JSONB NOT NULL DEFAULT '{}'::jsonb,            -- {version, period, deployment, auth} 组合
  clause_code VARCHAR(100) NOT NULL,
  clause_text TEXT,
  template_ref TEXT,
  required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  status config_status NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clause_mappings_org_code_key UNIQUE (org_id, code)
);

-- 9. 单号规则（O9）
CREATE TABLE IF NOT EXISTS document_number_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL DEFAULT 'quote',
  prefix VARCHAR(50) NOT NULL DEFAULT '',
  date_format VARCHAR(20) NOT NULL DEFAULT 'YYYYMMDD',
  seq_start INT NOT NULL DEFAULT 1,
  padding INT NOT NULL DEFAULT 4,
  suffix VARCHAR(50) NOT NULL DEFAULT '',
  separator VARCHAR(10) NOT NULL DEFAULT '',
  next_seq INT NOT NULL DEFAULT 1,
  sample TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status config_status NOT NULL DEFAULT 'PUBLISHED',
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_number_rules_org_key UNIQUE (org_id, doc_type)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_price_matrix_org ON price_matrix(org_id);
CREATE INDEX IF NOT EXISTS idx_price_matrix_product ON price_matrix(product_id, version_code, deployment, auth_mode);
CREATE INDEX IF NOT EXISTS idx_business_params_org ON business_params(org_id, category);
CREATE INDEX IF NOT EXISTS idx_field_dictionaries_org ON field_dictionaries(org_id, output_classification);
CREATE INDEX IF NOT EXISTS idx_approval_rules_org ON approval_rules(org_id, scene, enabled);
CREATE INDEX IF NOT EXISTS idx_approval_chain_nodes_chain ON approval_chain_nodes(chain_id);
CREATE INDEX IF NOT EXISTS idx_product_versions_org ON product_versions(org_id);
CREATE INDEX IF NOT EXISTS idx_output_templates_org ON output_templates(org_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_clause_mappings_org ON clause_mappings(org_id);

-- updated_at 触发器
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_versions','price_matrix','business_params','approval_chains','approval_rules','field_dictionaries','output_templates','clause_mappings','document_number_rules']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
  END LOOP;
END
$$;

-- RLS（org 隔离，与 configs 同口径）
ALTER TABLE product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_matrix_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_param_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_chain_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_dictionaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_dictionary_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE output_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE output_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clause_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_number_rules ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_versions','price_matrix','business_params','approval_chains','approval_chain_nodes','approval_rules','field_dictionaries','output_templates','clause_mappings','document_number_rules']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_org_access" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_org_access" ON %I FOR ALL TO authenticated USING (org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid())) WITH CHECK (org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid()))', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['price_matrix_versions','business_param_versions','field_dictionary_versions','output_template_versions']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_org_access" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_org_access" ON %I FOR SELECT TO authenticated USING (true)', t, t);
  END LOOP;
END
$$;

-- ============================================================
-- 11. 报价结构化源字段（quotes / quote_items，F034 前置）
-- ============================================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS fx_source TEXT,
  ADD COLUMN IF NOT EXISTS fx_date DATE,
  ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS amount_in_words TEXT,
  ADD COLUMN IF NOT EXISTS tax_summary JSONB;

ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS version_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deployment VARCHAR(20),
  ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS term_months INT,
  ADD COLUMN IF NOT EXISTS list_price NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_original_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS maintenance_months INT,
  ADD COLUMN IF NOT EXISTS version_from VARCHAR(20),
  ADD COLUMN IF NOT EXISTS version_to VARCHAR(20),
  ADD COLUMN IF NOT EXISTS attributes JSONB;
