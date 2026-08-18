# F048 内部价与毛利治理（隐藏字段）

- 状态: in_progress
- 优先级: P0
- 来源: 用户要求（隐藏字段/内部字段）+ 市面 CPQ 形态（成本/底价/毛利/毛利底线审批）

## 目标
内部价（成本/底价/毛利）是报价内部治理数据：**录入在配置中心，计算在报价引擎，可见性按内部角色，客户输出永不出现**。

## 数据
- products.cost_price / min_price（配置中心 ProductDialog 已可维护）
- quote_items：cost_price / floor_price / line_cost / margin_rate（建单时从产品快照带入）
- quotes：total_cost / margin_rate（整单毛利 = (净收入-总成本)/净收入）

## 计算
- 行毛利 = (行成交单价 - 成本单价) / 行成交单价
- 整单毛利 = (小计 - 整单折扣 - 总成本) / (小计 - 整单折扣)

## 治理（审核自动化 F047 扩展）
- 缺成本数据 → WARN（提醒维护成本）
- 整单毛利 < 0（低于成本）→ BLOCK 硬阻断，提交审批 409 暂缓
- 整单毛利 < 30%（毛利底线，默认）→ WARN（需审批确认）

## 可见性
- 客户导出/打印：INTERNAL_FIELD_KEYS 含 cost_price/floor_price/line_cost/total_cost/margin_rate，零泄漏（field-whitelist）
- 内部：审核核验面板显示毛利核验结果
