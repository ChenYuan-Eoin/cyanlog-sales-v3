-- F048：内部价与毛利治理（成本/底价/毛利——内部字段，客户输出永不出现）
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS floor_price NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS line_cost NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS margin_rate NUMERIC(6,4);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS margin_rate NUMERIC(6,4);
