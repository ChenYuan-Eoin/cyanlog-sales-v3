# Feature Packet: F038-多维价盘

> 阶段 0 设计交付物（只写文档，不写代码）。依据：主设计 `/.tmp/F0-报价域-配置对象与结构化字段设计.md` O3 + §三 价盘导入与校验；现状 `product-truth/feature-packets/F000-config-center-architecture.md`、`F001-price-list.md` 及 `product-truth/product-code` 现有实现（`lib/pricing/engine.ts`、`lib/pricing/service.ts`、`app/api/product-price-tiers`、`supabase/migrations/20260608000001_org_pricing_and_quote_items.sql`）。

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F038 |
| **Name** | 多维价盘 |
| **Module** | 配置中心 / 报价域（唯一算价来源） |
| **Branch** | `feature/F038-price-matrix` |
| **Owner** | （待定） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

依据主设计 O3，本包把「唯一算价来源」从现状二维阶梯价升级为多维价盘：

- **四维 + 区间**：product_id × version_code × deployment × auth_mode × term_months × currency × qty_from/qty_to 档位。
- **两口径**：`list_price`（累计刊例价）与 `unit_price`（区间单账号价，边际口径），并存于同一价盘行。
- **数学校验**：qty_from≥1、qty_to>qty_from、区间不重叠、无上限档最后；**累计=上档累计+本档 unit_price×档差**（容差 0.01）；高可用/信创=企业版×1.2（可配校验开关）；**10,000+ 档无价**（list_price/unit_price 为空，输出「请联系我们」）；导入/编辑强制校验，失败拒绝发布并返回逐行错误。
- **Excel 导入**：导入对象=产品×版本×部署×授权×期限×档位；验收硬门=Project 234 行导入 0 失败、30 点抽样与 Excel 100% 一致。
- **引擎扩维**：现状 `engine.resolveProductUnitPrice(product, quantity)` 为二维（base_price/product_price_tiers），扩维后按多维 key 命中并支持累计/边际两口径；兼容 product_price_tiers 二维特例。
- **V3 落点**：新增 `price_matrix` + `price_matrix_versions`；PriceListTab 升级；报价明细固化 list_price 等合同源数据（主设计 §二 quote_items ★，落库随阶段 1）。

### 2.2 待确认问题

- [ ] Project 234 行价盘源：`.tmp/price-table-dump.txt` 当前为 243 行原始 dump（表头+数据行），234 行口径、列名/列顺序的最终导入模板需 PM 定稿。
- [ ] 私有部署一次性授权 / 3 年订阅（O2 term_options 12/36/永久）的价盘数据是否与本批 234 行同时提供？
- [ ] 10,000+ 档是否所有维度组合统一无价？是否需要显式导入，还是系统自动补一档「无价」？
- [ ] dump 中浮点尾差（如 923199.999999999、568.000000000005）导入时按分四舍五入归一，容差 0.01，确认？
- [ ] 高可用/信创=企业版×1.2 校验开关默认开/关；信创是否仅「企业版×私有部署」可配（dump L3 提示「仅企业版私有部署支持信创」）？
- [ ] currency 本期是否仅支持 CNY？多币种汇率源/时点由 F045 参数提供，F038 是否只做币种字段预留？
- [ ] engine 扩维签名：`resolveProductUnitPrice` 增加 context 参数属破坏性变更，是否保留缺省 context 走二维的兼容重载？
- [ ] price_matrix 与 product_price_tiers 并存期：二维特例映射到多维的默认 version/deployment/auth_mode/term_months 取值规则？
- [ ] 导入事务粒度：整批失败回滚 vs 部分成功（主设计「失败拒绝发布」倾向整批校验+拒绝发布）？
- [ ] 配置对象 API 前缀统一问题（同 F037：主设计目标 `/api/config-center/<domain>` vs 现状 `/api/configs` 模式）。

### 2.3 本轮边界

- **做**：O3 全部——price_matrix 对象（五触点）、四维+区间、两口径、Excel 导入与逐行数学校验、`engine.resolveProductUnitPrice` 扩维（含累计模式）、10,000+ 兜底、product_price_tiers 二维兼容层、PriceListTab 多维升级；默认种子（234 行）仅作附录。
- **不做**：产品目录/版本矩阵（F037，本包依赖其已发布维度与维度字典）；业务参数（F042，1.2 校验开关与汇率参数属其消费面）；报价版本化/快照（F044）；历史报价重算（禁止，F001 §5 快照规则）；产品/版本/授权主数据的新增（F037）。

---

## 3. 技术方案

### 3.1 接口设计

五触点落地：

| 触点 | 现状依据 | 本包新增 |
|------|----------|----------|
| `lib/configs/types.ts` | 现有 Config 各 Value 接口 | `PriceMatrixRow`（product_id/version_code/deployment/auth_mode/term_months/currency/qty_from/qty_to/unit_price/list_price/sort_order/status/org_id）、`PriceMatrixValue` 类型 |
| `lib/configs/validation.ts` | 现有 zod schema 模式 | `priceMatrixRowSchema`：区间合法、不重叠、无上限档最后、累计=上档累计+本档×档差（容差 0.01）、10,000+ 无价、1.2 校验开关 |
| `lib/configs/runtime.ts` | `listPublishedConfigsByType` / `getPublishedTaxRate` | `listPublishedPriceMatrix(orgId, filter)`：只读 PUBLISHED 且按 org 过滤 |
| API | 现状 `app/api/configs` 五端点 + `app/api/product-price-tiers`（route.ts 的 schema drift/MIGRATION_REQUIRED 模式） | 按主设计目标 `app/api/config-center/price-matrix`：CRUD + import + validate + versions/publish/rollback |
| UI | 现状 `app/configs/tabs/PriceListTab.tsx`（SKU 卡片 + 阶梯价 Badge） | PriceListTab 升级为多维价盘（版本/部署/授权/期限筛选、两口径展示、导入入口） |

API 端点：

| 方法 | 路径 | 说明 | 错误码（沿用现状） |
|------|------|------|------|
| GET | `/api/config-center/price-matrix?product_id=&version_code=&deployment=&auth_mode=&term_months=&currency=&status=` | 分页/筛选列表（org 内） | NOT_FOUND/DB_ERROR |
| POST | `/api/config-center/price-matrix` | 单行新增/编辑（落草稿） | VALIDATION_ERROR(400) |
| POST | `/api/config-center/price-matrix/validate` | dry-run 纯校验，不落库，返回逐行错误 | VALIDATION_ERROR（含逐行错误） |
| POST | `/api/config-center/price-matrix/import` | multipart Excel 导入：先校验，失败返回逐行错误且拒绝发布；成功落草稿 | VALIDATION_ERROR（逐行 `{row, code, message}`）、MIGRATION_REQUIRED(409) |
| GET/PATCH/DELETE | `/api/config-center/price-matrix/[id]` | 详情/更新/删除 | NOT_FOUND(404) |
| GET/POST/POST | `[id]/versions`、`[id]/publish`、`[id]/rollback` | 版本历史/发布/回滚（复用现状 `app/api/configs/[id]` 模式） | DB_ERROR(500) |

引擎接口（扩维，现状 `lib/pricing/engine.ts`）：

```ts
// 现状
resolveProductUnitPrice(product: PriceBookProduct, quantity: number): PriceResolution
// 目标（兼容层：context 缺省时行为与现状一致）
interface PriceContext {
  versionCode?: string
  deployment?: string
  authMode?: string
  termMonths?: number
  currency?: string          // 本期仅 'CNY'
  mode?: 'marginal' | 'cumulative'   // 边际（区间单账号价）vs 累计（累计刊例价）
}
interface PriceResolution {
  unitPrice: number
  source: 'base' | 'tier' | 'matrix' | 'contact_us'
  tier: ProductPriceTier | null
  matrixRow?: PriceMatrixRow | null
  listPrice?: number | null
  message?: string           // 10,000+ 档 -> '请联系我们'
}
resolveProductUnitPrice(product, quantity, context?: PriceContext): PriceResolution
resolveCumulativeListPrice(product, quantity, context?: PriceContext): PriceResolution
```

### 3.2 数据模型

`price_matrix`（强类型表，F000 §5.1；字段=主设计 O3）：

```sql
CREATE TABLE price_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version_code TEXT NOT NULL,              -- STD/PRO/ENT/XINCHUANG（F037 维度）
  deployment TEXT NOT NULL,                -- PUBLIC_CLOUD/PRIVATE/HA（F037 维度）
  auth_mode TEXT NOT NULL,                 -- SUB_YEAR/SUB_3YEAR/ONETIME（F037 维度）
  term_months INT NOT NULL,                -- 12/36；买断=永久（主设计 O2/O3）
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  qty_from INT NOT NULL,
  qty_to INT NULL,                         -- NULL=无上限档，必须最后
  unit_price DECIMAL(15,2),                -- 区间单账号价（边际）；10,000+ 档为 NULL
  list_price DECIMAL(15,2),                -- 累计刊例价；10,000+ 档为 NULL
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED','INACTIVE')),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id, version_code, deployment, auth_mode, term_months, currency, qty_from),
  CHECK (qty_from >= 1 AND (qty_to IS NULL OR qty_to > qty_from))
);
```

累计不变量（主设计 §三.2，写入层强制，失败拒绝发布）：同一 (org, product_id, version_code, deployment, auth_mode, term_months, currency) 组内按 qty_from 升序，`list_price[n] = list_price[n-1] + unit_price[n] × (qty_from[n] - qty_from[n-1])`，容差 0.01；10,000+ 档（qty_from≥10000）list_price/unit_price 必须为 NULL，输出「请联系我们」（主设计 §三.4）。

`price_matrix_versions`（镜像现状 `config_versions` 模式，20260603000001 迁移）：

```sql
CREATE TABLE price_matrix_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matrix_id UUID NOT NULL REFERENCES price_matrix(id) ON DELETE CASCADE,
  version INT NOT NULL,
  snapshot JSONB NOT NULL,               -- 发布时整组价盘快照（组=维度+档位）
  status TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (matrix_id, version)
);
```

二维特例兼容（主设计 O3「兼容 product_price_tiers 二维特例」+ 现状 20260608000001 迁移）：`product_price_tiers`（product_id/qty_from/qty_to/unit_price/sort_order）继续作为二维回退；读取层优先 `price_matrix`（PUBLISHED），未命中多维时回退 `product_price_tiers` / `base_price`（现状 `engine.resolveProductUnitPrice` 与 `service.calculateQuoteDraft` 行为不变）；并提供迁移工具将现有二维数据映射为默认维度行（默认 version/deployment/auth_mode 取值见 2.2 待确认）。

导入校验规则（主设计 §三，全部强制）：

1. 档位区间合法：qty_from≥1、qty_to>qty_from、不重叠、无上限档最后
2. 累计=上档累计+本档 unit_price×档差（容差 0.01）
3. 高可用/信创 = 企业版×1.2（可配校验开关，开关来自 F042 业务参数或本对象配置位——见 2.2）
4. 10,000+ 档无价（list_price/unit_price 空 →「请联系我们」）
5. 失败拒绝发布，返回逐行错误

来源映射：全部字段与校验规则=主设计 O3 + §三；兼容策略=现状 product_price_tiers 迁移 + F001 §4；导入源=`.tmp/price-table-dump.txt`（当前证据，非 design-truth）。

### 3.3 状态机

价盘对象生命周期（复用 configs 现状 + 导入态）：

```
Excel 导入/单行编辑 ──[validate 通过]──> DRAFT ──[publish]──> PUBLISHED ──[edit]──> DRAFT(新版本)
        │  (validate 失败 → 返回逐行错误，不落库/拒绝发布)
        │                                                      ├──[rollback]──> 历史 PUBLISHED
        │                                                      └──[archive]──> ARCHIVED
```

行级状态：`ACTIVE` 参与定价 / `INACTIVE` 不参与（对应主设计 status 字段；归档行保留用于历史核对）。

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| Excel 浮点尾差导致累计校验误报 | 导入按分归一（四舍五入 2 位），累计容差 0.01；超差返回逐行错误并拒绝发布（主设计 §三.5） |
| 234+ 行大导入性能/事务 | validate dry-run 先行；导入事务内批量 upsert，失败整批回滚（待确认问题确认粒度） |
| 引擎破坏性变更影响报价 | 兼容层：context 缺省走二维（product_price_tiers/base_price），`service.calculateQuoteDraft` 逐步迁移 |
| 多维配置缺失导致算价失败 | 无命中矩阵行时按 10,000+ 逻辑返回「请联系我们」或显式错误「请配置价盘」，禁止静默用 0 价 |
| 历史报价被新价盘污染 | 保持 F001 §5 快照规则：报价创建时固化 unit_price/list_price，之后价盘变更不重算历史报价 |
| 双表并存口径漂移 | 读取层单一口径（优先 price_matrix），二维回退仅兜底；迁移工具将现有二维数据映射为默认维度行 |

---

## 4. 视觉锚点

### 4.1 参考页面

- `product-truth/product-code/app/configs/tabs/PriceListTab.tsx`（现状价盘 Tab，本包升级参照）
- `product-truth/product-code/app/quotes/new/page.tsx`（报价新页选品/数量输入，价盘命中展示消费方）
- `product-truth/03-design-truth/README.md`（设计真相边界）
- `.tmp/price-table-dump.txt`（Project 价盘当前证据/导入样例源，非 design-truth，仅供测试与导入模板对齐）
- F001 §6 客户端能力要求（SKU 列表/阶梯价摘要/编辑/停售启售；报价侧展示命中档位与价格来源）

### 4.2 组件

- shadcn/ui：`Card`、`Table`、`Badge`、`Button`、`Dialog`、`AlertDialog`、`Select`、`Switch`、`Tabs`、`Tooltip`、文件上传（沿用 app/configs 现有组件与 F011 §10.3 选型）

### 4.3 禁止偏离

- 禁止把价盘压进泛型 `configs` 表（F000 §5.2/§8 反模式）
- 禁止报价业务页面直接写价盘（F000 §2 强约束）
- 禁止历史报价随价盘变更重算（F001 §5 快照规则）
- 禁止 10,000+ 无价档出现占位 0 或隐藏「请联系我们」文案

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | `lib/pricing/engine.ts` 扩维函数；`lib/configs/validation.ts` price_matrix schema | 二维兼容调用（无 context）结果与现状一致；四维命中返回正确 marginal/cumulative 两口径；累计公式跨档验证容差 0.01；10,000+ 档返回 `contact_us` +「请联系我们」；区间非法/重叠/无上限非末档/负数价全部被校验拒绝 |
| 接口测试 | price-matrix CRUD + import/validate + versions/publish/rollback | dry-run 返回逐行错误且不落库；非法数据 publish 被拒绝；**Project 234 行导入 0 失败**且全部入草稿；发布后 30s 内消费端读到新价（服务不重启）；org 间价盘隔离 |
| E2E | 配置中心 PriceListTab（多维）→ 报价新页 | 导入 234 行→发布→报价页选择产品/版本/部署/授权/期限/数量→行单价与 Excel 一致；**30 点抽样 100% 一致**（含累计刊例价与区间单账号价两口径）；数量≥10,000 显示「请联系我们」且不可提交（或明确提示） |
| 人工验收 | 抽样核对 + 双口径展示 + 二维兼容回退 | 30 点抽样与 Excel 100% 一致；现有二维 product_price_tiers 报价在未配置多维行时行为不变（回退 base/tier）；改价发布后不重启生效；失败导入返回逐行错误清单 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F038 标记)
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
| `REQ_REGISTRY.yml` F038 | 待更新 | |
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

## 附录：默认种子（仅作附录，不进正文）

- 主设计 O3 默认种子：**Project 价盘 234 行（导入）**。
- 当前证据：`.tmp/price-table-dump.txt`（243 行原始 dump：标准/专业/企业/信创 × 公有云/私有部署 × 按年订阅 12 个月；F/G/H/I/J/K/L/M 列为「刊例价」+「区间单账号刊例价」，含 10,000+ 档位观察点）。
- 说明：最终导入模板（列名/列顺序）与 234 行口径待 PM 定稿（见 2.2 待确认问题）；评审通过后在 `03-design-truth/` 固化。
