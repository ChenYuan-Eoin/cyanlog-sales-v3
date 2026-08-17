# Feature Packet: F040-输出模板与条款映射

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F040 |
| **Name** | 输出模板与条款映射 |
| **Module** | 报价域 / 配置中心（输出规则能力域） |
| **Branch** | `feature/F040-output-templates-clause-mapping` |
| **Owner** | TBD（待指派） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

把报价单「用什么模板、模板匹配什么方案、条款怎么注入、文件怎么安全生成」变成配置中心规则：

- **O7 输出模板（output_templates）**：标准模板/客户模板统一管理；模板通过 `match_rule`（版本/部署/授权/期限条件）与方案属性匹配；模板 `variables[]` 必须引用 O6 字段字典，禁止引用隐藏字段。
- **O8 条款映射（clause_mappings）**：方案属性组合 → 条款/协议（订阅→SaaS 服务协议；买断→私有化部署授权协议+年度维保标准）；无对应条款时输出提示，**不静默**；为未来合同条款生成（F037）留好映射对象。
- **标准单输出**：按匹配模板 + 白名单变量渲染标准报价单（Word/PDF）；导出链完成 **word-generator 白名单改造**，根治「原始 docx 原样透传、无白名单」的现状风险。

来源：主设计 O7/O8 + F040 包划分（「O7+O8 + 标准单输出」）；V3 现状审计（`knowledge_pages type='template'` 已有模板文件字段与 `/api/knowledge/templates`；`contract_template_params.applicable_scenario` 已含 general/saas_buyout/saas_subscription/deployment；`lib/export/word-generator.py` 原始 docx 透传、无白名单；报价当前无导出）。

### 2.2 待确认问题

- [ ] 标准模板文件托管：主设计写「复用 knowledge_pages type=template」，现状该表已有 `template_file_url/template_file_size/template_mime/content/metadata/is_published`——确认 `output_templates.content` 直接引用 `knowledge_pages.id`，还是独立 storage 路径？（推荐引用 knowledge_pages，减少新存储体系）
- [ ] `match_rule` 冲突策略：同一属性组合命中多个已发布模板时，取「最具体规则」还是「拒绝发布」？（推荐：发布期不重叠校验 + 渲染期按规则明细度降序取首个命中）
- [ ] `clause_mappings` 独立表 vs 并入 `output_templates`：主设计两可；推荐独立表（条款可跨模板复用、供 F037 合同条款生成直接消费）。
- [ ] 输出格式范围：本期是否只做 Word（复用 word-generator 链路）？PDF/Excel（分项、价盘）是否后置？
- [ ] 条款注入形式：渲染时输出整段 `clause_text`（含条款编号），还是只写「引用条款号」？（推荐整段渲染+编号；F037 再做结构化引用）
- [ ] 无对应条款时的提示形态：配置期发布校验拦截（required 必须有匹配）vs 渲染期提示？（推荐配置期拦截 required，渲染期对可选条款缺失给提示，双保险）
- [ ] 标准模板的占位方式：docx 模板变量（如 `{{grand_total}}`）还是坐标填充？影响 word-generator 改造范围（推荐模板变量，便于白名单校验）。

### 2.3 本轮边界

- **做**：
  - O7/O8 配置对象进入配置中心五触点（`app/api/config-center/output-templates`、`app/api/config-center/clause-mappings`）。
  - 模板↔方案属性匹配（`match_rule` 解析、冲突校验）。
  - 条款映射注入（required/可选、缺失提示）。
  - 标准报价单导出链路（`app/api/quotes/[id]/export/standard`）+ **word-generator 白名单改造点**。
  - 发布校验与 F039 白名单、F044 快照（阶段 1 渲染锁定）衔接。
- **不做**：
  - 非标模板语义映射（F046：扫描/语义对齐/人工确认）。
  - 合同条款生成（F037 后置；本包只建 clause_mappings 对象与报价输出注入）。
  - 报价 Excel 导出（待确认）。
  - 修改合同审核导出（F007 现有评论导出保持兼容，仅共享白名单组件）。

---

## 3. 技术方案

> 依据：主设计 O7（字段/校验/默认种子/复用 knowledge_pages type=template）、O8（match/clause_code/clause_text/required/无对应提示）；F000 配置中心三层架构；V3 现状 `knowledge_pages`（20260617000002）、`app/api/knowledge/templates/route.ts`、`contract_template_params`（20260618000002，applicable_scenario 先例）、`lib/export/word-generator.py/.ts`、`app/api/contracts/[id]/export/route.ts`（原始 docx 下载→透传生成）。

### 3.1 接口设计

**配置面（`app/api/config-center/output-templates` 与 `clause-mappings`，均含 CRUD + versions/publish/rollback）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/config-center/output-templates` | GET/POST | 模板列表/新建（code/name/doc_type/scene/match_rule/content/variables） |
| `/api/config-center/output-templates/[id]` | GET/PATCH/DELETE | 详情/编辑/删除 |
| `/api/config-center/output-templates/[id]/versions` `.../publish` `.../rollback` | GET/POST | 版本化发布/回滚 |
| `/api/config-center/output-templates/[id]/validate` | POST | 发布前校验：variables⊆已发布字段字典、无隐藏字段、match_rule 不重叠、模板文件可下载 |
| `/api/config-center/clause-mappings` 及 `[id]`、`versions/publish/rollback` | 同上 | 条款映射 CRUD/版本化 |
| `/api/config-center/clause-mappings/validate` | POST | 校验：required 条款在默认方案组合下均有匹配（或明确标注缺失） |

**消费面（报价导出）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `POST /api/quotes/[id]/export/standard` | POST | 解析已冻结版本/快照（F044）→ 按方案属性 resolve 模板 → 白名单投影（F039）→ 条款注入 → 渲染 Word/PDF → 返回文件 |
| `GET /api/config-center/output-templates/resolve?quote_id=...` | GET | 返回命中的已发布模板与 variables（供前端预览） |
| `GET /api/config-center/clause-mappings/resolve?quote_id=...` | GET | 返回注入条款列表 + 缺失的 required 条款提示（不静默） |

**错误码约定**：400 match_rule 非法/变量不存在；409 模板 code 重复或 match_rule 与已发布模板冲突；422 发布校验失败（引用隐藏字段/required 条款缺失/文件不可下载）；409 导出时快照缺失或不一致（F044 联动）。

### 3.2 数据模型

**配置对象（新表，org 隔离 + 版本化/发布语义，强类型表优先）**

```sql
output_templates (
  id UUID PK,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                       -- 模板编码（org 内唯一）
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('standard','customer')),
  scene TEXT,                               -- 业务场景标识（订阅/买断/信创…，可空=通用）
  match_rule JSONB NOT NULL,                -- 方案属性条件，如 {"v_type":"SUBSCRIPTION","deployment":["PUBLIC_CLOUD"]}
  content JSONB NOT NULL,                   -- 标准模板：knowledge_page_id/template_file_url + 占位变量映射；客户模板：上传文件引用
  variables TEXT[] NOT NULL DEFAULT '{}',   -- field_key 列表，必须 ⊆ O6 已发布白名单
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  version INT NOT NULL DEFAULT 1,
  created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, code)
)

output_template_versions (id UUID PK, template_id UUID FK, version INT, value JSONB, status TEXT, created_by UUID, created_at, UNIQUE(template_id, version))

clause_mappings (
  id UUID PK,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match JSONB NOT NULL,                     -- version/period/deployment/auth 组合，如 {"v_type":"BUYOUT","period":"PERPETUAL"}
  clause_code TEXT NOT NULL,                -- 条款编码（如 SLA-SUBSCRIPTION / LICENSE-BUYOUT / MAINTENANCE-ANNUAL）
  clause_text TEXT,                         -- 条款正文（整段渲染）
  template_ref TEXT,                        -- 可选：引用 knowledge_pages 模板/条款页 id
  required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  version INT NOT NULL DEFAULT 1,
  created_by UUID, updated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
)

clause_mapping_versions (id UUID PK, mapping_id UUID FK, version INT, value JSONB, status TEXT, created_by UUID, created_at, UNIQUE(mapping_id, version))
```

**复用现状**：
- `content` 引用 `knowledge_pages`（`type='template'`）：现有字段 `template_file_url / template_file_size / template_mime / content / metadata / is_published / is_archived` 已可直接承接（主设计 O7 落点「复用 knowledge_pages type=template」）。
- 默认种子对齐主设计：订阅模板→SaaS 条款（`clause_code=SLA-SUBSCRIPTION`）；买断模板→私有化部署授权协议 + 年度维保标准（`LICENSE-BUYOUT`、`MAINTENANCE-ANNUAL`）。
- `contract_template_params.applicable_scenario`（general/saas_buyout/saas_subscription/deployment）作为 scene 取值的先例，本包 `scene` 与之对齐，避免两套枚举。

### 3.3 状态机

```
模板/条款：DRAFT ──publish（validate 通过）──▶ PUBLISHED ──archived──▶ ARCHIVED
                  ▲                              │
                  └──────────rollback────────────┘

导出：解析快照(F044) → resolve 模板（唯一命中） → 白名单投影(F039) → 条款注入 → 渲染 → 返回文件
      任一步失败：明确错误（缺失 required 条款 → 提示；快照不一致 → 409），不输出不完整单
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 模板匹配冲突（多模板命中同一方案） | 发布期 `validate` 检测 match_rule 重叠并拒绝；渲染期按明细度降序取首个命中，两次命中兜底报错 |
| 模板变量引用隐藏/不存在字段 | 发布校验 `variables ⊆ 已发布白名单`；已发布后字段被停用 → 该模板重新发布校验（F039 联动） |
| required 条款缺失被静默 | 配置期 `validate` 对 required 必须有匹配；渲染期缺失返回 422 + 明确提示 |
| word-generator 原始 docx 透传导致内部字段泄漏 | 见下方「word-generator 白名单改造点」；只接受白名单投影 DTO，未知键报错 |
| 模板文件损坏/缺失 | 发布时校验文件可下载（knowledge_pages 状态 active）；渲染失败返回错误，不输出空白单 |
| 合同审核导出（F007）回归 | 改造点做成可选白名单参数，F007 路径不传白名单时保持原行为；E2E 覆盖 F007 导出 |

**word-generator 白名单改造点（本包核心安全改动）**
1. **新增独立入口**：报价导出走新 `app/api/quotes/[id]/export/standard`，不复用合同审核导出；输入 = `lib/export/field-whitelist.ts`（F039）投影后的 DTO JSON。
2. **生成器侧白名单校验**：`word-generator.py` 的 `generate_document` 增加白名单参数（可选，报价导出必传）：仅接受声明字段键；出现未声明键（尤其 `internal_*`/隐藏字段）→ 返回错误并写审计日志，**不静默丢弃、不原样透传**。
3. **模板渲染而非透传**：标准单用模板文件 + 变量填充（`{{field_key}}` 或坐标），禁止把报价源数据整包 JSON 传入生成器。
4. **后置扫描**：输出 docx 生成后做后置断言（解包检查隐藏字段键/值），作为硬门测试；F007 合同评论导出不传白名单时保持现状兼容。

---

## 4. 视觉锚点

### 4.1 参考页面
- 主设计 O7/O8（模板/条款字段与默认种子）
- 现状 `app/contracts/[id]/page.tsx`（导出交互）、`app/api/knowledge/templates/route.ts`（type=template 数据源）、`app/configs/dialogs/ThemeEditForm.tsx`（配置表单模式）
- `product-truth/feature-packets/F000-config-center-architecture.md`（配置中心形态）

### 4.2 组件
- 配置中心「输出模板」Tab：模板列表、上传/引用模板文件、match_rule 编辑、变量选择（来自字段字典白名单）、validate/发布/回滚
- 「条款映射」Tab：match 组合编辑、条款文本编辑、required 标记、缺失校验结果
- 报价详情页：导出按钮 + 模板/条款预览（只读消费）

### 4.3 禁止偏离
- 禁止绕过白名单直接把报价 DTO 传给渲染器/生成器（word-generator 必须校验白名单）
- 禁止静默缺条款（required 缺失必须报错/提示）
- 禁止在报价页修改模板/条款配置（F000：业务页面只能消费配置）
- 禁止把模板对象压进泛型 `configs` 表（F000 5.2）
- 禁止非标语义映射逻辑混入本包（F046 独立）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | schema/校验（variables⊆白名单、match_rule 重叠检测、required 缺失检测）；白名单投影；word-generator 白名单拒绝未知键 | 引用隐藏字段/不存在字段发布返回 422；重叠规则发布拒绝；required 无匹配返回校验错误；生成器收到未声明键返回错误且不产出文件 |
| 接口测试 | output-templates/clause-mappings CRUD + versions/publish/rollback；resolve 接口；`POST /api/quotes/[id]/export/standard` | 订阅方案命中 SaaS 模板、买断方案命中私有化+维保条款；resolve 唯一命中；required 缺失返回 422 与提示；发布后无需重启生效 |
| E2E | 标准报价单导出全链路：冻结快照(F044)→匹配模板→白名单投影→条款注入→Word 导出→解包检查 | 导出件条款与模板匹配正确；**打印/导出内部信息（成本/底价/毛利/审批人/审批意见）零泄漏**；无对应条款时界面提示而非静默；F007 合同审核导出回归通过 |
| 人工验收 | 真实报价单对照标准单；模板/条款配置改动后导出 | 人工核对导出内容与方案属性一致；模板/条款发布新版本后新导出即生效；隐藏字段由接口断言+人工抽查双重确认 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F040 标记)
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
| `REQ_REGISTRY.yml` F040 | 待更新 | |
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
