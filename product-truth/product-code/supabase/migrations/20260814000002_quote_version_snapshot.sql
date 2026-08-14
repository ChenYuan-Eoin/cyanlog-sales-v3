-- ============================================================
-- F034 报价版本化与中间快照（阶段 1）

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- 原则：结构化报价版本 = 合同源数据（可查询/对比/推导）；
--       中间快照 = 阶段 1 交付物（导出锁定/历史核对/防伪，非终点）
-- ============================================================

-- 1. quotes 增加版本指针
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS version_no INT NOT NULL DEFAULT 1;

-- 2. 结构化报价版本表（header + items 全字段副本，供下游推导）
CREATE TABLE IF NOT EXISTS quote_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  header JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'FROZEN',
  checksum TEXT,
  frozen_by UUID REFERENCES users(id),
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quote_versions_quote_version_key UNIQUE (quote_id, version_no)
);

CREATE TABLE IF NOT EXISTS quote_version_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  product_id UUID,
  product_code TEXT,
  name TEXT,
  version_code TEXT,
  deployment TEXT,
  auth_mode TEXT,
  term_months INT,
  quantity INT,
  unit_price NUMERIC(15,2),
  list_price NUMERIC(15,2),
  discount NUMERIC(15,2),
  line_total NUMERIC(15,2),
  tax_rate NUMERIC(6,4),
  tax_amount NUMERIC(15,2),
  is_gift BOOLEAN NOT NULL DEFAULT false,
  gift_original_amount NUMERIC(15,2),
  maintenance_months INT,
  version_from TEXT,
  version_to TEXT,
  pricing_source TEXT,
  tier_range TEXT,
  attributes JSONB
);

-- 3. 中间快照（与版本逐位一致，checksum 由应用层 canonical 计算）
CREATE TABLE IF NOT EXISTS quote_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  snapshot JSONB NOT NULL,
  checksum TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quote_snapshots_quote_version_key UNIQUE (quote_id, version_no)
);

-- 4. 已发布版本不可变（DB 强制）
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'guard_frozen_quote_version') THEN
    CREATE FUNCTION guard_frozen_quote_version()
    RETURNS trigger AS $fn$
    BEGIN
      IF NEW.status = 'FROZEN' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.* IS DISTINCT FROM NEW.*) THEN
        RAISE EXCEPTION '已冻结的报价版本不可修改 (quote_id=%, version_no=%)', NEW.quote_id, NEW.version_no;
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END
$do$;

DROP TRIGGER IF EXISTS trg_guard_frozen_quote_version ON quote_versions;
CREATE TRIGGER trg_guard_frozen_quote_version
  BEFORE UPDATE ON quote_versions
  FOR EACH ROW EXECUTE FUNCTION guard_frozen_quote_version();

-- 5. 冻结 RPC（单事务：生成版本行 + 中间快照 + 更新 quotes.version_no）
CREATE OR REPLACE FUNCTION freeze_quote(p_quote_id UUID, p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_version_no INT;
  v_version_id UUID;
  v_header JSONB;
  v_items JSONB;
  v_checksum TEXT;
BEGIN
  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_version_no FROM quote_versions WHERE quote_id = p_quote_id;

  SELECT jsonb_build_object(
    'quote_no', q.quote_no,
    'customer_name', q.customer_name,
    'customer_contact', q.customer_contact,
    'currency', q.currency,
    'exchange_rate', q.exchange_rate,
    'discount_rate', q.discount_rate,
    'subtotal', q.subtotal,
    'discount_amount', q.discount_amount,
    'tax_amount', q.tax_amount,
    'total_amount', q.total_amount,
    'tax_summary', q.tax_summary,
    'valid_until', q.valid_until,
    'notes', q.notes
  ) INTO v_header
  FROM quotes q WHERE q.id = p_quote_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order), '[]'::jsonb) INTO v_items
  FROM quote_items qi WHERE qi.quote_id = p_quote_id;

  -- canonical checksum 由应用层计算后写入；此处先占位，应用层冻结时更新
  v_checksum := encode(digest(v_header::text || v_items::text, 'sha256'), 'hex');

  INSERT INTO quote_versions (quote_id, version_no, header, status, checksum, frozen_by)
  VALUES (p_quote_id, v_version_no, v_header, 'FROZEN', v_checksum, p_user_id)
  RETURNING id INTO v_version_id;

  INSERT INTO quote_version_items (version_id, sort_order, product_id, product_code, name, version_code, deployment, auth_mode, term_months, quantity, unit_price, list_price, discount, line_total, tax_rate, tax_amount, is_gift, gift_original_amount, maintenance_months, version_from, version_to, pricing_source, tier_range, attributes)
  SELECT v_version_id, qi.sort_order, qi.product_id, qi.product_code, qi.name, qi.version_code, qi.deployment, qi.auth_mode, qi.term_months, qi.quantity, qi.unit_price, qi.list_price, qi.discount, qi.line_total, qi.tax_rate, qi.tax_amount, qi.is_gift, qi.gift_original_amount, qi.maintenance_months, qi.version_from, qi.version_to, qi.pricing_source, qi.tier_range, qi.attributes
  FROM quote_items qi WHERE qi.quote_id = p_quote_id;

  INSERT INTO quote_snapshots (quote_id, version_no, snapshot, checksum, created_by)
  VALUES (p_quote_id, v_version_no, jsonb_build_object('header', v_header, 'items', v_items), v_checksum, p_user_id);

  UPDATE quotes SET version_no = v_version_no WHERE id = p_quote_id;

  RETURN v_version_id;
END;
$$ LANGUAGE plpgsql;

-- 6. RLS（org 隔离：经 quotes.org_id）
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_version_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quote_versions','quote_snapshots']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_org_read" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_org_read" ON %I FOR SELECT TO authenticated USING (quote_id IN (SELECT id FROM quotes WHERE org_id IN (SELECT org_id FROM user_organizations WHERE user_id = auth.uid())))', t, t);
  END LOOP;
END
$$;
