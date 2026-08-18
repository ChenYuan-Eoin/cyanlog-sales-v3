# F047 报价审核自动化工作流

- 状态: in_progress
- 优先级: P0
- 来源: 用户审核要求（报价单信息核对 10 项 / 13 类审核场景 / 审核原则：不满足暂缓审批）

## 目标
把人工审核 Checklist 变成**系统自动核验**：报价提交审批时自动逐项检查，
`BLOCK` 项不满足 → 暂缓审批（不创建审批链）；`WARN` 项 → 审批视图展示提醒。

## 审核点 → 规则 → 数据 → 判定

| 审核点 | 规则 code | 数据来源 | 判定 |
|---|---|---|---|
| 抬头真实（工商名称） | HEADER_REAL | quotes.customer_name | 非空且不含占位/测试词 |
| 品牌/产品/版本/部署明确 | LINE_COMPLETE | quote_items.product_id/version_code/deployment/auth_mode | 必选非空 |
| 币种统一 | CURRENCY | quotes.currency | 非空（默认 CNY） |
| 税价口径统一 | TAX_BASIS | quotes.tax_inclusive | 有值即可（默认 false=不含税） |
| 分项计算准确（含大小写） | CALC_ACCURATE / AMOUNT_IN_WORDS | 重算 quantity×unit_price、Σline_total、total、大写 | 与存储一致 |
| 与 CRM/合同/审批一致 | CHANGE_REVIEW | quote_kind=CHANGE + change_reason + 已批准变更需重审 | 变更必须留痕 |
| 只报当前可售版本 | VERSION_SELLABLE | product_versions（PUBLISHED） | 行版本在可售目录内，部署/授权在版本允许范围 |
| 产品/二开/服务/维保边界清晰（税率分开） | LINE_TYPE_BOUNDARY | quote_items.line_type + tax_rate | line_type 必填，税率存在 |
| 私有化新签必须明确维保 | PRIVATE_MAINT | deployment=PRIVATE | 存在维保行或 maintenance_months>0 |
| 订阅明确到具体日期 | SUBSCRIBE_DATE | subscription_start/end + term_months | SUB_YEAR/SUB_3YEAR 必填起止 |
| 能解释“为什么这样报价” | DISCOUNT_REASON / NONSTANDARD_NOTE | discount_reason / line_note | 有折扣必有原因；非标必有说明 |
| 符合售卖规则（搭售/跟随/版本一致） | COMBINATION_RULE | validateProductCombination | 失败即 block |
| 特殊折扣：原价/成交价/底价/审批 | DISCOUNT_GOVERNANCE | list_price vs unit_price + 审批链 | 超阈值 warn；超底价 block |
| 有效期 | VALID_UNTIL | quotes.valid_until | 非空且未过期 |
| 13 类场景 | SCENE_* | quotes.quote_kind | 场景规则组（见下） |

## 场景规则组（quote_kind）
- STANDARD 标准新签：基础规则
- PRIVATE 私有化新签：+PRIVATE_MAINT
- SUBSCRIBE 订阅制：+SUBSCRIBE_DATE
- RENEW 续费：+变更说明必填（change_reason/line_note 续费基数）
- ADDON 增购：+line_note 说明与既有产品关系
- UPGRADE 升级：+version_from/version_to 必填
- DEV 二次开发：+line_type=dev 行 line_note 必填（内容/工作量/成果/验收/边界）
- SERVICE 实施服务：+line_type=service 行 line_note 必填（模块/人天/范围）
- GIFT 赠送：+赠送行 gift_original_amount>0 + line_note 赠送原因
- SPECIAL_DISCOUNT 特殊折扣：+discount_reason 必填 + list_price 展示 + 审批链
- INSTALLMENT 分期：+attributes.payment_plan 分期比例合计=100%
- CHANGE 报价变更：+change_reason 必填
- 过期：任何 kind 都校验 VALID_UNTIL

## 动作
- 提交审批（DRAFT→PENDING_APPROVAL）：先跑核验；BLOCK → 409 + 核验结果，不建审批链
- 审核视图：GET /api/quotes/:id/review 返回核验快照，详情页面板逐项 ✅/⚠️/❌
- 手动重跑：POST /api/quotes/:id/review
