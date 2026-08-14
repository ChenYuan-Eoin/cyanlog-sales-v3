# Feature Packet: F035-高级科目（维保/转版本/汇率/赠送/大写/分税）

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F035 |
| **Name** | 高级科目（维保/转版本/汇率/赠送/大写/分税） |
| **Module** | 报价中心 |
| **Branch** | `feature/F035-advanced-subjects` |
| **Owner** | TBD（待指派） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

在阶段 2「高级科目」内，把六个业务科目**全部纳入算价引擎，数字走配置（O4 business_params）**，并在 `quotes / quote_items` 落结构化源字段（阶段 1 落库，合同源数据）：

1. **维保续保（SC4）**：维保费率/多套递增/基数口径全部参数化（默认种子「维保 20%+2%」）；买断场景明细行增加「维保续保年份」`maintenance_months`；维保/增购互斥；累计金额录入。
2. **版本转换（SC3）**：`version_from / version_to`；按「旧合同起、旧合同止、新合同起始」三时点计算折残值抵扣；税率对应规则可配；历史实付录入入口。
3. **币种汇率**：`currency / exchange_rate / fx_source / fx_date`；切换币种时**重新计算**（非换符号）；汇率源与取值时点由参数配置（O4 标注「待定」）。
4. **赠送**：`is_gift / gift_original_amount`；赠送行划线展示、**不计总价**；赠送配额参数（默认种子「赠送 5/3/1+5000」）。
5. **中文大写**：`amount_in_words` 含税总价中文大写（壹拾万…），由引擎生成而非人工填写。
6. **分税按大类**：`tax_inclusive / tax_summary / tax_rate / tax_amount`；按大类（软件 13% / 服务 6%，参数可配）生成税摘要。

验收硬门：**历史真实单回归通过**（所有科目数字与历史单逐位一致）。

来源：主设计 §二（quotes/quote_items ★ 字段）、O4（业务参数默认种子）、SC3/SC4/阶段 2；字段字典材料（大写/分税/汇率快照口径）；V3 现状（引擎二维、无高级科目字段）。

### 2.2 待确认问题

- [ ] 「维保 20%+2%」语义：首年 20%、次年起 2%？还是基础费率 20% + 逐年递增 2%？上限是多少？
- [ ] 维保基数口径：以软件（买断）总价为基数？含税还是不含税？是否剔除赠送金额？多套产品如何叠加？
- [ ] 多套递增规则：多套产品维保是否逐套递增、步长与封顶参数形态（O4 需哪些 key）。
- [ ] 转版本三时点精确定义与折残值公式（按剩余月份比例？含税/不含税？旧合同实付从哪来——录入入口字段与校验）。
- [ ] 汇率源与取值时点（主设计 O4 标注「待定」）；是否含加价系数（材料提到银行汇率 +0.05）；换汇精度与舍入规则。
- [ ] 汇率展示：报价单显示「外币符号 + 本位币折算」还是仅备注？`amount_in_words` 以哪种币种为准？
- [ ] 赠送 5/3/1+5000 语义（5 账号/3 年/1 次实施/5000 额度？）及赠送金额是否计入维保基数。
- [ ] 分税大类映射：产品/明细行 → 税率组的规则形态（软件 13%、服务 6% 的参数 key 与匹配依据，如产品 category）。
- [ ] 中文大写格式：元/角/分处理、是否含「整」、零与负数边界。
- [ ] 「条款注入」是否本包：阶段 2 描述含条款注入，但 O7/O8 属 F030——确认本包只算数字、条款注入归 F030。

### 2.3 本轮边界

- **做**：
  - `quotes / quote_items` 高级科目结构化字段（★ 字段）落库。
  - 引擎新增 pure 计算：维保、转版本折残值、汇率换算、赠送不计总价、中文大写、分税摘要。
  - 消费 O4 业务参数（维保/赠送/税率/汇率源），默认值=现行业务值，改数不改代码。
  - 历史实付录入入口与校验。
- **不做**：
  - 条款/协议注入（F030 O7/O8）。
  - 10,000+ 自动出价（人工评审）、电子签章、合同承接（F037）。
  - 非标客户模板语义映射（F036）。
  - 改报价状态机（仍由 F033/F034 负责流转与冻结）。

---

## 3. 技术方案

> 依据：主设计 §二（quotes/quote_items ★ 字段明细）、O4（业务参数与默认种子）、SC3/SC4/阶段 2；V3 现状 `001_initial_schema.sql`、`20260608000001_org_pricing_and_quote_items.sql`（quotes/quote_items 现有列）、`lib/pricing/engine.ts`（二维引擎需扩展）。

### 3.1 接口设计

**计算链（扩展现有报价创建/重算）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `POST /api/quotes` / `PATCH /api/quotes/[id]` | POST/PATCH | 入参含高级科目（maintenance_months、version_from/to、currency、is_gift 等）；返回重算后的结构化字段（含 amount_in_words、tax_summary、line_total/total） |
| `POST /api/quotes/[id]/recalculate` | POST | 草稿重算（编辑明细后同步高级科目），返回校验错误逐行 |
| `POST /api/quotes/[id]/history-payments` | POST | 转版本历史实付录入（旧合同实付金额、期间），供折残值计算 |
| `GET /api/config-center/business-params`（消费侧） | GET | 只读读取 O4 参数（维保/赠送/税率/汇率源），业务页无写入口（F000） |

**错误码约定**：422 高级科目校验失败（互斥/基数/大写生成失败/字段缺失）；409 已冻结版本禁止改金额（F034 联动）；400 汇率缺源/缺时点。

### 3.2 数据模型

**quotes 扩展（主设计 §二 ★ 字段）**

```sql
ALTER TABLE quotes
  ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'CNY',
  ADD COLUMN exchange_rate DECIMAL(18,6),        -- 切换币种时计算，非换符号
  ADD COLUMN fx_source TEXT,                     -- 汇率源（参数配置，待定）
  ADD COLUMN fx_date DATE,                       -- 汇率取值时点（参数配置，待定）
  ADD COLUMN tax_inclusive BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN amount_in_words TEXT,               -- 含税总价中文大写（引擎生成）
  ADD COLUMN tax_summary JSONB;                  -- 分税摘要（按大类：软件 13%/服务 6%，参数可配）
```

**quote_items 扩展（主设计 §二 ★ 字段）**

```sql
ALTER TABLE quote_items
  ADD COLUMN version_code TEXT,                  -- STD/PRO/ENT/XINCHUANG
  ADD COLUMN deployment TEXT,                    -- PUBLIC_CLOUD/PRIVATE/HA
  ADD COLUMN auth_mode TEXT,                     -- SUB_YEAR/SUB_3YEAR/ONETIME
  ADD COLUMN term_months INT,                    -- 12/36；买断=永久
  ADD COLUMN list_price DECIMAL(15,2),           -- 累计刊例价（合同源数据）
  ADD COLUMN tax_rate DECIMAL(6,4),              -- 行级税率（按大类）
  ADD COLUMN tax_amount DECIMAL(15,2),
  ADD COLUMN is_gift BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN gift_original_amount DECIMAL(15,2), -- 赠送前应收
  ADD COLUMN maintenance_months INT,             -- 维保续保年份（买断场景）
  ADD COLUMN version_from TEXT,                  -- 转版本来源
  ADD COLUMN version_to TEXT;                    -- 转版本目标
```

**O4 参数消费（默认种子=主设计 O4，key 待业务定稿）**

```text
maintenance_rate        = 0.20   # 维保基础费率（口径待确认）
maintenance_increment   = 0.02   # 多套/续年递增（口径待确认）
maintenance_base_mode   = ...    # 基数口径（软件总价/含税/不含税，待确认）
gift_quota              = {5,3,1,5000}  # 赠送配额（账号/年限/实施次数/金额，待确认）
tax_rate_software       = 0.13   # 软件大类税率
tax_rate_service        = 0.06   # 服务大类税率
fx_source / fx_date_policy = ... # 汇率源与时点（主设计标注待定）
```

**引擎输出（计算链统一产出，供 F034 冻结）**

```jsonc
// quote_items 行：unit_price(边际) / list_price(累计) / discount / line_total / tax_rate / tax_amount
//   is_gift=true → line_total 不计入 subtotal/total，仅展示划线 gift_original_amount
// quotes：subtotal / discount_amount / tax_amount / total_amount
//   tax_summary = { "software": {"rate": 0.13, "tax_amount": ...}, "service": {"rate": 0.06, ...} }
//   amount_in_words = 中文大写(含税总价)
```

**互斥与校验（引擎 + validation）**：维保/增购互斥；买断才允许 `maintenance_months`；`is_gift` 行必须带 `gift_original_amount`；转版本必须有 `version_from/version_to` 与历史实付；币种切换必须带 `fx_source/fx_date`；大写与 `total_amount` 由同一计算链生成并断言一致。

### 3.3 状态机

```
不改变报价状态机（仍为 F033 的 DRAFT→PENDING_APPROVAL→APPROVED/REJECTED）；
高级科目在 DRAFT 编辑/重算时生效，金额字段在提交前完成校验；
冻结后金额/科目字段进入 F034 版本（不可变），高级科目计算不产生独立状态。
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 业务口径未定（维保 20%+2%、赠送配额、汇率源） | 全部参数化，默认值=主设计种子；未定项显式标「待确认」，不硬编码；发布前业务确认 G1 类问题 |
| 汇率/税率漂移导致历史单不一致 | `fx_date`/版本冻结（F034）固化取值；历史核对走快照；引擎数字不与活配置联动 |
| 转版本历史实付缺失 | 录入入口 + 校验；缺数据时禁止提交转版本行（显式错误，不静默） |
| 精度/舍入漂移（大写、税额、汇率） | 统一 decimal 精度规则（金额 15,2 / 汇率 18,6 / 税率 6,4）+ 单元测试锁定；大写与数字同源生成 |
| 赠送误计总价 | `is_gift` 行强制不进 subtotal/total；E2E 断言总价不含赠送行 |
| 分税大类映射错配 | 大类→税率组走 O4 参数 + O6 字段字典派生；校验行级税率合计= tax_summary |

---

## 4. 视觉锚点

### 4.1 参考页面
- 主设计 §二（quotes/quote_items ★ 字段表）、O4（业务参数）
- 场景材料 `field-design.txt`（中文大写、分税按大类、汇率快照口径）
- 现状 `app/quotes/new/page.tsx`（编辑器需增加高级科目录入区）

### 4.2 组件
- 明细行高级科目编辑：版本/部署/授权/期限、维保年份、转版本选择器（version_from/to + 历史实付入口）、赠送标记（划线原价展示）
- 报价头币种选择器（切换=重算，非换符号）与汇率信息（源/时点只读展示）
- 金额区：小计/折扣/税额/含税总价 + 中文大写 + 分税摘要（按大类）
- 校验提示：互斥、基数、缺历史实付、汇率缺失

### 4.3 禁止偏离
- 禁止硬编码任何业务数字（20%/2%/13%/6%/5/3/1/5000）——必须走 O4 参数
- 禁止「换符号当汇率换算」；禁止赠送行计入总价
- 禁止人工填写/修改 `amount_in_words`（引擎生成）
- 禁止输出无分税摘要或税额与行级税率不等的报价单
- 禁止业务页面写参数配置（F000：业务页只读消费）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | 维保计算（费率/多套递增/基数口径）、转版本三时点折残值、汇率换算（切换币种计算非换符号）、赠送不计总价、中文大写（0/整数/角分/负数）、分税摘要（按大类） | 边界与口径用例逐项通过；同一参数变更后（改 O4 不重启）计算结果即时变化；数字与公式 100% 一致（含舍入规则） |
| 接口测试 | 报价创建/重算计算链、历史实付录入、参数只读消费 | 入参含高级科目时返回完整结构化字段（currency/exchange_rate/amount_in_words/tax_summary/行级税）；互斥/基数/缺汇率/缺实付返回 422 且不落库；冻结版本（F034）金额字段拒绝修改 |
| E2E | 含维保+转版本+赠送+汇率+分税+大写的真实单全流程 | 报价单打印：赠送行划线且不计总价、中文大写与数字一致、分税摘要按大类合计正确、外币汇率展示正确；冻结后历史版本字段不随参数漂移 |
| 人工验收 | **历史真实单回归** + 售卖规则核对 | 历史真实单逐位回归通过（金额/税额/大写/维保/折残值与原单一致）；与售卖规则 12 条逐项核对（SC4）；G1 类口径经业务确认 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F035 标记)
```

### 6.2 关键决策
- **决策**: (...)
- **理由**: (...)

### 6.3 非目标
- (...)

---

## 7. 评审记录

| 评审类型 | 评审人 | 状态 | 日期 | 备注 |
|---------|--------|------|------|------|
| PM 需求评审 | | | | |
| Dev 技术评审 | | | | |
| QA 测试评审 | | | | |

---

## 8. 发布记录

| 字段 | 值 |
|------|-----|
| **环境** | |
| **发布时间** | |
| **发布结果** | |
| **回滚点** | |

---

## 9. 回写记录

| 目标 | 状态 | 更新点 |
|------|------|--------|
| `REQ_REGISTRY.yml` F035 | 待更新 | |
| `03-design-truth/` | 待更新 | |
| `04-implementation-truth/` | 待创建 | |

---

## 附录：状态机

```
drafting → pm_review → tech_review → test_review → coding → code_review → qa_acceptance → ready_to_release → released
                                                                                          ↓
                                                                                        rejected
```

| 状态 | 含义 | 谁推进 |
|------|------|--------|
| `drafting` | AI 需求反讲中 | AI |
| `pm_review` | 等产品确认 | PM |
| `tech_review` | 等研发评审 | Dev |
| `test_review` | 等测试方案评审 | QA |
| `coding` | AI 编码中 | AI |
| `code_review` | 代码审查中 | Dev |
| `qa_acceptance` | 测试/产品验收中 | QA/PM |
| `ready_to_release` | 可发布 | DevOps |
| `released` | 已上线 | - |
| `rejected` | 被打回 | 任意 |
