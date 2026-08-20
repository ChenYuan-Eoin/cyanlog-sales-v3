-- WP10 阶段4/7：报价冻结版本 → 下游派生（销售订单/盖章申请/标书数据包）
-- 原则：下游全部从 quote_versions 派生，字段逐位一致；quote_derivations 统一留痕
-- 说明：生产应用需授权；代码兼容未迁移库（schema-drift 剥离新表重试）

-- 1. 统一派生记录（留痕：谁在何时从哪个版本派生了什么）
CREATE TABLE IF NOT EXISTS quote_derivations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  derivation_type VARCHAR(30) NOT NULL CHECK (derivation_type IN ('contract', 'order', 'seal', 'tender')),
  target_id UUID,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_derivations_quote ON quote_derivations(quote_id, derivation_type);

-- 2. 销售订单草稿（从冻结版本派生；金额/税/明细逐位一致）
CREATE TABLE IF NOT EXISTS order_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  source_version_id UUID REFERENCES quote_versions(id) ON DELETE SET NULL,
  order_no TEXT,
  customer_name TEXT,
  currency TEXT DEFAULT 'CNY',
  subtotal DECIMAL(15,2),
  discount_amount DECIMAL(15,2),
  tax_amount DECIMAL(15,2),
  total_amount DECIMAL(15,2),
  business_params JSONB DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_org ON order_drafts(org_id);
CREATE INDEX IF NOT EXISTS idx_order_drafts_quote ON order_drafts(quote_id);

-- 3. 盖章申请（从冻结版本派生；审批后进入盖章流程）
CREATE TABLE IF NOT EXISTS seal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  source_version_id UUID REFERENCES quote_versions(id) ON DELETE SET NULL,
  reason TEXT,
  customer_name TEXT,
  total_amount DECIMAL(15,2),
  business_params JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sealed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seal_requests_org ON seal_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_seal_requests_quote ON seal_requests(quote_id);

-- 4. 标书数据包（冻结版本 → 标书填写/审核盖章的结构化数据）
CREATE TABLE IF NOT EXISTS tender_quote_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  source_version_id UUID REFERENCES quote_versions(id) ON DELETE SET NULL,
  title TEXT,
  package_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_quote_packages_org ON tender_quote_packages(org_id);
CREATE INDEX IF NOT EXISTS idx_tender_quote_packages_quote ON tender_quote_packages(quote_id);
