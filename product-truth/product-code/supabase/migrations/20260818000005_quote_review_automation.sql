-- F047：报价审核自动化（审核点 → 自动核验 → 暂缓/放行）
-- 报价头：场景、变更原因、折扣原因、审核状态与核验结果快照
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS quote_kind TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS change_reason TEXT,
  ADD COLUMN IF NOT EXISTS discount_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT,
  ADD COLUMN IF NOT EXISTS review_result JSONB;

-- 报价分项：行类型（产品/二开/服务/维保/赠送/其他）、折扣原因、非标说明、订阅起止
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS discount_reason TEXT,
  ADD COLUMN IF NOT EXISTS line_note TEXT,
  ADD COLUMN IF NOT EXISTS subscription_start DATE,
  ADD COLUMN IF NOT EXISTS subscription_end DATE;
