# Feature Packet: F027-产品目录与版本能力矩阵

> 阶段 0 设计交付物（只写文档，不写代码）。依据：主设计 `/.tmp/F0-报价域-配置对象与结构化字段设计.md` O1+O2；现状 `product-truth/feature-packets/F000-config-center-architecture.md`、`F001-price-list.md`、`F010-quote-rule-config.md`、`F011-org-permission-config.md` 及 `product-truth/product-code` 现有实现。

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F027 |
| **Name** | 产品目录与版本能力矩阵 |
| **Module** | 配置中心 / 报价域（可售对象与能力矩阵） |
| **Branch** | `feature/F027-product-catalog-version-matrix` |
| **Owner** | （待定） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

依据主设计 O1+O2，本包把「报价可售对象」与「版本×部署×授权×能力×期限允许矩阵」做成配置中心对象，遵循五触点：`lib/configs/types.ts` → `validation.ts` → `runtime.ts` → `app/api/config-center/<domain>`（list/[id]/versions/publish/rollback）→ `app/configs` 新 Tab。

- **O1 产品目录（product_catalog）**：报价可售对象，决定跟随/搭售/可售版本；字段含 id、code、name、category（BASE/FOLLOW_PRODUCT/FOLLOW_APP/FOLLOW_ECO）、standalone、follows[]、version_codes[]、account_constraint(jsonb)、status、org_id；校验要求 FOLLOW 系列必须 standalone=false 且 follows 非空、基座 standalone=true；默认种子 6 个产品（仅附录）。
- **O2 版本能力矩阵（version_capability_matrix）**：版本×部署×授权×能力的允许矩阵，字段含 version_code、deployment、auth_mode、capabilities[](ha/xinchuang/onetime/migration)、term_options[](12/36/永久)、mutex(jsonb)；矩阵即结构，改动走配置发布；默认种子标准/专业/企业/信创矩阵（仅附录）。
- **V3 落点**：products 加 attributes JSONB（含 category/standalone/follows/version_codes）或新建 product_catalog 旁挂表；新增 product_versions + 维度字典；配置中心新 Tab「产品目录」；PriceListTab 升级展示版本维度。
- **选品/防呆消费**：报价选品只展示已发布在售产品与可售版本；非法组合（部署×授权×能力×期限互斥）前端拦截 + 服务端二次校验；跟随类产品仅随基座出现；输出 F028 算价所需维度（version_code/deployment/auth_mode/term_months）。

### 2.2 待确认问题

- [ ] 主设计附录 A（6 个产品种子 + 标准/专业/企业/信创矩阵种子）当前未随主设计文件落地，需 PM 补齐后回填本包附录 A。
- [ ] O1 V3 落点二选一：products.attributes JSONB vs 旁挂强类型 product_catalog 表。本包推荐旁挂强类型表（F000 §5.1），待评审确认。
- [ ] O2 维度字典（deployment/auth_mode/term_options/capabilities）的枚举值与 F028 price_matrix 共用，是否由 F027 先建、F028 引用？
- [ ] capabilities 与 mutex(jsonb) 的具体互斥规则（如「信创×公有云」「一次性×SaaS」）需业务定稿。
- [ ] account_constraint(jsonb) 的表达式语法（如 min/max 账号数、按版本约束）待定。
- [ ] 配置对象 API 前缀：主设计目标为 `app/api/config-center/<domain>`，现状为 `app/api/configs`（含 [id]/versions/publish/rollback）。本期是否统一迁移前缀，还是先按现状模式新建 domain API？
- [ ] products 按 org 的 RLS 属主设计前置修复 #3，本包是否包含该修复，还是单独排期？
- [ ] FOLLOW 系列产品在报价单中的行级形态（随基座一行 / 独立行）待产品确认。

### 2.3 本轮边界

- **做**：O1 产品目录、O2 版本能力矩阵两个配置对象（五触点）；products/product_versions V3 落点；配置中心「产品目录」Tab 与 PriceListTab 版本维度升级；报价选品/防呆消费（前端过滤 + 服务端校验）；默认种子仅作附录。
- **不做**：多维价盘与 Excel 导入（F028）；业务参数（F032）；审批规则化（F033）；报价版本化与中间快照（F034）；税率/折扣矩阵改造（F010 现状不动）；报价结构化字段落库（阶段 1，随 F034/F035）。

---

## 3. 技术方案

### 3.1 接口设计

每个对象走五触点（主设计 §一），触点落地与现状依据如下：

| 触点 | 现状依据 | 本包新增 |
|------|----------|----------|
| `lib/configs/types.ts` | 现有 ConfigType/Config 与各 Value 接口（F009-F012） | `ProductCatalogValue`、`VersionCapabilityMatrixValue` 类型与 CONFIG_TYPE_META 条目（若走 config 类型化方案）；若走强类型表方案则在 `lib/product-catalog/types.ts` 承载，`lib/configs/types.ts` 仅登记类型元数据 |
| `lib/configs/validation.ts` | 现有 zod schema 模式（configKeySchema 等） | `productCatalogSchema`、`versionCapabilityMatrixSchema`：FOLLOW 系列 standalone=false 且 follows 非空；BASE standalone=true；矩阵组合合法 |
| `lib/configs/runtime.ts` | 现有 `listPublishedConfigsByType` / `getPublishedTaxRate` | `listPublishedProductCatalog(orgId)`、`getPublishedVersionMatrix(orgId)`：只读 PUBLISHED 且按 org 过滤 |
| API | 现状 `app/api/configs`（GET/POST）+ `[id]/versions` + `[id]/publish` + `[id]/rollback` | 按主设计目标 `app/api/config-center/product-catalog` 与 `app/api/config-center/version-capability-matrix`，端点一一对应现状五端点 |
| UI | 现状 `app/configs` + `tabs/PriceListTab.tsx` | 新 Tab「产品目录」（含产品目录、版本能力矩阵两个子区），PriceListTab 升级展示版本/部署/授权维度 |

API 端点（主设计目标形态，实现先复用现状 `app/api/configs` 模式）：

| 方法 | 路径 | 说明 | 错误码（沿用现状） |
|------|------|------|------|
| GET | `/api/config-center/product-catalog?status=&category=` | 分页列表（org 内） | NOT_FOUND/DB_ERROR |
| POST | `/api/config-center/product-catalog` | 新建（草稿） | VALIDATION_ERROR(400) |
| GET/PATCH/DELETE | `/api/config-center/product-catalog/[id]` | 详情/更新/删除 | NOT_FOUND(404) |
| GET | `/api/config-center/product-catalog/[id]/versions` | 版本历史 | DB_ERROR(500) |
| POST | `/api/config-center/product-catalog/[id]/publish` | 发布 | VALIDATION_ERROR（发布前交叉校验失败） |
| POST | `/api/config-center/product-catalog/[id]/rollback` | 回滚 | VALIDATION_ERROR |
| … | `version-capability-matrix` 同构 | 同上 | 同上 |

消费接口（选品/防呆，本包新增只读面）：

- `GET /api/quote/available-products`：返回已发布在售产品、可售版本 version_codes、合法 deployment/auth_mode 组合、跟随关系、账号约束。现状报价新页仅 `GET /api/products?status=active`（`app/quotes/new/page.tsx`），本包将其升级为按已发布目录/矩阵过滤。
- 报价创建 API 落库前服务端二次校验组合合法性（沿用 `lib/pricing/service.ts calculateQuoteDraft` 消费链，防前端绕过）。

### 3.2 数据模型

**方案 A（推荐）——旁挂强类型表（F000 §5.1「优先强类型表」）**

O1 产品目录（主设计字段 + 关联 products.id 的 product_id，V3 落点旁挂表需要）：

```sql
CREATE TABLE product_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('BASE','FOLLOW_PRODUCT','FOLLOW_APP','FOLLOW_ECO')),
  standalone BOOLEAN NOT NULL DEFAULT true,
  follows TEXT[] NOT NULL DEFAULT '{}',            -- 跟随产品 code
  version_codes TEXT[] NOT NULL DEFAULT '{}',       -- 可售版本
  account_constraint JSONB,                          -- 账号约束表达式
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code),
  CHECK (category = 'BASE' OR (standalone = false AND cardinality(follows) > 0)),
  CHECK (category <> 'BASE' OR standalone = true)
);
```

O2 版本能力矩阵（对象名 version_capability_matrix；V3 落点表名按主设计取 `product_versions`，每行 = 版本×部署×授权组合）：

```sql
CREATE TABLE product_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version_code TEXT NOT NULL,                        -- STD/PRO/ENT/XINCHUANG
  deployment TEXT NOT NULL,                          -- PUBLIC_CLOUD/PRIVATE/HA
  auth_mode TEXT NOT NULL,                           -- SUB_YEAR/SUB_3YEAR/ONETIME
  capabilities TEXT[] NOT NULL DEFAULT '{}',         -- ha/xinchuang/onetime/migration
  term_options INT[] NOT NULL DEFAULT '{12,36}',     -- 12/36；永久以特殊值（如 0）表达
  mutex JSONB,                                       -- 互斥规则
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id, version_code, deployment, auth_mode)
);
```

维度字典（主设计「新增 product_versions + 维度字典」）：`dimension_dicts(dict_key, code, label, sort_order, org_id)` 承载 deployment/auth_mode/term_options/capabilities 枚举；默认种子=标准/专业/企业/信创矩阵（附录 A）。

**方案 B（最小入侵备选，主设计 O1 原文）**：`products` 加 `attributes JSONB`（含 category/standalone/follows/version_codes/account_constraint），不动存量列。注意：方案 B 仅覆盖 O1，O2 仍需独立 `product_versions`（能力矩阵无法塞进 products）。

**关系与消费**（报价侧落点见主设计 §二 quote_items ★：version_code/deployment/auth_mode/term_months）：

```
products 1─1 product_catalog（可售语义）
products 1─n product_versions（版本×部署×授权×能力×期限）
      │
      ▼
quotes/quote_items 选品快照（version_code/deployment/auth_mode/term_months）
      │
      ▼
price_matrix（F028）以 product_id+version_code+deployment+auth_mode+term_months 为定价 key
```

### 3.3 状态机

配置对象生命周期（复用现状 configs 的 DRAFT/PUBLISHED/ARCHIVED 与版本机制）：

```
DRAFT ──[publish]──> PUBLISHED ──[edit]──> DRAFT(新版本)
   ▲                    │
   │                    ├──[rollback]──> 历史 PUBLISHED
   │                    └──[archive]──> ARCHIVED
   └────────[rollback]──┘
```

产品目录行状态（复用现状 products 的 status 语义，`app/api/products` 现状）：

```
active ──[停售]──> inactive ──[启售]──> active
   │
   └──[停产]──> discontinued（不可再选，历史报价快照不受影响）
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 附录 A 种子未齐 | 先建机制后灌数；允许空种子上线，报价选品为空时给出明确配置提示，不静默 |
| products 大表迁移风险 | 方案 A 旁挂表不触碰 products 存量列；方案 B attributes 加列默认 NULL、分批回填 |
| 矩阵漏配导致无合法组合 | 发布前交叉校验：目录引用的 version_code 必须在矩阵中存在；报价页无选项时提示配置缺失 |
| 防呆被前端绕过 | 报价创建 API 服务端二次校验（现状 `lib/pricing/service.ts` 消费链处增加） |
| products RLS 未按 org 收口 | 现状 products 仍为全量读写策略（20260531000001 迁移），本包接口先按 org 过滤；DB 层 RLS 依赖主设计前置修复 #3（待确认问题） |

---

## 4. 视觉锚点

### 4.1 参考页面

- `product-truth/03-design-truth/README.md`（设计真相边界：只定义主题/组件原语，不定义业务页面）
- `product-truth/product-code/app/configs/page.tsx` + `app/configs/ConfigsClient.tsx`（配置中心入口与信息架构，F000 §4）
- `product-truth/product-code/app/configs/tabs/PriceListTab.tsx`（现有价盘 Tab 形态，F027 升级参照）
- F011 §10.2-10.4 行内操作/状态流转（产品目录行操作可复用「编辑/更多」模式）

### 4.2 组件

- shadcn/ui：`Card`、`Table`、`Badge`、`Button`、`Dialog`、`AlertDialog`、`Select`、`Switch`、`Tabs`、`Tooltip`（沿用 app/configs 现有组件与 F011 §10.3 选型）

### 4.3 禁止偏离

- 禁止把产品目录/版本矩阵压进泛型 `configs` 表（F000 §5.2/§8 反模式）
- 禁止业务页面直接修改配置（F000 §2 强约束：配置中心是控制面，业务中心是执行面）
- 禁止在报价页硬编码版本/部署/授权/能力组合（防呆必须来自已发布矩阵）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | `lib/configs/validation.ts` 产品目录/版本矩阵 schema；`runtime.ts` 已发布读取；选品组合校验函数 | FOLLOW 系列 standalone=false 且 follows 非空、BASE standalone=true 的校验全覆盖；非法矩阵组合返回明确错误；runtime 只返回 PUBLISHED 且按 org 过滤 |
| 接口测试 | `/api/config-center/product-catalog`、`version-capability-matrix`（或现状 `/api/configs` 模式）CRUD + versions/publish/rollback | 草稿不可被消费端读到；发布后立即可读（不重启服务）；回滚到上一版本生效；跨 org 不可见；错误码符合 3.1 表 |
| E2E | 配置中心「产品目录」Tab + 报价新页选品 | 管理员可维护产品目录与版本矩阵并发布；报价页只出现已发布在售产品与合法组合；非法组合被拦截（前端 + 服务端各验证一次）；跟随类产品仅随基座出现 |
| 人工验收 | 默认种子（附录 A）与选品防呆 | 附录 A 种子导入后，报价可完成一次含版本/部署/授权/期限的选择并进入 F028 定价链路；矩阵改动发布后 30s 内新报价反映（服务不重启） |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F027 标记)
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
| `REQ_REGISTRY.yml` F027 | 待更新 | |
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

- 主设计 O1 默认种子：**6 个产品**（引用主设计「附录 A」）。
- 主设计 O2 默认种子：**标准/专业/企业/信创矩阵**（引用主设计「附录 A」）。
- 说明：主设计文件当前未包含附录 A 正文，种子清单待 PM 补齐后回填；评审通过后在 `03-design-truth/` 固化。
