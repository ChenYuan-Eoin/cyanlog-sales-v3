-- Migration: 20260618000002_contract_drafts.sql
-- PURPOSE: Phase 1 - AI 智能起草草稿表
-- REQ: F005v2
-- Dependencies: 001_initial_schema.sql (contracts, users, organizations, quotes)

-- ═══════════════════════════════════════════════════════════════
-- 1. 合同草稿表
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 基础信息
  title TEXT,                                        -- 草稿标题
  party_a_name TEXT,                                 -- 甲方(我方)
  party_b_name TEXT,                                 -- 乙方(客户)
  party_b_contact TEXT,                              -- 乙方联系人
  contract_amount DECIMAL(15,2),                   -- 合同金额
  tax_amount DECIMAL(15,2),                        -- 税额

  -- CRM 联动
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id UUID,                                   -- 关联客户

  -- 业务参数 (JSON)
  business_params JSONB DEFAULT '{}',
  -- 示例: {payment_method: "3-4-3", deployment_type: "公有云", ...}

  -- 条款开关 (JSON)
  clause_toggles JSONB DEFAULT '{}',
  -- 示例: {ip_protection: true, penalty_compensation: false, ...}

  -- AI 增补诉求 (JSON数组)
  ai_additions JSONB DEFAULT '[]',
  -- 示例: [{text: "送3天培训", clause_type: "培训条款", inserted_at: "..."}]

  -- 生成的合同内容
  generated_content TEXT,                           -- 生成的完整合同文本 (Markdown)

  -- 状态机
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'generated', 'submitted_for_review', 'approved')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_contract_drafts_org ON contract_drafts(org_id);
CREATE INDEX IF NOT EXISTS idx_contract_drafts_user ON contract_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_contract_drafts_status ON contract_drafts(status);
CREATE INDEX IF NOT EXISTS idx_contract_drafts_quote ON contract_drafts(quote_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. 合同模板参数表 (支持多种业务类型的模板参数定义)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contract_template_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  param_key TEXT NOT NULL,                           -- 参数标识, e.g. "payment_method"
  param_type TEXT NOT NULL
    CHECK (param_type IN ('enum', 'toggle', 'text', 'number', 'date')),
  param_label TEXT NOT NULL,                         -- 显示名称
  param_options JSONB,                               -- 枚举选项 [{value, label}]
  default_value JSONB,                              -- 默认值
  required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,

  -- 适用场景
  applicable_scenario TEXT DEFAULT 'general',        -- general / saas_buyout / saas_subscription / deployment

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_params_org ON contract_template_params(org_id);
CREATE INDEX IF NOT EXISTS idx_template_params_scenario ON contract_template_params(applicable_scenario);

-- ═══════════════════════════════════════════════════════════════
-- 3. 触发器：自动更新 updated_at
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_contract_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_contract_drafts_updated_at ON contract_drafts;
CREATE TRIGGER tr_contract_drafts_updated_at
  BEFORE UPDATE ON contract_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_drafts_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 4. Seed: 默认模板参数 (Phase 1 基础参数)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO contract_template_params (org_id, param_key, param_type, param_label, param_options, default_value, required, sort_order, applicable_scenario)
SELECT
  o.id AS org_id,
  p.param_key,
  p.param_type,
  p.param_label,
  p.param_options::jsonb,
  p.default_value::jsonb,
  p.required,
  p.sort_order,
  p.applicable_scenario
FROM organizations o
CROSS JOIN (VALUES
  ('payment_method', 'enum', '付款方式', '[{"value":"3-4-3","label":"3-4-3分期"},{"value":"full","label":"预付全款"},{"value":"milestone","label":"验收支付"}]', '{"value":"3-4-3"}', true, 1, 'general'),
  ('deployment_type', 'enum', '部署方式', '[{"value":"public_cloud","label":"公有云"},{"value":"private_cloud","label":"私有部署"}]', '{"value":"public_cloud"}', true, 2, 'general'),
  ('service_term', 'number', '服务期限(月)', null, '{"value":12}', true, 3, 'general'),
  ('ip_protection', 'toggle', '知识产权加强保护', null, '{"value":false}', false, 4, 'general'),
  ('penalty_compensation', 'toggle', '交付违约金补偿', null, '{"value":false}', false, 5, 'general'),
  ('dispute_resolution', 'enum', '争议解决地点', '[{"value":"shenzhen","label":"深圳南山区法院"},{"value":"beijing","label":"北京仲裁委员会"}]', '{"value":"shenzhen"}', true, 6, 'general')
) AS p(param_key, param_type, param_label, param_options, default_value, required, sort_order, applicable_scenario)
WHERE NOT EXISTS (
  SELECT 1 FROM contract_template_params t WHERE t.org_id = o.id AND t.param_key = p.param_key
);
