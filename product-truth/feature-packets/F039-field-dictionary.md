# Feature Packet: F039-字段字典与输出白名单

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F039 |
| **Name** | 字段字典与输出白名单 |
| **Module** | 报价域 / 配置中心（输出规则能力域） |
| **Branch** | `feature/F039-field-dictionary` |
| **Owner** | TBD（待指派） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

把「报价单/输出用哪些字段、字段怎么来、怎么转、能不能对外」变成**配置中心的规则**，增删改字段不写代码：

- 建立 **O6 字段字典（field_dictionary）**：每个字段记录 `field_key / business_name / source / transform_rule / output_classification / is_external / data_type / options / default_value / remark`，字段唯一键 `field_key`（系统内部唯一变量名，客户模板怎么变，变量名不变）。
- **隐藏字段白名单派生**：白名单不是人工再维护一张表，而是从已发布字段字典**派生**——`is_external=false` 的字段永不进入输出流；只有 `is_external=true` 的已发布字段才进入导出/打印渲染。
- **物理隔离**：内部字段（成本/底价/毛利/审批人/审批意见）只存在于逻辑运算层；所有导出入口（标准单 F040、非标模板 F046、打印）必须经过 `field-whitelist` 过滤后才允许进入渲染引擎。
- 默认出厂 **31 个字段**只作为种子与核对基线（附录 B），不替代业务定稿。

来源：主设计 O6 + F039 包划分；V3 现状审计（配置中心泛型 `configs/config_versions` 无字段目录；`contract_template_params` 提供 per-org 参数表模式可复用；报价当前无导出）；需求材料字段字典六类与五种转换规则、Whitelist Filter 物理隔离协议。

### 2.2 待确认问题

- [ ] `output_classification` 枚举口径：主设计 O6 为 5 值（header/software/financial/clause/internal），需求材料为 6 类（报价单头/软件明细/价格汇总/财务摘要/条款承诺/内部隐藏）——是否把「价格汇总」并入 `financial`（推荐，用 options/子类区分），还是扩为 6 值？需 PM 定稿。
- [ ] 31 个默认字段的精确清单：隐藏安全类为 5 还是 6（是否含 `rebate_commission` 返点/竞对价）。本包附录按「隐藏 6 个共 31」列出（与主设计「隐藏 5+」兼容），待业务定稿。
- [ ] 字段字典与现有 `contract_template_params` 的关系：并存（本表=报价侧字段/白名单真相，`contract_template_params`=合同侧模板参数）还是统一迁移？推荐并存、不迁移存量数据。
- [ ] 历史版本导出用哪个白名单：导出时点的已发布白名单（写入 F044 快照）还是最新发布版？推荐导出时点，保证「历史版本不随配置漂移」。
- [ ] 自定义字段的消费边界：`direct/formula` 首批只支持引用现有计算函数；`semantic/capture` 仅服务非标映射（F046）。是否开放可配置 formula 表达式，需 Dev 技术评审。
- [ ] 白名单变更对在途草稿的提示：字段被停用/改隐藏后，草稿报价是否提示字段缺失？（推荐：导出时提示并阻断，草稿不强制）

### 2.3 本轮边界

- **做**：
  - O6 `field_dictionary` 配置对象进入配置中心五触点（`lib/configs/types.ts → validation.ts → runtime.ts → app/api/config-center/field-dictionaries → app/configs` 新 Tab）。
  - 白名单派生机制（已发布 + `is_external=true`）与消费面 API。
  - `lib/export/field-whitelist.ts` 白名单投影模块（供 F040/F046 与打印共用）。
  - 31 个默认字段种子（附录 B，作为出厂基线）。
  - 发布校验：字段被 F040 模板变量引用时不可停用为隐藏/删除（与 F040 联动）。
- **不做**：
  - 报价结构化字段落库与版本化（F044 前置，本包只定义字段语义）。
  - 标准/客户模板与条款注入（F040）。
  - 非标模板语义映射（F046）。
  - 修改报价算价/审批代码逻辑（除导出边界接白名单外，行为不变）。
  - 迁移/合并 `contract_template_params`（合同侧，后置决策）。

---

## 3. 技术方案

> 依据：主设计 O6（字段、校验、默认种子、V3 落点）；F000 配置中心三层架构与 5.1 强类型表约束；V3 现状 `contract_template_params`（20260618000002）、`lib/configs/types.ts / validation.ts / runtime.ts`、`app/api/configs/[id]/publish|rollback|versions`；需求材料「隐藏字段物理隔离协议（Whitelist Filter）」。

### 3.1 接口设计

**配置面（配置中心五触点，`app/api/config-center/field-dictionaries`）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/config-center/field-dictionaries` | GET/POST | 字段列表（按类别/状态/org 过滤）/新建字段 |
| `/api/config-center/field-dictionaries/[id]` | GET/PATCH/DELETE | 字段详情/编辑/删除（删除仅限未发布且未被引用） |
| `/api/config-center/field-dictionaries/[id]/versions` | GET | 版本历史（复用 config_versions 语义） |
| `/api/config-center/field-dictionaries/[id]/publish` | POST | 发布：校验唯一性/枚举/被引用约束后生效 |
| `/api/config-center/field-dictionaries/[id]/rollback` | POST | 回滚到历史发布版本（消费面立即切换） |
| `/api/config-center/field-dictionaries/whitelist` | GET | **消费面专用**：仅返回已发布且 `is_external=true` 的字段（服务端投影，不返回任何内部字段） |

**消费面（导出/打印共用）**

| 接口/模块 | 说明 |
|---|---|
| `lib/export/field-whitelist.ts` | `getOutputWhitelist(orgId)` 运行时读取（服务端），返回白名单字段数组；`projectToWhitelist(payload, whitelist)` 对任意报价 DTO 做白名单投影，内部字段物理剔除 |
| `POST /api/quotes/[id]/export`（F040 落地） | 渲染入参 = 白名单投影后的 DTO；`word-generator` 只接受白名单 JSON |

**错误码约定**：400 枚举非法/数据格式错误；409 `field_key` 重复或字段被模板引用不可停用/删除；404 字段不存在；422 发布校验失败（含被引用字段降级为隐藏）。

### 3.2 数据模型

**配置对象（新表，org 隔离 + 版本化/发布语义，走 F000 强类型约束；复用 `contract_template_params` 的 per-org 种子模式）**

```sql
field_dictionaries (
  id UUID PK,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,                 -- 系统唯一变量名（如 grand_total、internal_cost）
  business_name TEXT NOT NULL,             -- 业务描述/显示名（如 含税总价、内部成本）
  source TEXT NOT NULL CHECK (source IN ('system','input','config','computed')),
  transform_rule TEXT NOT NULL CHECK (transform_rule IN ('direct','formula','semantic','conditional','capture')),
  output_classification TEXT NOT NULL CHECK (output_classification IN ('header','software','financial','clause','internal')),
  is_external BOOLEAN NOT NULL DEFAULT false,   -- 白名单根：false 永不进输出流
  data_type TEXT NOT NULL CHECK (data_type IN ('string','number','date','bool','array','jsonb')),
  options JSONB,                          -- 枚举选项（对应 contract_template_params.param_options）
  default_value JSONB,                    -- 默认值（对应 param_default_value 模式）
  remark TEXT,
  sort_order INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  version INT NOT NULL DEFAULT 1,
  created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, field_key)
)

field_dictionary_versions (
  id UUID PK,
  field_id UUID NOT NULL REFERENCES field_dictionaries(id) ON DELETE CASCADE,
  version INT NOT NULL,
  value JSONB NOT NULL,                    -- 该版本完整字段快照（与 config_versions.value 语义一致）
  status TEXT CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (field_id, version)
)
```

**与 `contract_template_params` 的对应关系（复用模式，不合并）**：`field_key=param_key`、`business_name=param_label`、`data_type=param_type`、`options=param_options`、`default_value=default_value`、`sort_order` 与 per-org 种子一致；`contract_template_params` 额外有 `applicable_scenario`（合同侧场景），本表以 `output_classification` 表达输出位置。

**白名单派生（唯一真相）**：白名单 = `SELECT field_key, business_name, data_type, transform_rule, output_classification, options FROM field_dictionaries WHERE org_id=$1 AND status='PUBLISHED' AND is_external=true ORDER BY sort_order`。任何导出/打印路径不得手工维护第二份字段清单。

**物理隔离约定**：`output_classification='internal'` 与 `is_external=false` 双保险——内部字段只存在于逻辑运算层（算价/审批），在进入渲染引擎前由 `projectToWhitelist` 物理剔除；`word-generator`（F040 改造）与 F046 非标渲染共用同一白名单，禁止绕过。

### 3.3 状态机

```
字段：DRAFT ──publish（校验通过）──▶ PUBLISHED ──archived──▶ ARCHIVED
              ▲                            │
              └─────────rollback───────────┘（切回历史 PUBLISHED 版本）

消费面：只读 PUBLISHED；whitelist 每次按当前发布态派生
```

- 发布校验链：`field_key` 唯一 → 枚举合法 → 默认值类型匹配 `data_type` → 被 `output_templates.variables` 引用的字段不允许 `is_external=false` 或删除（F040 联动）。
- 回滚不回退引用关系；被回滚版本引用的模板需重新校验（F040 发布时再做）。

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 字段字典与代码字段漂移（新增代码字段未入字典） | 导出边界白名单投影强制：未在白名单的字段直接被剔除；E2E 断言导出件不含任何未登记键；新增计算字段流程=先入字典再发布 |
| 隐藏字段被误标对外 | `is_external` 默认 false（白名单是正列表）；导出链路单元/接口测试包含红队用例（构造 internal_* 值断言不出现）；人工验收 grep 导出文件 |
| 白名单变更影响历史导出 | 导出使用发布时点白名单并随 F044 快照固化；本包先约定语义，快照锁定在 F044 落地 |
| 配置中心不可用导致导出失败 | 降级使用最近一次已发布白名单缓存（沿用 `getPublishedUITheme` 的缓存+超时降级模式），并在导出审计记录降级标记 |
| 31 个默认字段与业务实际不符 | 种子仅作基线，发布前由 PM/业务核对；附录 B 标注待定项 |

---

## 4. 视觉锚点

### 4.1 参考页面
- 主设计 O6（字段定义/校验/默认种子/落点）
- `product-truth/feature-packets/F000-config-center-architecture.md`（配置中心三层架构、强类型表约束）
- 现状 `app/configs/tabs/TaxTab.tsx / ThemeTab.tsx`（Tab 骨架）、`app/configs/dialogs/ThemeEditForm.tsx`（表单/发布交互模式）

### 4.2 组件
- 配置中心「字段字典」Tab：字段列表（按六类分组）、字段表单（来源/转换规则/输出分类/是否对外）、版本历史/发布/回滚、白名单预览面板（实时显示派生白名单）
- 报价详情/导出页：只读展示「当前命中的白名单字段数」，不暴露写入口

### 4.3 禁止偏离
- 禁止把字段字典压进泛型 `configs` 单表（F000 5.2 强类型表优先）
- 禁止在报价页/导出页写字段配置（F000：业务页面只能消费配置）
- 禁止导出路径绕过白名单（不得把报价源数据整包 JSON 直接传入渲染器/生成器）
- 禁止手工维护第二份输出字段清单（白名单唯一派生）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | schema/校验：`field_key` 唯一、source/transform_rule/output_classification/data_type 枚举、默认值类型；白名单派生函数；`projectToWhitelist` 物理剔除 | 枚举与唯一性校验全通过；`is_external=false` 字段在任意输入下永不出现于白名单/投影结果；对 31 个默认字段断言：31 个全部合法、隐藏类 `is_external=false` |
| 接口测试 | 字段 CRUD + versions/publish/rollback + `/whitelist` | 发布后无需重启即生效；`/whitelist` 仅返回已发布且 `is_external=true`；DRAFT/ARCHIVED 对消费面不可见；被模板引用的字段发布为隐藏返回 422 |
| E2E | 配置中心字段字典 Tab 增改/发布 → 构造含 `internal_cost/min_price/margin_rate/approver/approval_opinion` 的报价 → 标准导出 Word → 解包检查 | 导出文件（docx 解包后的 document.xml 与元数据）不含任何隐藏字段键/值——**打印/导出内部信息零泄漏**硬门通过 |
| 人工验收 | 31 个默认字段核对；改字段名/输出分类后导出对照 | 与附录 B 基线 100% 一致（除待定项标注）；字段改动发布后新导出即生效、历史导出不受影响（配合 F044 快照） |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F039 标记)
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
| `REQ_REGISTRY.yml` F039 | 待更新 | |
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

---

## 附录 B：31 个默认字段（种子基线，仅作核对，待业务定稿）

> 依据：主设计 O6「默认种子：31 个字段（基础识别 5 / 商务实体 5 / 核心联动 5 / 财务 6 / 承诺 4 / 隐藏 5+）」+ 需求材料六类变量表；`output_classification` 暂按 O6 五值映射（价格汇总/财务摘要均落 `financial`，见 2.2 待确认 1）。隐藏类共列 6 个（第 31 个 `rebate_commission` 待确认）。

| # | field_key | business_name | 来源 | 转换规则 | 输出分类 | is_external | data_type |
|---|---|---|---|---|---|---|---|
| 1 | quote_id | 报价单号 | system | formula | header | true | string |
| 2 | proj_name | 项目名称 | input | direct | header | true | string |
| 3 | proj_no | 项目/招标编号 | input | direct | header | true | string |
| 4 | quote_date | 报价日期 | system | direct | header | true | date |
| 5 | valid_till | 有效期至 | system | formula（报价日+有效天数，参数可配） | header | true | date |
| 6 | cust_full_name | 客户全称 | input | direct（与公章一致校验） | header | true | string |
| 7 | supp_full_name | 我方全称 | config | direct | header | true | string |
| 8 | supp_contact | 我方联系人 | input | direct | header | true | string |
| 9 | currency | 币种 | config | conditional（默认人民币） | financial | true | string |
| 10 | fx_rate | 汇率 | input/config | formula（外币×汇率=本位币；取值时点可配） | financial | true | number |
| 11 | v_type | 版本类型（订阅/买断） | input | conditional（驱动部署/授权/条款） | clause | true | string |
| 12 | v_period | 服务周期（1/3年/永久） | input | conditional（订阅乘年数、买断转维保） | clause | true | string |
| 13 | deploy_mode | 部署方式 | system | conditional（买断→私有化；能力表门禁） | clause | true | string |
| 14 | auth_mode | 授权方式 | system | conditional（与能力矩阵一致，不可改出不一致） | clause | true | string |
| 15 | sla_clause | 关联条款 | system | conditional（v_type→SLA 话术库） | clause | true | string |
| 16 | line_items | 产品/服务行数组 | system | formula（档位匹配→累计/边际价） | software | true | array |
| 17 | sub_total | 分项小计 | system | formula | financial | true | number |
| 18 | discount_rate | 折扣率 | input | formula（实时重算；越权触发审批） | financial | true | number |
| 19 | grand_total | 含税总价 | system | formula（分税汇总） | financial | true | number |
| 20 | total_in_words | 总价大写 | system | formula（NumberToChinese） | financial | true | string |
| 21 | tax_summary | 税金摘要 | system | formula（按大类税率分拆，13%/6% 可配） | financial | true | jsonb |
| 22 | promo_list | 优惠承诺清单 | input | semantic（勾选项→条文 1/2/3） | clause | true | array |
| 23 | gift_items | 赠送行 | input | formula（保留折扣后应收、划线、不计总价） | software | true | array |
| 24 | delivery_terms | 交付说明 | config | conditional（公有云/私有云不同话术） | clause | true | string |
| 25 | payment_terms | 分期/付款 | input/config | direct（建议提示，最多 4 期可配） | clause | true | string |
| 26 | internal_cost | 内部成本 | config | —（禁止流向渲染引擎） | internal | false | number |
| 27 | min_price | 底价红线 | config | —（仅供警示/审批摘要） | internal | false | number |
| 28 | margin_rate | 毛利率 | system | —（仅供审批摘要，低于阈值标红） | internal | false | number |
| 29 | approver | 审批人 | system | —（审批路由，不输出） | internal | false | string |
| 30 | approval_opinion | 审批意见 | input | —（永不进入对外文件） | internal | false | string |
| 31 | rebate_commission | 返点/佣金 | config | —（仅供财务/合规判断） | internal | false | number |

> 说明：主设计「隐藏 5+」与材料「成本/底价/毛利/审批人/审批意见 + 返点」合并后为 6 个隐藏字段，构成 31；若业务确认返点不属于报价字段，则基线回落到 30，见 2.2 待确认 2。
