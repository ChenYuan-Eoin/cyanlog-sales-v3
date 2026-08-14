-- ============================================================
-- F027-F036 报价域出厂种子（配置数据，非需求；业务可改）
-- 按组织注入，on conflict do nothing
-- ============================================================

-- 1. 版本能力矩阵（O2）
INSERT INTO product_versions (org_id, version_code, name, deployments, auth_modes, term_options, capabilities, status, version)
SELECT org.id, seed.version_code, seed.name, seed.deployments::jsonb, seed.auth_modes::jsonb, seed.term_options::jsonb, seed.capabilities::jsonb, 'PUBLISHED', 1
FROM organizations org
CROSS JOIN (VALUES
  ('STD_V6', '标准版 V6', '["PUBLIC_CLOUD"]', '["SUB_YEAR"]', '[12]', '{"ha":false,"xinchuang":false,"onetime":false,"migration":false}'),
  ('PRO_V6', '专业版 V6', '["PUBLIC_CLOUD","PRIVATE"]', '["SUB_YEAR","SUB_3YEAR"]', '[12,36]', '{"ha":false,"xinchuang":false,"onetime":false,"migration":false}'),
  ('ENT_V6', '企业版 V6', '["PUBLIC_CLOUD","PRIVATE","HA"]', '["SUB_YEAR","SUB_3YEAR","ONETIME"]', '[12,36]', '{"ha":true,"xinchuang":true,"onetime":true,"migration":true}'),
  ('XINCHUANG_V6', '信创版 V6', '["PRIVATE","HA"]', '["SUB_YEAR","SUB_3YEAR","ONETIME"]', '[12,36]', '{"ha":true,"xinchuang":true,"onetime":true,"migration":false}')
) AS seed(version_code, name, deployments, auth_modes, term_options, capabilities)
ON CONFLICT (org_id, version_code) DO NOTHING;

-- 2. 业务参数（O4，默认值=现行业务值）
INSERT INTO business_params (org_id, param_key, name, value, data_type, unit, category, status, version)
SELECT org.id, seed.param_key, seed.name, seed.value::jsonb, seed.data_type, seed.unit, seed.category, 'PUBLISHED', 1
FROM organizations org
CROSS JOIN (VALUES
  ('PRIVATE_MIN_SUB', '私有部署按年订阅起售', '50000', 'number', '元', 'pricing'),
  ('PRIVATE_MIN_ONETIME', '私有部署一次性授权起售', '80000', 'number', '元', 'pricing'),
  ('ADDON_MIN_USERS', '增售最低账号数', '10', 'number', '账号', 'pricing'),
  ('MAINT_RATE', '维保费率', '0.2', 'number', '/年', 'maintenance'),
  ('MAINT_MULTI_ENV_INC', '多套环境递增', '0.02', 'number', '/套', 'maintenance'),
  ('HA_NEW_UPLIFT', '高可用新购加价', '0.2', 'number', NULL, 'pricing'),
  ('HA_UPGRADE_RATE', '老客户升级高可用费率', '0.2', 'number', NULL, 'pricing'),
  ('GIFT_A_DAYS', 'A 类赠送人天', '5', 'number', '人天', 'gift'),
  ('GIFT_B_DAYS', 'B 类赠送人天', '3', 'number', '人天', 'gift'),
  ('GIFT_C_DAYS', 'C 类赠送人天', '1', 'number', '人天', 'gift'),
  ('GIFT_EXTRA_RATE', '超出人天单价', '5000', 'number', '元/人天', 'gift'),
  ('TIER_A_ONETIME', 'A 类买断线', '600000', 'number', '元', 'customer'),
  ('TIER_A_ARR', 'A 类 ARR 线', '300000', 'number', '元', 'customer'),
  ('TIER_B_ARR', 'B 类 ARR 线', '50000', 'number', '元', 'customer'),
  ('PAYMENT_SUGGEST', '分期建议', '[0.3,0.6,0.1]', 'json', NULL, 'payment'),
  ('TAX_SOFTWARE', '软件税率', '0.13', 'number', NULL, 'tax'),
  ('TAX_SERVICE', '服务税率', '0.06', 'number', NULL, 'tax'),
  ('QUOTE_VALID_DAYS', '报价有效期', '15', 'number', '天', 'quote'),
  ('LEGACY_PROTECT_DATE', '老客户保护日', '"2021-02-01"', 'date', NULL, 'quote'),
  ('FX_SOURCE', '汇率源', '"BOC"', 'string', NULL, 'quote')
) AS seed(param_key, name, value, data_type, unit, category)
ON CONFLICT (org_id, param_key) DO NOTHING;

-- 3. 字段字典（O6，隐藏字段 is_external=false 永不输出）
INSERT INTO field_dictionaries (org_id, field_key, business_name, source, transform_rule, output_classification, is_external, data_type, status, version)
SELECT org.id, seed.field_key, seed.business_name, seed.source, seed.transform_rule, seed.output_classification, seed.is_external, seed.data_type, 'PUBLISHED', 1
FROM organizations org
CROSS JOIN (VALUES
  ('quote_id', '报价单号', 'system', 'formula', 'header', true, 'string'),
  ('proj_name', '项目名称', 'input', 'direct', 'header', true, 'string'),
  ('proj_no', '项目编号', 'input', 'direct', 'header', true, 'string'),
  ('quote_date', '报价日期', 'system', 'direct', 'header', true, 'date'),
  ('valid_till', '有效期至', 'computed', 'formula', 'header', true, 'date'),
  ('cust_full_name', '客户全称', 'input', 'direct', 'header', true, 'string'),
  ('supp_full_name', '我方全称', 'config', 'direct', 'header', true, 'string'),
  ('supp_contact', '我方联系人', 'input', 'direct', 'header', true, 'string'),
  ('currency', '币种', 'config', 'direct', 'financial', true, 'string'),
  ('fx_rate', '汇率', 'input', 'formula', 'financial', true, 'number'),
  ('v_type', '版本类型', 'input', 'conditional', 'software', true, 'string'),
  ('v_period', '服务周期', 'input', 'conditional', 'software', true, 'string'),
  ('deploy_mode', '部署方式', 'computed', 'conditional', 'software', true, 'string'),
  ('auth_mode', '授权方式', 'computed', 'conditional', 'software', true, 'string'),
  ('sla_clause', '关联条款', 'computed', 'conditional', 'clause', true, 'string'),
  ('line_items', '产品/服务行', 'computed', 'formula', 'software', true, 'json'),
  ('sub_total', '分项小计', 'computed', 'formula', 'financial', true, 'number'),
  ('discount_rate', '折扣率', 'input', 'formula', 'financial', true, 'number'),
  ('grand_total', '含税总价', 'computed', 'formula', 'financial', true, 'number'),
  ('total_in_words', '总价大写', 'computed', 'formula', 'financial', true, 'string'),
  ('tax_summary', '税金摘要', 'computed', 'formula', 'financial', true, 'json'),
  ('promo_list', '优惠承诺', 'input', 'semantic', 'clause', true, 'string'),
  ('gift_items', '赠送行', 'input', 'formula', 'software', true, 'json'),
  ('delivery_terms', '交付说明', 'config', 'conditional', 'clause', true, 'string'),
  ('payment_terms', '付款方式', 'config', 'direct', 'clause', true, 'string'),
  ('internal_cost', '内部成本', 'config', 'direct', 'internal', false, 'number'),
  ('min_price', '底价红线', 'config', 'direct', 'internal', false, 'number'),
  ('margin_rate', '毛利率', 'computed', 'formula', 'internal', false, 'number'),
  ('approver', '审批人', 'computed', 'direct', 'internal', false, 'string'),
  ('approval_opinion', '审批意见', 'input', 'direct', 'internal', false, 'string')
) AS seed(field_key, business_name, source, transform_rule, output_classification, is_external, data_type)
ON CONFLICT (org_id, field_key) DO NOTHING;

-- 4. 单号规则（O9）
INSERT INTO document_number_rules (org_id, doc_type, prefix, date_format, seq_start, padding, separator, sample, status, version)
SELECT org.id, 'quote', 'QT-', 'YYYYMMDD', 1, 4, '-', 'QT-20260814-0001', 'PUBLISHED', 1
FROM organizations org
ON CONFLICT (org_id, doc_type) DO NOTHING;

-- 5. 条款映射（O8）
INSERT INTO clause_mappings (org_id, code, match, clause_code, clause_text, required, status, version)
SELECT org.id, seed.code, seed.match::jsonb, seed.clause_code, seed.clause_text, seed.required, 'PUBLISHED', 1
FROM organizations org
CROSS JOIN (VALUES
  ('CLAUSE_SUB_SaaS', '{"v_type":"subscription"}', 'SaaS_SERVICE_AGREEMENT', 'ONES SaaS 服务协议', true),
  ('CLAUSE_ONETIME_PRIVATE', '{"v_type":"perpetual","deploy":"private"}', 'PRIVATE_LICENSE_MAINT', 'ONES 私有化部署授权协议 + 年度维保服务标准', true)
) AS seed(code, match, clause_code, clause_text, required)
ON CONFLICT (org_id, code) DO NOTHING;

-- 6. 输出模板（O7）
INSERT INTO output_templates (org_id, code, name, doc_type, scene, match_rule, variables, status, version)
SELECT org.id, seed.code, seed.name, seed.doc_type, 'quote', seed.match_rule::jsonb, seed.variables::jsonb, 'PUBLISHED', 1
FROM organizations org
CROSS JOIN (VALUES
  ('TMPL_STD_SUB', '标准报价单（订阅）', 'standard', '{"v_type":"subscription"}', '["quote_id","proj_name","cust_full_name","supp_full_name","line_items","grand_total","total_in_words","tax_summary","valid_till","sla_clause"]'),
  ('TMPL_STD_ONETIME', '标准报价单（买断）', 'standard', '{"v_type":"perpetual"}', '["quote_id","proj_name","cust_full_name","supp_full_name","line_items","grand_total","total_in_words","tax_summary","valid_till","sla_clause"]')
) AS seed(code, name, doc_type, match_rule, variables)
ON CONFLICT (org_id, code) DO NOTHING;

-- 7. 审批链 + 审批规则（O5；规则引用链 code 解析为 id）
DO $$
DECLARE org RECORD; v_chain_id uuid;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    -- 链
    INSERT INTO approval_chains (org_id, code, name, mode, quorum, status, version)
    VALUES (org.id, 'CHAIN_REGION_LEAD', '区域负责人审批', 'serial', 'all', 'PUBLISHED', 1)
    ON CONFLICT (org_id, code) DO NOTHING;
    INSERT INTO approval_chains (org_id, code, name, mode, quorum, status, version)
    VALUES (org.id, 'CHAIN_SPECIAL', '特批流程', 'serial', 'all', 'PUBLISHED', 1)
    ON CONFLICT (org_id, code) DO NOTHING;

    -- 链节点（角色值 = 配置角色 code；成员由组织数据维护）
    SELECT id INTO v_chain_id FROM approval_chains WHERE org_id = org.id AND code = 'CHAIN_REGION_LEAD';
    IF v_chain_id IS NOT NULL THEN
      INSERT INTO approval_chain_nodes (org_id, chain_id, ord, assignee_type, assignee_value, condition)
      VALUES (org.id, v_chain_id, 1, 'role', 'ROLE_REGION_LEAD', '{}'::jsonb)
      ON CONFLICT (chain_id, ord) DO NOTHING;
    END IF;
    SELECT id INTO v_chain_id FROM approval_chains WHERE org_id = org.id AND code = 'CHAIN_SPECIAL';
    IF v_chain_id IS NOT NULL THEN
      INSERT INTO approval_chain_nodes (org_id, chain_id, ord, assignee_type, assignee_value, condition)
      VALUES (org.id, v_chain_id, 1, 'role', 'ROLE_SPECIAL', '{}'::jsonb)
      ON CONFLICT (chain_id, ord) DO NOTHING;
    END IF;

    -- 规则（原型阈值：≥50% 区域负责人、<50% 特批）
    INSERT INTO approval_rules (org_id, code, scene, condition, chain_id, priority, enabled, status, version)
    SELECT org.id, 'R_QUOTE_DISCOUNT_GE50', 'QUOTE_DISCOUNT', '{"discount":{"gte":50,"lt":100}}'::jsonb, c.id, 10, true, 'PUBLISHED', 1
    FROM approval_chains c WHERE c.org_id = org.id AND c.code = 'CHAIN_REGION_LEAD'
    ON CONFLICT (org_id, code) DO NOTHING;
    INSERT INTO approval_rules (org_id, code, scene, condition, chain_id, priority, enabled, status, version)
    SELECT org.id, 'R_QUOTE_DISCOUNT_LT50', 'QUOTE_DISCOUNT', '{"discount":{"lt":50}}'::jsonb, c.id, 20, true, 'PUBLISHED', 1
    FROM approval_chains c WHERE c.org_id = org.id AND c.code = 'CHAIN_SPECIAL'
    ON CONFLICT (org_id, code) DO NOTHING;
  END LOOP;
END
$$;
