-- Migration: 20260617000002_F005_v2_derivation.sql
-- PURPOSE: F005 v2 派生设计 - 新表（规则集/变体词典/知识库/权限点）

-- =====================================================
-- 1. 合同规则集（多套可重叠，柔性化 3 级阈值）
-- =====================================================
CREATE TABLE IF NOT EXISTS contract_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  applicable_scenario TEXT,
  priority INT DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, code)
);

-- 合同规则（12 条核心规则，柔性化 3 级阈值）
CREATE TABLE IF NOT EXISTS contract_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id UUID NOT NULL REFERENCES contract_rule_sets(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  -- 3 级阈值
  threshold_lower_bound DECIMAL,
  threshold_recommended_min DECIMAL,
  threshold_recommended_max DECIMAL,
  threshold_red_line DECIMAL,
  threshold_unit TEXT,
  -- 适用条件
  applicable_to_contract_types TEXT[] DEFAULT '{}',
  -- 关联资源
  reference_doc_id UUID,
  variant_terms TEXT[] DEFAULT '{}',
  -- 让步梯度（JSONB 数组）
  concession_gradient JSONB DEFAULT '[]',
  -- 话术（JSONB 数组）
  scripts JSONB DEFAULT '[]',
  -- 审批角色
  approval_roles TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rule_set_id, code)
);

CREATE INDEX IF NOT EXISTS idx_contract_rules_set ON contract_rules(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_contract_rules_org ON contract_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_contract_rules_code ON contract_rules(code);

-- 规则审计日志
CREATE TABLE IF NOT EXISTS contract_rule_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES contract_rules(id) ON DELETE SET NULL,
  rule_set_id UUID REFERENCES contract_rule_sets(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  changed_by UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  change_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_rule_audit_changed_at ON contract_rule_audit_logs(changed_at DESC);

-- =====================================================
-- 2. 变体词典（1.2 万词）
-- =====================================================
CREATE TABLE IF NOT EXISTS contract_variant_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  standard_term TEXT NOT NULL,
  standard_category TEXT NOT NULL,
  variant_term TEXT NOT NULL,
  variant_language TEXT DEFAULT 'zh',
  confidence DECIMAL(3,2) DEFAULT 1.0,
  source TEXT DEFAULT 'seed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, standard_term, variant_term)
);

CREATE INDEX IF NOT EXISTS idx_variant_standard ON contract_variant_dictionary(standard_term);
CREATE INDEX IF NOT EXISTS idx_variant_term ON contract_variant_dictionary(variant_term);

-- =====================================================
-- 3. AI 降级配置
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_degradation_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Layer 1
  layer1_enabled BOOLEAN DEFAULT true,
  layer1_provider TEXT DEFAULT 'gpt-oss-20b',
  layer1_timeout_sec INT DEFAULT 30,
  layer1_failure_threshold INT DEFAULT 3,
  -- Layer 2
  layer2_enabled BOOLEAN DEFAULT true,
  layer2_provider TEXT DEFAULT 'claude-3-5-sonnet',
  layer2_timeout_sec INT DEFAULT 60,
  layer2_failure_threshold INT DEFAULT 3,
  -- Layer 3
  layer3_enabled BOOLEAN DEFAULT true,
  layer3_rule_set_id UUID REFERENCES contract_rule_sets(id),
  -- Layer 4
  layer4_trigger TEXT DEFAULT 'all_failed',
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id)
);

-- =====================================================
-- 4. 知识库（Notion 风格树状）
-- =====================================================
CREATE TABLE IF NOT EXISTS knowledge_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('folder', 'doc', 'template', 'rule', 'case', 'qualification', 'reference')),
  content JSONB DEFAULT '[]'::jsonb,
  content_text TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  template_file_url TEXT,
  template_file_size BIGINT,
  template_mime TEXT,
  depth INT DEFAULT 0,
  path TEXT,
  sort_order INT DEFAULT 0,
  is_published BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_pages_parent ON knowledge_pages(parent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_org ON knowledge_pages(org_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_type ON knowledge_pages(type);

-- 知识库页面权限
CREATE TABLE IF NOT EXISTS knowledge_page_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'role', 'org')),
  principal_id UUID NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'edit', 'admin')),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(page_id, principal_type, principal_id, permission)
);

-- 知识库页面版本历史
CREATE TABLE IF NOT EXISTS knowledge_page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content JSONB,
  metadata JSONB,
  saved_by UUID REFERENCES users(id),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  change_note TEXT,
  UNIQUE(page_id, version)
);

-- =====================================================
-- 5. 权限点（按权限点隔离，不直接配人）
-- =====================================================
CREATE TABLE IF NOT EXISTS permission_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  scope JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_permission_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  permission_point_id UUID NOT NULL REFERENCES permission_points(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, permission_point_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_perm_user ON user_permission_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_perm_point ON user_permission_assignments(permission_point_id);

-- =====================================================
-- 6. 扩展 contract_reviews 加 ai_degradation 字段
-- =====================================================
ALTER TABLE contract_reviews
  ADD COLUMN IF NOT EXISTS ai_degradation JSONB DEFAULT '{}'::jsonb;

-- =====================================================
-- 7. RLS（简化版多租户隔离）
-- =====================================================
ALTER TABLE contract_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_rule_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_variant_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_degradation_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_assignments ENABLE ROW LEVEL SECURITY;

-- 简化 RLS：同 org 可读
CREATE POLICY rule_sets_isolation ON contract_rule_sets
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY contract_rules_isolation ON contract_rules
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY variant_dict_isolation ON contract_variant_dictionary
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY ai_degradation_isolation ON ai_degradation_configs
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY knowledge_pages_isolation ON knowledge_pages
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

-- 知识库页面权限：默认同 org 可读
CREATE POLICY knowledge_perm_isolation ON knowledge_page_permissions
  FOR ALL TO authenticated USING (
    page_id IN (SELECT id FROM knowledge_pages WHERE org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid()))
  );

CREATE POLICY knowledge_ver_isolation ON knowledge_page_versions
  FOR ALL TO authenticated USING (
    page_id IN (SELECT id FROM knowledge_pages WHERE org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid()))
  );

CREATE POLICY user_perm_isolation ON user_permission_assignments
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );
