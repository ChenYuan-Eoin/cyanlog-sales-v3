-- Migration: 20260617000003_contract_quote_linkage.sql
-- PURPOSE: 添加 contracts 表缺失字段，支持报价→合同链路
-- REQ: F002, F005

-- ═══════════════════════════════════════════════════════════════
-- 1. contracts 表扩展字段
-- ═══════════════════════════════════════════════════════════════

-- 添加报价/标书关联
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tender_id UUID REFERENCES tenders(id) ON DELETE SET NULL;

-- 添加合同基本信息
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_no TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS party_a_name TEXT,                    -- 甲方(我方)
  ADD COLUMN IF NOT EXISTS party_b_name TEXT NOT NULL DEFAULT '',  -- 乙方(客户)
  ADD COLUMN IF NOT EXISTS party_b_contact TEXT;                  -- 乙方联系人

-- 添加金额信息
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_amount DECIMAL(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15, 2) DEFAULT 0;

-- 添加日期信息
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS contract_date DATE,
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- 添加条款信息
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms TEXT;

-- 添加签章状态
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS signature_status TEXT DEFAULT 'UNSIGNED'
    CHECK (signature_status IN ('UNSIGNED', 'PENDING', 'PARTIAL', 'SIGNED'));

-- 添加品类识别结果（AI解析）
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('买断', '订阅', null)),
  ADD COLUMN IF NOT EXISTS deployment_type TEXT CHECK (deployment_type IN ('公有云', '私有部署', null)),
  ADD COLUMN IF NOT EXISTS license_type TEXT CHECK (license_type IN ('新签', '续约', '增购', null));

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_contracts_quote_id ON contracts(quote_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tender_id ON contracts(tender_id);
CREATE INDEX IF NOT EXISTS idx_contracts_party_b_name ON contracts(party_b_name);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_no ON contracts(contract_no);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

-- 更新注释
COMMENT ON COLUMN contracts.quote_id IS '来源报价ID，支持报价→合同链路';
COMMENT ON COLUMN contracts.contract_no IS '合同编号，系统生成或人工填写';
COMMENT ON COLUMN contracts.party_b_name IS '乙方名称，从报价或手动填写';
COMMENT ON COLUMN contracts.contract_amount IS '合同总金额';

-- ═══════════════════════════════════════════════════════════════
-- 2. 合同标的明细表
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contract_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  quote_item_id UUID REFERENCES quote_items(id),  -- 关联来源报价明细
  name TEXT NOT NULL,                              -- 标的名称
  specification TEXT,                              -- 规格
  quantity INTEGER NOT NULL DEFAULT 1,
  unit TEXT,                                       -- 单位
  unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
  line_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_items_contract_id ON contract_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_items_quote_item_id ON contract_items(quote_item_id);

COMMENT ON TABLE contract_items IS '合同标的明细，从报价明细转换或手工录入';

-- ═══════════════════════════════════════════════════════════════
-- 3. 签章记录表（预留）
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contract_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  party TEXT NOT NULL CHECK (party IN ('A', 'B')),  -- A:甲方(我方) B:乙方(客户)
  signer_name TEXT NOT NULL,
  signer_email TEXT,
  signature_provider TEXT,                          -- docusign/fadada/eesign
  signature_id TEXT,                                -- 第三方签章ID
  signature_url TEXT,                               -- 签署链接
  signed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SIGNED', 'REJECTED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract_id ON contract_signatures(contract_id);

COMMENT ON TABLE contract_signatures IS '合同签章记录，支持多方签署';

-- ═══════════════════════════════════════════════════════════════
-- 4. 自动更新 updated_at 触发器
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_contract_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_contract_items_updated_at ON contract_items;
CREATE TRIGGER trig_contract_items_updated_at
  BEFORE UPDATE ON contract_items
  FOR EACH ROW EXECUTE FUNCTION update_contract_items_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 5. quotes 表添加关联合同ID字段
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS generated_contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_generated_contract_id ON quotes(generated_contract_id);

COMMENT ON COLUMN quotes.generated_contract_id IS '从该报价生成的合同ID';
