-- Separate the business problem taxonomy from reusable property types.
--
-- `contract_rule_problem_categories` answers "what kind of contract problem is
-- this?" (payment, acceptance, liability, ...).  `contract_rules_v2.category`
-- remains temporarily as a legacy single-property adapter and must not be used
-- as the business taxonomy by new callers.

CREATE TABLE IF NOT EXISTS public.contract_rule_problem_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contract_rule_problem_categories_code_check
    CHECK (code ~ '^[a-z][a-z0-9_]{0,79}$'),
  CONSTRAINT contract_rule_problem_categories_org_code_key UNIQUE (org_id, code),
  CONSTRAINT contract_rule_problem_categories_org_id_id_key UNIQUE (org_id, id)
);

CREATE INDEX IF NOT EXISTS idx_contract_rule_problem_categories_org_sort
  ON public.contract_rule_problem_categories(org_id, is_active, sort_order, code);

CREATE OR REPLACE FUNCTION public.update_contract_rule_problem_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_contract_rule_problem_categories_updated_at
  ON public.contract_rule_problem_categories;
CREATE TRIGGER tr_contract_rule_problem_categories_updated_at
  BEFORE UPDATE ON public.contract_rule_problem_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contract_rule_problem_categories_updated_at();

ALTER TABLE public.contract_rules_v2
  ADD COLUMN IF NOT EXISTS problem_category_id UUID,
  ADD COLUMN IF NOT EXISTS rule_contract JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rules_v2_problem_category_org_fk'
      AND conrelid = 'public.contract_rules_v2'::regclass
  ) THEN
    ALTER TABLE public.contract_rules_v2
      ADD CONSTRAINT contract_rules_v2_problem_category_org_fk
      FOREIGN KEY (org_id, problem_category_id)
      REFERENCES public.contract_rule_problem_categories(org_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_rules_v2_problem_category
  ON public.contract_rules_v2(org_id, problem_category_id, is_active);

-- Seed stable business problem categories for every existing organization.
WITH canonical_categories(code, name, description, sort_order) AS (
  VALUES
    ('payment', '付款与结算', '付款比例、付款节点、账期与结算条件。', 10),
    ('termination', '终止与退款', '终止权、解除条件、退款与未消耗费用。', 20),
    ('tax', '税务与发票', '税率、开票方式、发票类型与税务口径。', 30),
    ('acceptance', '验收与交付', '验收周期、默示验收、整改与交付条件。', 40),
    ('breach', '违约责任', '违约金、逾期责任与赔偿规则。', 50),
    ('liability', '责任边界', '责任上限、间接损失与免责范围。', 60),
    ('confidentiality', '保密义务', '保密期限、保密范围与双方义务。', 70),
    ('business_integrity', '主体与金额一致性', '签约主体、收款主体、合同金额与附件一致性。', 80),
    ('ip', '知识产权', '产品知识产权、定制成果、许可与源代码边界。', 90),
    ('data_security', '数据安全', '客户数据、个人信息、跨境、训练授权与删除要求。', 100),
    ('sla', '服务承诺', '可用性、服务时间、补偿与服务级别承诺。', 110),
    ('renewal', '续约与退出', '续期、锁价、通知期限与退出机制。', 120),
    ('dispute', '争议解决', '适用法律、管辖法院与仲裁机构。', 130)
)
INSERT INTO public.contract_rule_problem_categories (
  org_id,
  code,
  name,
  description,
  sort_order
)
SELECT
  organization.id,
  category.code,
  category.name,
  category.description,
  category.sort_order
FROM public.organizations AS organization
CROSS JOIN canonical_categories AS category
ON CONFLICT (org_id, code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

-- Attach the current R001-R015 rules to their business problem category.  The
-- mapping intentionally follows `clause_category`; legacy property type
-- (`ratio`, `amount`, ...) is not used as classification evidence.
UPDATE public.contract_rules_v2 AS rule
SET problem_category_id = problem_category.id
FROM public.contract_rule_problem_categories AS problem_category
WHERE problem_category.org_id = rule.org_id
  AND problem_category.code = COALESCE(
    CASE rule.clause_category
      WHEN 'payment' THEN 'payment'
      WHEN 'termination' THEN 'termination'
      WHEN 'tax' THEN 'tax'
      WHEN 'acceptance' THEN 'acceptance'
      WHEN 'quality' THEN 'acceptance'
      WHEN 'breach' THEN 'breach'
      WHEN 'liability' THEN 'liability'
      WHEN 'confidentiality' THEN 'confidentiality'
      WHEN 'business_integrity' THEN 'business_integrity'
      WHEN 'ip' THEN 'ip'
      WHEN 'data_security' THEN 'data_security'
      WHEN 'sla' THEN 'sla'
      WHEN 'renewal' THEN 'renewal'
      WHEN 'term' THEN 'renewal'
      WHEN 'dispute' THEN 'dispute'
      ELSE NULL
    END,
    CASE rule.code
      WHEN 'R001' THEN 'payment'
      WHEN 'R002' THEN 'termination'
      WHEN 'R003' THEN 'tax'
      WHEN 'R004' THEN 'acceptance'
      WHEN 'R005' THEN 'acceptance'
      WHEN 'R006' THEN 'breach'
      WHEN 'R007' THEN 'liability'
      WHEN 'R008' THEN 'liability'
      WHEN 'R009' THEN 'confidentiality'
      WHEN 'R010' THEN 'business_integrity'
      WHEN 'R011' THEN 'ip'
      WHEN 'R012' THEN 'data_security'
      WHEN 'R013' THEN 'sla'
      WHEN 'R014' THEN 'renewal'
      WHEN 'R015' THEN 'dispute'
      ELSE NULL
    END
  )
  AND rule.problem_category_id IS DISTINCT FROM problem_category.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_rules_v2_rule_contract_shape_check'
      AND conrelid = 'public.contract_rules_v2'::regclass
  ) THEN
    ALTER TABLE public.contract_rules_v2
      ADD CONSTRAINT contract_rules_v2_rule_contract_shape_check
      CHECK (
        rule_contract IS NULL
        OR COALESCE((
          jsonb_typeof(rule_contract) = 'object'
          AND rule_contract ->> 'schema_version' = '1.0'
          AND jsonb_typeof(rule_contract -> 'properties') = 'array'
          AND jsonb_typeof(rule_contract -> 'decisions') = 'array'
          AND rule_contract ->> 'missing_evidence_outcome' IN ('manual_review', 'block')
        ), false)
      );
  END IF;
END $$;

-- These tables are server control-plane assets.  Browser roles must use the
-- authenticated SaaS API; the service-role client remains the sole data path.
ALTER TABLE public.contract_rule_problem_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_rules_v2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contract_rule_problem_categories FROM anon, authenticated;
REVOKE ALL ON TABLE public.contract_rules_v2 FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.contract_rule_problem_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.contract_rules_v2 TO service_role;

COMMENT ON TABLE public.contract_rule_problem_categories IS
  'Organization-scoped business problem taxonomy for contract rules; property types are stored inside rule_contract.';
COMMENT ON COLUMN public.contract_rules_v2.problem_category_id IS
  'Business problem classification. It is independent from legacy single-property category.';
COMMENT ON COLUMN public.contract_rules_v2.rule_contract IS
  'Canonical v1 human-authored rule definition. Legacy rows remain NULL and are resolved by the single runtime adapter until a user saves canonical details.';
