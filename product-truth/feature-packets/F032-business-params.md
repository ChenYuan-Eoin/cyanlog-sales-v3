# Feature Packet: F032-业务参数

> 阶段 0 设计交付物（只写文档，不写代码）。依据：主设计 `/.tmp/F0-报价域-配置对象与结构化字段设计.md` O4；现状 `product-truth/feature-packets/F000-config-center-architecture.md`、`F010-quote-rule-config.md` 及 `product-truth/product-code` 现有实现（`lib/configs/types.ts`、`lib/configs/validation.ts`、`lib/configs/runtime.ts`、`app/api/configs`、`supabase/migrations/20260603000001_add_configs_tables.sql`）。

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F032 |
| **Name** | 业务参数 |
| **Module** | 配置中心 / 报价域（业务数字配置） |
| **Branch** | `feature/F032-business-params` |
| **Owner** | （待定） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

依据主设计 O4，本包把所有「业务数字」集中为配置中心对象：

- **字段**：param_key、name、value(jsonb)、data_type、unit、category（pricing/approval/maintenance/gift/customer/payment/tax/quote）、effective_from、status、org_id。
- **校验**：key 唯一（org 内）；敏感参数 is_secret 脱敏。
- **原则**：默认值=现行业务值，**改数不改代码**；走五触点（types/validation/runtime/API/UI）。
- **V3 落点**：`business_params` + versions，或 config_type 加 `BIZ_PARAM`（复用现状 configs/config_versions 机制）。
- **消费**：门槛（5万/8万/10）、维保（20%+2%）、高可用（20%）、赠送（5/3/1+5000）、分级（60万/30万/5万）、分期（30/60/10）、税率（13/6）、有效期（15）、保护日（2021-02-01）、汇率源（BOC 官方牌价，已接入）/时点（创建报价时抓取，缓存 15 分钟，口径=中行折算价）——这些数字的消费方（报价/审批/维保/赠送/税率/收款/汇率）统一读已发布参数，**改参数不重启生效**。
- **种子清单仅作附录**（主设计 O4 列示，key/单位/生效时间待 PM 定稿）。

### 2.2 待确认问题

- [ ] O4 落点二选一：独立强类型 `business_params`+versions（本包推荐，F000 §5.1 强类型、§5.2 泛型 configs 只做低频弱结构）vs config_type 加 `BIZ_PARAM`（最小入侵、复用现状 configs 版本/发布/回滚/RLS/审计）——待架构评审定案。
- [ ] 种子清单（门槛 5万/8万/10、维保 20%+2%、高可用 20%、赠送 5/3/1+5000、分级 60万/30万/5万、分期 30/60/10、税率 13/6、有效期 15、保护日 2021-02-01、汇率源/时点待定）的 param_key/单位/类别/生效时间由 PM 定稿（附录 B）。
- [ ] 与现状 TAX_RULE 的关系：税率 13/6 已由 configs TAX_RULE 承担（20260603000001 迁移种子），是迁移到 business_params 还是继续由 TAX_RULE 承担、本包只消费？
- [ ] 「改参数不重启生效」的缓存策略：现状 `app/configs/data.ts` 使用 `unstable_cache`（60s 缓存），发布时是否 revalidateTag 全量失效？消费端直读 DB（现状 `runtime.getPublishedTaxRate` 模式）是否足够？
- [ ] is_secret 敏感参数范围与脱敏展示规则（API 返回掩码、详情是否需要单独查看）？
- [ ] effective_from 定时生效与立即生效并存时的发布语义（F000 §6 生效控制）：定时参数未到生效时间是否「可见但未生效」？
- [ ] 首批纳入替换的现行业务数字/代码常量清单需产品+研发对账（如 quotes valid_until 默认 15 天、赠送 5/3/1+5000、维保 20%+2%）。
- [ ] category 枚举是否闭合（pricing/approval/maintenance/gift/customer/payment/tax/quote）或允许扩展。

### 2.3 本轮边界

- **做**：O4 业务参数对象（五触点）；参数消费（运行时读取 PUBLISHED 且 effective_from≤now）；is_secret 脱敏；改数不改代码；不重启生效；种子清单仅附录。
- **不做**：审批规则化（F033，本包只提供 approval 类参数与消费读取）；税率配置改造（F010 TAX_RULE 现状不动，仅定义消费一致性）；汇率计算（F035）；多维价盘（F028）；产品目录/版本矩阵（F027）。

---

## 3. 技术方案

### 3.1 接口设计

五触点落地：

| 触点 | 现状依据 | 本包新增 |
|------|----------|----------|
| `lib/configs/types.ts` | 现有 ConfigType/Config 与 TaxRuleValue 等 Value 接口 | `BusinessParamValue`（param_key/name/value/data_type/unit/category/is_secret/effective_from）+ meta 条目 |
| `lib/configs/validation.ts` | 现有 zod schema 模式（configKeySchema 大写蛇形） | `businessParamSchema`：key 格式、data_type/category 枚举、is_secret、effective_from ISO 日期 |
| `lib/configs/runtime.ts` | `listPublishedConfigsByType` / `getPublishedTaxRate`（直读 DB） | `getPublishedBusinessParam(orgId, key, effectiveAt?)`、`listPublishedBusinessParamsByCategory(orgId, category)`、`sanitizeBusinessParam`（is_secret 脱敏） |
| API | 现状 `app/api/configs`（GET/POST）+ `[id]/versions` + `[id]/publish` + `[id]/rollback` | 按主设计目标 `app/api/config-center/business-params` 五端点（实现复用现状模式）；若走 BIZ_PARAM 方案则直接 `app/api/configs?type=BIZ_PARAM` |
| UI | 现状 `app/configs` Tab 体系 | 新 Tab「业务参数」（表 + 编辑 Dialog + 发布/回滚 + 脱敏展示） |

API 端点：

| 方法 | 路径 | 说明 | 错误码（沿用现状） |
|------|------|------|------|
| GET | `/api/config-center/business-params?category=&status=` | 分页列表（org 内） | NOT_FOUND/DB_ERROR |
| POST | `/api/config-center/business-params` | 新建（草稿） | VALIDATION_ERROR(400) |
| GET/PATCH/DELETE | `/api/config-center/business-params/[id]` | 详情/更新/删除 | NOT_FOUND(404) |
| GET | `[id]/versions` | 版本历史 | DB_ERROR(500) |
| POST | `[id]/publish` | 发布（触发消费端缓存失效 revalidateTag） | VALIDATION_ERROR |
| POST | `[id]/rollback` | 回滚 | VALIDATION_ERROR |

消费接口：报价 `service.calculateQuoteDraft`、维保/赠送/审批/收款/税率等消费方通过 runtime 读取已发布参数；发布端点调用 `revalidateTag('business-params')` 使 `app/configs/data.ts` 类 unstable_cache 失效（2.2 确认策略）。

### 3.2 数据模型

**方案 A（推荐）——独立强类型表（F000 §5.1；字段=主设计 O4）**：

```sql
CREATE TABLE business_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  param_key TEXT NOT NULL,                  -- 如 MAINTENANCE_RATE；大写蛇形（沿用 configKeySchema）
  name TEXT NOT NULL,
  value JSONB NOT NULL,                     -- 按 data_type 解释
  data_type TEXT NOT NULL CHECK (data_type IN ('number','string','boolean','json','percent')),
  unit TEXT,                                -- 如 % / 元 / 天 / 月
  category TEXT NOT NULL CHECK (category IN ('pricing','approval','maintenance','gift','customer','payment','tax','quote')),
  is_secret BOOLEAN NOT NULL DEFAULT false, -- 敏感参数脱敏（主设计校验）
  effective_from TIMESTAMPTZ,               -- 生效时间；NULL=立即生效
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  version INT NOT NULL DEFAULT 1,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, param_key)                -- key 唯一（org 内，主设计校验）
);

CREATE TABLE business_params_versions (     -- 镜像现状 config_versions 模式
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  param_id UUID NOT NULL REFERENCES business_params(id) ON DELETE CASCADE,
  version INT NOT NULL,
  value JSONB NOT NULL,
  status TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (param_id, version)
);
```

**方案 B（最小入侵备选，主设计原文「config_type 加 BIZ_PARAM」）**：现状 `config_type` 枚举（20260603000001 迁移）加 `BIZ_PARAM`，复用 `configs`/`config_versions` 的 key+org 唯一、版本触发器、发布/回滚、RLS 与审计；`value` 内承载 O4 字段（data_type/unit/category/is_secret/effective_from）。评估点：PG 枚举扩展（ALTER TYPE ADD VALUE）限制、F000 §5.2「禁止整个配置中心压到一个 configs 表」的边界（业务参数属强结构高频消费，倾向方案 A）。

消费映射（每条=主设计 O4 种子/类别 + 消费方 + 现状依据）：

| 类别 | 种子（附录 B） | 消费方 | 现状依据 |
|------|----------------|--------|----------|
| pricing | 门槛 5万/8万/10 | 折扣/分级展示与触发（F010/F033） | 现状 configs APPROVAL_RULE 阈值语义（F011 ApprovalThreshold） |
| approval | 分级 60万/30万/5万 | F033 审批规则化触发阈值 | 主设计 O5 默认口径（待业务定稿 G1） |
| maintenance | 维保 20%+2% | 买断维保金额（F035 高级科目） | 主设计 §二 quote_items ★ maintenance_months |
| gift | 赠送 5/3/1+5000 | 赠送数量与金额（F035） | 主设计 §二 quote_items ★ is_gift/gift_original_amount |
| payment | 分期 30/60/10 | 收款计划（F035/合同） | 主设计 O4 种子 |
| tax | 税率 13/6 | `getPublishedTaxRate`（现状已读 TAX_RULE） | `lib/configs/runtime.ts` + 20260603000001 迁移 |
| quote | 有效期 15 | quotes.valid_until 默认（报价创建） | 现状 `app/quotes/new/page.tsx`（硬编码待替换） |
| customer | 保护日 2021-02-01 | 客户保护期逻辑 | 主设计 O4 种子 |
| (pricing) | 高可用 20% | F028 价盘 1.2 校验开关/高可用参数 | 主设计 §三.3 |
| (quote) | 汇率源/时点（待定） | F035 汇率计算 | 主设计 §二 quotes ★ fx_source/fx_date |

### 3.3 状态机

配置对象生命周期（复用现状 configs 的 DRAFT/PUBLISHED/ARCHIVED + effective_from）：

```
DRAFT ──[publish]──> PUBLISHED ──[edit]──> DRAFT(新版本)
   ▲                    │
   │                    ├──[rollback]──> 历史 PUBLISHED
   │                    └──[archive]──> ARCHIVED
   └────────[rollback]──┘
effective_from：PUBLISHED 且 effective_from<=now 才被消费端读取（定时生效，F000 §6）
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 种子值与现行业务值漂移 | 默认值=现行业务值（主设计 O4），交付前按附录 B 逐项对账 |
| 缓存导致改参数不生效 | 发布时 revalidateTag + 消费端直读 PUBLISHED（现状 `getPublishedTaxRate` 模式），不以 60s unstable_cache 当生效手段 |
| 枚举扩展限制（方案 B） | 强类型表方案无此问题；若走 BIZ_PARAM 需评估 PG ALTER TYPE 与迁移 |
| 敏感参数泄漏 | is_secret 强制脱敏（API 返回掩码），审计记录操作人（主设计前置修复 #5 口径） |
| 参数被业务页面误改 | 配置中心唯一写入口（F000 §2），业务页只读消费 |

---

## 4. 视觉锚点

### 4.1 参考页面

- `product-truth/product-code/app/configs/page.tsx` + `app/configs/ConfigsClient.tsx`（现有 Tab 形态与信息架构，F000 §4「交易配置」分组下新增业务参数）
- `product-truth/product-code/app/configs/tabs/TaxTab.tsx` / `ApprovalTab.tsx`（现有参数类配置 Tab 形态参照）
- `product-truth/03-design-truth/README.md`（设计真相边界）

### 4.2 组件

- shadcn/ui：`Table`、`Card`、`Badge`、`Button`、`Dialog`、`AlertDialog`、`Switch`、`Select`、`Tooltip`（沿用 app/configs 现有组件与 F011 §10.3 选型）

### 4.3 禁止偏离

- 禁止把全部业务参数压进单一泛型 `configs` 表（F000 §5.2/§8 反模式）
- 禁止业务页面直接写参数（F000 §2 强约束：业务中心只读消费）
- 禁止继续在代码里新增硬编码业务数字（本包为业务数字的唯一配置入口）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | `lib/configs/validation.ts` business_param schema；`runtime.ts` 读取（published+effective）；脱敏函数 | key 唯一（org 内）校验；data_type/category 非法被拒；is_secret=true 的参数 API 返回脱敏值；未到 effective_from 的参数不被消费端读取 |
| 接口测试 | business-params CRUD + versions/publish/rollback | 草稿不被消费端读到；发布后立即被 runtime 读取（服务不重启）；回滚到上一版本生效；跨 org 隔离；错误码符合 3.1 表 |
| E2E | 配置中心「业务参数」Tab → 报价/维保/赠送消费点 | 修改「维保比例 20%→25%」→ 发布 → 新建报价（维保金额场景）使用 25%，全程无需重启服务；「有效期 15→30」发布后新报价默认 valid_until 为 30 天 |
| 人工验收 | 硬门：改参数不重启生效；种子对账；脱敏 | 发布后 30s 内新业务单据反映新参数值且服务不重启；附录 B 种子与现行业务值 100% 一致（逐项核对签字）；敏感参数列表接口返回脱敏值 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F032 标记)
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
| `REQ_REGISTRY.yml` F032 | 待更新 | |
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

## 已实现代码位置

- `product-truth/product-code/lib/quote/fx-rate.ts`：BOC 牌价抓取/解析/缓存/取值（含 `parseBocRateType` 口径解析）
- `product-truth/product-code/app/api/quotes/route.ts`：POST 创建报价时按 FX_SOURCE=BOC 自动带 exchange_rate
- `product-truth/product-code/lib/config-center/runtime.ts`：getPublishedParamString（业务参数读取）
- `product-truth/product-code/lib/quote/fx-rate.test.ts`：解析/抓取/缓存/失败回退测试

## 附录：默认种子（仅作附录，不进正文）

主设计 O4 列示的种子清单（原文引用，key/单位/类别/生效时间待 PM 定稿后回填本附录）：

- 门槛：5万 / 8万 / 10
- 维保：20% + 2%
- 高可用：20%
- 赠送：5 / 3 / 1 + 5000
- 分级：60万 / 30万 / 5万
- 分期：30 / 60 / 10
- 税率：13 / 6
- 有效期：15（天）
- 保护日：2021-02-01
- 汇率源：BOC（中国银行官方牌价页 https://www.boc.cn/sourcedb/whpj/，无公开开发者实时 API，官网为权威免费源）
- 汇率时点：创建报价时抓取，内存缓存 15 分钟；失败不阻断报价、不伪造数据
- 汇率口径：业务参数 `FX_RATE_TYPE` 可配（默认 `middle`=中行折算价，可选 `spotSell`=现汇卖出价 / `spotBuy`=现汇买入价 / `cashSell` / `cashBuy`）；每 100 外币兑人民币，1 USD = 口径价/100 CNY

说明：种子不进正文，仅作附录；评审通过后在 `03-design-truth/` 固化。
