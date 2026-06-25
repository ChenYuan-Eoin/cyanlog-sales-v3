-- Migration: 20260617000001_contract_review_enhancement.sql
-- PURPOSE: 合同审查功能增强（条款库、审核策略、结构化报告）
-- 基于 iTerms 合同审查产品形态设计

-- Runtime contract APIs are organization-scoped. Older contract migrations only
-- had created_by, so add and backfill org_id before RLS policies below read it.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE contracts c
SET org_id = uo.org_id
FROM user_organizations uo
WHERE c.org_id IS NULL
  AND c.created_by = uo.user_id
  AND uo.is_default = TRUE;

UPDATE contracts c
SET org_id = u.org_id
FROM users u
WHERE c.org_id IS NULL
  AND c.created_by = u.id
  AND u.org_id IS NOT NULL;

UPDATE contracts c
SET org_id = fallback_org.id
FROM (
  SELECT id
  FROM organizations
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
) fallback_org
WHERE c.org_id IS NULL;

-- =====================================================
-- 1. 条款库 (clause_library)
-- 存储企业/行业标准条款模板，用于审核时的对比
-- =====================================================
CREATE TABLE IF NOT EXISTS clause_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  -- 全局条款（org_id 为 NULL）属于系统默认
  category TEXT NOT NULL,                          -- 条款类别: payment/delivery/law/quality/...
  name TEXT NOT NULL,                              -- 条款名称
  -- 法律立场: required/recommended/optional/risky/dangerous
  -- required   - 必备条款，缺失即为高风险
  -- recommended - 推荐条款，缺失为中风险
  -- optional   - 可选条款
  -- risky      - 风险条款，己方处于该立场时为高风险
  -- dangerous  - 危险条款，必须修改
  stance TEXT NOT NULL DEFAULT 'recommended' CHECK (stance IN ('required', 'recommended', 'optional', 'risky', 'dangerous')),
  -- 适用合同类型
  contract_types TEXT[] DEFAULT '{}',
  -- 标准条款内容
  template_text TEXT NOT NULL,
  -- 标准条款的法律依据/说明
  legal_basis TEXT,
  description TEXT,
  -- 标签
  tags TEXT[] DEFAULT '{}',
  -- 元数据
  is_system BOOLEAN DEFAULT false,                 -- 是否系统内置
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clause_library_org ON clause_library(org_id);
CREATE INDEX IF NOT EXISTS idx_clause_library_category ON clause_library(category);
CREATE INDEX IF NOT EXISTS idx_clause_library_stance ON clause_library(stance);
CREATE INDEX IF NOT EXISTS idx_clause_library_types ON clause_library USING GIN(contract_types);
CREATE INDEX IF NOT EXISTS idx_clause_library_tags ON clause_library USING GIN(tags);

ALTER TABLE clause_library ENABLE ROW LEVEL SECURITY;

-- 条款库策略：同组织可读，ADMIN 可写
DROP POLICY IF EXISTS "Same org reads clause_library" ON clause_library;
CREATE POLICY "Same org reads clause_library" ON clause_library
  FOR SELECT TO authenticated USING (
    org_id IS NULL
    OR org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "ADMIN writes clause_library" ON clause_library;
CREATE POLICY "ADMIN writes clause_library" ON clause_library
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

-- =====================================================
-- 2. 审核策略 (review_strategies)
-- 强势/平衡/弱势 三种审核立场
-- =====================================================
CREATE TABLE IF NOT EXISTS review_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  -- 策略代码: AGGRESSIVE(强势) / BALANCED(平衡) / CONSERVATIVE(弱势)
  code TEXT NOT NULL CHECK (code IN ('AGGRESSIVE', 'BALANCED', 'CONSERVATIVE')),
  name TEXT NOT NULL,
  description TEXT,
  -- 立场描述（这个立场对己方/对方的影响）
  -- 风险阈值: 0-100，越低越严格
  risk_threshold INT DEFAULT 50 CHECK (risk_threshold BETWEEN 0 AND 100),
  -- 启用的规则类别（决定审核重点）
  enabled_categories TEXT[] DEFAULT '{}',
  -- 自定义配置
  config JSONB DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_review_strategies_org ON review_strategies(org_id);

ALTER TABLE review_strategies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads review_strategies" ON review_strategies;
CREATE POLICY "Same org reads review_strategies" ON review_strategies
  FOR SELECT TO authenticated USING (
    org_id IS NULL
    OR org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "ADMIN writes review_strategies" ON review_strategies;
CREATE POLICY "ADMIN writes review_strategies" ON review_strategies
  FOR ALL TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

-- 预置默认策略
INSERT INTO review_strategies (id, org_id, code, name, description, risk_threshold, is_default)
VALUES
  (gen_random_uuid(), NULL, 'AGGRESSIVE', '强势（保护己方）',
   '最大程度保护己方利益，所有不利条款均标为高风险', 30, true),
  (gen_random_uuid(), NULL, 'BALANCED', '平衡（公平合作）',
   '甲乙双方权益平衡，识别明显不公平条款', 50, false),
  (gen_random_uuid(), NULL, 'CONSERVATIVE', '弱势（合作优先）',
   '以促成合作为主，仅标记严重风险条款', 70, false)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. 合同条款抽取 (contract_clauses)
-- 审核过程中从合同文本中识别出的每条具体条款
-- =====================================================
CREATE TABLE IF NOT EXISTS contract_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES contract_reviews(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  -- 条款在原文中的定位
  clause_number TEXT,                               -- 条款编号: "第一条", "1.1", "三、"
  clause_title TEXT,                                -- 条款标题
  clause_text TEXT NOT NULL,                        -- 条款原文
  -- 风险评估
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_category TEXT,                               -- 风险类别: payment/law/quality/...
  -- 风险说明
  risk_description TEXT,                            -- 为什么是风险
  legal_basis TEXT,                                 -- 法律依据（如《合同法》第X条）
  -- 修改建议
  suggestion TEXT,                                  -- 修改建议
  suggested_text TEXT,                              -- 建议的标准条款文本
  -- 关联
  matched_library_clause_id UUID REFERENCES clause_library(id),
  -- 元数据
  position INT,                                     -- 条款在合同中的顺序
  start_offset INT,
  end_offset INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_clauses_review ON contract_clauses(review_id);
CREATE INDEX IF NOT EXISTS idx_contract_clauses_contract ON contract_clauses(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_clauses_risk ON contract_clauses(risk_level);
CREATE INDEX IF NOT EXISTS idx_contract_clauses_position ON contract_clauses(review_id, position);

ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads contract_clauses" ON contract_clauses;
CREATE POLICY "Same org reads contract_clauses" ON contract_clauses
  FOR SELECT TO authenticated USING (
    contract_id::text IN (
      SELECT id::text FROM contracts
      WHERE org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
    )
  );

-- =====================================================
-- 4. 审核报告主表（contract_reviews 增强）
-- 在原有 contract_reviews 表基础上加字段
-- =====================================================
ALTER TABLE contract_reviews
  ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES review_strategies(id),
  ADD COLUMN IF NOT EXISTS risk_summary JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS effectiveness_analysis TEXT,
  ADD COLUMN IF NOT EXISTS compliance_check JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS report_version INT DEFAULT 1;

-- 风险汇总 JSONB 结构:
-- {
--   "total_clauses": 25,
--   "high_risks": 3,
--   "medium_risks": 5,
--   "low_risks": 2,
--   "critical_risks": 1,
--   "compliance_score": 75
-- }

-- 合规检查 JSONB 结构:
-- {
--   "missing_required_clauses": ["付款条款", "违约金条款"],
--   "dangerous_clauses": ["无限连带责任"],
--   "ambiguous_clauses": ["双方应...（未明确）"],
--   "unbalanced_clauses": ["仅甲方义务"]
-- }

-- =====================================================
-- 5. 合同版本 (contract_versions)
-- 合同修订历史
-- =====================================================
CREATE TABLE IF NOT EXISTS contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  -- 版本来源: original/original_review/revised
  source TEXT NOT NULL DEFAULT 'original' CHECK (source IN ('original', 'review_revision', 'manual_revision')),
  storage_path TEXT NOT NULL,                       -- 文件存储路径
  file_size BIGINT,
  mime_type TEXT,
  -- 元数据
  parent_version_id UUID REFERENCES contract_versions(id),
  change_summary TEXT,                              -- 变更摘要
  uploaded_by UUID REFERENCES users(id),
  review_id UUID REFERENCES contract_reviews(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contract_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_versions_parent ON contract_versions(parent_version_id);

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads contract_versions" ON contract_versions;
CREATE POLICY "Same org reads contract_versions" ON contract_versions
  FOR SELECT TO authenticated USING (
    contract_id::text IN (
      SELECT id::text FROM contracts
      WHERE org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
    )
  );

-- =====================================================
-- 6. 合同关联方 (contract_parties)
-- 甲乙双方及关联方信息（用于一致性检查）
-- =====================================================
CREATE TABLE IF NOT EXISTS contract_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  -- 角色: party_a/party_b
  role TEXT NOT NULL CHECK (role IN ('party_a', 'party_b', 'guarantor', 'witness')),
  -- 名称信息
  legal_name TEXT,                                  -- 法定名称
  short_name TEXT,                                  -- 简称
  tax_id TEXT,                                      -- 税号
  legal_representative TEXT,                        -- 法人代表
  -- 联系信息
  address TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  -- 关联性
  parent_company TEXT,                              -- 母公司
  related_party_ids UUID[] DEFAULT '{}',            -- 关联方 ID 列表
  -- 元数据
  confidence_score DECIMAL(3,2),                    -- 抽取置信度
  extraction_source TEXT,                           -- manual/ai_extracted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_parties_contract ON contract_parties(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_parties_role ON contract_parties(contract_id, role);

ALTER TABLE contract_parties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads contract_parties" ON contract_parties;
CREATE POLICY "Same org reads contract_parties" ON contract_parties
  FOR SELECT TO authenticated USING (
    contract_id::text IN (
      SELECT id::text FROM contracts
      WHERE org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
    )
  );

-- =====================================================
-- 7. 合同批注 (contract_annotations)
-- WPS 风格的批注系统
-- =====================================================
CREATE TABLE IF NOT EXISTS contract_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  clause_id UUID REFERENCES contract_clauses(id) ON DELETE CASCADE,
  -- 批注位置
  start_offset INT NOT NULL,
  end_offset INT NOT NULL,
  selected_text TEXT,                                -- 被批注的文本
  -- 批注内容
  comment TEXT NOT NULL,
  category TEXT,                                    -- issue/question/approval/revision
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  -- 作者
  author_id UUID REFERENCES users(id),
  -- 解决人
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  -- 元数据
  replies JSONB DEFAULT '[]',                       -- 回复列表
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_annotations_contract ON contract_annotations(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_annotations_clause ON contract_annotations(clause_id);
CREATE INDEX IF NOT EXISTS idx_contract_annotations_status ON contract_annotations(contract_id, status);

ALTER TABLE contract_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same org reads contract_annotations" ON contract_annotations;
CREATE POLICY "Same org reads contract_annotations" ON contract_annotations
  FOR SELECT TO authenticated USING (
    contract_id::text IN (
      SELECT id::text FROM contracts
      WHERE org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
    )
  );

-- =====================================================
-- 8. 预置标准条款库数据
-- 基于典型销售合同
-- =====================================================
INSERT INTO clause_library (id, org_id, category, name, stance, contract_types, template_text, legal_basis, description, is_system, tags)
VALUES
  -- 必备条款
  (gen_random_uuid(), NULL, 'payment', '明确付款条款', 'required', ARRAY['销售合同', '服务合同'],
   '甲方应于本合同签订之日起 X 日内，向乙方支付合同总价的 Y%，即人民币 Z 元。',
   '《中华人民共和国民法典》第五百九十五条',
   '明确付款时间、金额、方式，避免纠纷', true, ARRAY['付款', '核心条款']),

  (gen_random_uuid(), NULL, 'delivery', '明确交付条款', 'required', ARRAY['销售合同'],
   '乙方应于 X 年 X 月 X 日前将合同标的物交付甲方，交付地点为 X，交付方式为 X。',
   '《中华人民共和国民法典》第五百九十八条',
   '明确交付时间、地点、方式、验收标准', true, ARRAY['交付', '核心条款']),

  (gen_random_uuid(), NULL, 'quality', '质量保证条款', 'required', ARRAY['销售合同', '服务合同'],
   '乙方对合同标的物提供 X 个月的质量保证期，期间非人为损坏由乙方免费维修或更换。',
   '《中华人民共和国产品质量法》',
   '明确质保期、范围、责任', true, ARRAY['质保', '售后']),

  (gen_random_uuid(), NULL, 'breach', '违约金条款', 'required', ARRAY['销售合同', '服务合同'],
   '任何一方违反本合同约定，应向守约方支付合同总价 X% 的违约金，并赔偿守约方因此遭受的全部损失。',
   '《中华人民共和国民法典》第五百八十五条',
   '明确违约金比例和损失赔偿', true, ARRAY['违约', '核心条款']),

  (gen_random_uuid(), NULL, 'dispute', '争议解决条款', 'required', ARRAY['销售合同', '服务合同'],
   '因本合同引起的争议，双方应协商解决；协商不成的，提交 X 仲裁委员会仲裁（或向 X 人民法院起诉）。',
   '《中华人民共和国民事诉讼法》',
   '明确争议解决方式，避免管辖权争议', true, ARRAY['争议', '核心条款']),

  -- 风险条款
  (gen_random_uuid(), NULL, 'liability', '限制/免除责任条款', 'risky', ARRAY['销售合同', '服务合同'],
   '如因不可抗力或乙方合理控制之外的原因导致乙方无法履行义务的，乙方不承担责任。',
   '《中华人民共和国民法典》第五百九十条',
   '需明确"合理控制之外"的具体情形，避免被滥用', true, ARRAY['免责', '风险条款']),

  (gen_random_uuid(), NULL, 'payment', '全款预付条款', 'dangerous', ARRAY['销售合同'],
   '甲方应于本合同签订时一次性支付全部合同款项。',
   '《中华人民共和国民法典》',
   '全款预付风险极高，应争取分期付款', true, ARRAY['付款', '高风险']),

  (gen_random_uuid(), NULL, 'breach', '不对等违约金条款', 'dangerous', ARRAY['销售合同', '服务合同'],
   '甲方违约需支付 30% 违约金，乙方违约仅需支付 5% 违约金。',
   '《中华人民共和国民法典》第五百八十五条',
   '违约金比例不对等，违反公平原则', true, ARRAY['违约', '不对等']),

  (gen_random_uuid(), NULL, 'ip', '知识产权归属条款', 'risky', ARRAY['服务合同', '技术开发合同'],
   '乙方在为甲方提供服务过程中产生的所有成果（包括但不限于技术、文档、代码）的知识产权归乙方所有。',
   '《中华人民共和国民法典》',
   '服务成果的知识产权应明确归属，避免后期纠纷', true, ARRAY['知识产权', '风险条款'])
ON CONFLICT DO NOTHING;
