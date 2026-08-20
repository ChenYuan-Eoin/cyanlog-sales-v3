-- WP10 阶段2 补全：报价承载商机上下文（负责人/订单类型/市场/渠道/部署需求）
-- 原则：商机是业务事实源，报价只读快照上下文（不写回 CRM）；结构化 JSONB 供审核/复用
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS opportunity_context JSONB;
