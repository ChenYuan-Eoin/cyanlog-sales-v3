# F049 海外/区域能力（价盘 region 维度 + 区域税率矩阵 + 多币种）

- 状态: in_progress
- 优先级: P0
- 来源: 用户要求（海外市场）+ CPQ 市面形态（区域价目/地区税率/多币种）

## 机制（不伪造业务数据）
- price_matrix / quotes / quote_items 增加 `region`（默认 CN）
- 区域税率配置域 `regional-tax-rates`：region × 软件税率 × 服务税率 × 含税口径 × 币种
  - 仅迁移 CN 现有业务值（13% / 6% / 不含税 / CNY）；其他区域由配置中心按业务口径维护
- 报价创建：按 region 取税率与价盘（指定区域无价回退 CN）
- 审核核验：分项区域与报价区域一致（不一致 BLOCK）
- 多币种：currency + BOC 汇率（F042 已有），区域配置带默认币种

## 数据
- 迁移 00007：region 列 + regional_tax_rates 表（RLS + CN 种子）
- DOMAIN_REGISTRY 新增 regional-tax-rates 配置域（配置中心可维护）

## 待业务口径（不伪造）
- 海外区域清单与各自税率/币种/价目（配置中心维护）
- 海外版本/部署/授权可售范围（product_versions 按 region）
