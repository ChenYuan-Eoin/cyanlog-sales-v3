-- WP10 阶段2：报价挂接 CRM 商机（商机接入与复用）
-- 原则：可空外键向后兼容；不删除既有报价；商机是业务事实源，报价只读商机上下文
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_opportunity_id ON quotes(opportunity_id);

-- 复制来源留痕：复制生成的新报价记录 source_quote_id（历史价/复用链）
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS source_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_source_quote_id ON quotes(source_quote_id);
