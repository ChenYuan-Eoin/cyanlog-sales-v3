-- Migration: 20260701151054_align_contract_rules_with_ones_skill.sql
-- PURPOSE: Align contract_rules_v2 R001-R015 with suoyidev/ones-internal-skills ones-contract-assistant.
-- Source commit: f8b0c27f5c19a499c1563923ca372a2171aaca58

ALTER TABLE contract_rules_v2
  ADD COLUMN IF NOT EXISTS engine_type TEXT DEFAULT 'structured',
  ADD COLUMN IF NOT EXISTS target_field TEXT,
  ADD COLUMN IF NOT EXISTS clause_category TEXT,
  ADD COLUMN IF NOT EXISTS field_hints TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS semantic_prompt TEXT,
  ADD COLUMN IF NOT EXISTS message_template JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id);

WITH skill_rules (
  code, name, category, target_field, clause_category, field_hints, priority, approval_roles,
  level_a_operator, level_a_threshold, level_a_unit,
  level_b_operator, level_b_threshold, level_b_unit,
  level_c_operator, level_c_threshold, level_c_unit,
  level_a_text, level_b_text, level_c_text
) AS (
  VALUES
    ('R001', '付款节奏', 'ratio', 'payment_schedule', 'payment', ARRAY['首期','首付款','预付款','付款节奏','账期','尾款'], 150, ARRAY['finance','legal'], '>=', 30::decimal, 'percent', '>=', 15::decimal, 'percent', '<', 15::decimal, 'percent', '首期≥30%，三段式 30/60/10，尾款账期≤30工作日', '首期 15–29%', '首期<15% / 100%验收后付首款 / 账期>30工作日'),
    ('R002', '终止退款', 'text', 'termination_refund_clause', 'termination', ARRAY['终止','解除','退款','退还','未消耗','计息'], 145, ARRAY['finance','legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '不退款', '仅退未消耗款项、不计息', '全额退款 / 计息'),
    ('R003', '税率', 'ratio', 'tax_rate', 'tax', ARRAY['税率','增值税','发票','开票','软件','SaaS','维保'], 140, ARRAY['finance'], 'contains', 0::decimal, 'percent', 'contains', 0::decimal, 'percent', 'contains', 0::decimal, 'percent', '软件买断/私有部署授权 13%；SaaS/订阅/服务/维保 6%；混合分项开票', '—', '错套税率 / 统一税率 / 未写税率'),
    ('R004', '默示验收期', 'duration', 'acceptance_silent_days', 'acceptance', ARRAY['验收','默示验收','视为验收','工作日'], 138, ARRAY['legal','delivery'], '<=', 10::decimal, 'day', '<=', 15::decimal, 'day', '>', 30::decimal, 'day', '5工作日含默示（可至7–10）', '15工作日（保留默示）', '>30工作日 / 取消默示验收'),
    ('R005', '验收不通过', 'text', 'acceptance_failure_clause', 'acceptance', ARRAY['验收不通过','整改','重交','解除','全额退款','间接损失'], 136, ARRAY['legal','delivery'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '整改重交', '2次整改后可解除、限直接损失', '直接解除+全额退款 / 赔一切或间接损失'),
    ('R006', '违约金', 'ratio', 'breach_penalty_cap', 'breach', ARRAY['违约金','赔偿上限','日违约金','万分之五','千分之三','实损'], 134, ARRAY['finance','legal'], '<=', 10::decimal, 'percent', '<=', 50::decimal, 'percent', '>', 100::decimal, 'percent', '乙方赔偿上限10%、日违约金万分之五；甲方日违约金千分之三', '赔偿上限≤50%（50–100%需高风险提示）、日万分之五~千分之三', '赔偿上限>100% / 日>千分之三 / 违约金+实损累加 / 甲方日<万分之五'),
    ('R007', '间接损失', 'text', 'indirect_loss_clause', 'liability', ARRAY['间接损失','可得利益','商誉','惩罚性赔偿','一切损失'], 132, ARRAY['legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '明确排除间接/可得利益/商誉/惩罚性', '未提及（建议补排除条款）', '承担一切损失/间接损失/惩罚性赔偿'),
    ('R008', '责任总额上限 Cap', 'ratio', 'liability_cap', 'liability', ARRAY['责任总额','责任上限','Cap','赔偿上限','单向'], 130, ARRAY['finance','legal'], '<=', 50::decimal, 'percent', '<=', 100::decimal, 'percent', '>', 100::decimal, 'percent', '≤50% 双向', '50–100%', '>100% / 无 Cap / 单向'),
    ('R009', '保密期', 'duration', 'confidentiality_years', 'confidentiality', ARRAY['保密期','保密义务','永久','商业秘密','单向'], 128, ARRAY['legal'], '<=', 7::decimal, 'year', '<=', 10::decimal, 'year', '>', 10::decimal, 'year', '5年双向（3–7年）', '10年双向', '单向 / 永久（非商业秘密）'),
    ('R010', '主体·收款·金额', 'text', 'entity_payment_amount_consistency', 'business_integrity', ARRAY['主体','账户','收款','签字','日期','金额','大写','报价单'], 126, ARRAY['finance','legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '主体/账户/签字/日期正确，且数字=大写=附件=报价单', '旧版模板（建议更新）', '主体错/外部账户/金额不一致/含税不等/日期逻辑错'),
    ('R011', 'IP 归属', 'text', 'ip_ownership_clause', 'ip', ARRAY['知识产权','源代码','二次开发','著作权','专利','转让'], 124, ARRAY['legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'ONES 保留全部 IP + 客户使用许可', '二次开发归属让步需提价', '客户主张 ONES 产品 IP / 交付源代码 / 可二次销售转让'),
    ('R012', '数据安全', 'text', 'data_security_clause', 'data_security', ARRAY['客户数据','AI训练','跨境','境外','个人信息','DPA','删除'], 122, ARRAY['legal','security'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '客户数据归客户 + ONES 受限处理', '加密/本地化/立即删除可让', 'AI训练无授权；海外/境外主体/跨境处理涉个信无 DPA（境内客户不因缺DPA单列风险）'),
    ('R013', 'SLA', 'enum', 'sla_commitment', 'sla', ARRAY['SLA','可用性','99.5%','99.9%','7×24','营业损失','服务费'], 120, ARRAY['delivery','legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '公有云 99.5% + 服务费比例赔偿', '99.9% 需售后评估架构', '按合同总额/含营业损失赔偿 / 私有部署承诺可用性 / 7×24'),
    ('R014', '续约', 'text', 'renewal_clause', 'renewal', ARRAY['续约','自动续期','自动终止','退出权','锁价','涨幅'], 118, ARRAY['sales','legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '书面续约、到期自动终止', '自动续期+≥30日通知；年涨幅≤5%', '永久锁价 / 自动续期无退出权'),
    ('R015', '争议解决', 'text', 'dispute_resolution_clause', 'dispute', ARRAY['争议解决','仲裁','管辖','法院','法律','境外'], 116, ARRAY['legal'], 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', 'contains', 0::decimal, 'text', '深圳 SCIA 仲裁、中国法律', '北京/上海仲裁；一线城市法院', '境外仲裁/法院/法律')
),
upserted AS (
  INSERT INTO contract_rules_v2 (
    org_id, code, name, description, category, applicable_scenarios, scope,
    level_a_operator, level_a_threshold, level_a_unit, level_a_action,
    level_b_operator, level_b_threshold, level_b_unit, level_b_action, level_b_counterparty,
    level_c_operator, level_c_threshold, level_c_unit, level_c_action, level_c_message,
    approval_roles, engine_type, target_field, clause_category, field_hints, semantic_prompt,
    message_template, priority, version, is_active, published_at, updated_at
  )
  SELECT
    org.id,
    rule.code,
    rule.name,
    'ONES skill 条款速查：A=' || rule.level_a_text || '；B=' || rule.level_b_text || '；红线=' || rule.level_c_text,
    rule.category,
    ARRAY['customer_contract','customer_redline','quote_to_contract','renewal','source_docx_review'],
    'org',
    rule.level_a_operator, rule.level_a_threshold, rule.level_a_unit, 'auto_accept',
    rule.level_b_operator, rule.level_b_threshold, rule.level_b_unit, 'negotiate_with_counterparty',
    CASE WHEN rule.level_b_text = '—'
      THEN '无标准让步口径；进入法务复核后再决定是否放行。'
      ELSE '销售需围绕风险项取得对价或客户确认，并记录谈判结果。'
    END,
    rule.level_c_operator, rule.level_c_threshold, rule.level_c_unit, 'block_or_escalate',
    '触发「' || rule.name || '」红线：' || rule.level_c_text,
    rule.approval_roles,
    'hybrid',
    rule.target_field,
    rule.clause_category,
    rule.field_hints,
    '你是 ONES 业务运营合同审核角色，只能依据配置中心发布规则判断「' || rule.name || '」。' || E'\n' ||
      '规则来源：suoyidev/ones-internal-skills/ones-contract-assistant v2.2.2，commit f8b0c27f5c19a499c1563923ca372a2171aaca58。' || E'\n' ||
      'Level A 可接受：' || rule.level_a_text || E'\n' ||
      'Level B 偏离可让步：' || rule.level_b_text || E'\n' ||
      '红线：' || rule.level_c_text || E'\n' ||
      '请输出风险等级、命中原文、判断依据、销售谈判建议、Word 批注文案，并保留规则编号与快照引用。',
    jsonb_build_object(
      'source', jsonb_build_object(
        'repo', 'suoyidev/ones-internal-skills',
        'skill', 'ones-contract-assistant',
        'version', '2.2.2',
        'commit', 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
        'last_updated', '2026-06-16'
      ),
      'levels', jsonb_build_object('level_a', rule.level_a_text, 'level_b', rule.level_b_text, 'level_c', rule.level_c_text),
      'outputs', jsonb_build_object('primary', 'word_native_comment', 'secondary', 'review_report', 'comment_author', 'ONES 业务运营')
    ),
    rule.priority,
    1,
    true,
    NOW(),
    NOW()
  FROM organizations org
  CROSS JOIN skill_rules rule
  ON CONFLICT (org_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    applicable_scenarios = EXCLUDED.applicable_scenarios,
    scope = EXCLUDED.scope,
    level_a_operator = EXCLUDED.level_a_operator,
    level_a_threshold = EXCLUDED.level_a_threshold,
    level_a_unit = EXCLUDED.level_a_unit,
    level_a_action = EXCLUDED.level_a_action,
    level_b_operator = EXCLUDED.level_b_operator,
    level_b_threshold = EXCLUDED.level_b_threshold,
    level_b_unit = EXCLUDED.level_b_unit,
    level_b_action = EXCLUDED.level_b_action,
    level_b_counterparty = EXCLUDED.level_b_counterparty,
    level_c_operator = EXCLUDED.level_c_operator,
    level_c_threshold = EXCLUDED.level_c_threshold,
    level_c_unit = EXCLUDED.level_c_unit,
    level_c_action = EXCLUDED.level_c_action,
    level_c_message = EXCLUDED.level_c_message,
    approval_roles = EXCLUDED.approval_roles,
    engine_type = EXCLUDED.engine_type,
    target_field = EXCLUDED.target_field,
    clause_category = EXCLUDED.clause_category,
    field_hints = EXCLUDED.field_hints,
    semantic_prompt = EXCLUDED.semantic_prompt,
    message_template = EXCLUDED.message_template,
    priority = EXCLUDED.priority,
    version = COALESCE(contract_rules_v2.version, 1) + 1,
    is_active = true,
    published_at = NOW(),
    updated_at = NOW()
  RETURNING *
)
INSERT INTO contract_rule_snapshots (
  rule_id, version, config_snapshot, released_at, release_note, status, created_at
)
SELECT
  rule.id,
  COALESCE(rule.version, 1),
  to_jsonb(rule),
  COALESCE(rule.published_at, NOW()),
  'Aligned with suoyidev/ones-internal-skills ones-contract-assistant f8b0c27f5c19a499c1563923ca372a2171aaca58',
  'published',
  NOW()
FROM upserted rule
WHERE NOT EXISTS (
  SELECT 1
  FROM contract_rule_snapshots snapshot
  WHERE snapshot.rule_id = rule.id
    AND snapshot.version = COALESCE(rule.version, 1)
);

UPDATE contract_rules_v2
SET is_active = false, updated_at = NOW()
WHERE code IN ('RULE-01-01', 'RULE-01-02', 'RULE-01-03');
