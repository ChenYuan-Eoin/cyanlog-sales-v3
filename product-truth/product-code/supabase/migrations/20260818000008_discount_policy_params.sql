-- F050：折扣治理交互（档位 + 常规上限，可配默认；配置中心可改）
INSERT INTO business_params (org_id, param_key, name, value, data_type, unit, category, status)
SELECT o.id, 'DISCOUNT_TIERS', '折扣档位(%)', '[0,5,10,15,20,25,30,40]', 'json', NULL, 'pricing', 'PUBLISHED'
FROM organizations o
ON CONFLICT (org_id, param_key) DO NOTHING;

INSERT INTO business_params (org_id, param_key, name, value, data_type, unit, category, status)
SELECT o.id, 'DISCOUNT_MAX', '常规折扣上限(%)', '40', 'number', '%', 'pricing', 'PUBLISHED'
FROM organizations o
ON CONFLICT (org_id, param_key) DO NOTHING;
