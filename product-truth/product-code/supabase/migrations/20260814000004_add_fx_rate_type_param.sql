-- F032：汇率口径参数化（机制可配，默认中行折算价）
-- 取值：middle=中行折算价 / spotSell=现汇卖出价 / spotBuy=现汇买入价 / cashSell=现钞卖出价 / cashBuy=现钞买入价
INSERT INTO business_params (org_id, param_key, name, value, data_type, unit, category, status)
SELECT o.id AS org_id, 'FX_RATE_TYPE', '汇率口径', '"middle"', 'string', NULL, 'quote', 'PUBLISHED'
FROM organizations o
ON CONFLICT (org_id, param_key) DO NOTHING;
