# Feature Packet: F036-非标模板语义映射

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F036 |
| **Name** | 非标模板语义映射 |
| **Module** | 报价域 / 非标输出 |
| **Branch** | `feature/F036-nonstandard-template-semantic` |
| **Owner** | TBD（待指派） |
| **Created** | 2026-08-14 |
| **Status** | `drafting` |

---

## 2. 需求反讲

### 2.1 AI 复述

客户非标模板（政企/招标 Word/Excel，PDF 待定）的「识别→翻译→填入→确认→校验」全流程：

- **客户模板扫描**：解析上传模板的表头/标题/占位符/空位，识别语义槽位（如「响应总报价」「供应商名称（加盖公章）」「大写金额」）。
- **语义对齐**：用字段字典（O6）业务描述 + 同义词库计算模板文字与抽象字段的相似度，输出每个槽位的 `mapped_field_key` 与置信度（如「投标报价/最终报价/响应价」→ `grand_total` 99%）。
- **变量填充**：按 F029 白名单投影后填充；支持特殊换算（不含税价=总价/(1+税率) 逆向倒求）、大写转换、承诺话术扩写（勾选项→1/2/3 条文）、规格描述压缩/扩写。
- **低置信人工确认**：置信度低于阈值（默认 0.90，待确认）的槽位强制人工确认/纠正，确认结果回流同义词库；**不静默跳过**。
- **数字一致性校验**：渲染前校验「明细合计数」与「总价一览表」四舍五入后绝对一致，不一致阻断导出并列出槽位。
- **隐藏字段物理隔离**：模板出现成本/底价类槽位时填「/」或报错，**严禁输出内部字段**。

来源：主设计 F036 包划分（「客户模板扫描/映射/人工确认」）+ SC2（O6+O7+语义比对：扫描→映射→对齐；低置信人工确认；数字一致性校验=明细总价）+ 需求材料「非标报价单 AI 处理映射清单 / 语义比对机制 / 隐藏字段物理隔离协议 / 跨表一致性校对」。

### 2.2 待确认问题

- [ ] 低置信阈值与统计口径：单槽位阈值默认多少（建议 0.90）；硬门「20 份模板人工确认 <30%」按**份数**（≤5 份需要人工确认）还是按**槽位数**统计？（推荐：份数为主指标 + 槽位率辅助指标）
- [ ] PDF 模板是否本期支持：材料覆盖 Word/Excel/PDF，V3 现状无 PDF 解析组件；推荐先 Word/Excel，PDF 后置。
- [ ] 语义映射实现：纯同义词库+规则匹配 vs 接入 AI 运行时（F012 云端/本地模型）？推荐先同义词库+规则（低成本、可测），AI 语义增强作为可选后置，失败降级人工。
- [ ] 人工确认后的纠正是否自动写入同义词库：推荐「确认即入草稿库，审核/发布后生效」，避免脏数据污染后续映射。
- [ ] 数字一致性舍入口径与容差：材料要求「四舍五入后绝对一致」；容差建议 0.01，需财务确认（与 O3 价盘容差 0.01 对齐）。
- [ ] 非标导出是否强制走 F034 快照渲染锁定：推荐强制（与标准单一致），保证历史非标导出不随配置漂移。
- [ ] 客户模板归属：`output_templates(doc_type='customer')` 的 content 引用 vs knowledge_pages type=template？（推荐 O7 content 引用，复用 F030 管理面）
- [ ] 同义词库是否需要多语言（中/英模板）？（材料提及跨国项目按币种切换输出语言，本期先中文，待确认）

### 2.3 本轮边界

- **做**：
  - 客户模板上传/扫描（Word/Excel 表格、表头、占位符、空位）。
  - 语义对齐（同义词库 + 相似度 → `mapped_field_key` + 置信度）。
  - 白名单变量填充（F029）与特殊换算/大写/话术扩写。
  - 低置信人工确认界面与确认记录；同义词库回流。
  - 数字一致性校验（明细=总价）与隐藏字段物理隔离（成本槽位填「/」或报错）。
  - `app/api/quotes/[id]/export/nonstandard` 与映射任务/槽位 API。
- **不做**：
  - 合同条款生成（F037 后置）。
  - 标准模板输出（F030）。
  - 全自动无人确认（人工确认是流程兜底，不是可选项）。
  - PDF 复杂版式解析（待确认）。
  - 报价结构化字段/快照本身（F034 前置依赖，本包只消费）。

---

## 3. 技术方案

> 依据：主设计 F036/SC2（文件清单：`app/api/config-center/field-dictionaries`、`output-templates`、`app/api/quotes/[id]/export/nonstandard`、`lib/export/field-whitelist.ts`；验收：20 份真实模板低置信人工确认 <30%）；O6（语义对齐目标=字段字典）、O7（客户模板）、F029（白名单）；需求材料「扫描→映射→对齐」流程、同义词映射表（置信度示例）、跨表一致性校对、隐藏字段 Whitelist Filter 物理隔离。

### 3.1 接口设计

**映射任务与导出（新 API）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `POST /api/quotes/[id]/export/nonstandard` | POST | 触发全流程：读取已冻结快照（F034）+ 客户模板（F030 O7）→ 扫描 → 语义对齐 → 白名单填充 → 一致性校验；低置信时返回 `PENDING_CONFIRMATION` 任务与槽位清单，不直接出单 |
| `GET /api/nonstandard-jobs/[id]` | GET | 任务进度与槽位状态（SCANNING/MAPPING/PENDING_CONFIRMATION/CONFIRMED/EXPORTED/FAILED） |
| `POST /api/nonstandard-jobs/[id]/slots/[slotId]/confirm` | POST | 人工确认/纠正槽位映射（传入 corrected_field_key 或 reject）；确认记录留痕，纠正写回同义词库草稿 |
| `POST /api/nonstandard-jobs/[id]/export` | POST | 全部低置信槽位确认完成后导出；仍有未确认槽位返回 409 |
| `GET/POST /api/synonym-library` | GET/POST | 同义词库查询/新增草稿条目（发布制生效） |

**错误码约定**：409 仍有未确认槽位/数字不一致/快照不一致；422 模板解析失败或隐藏字段冲突（模板含成本槽位且无法以「/」安全填充）；404 任务/槽位不存在；403 非本 org/非任务创建人操作。

### 3.2 数据模型

**消费复用（不新建重复真相）**：
- `field_dictionaries`（F029 O6）：语义对齐目标（`field_key + business_name + transform_rule`）。
- `output_templates`（F030 O7）：`doc_type='customer'` 的模板记录 = 客户模板文件引用（content）+ 方案关联。
- 白名单 = F029 派生（`is_external=true AND PUBLISHED`），填充只允许白名单字段。

**新表（映射任务与确认记录）**

```sql
nonstandard_mapping_jobs (
  id UUID PK,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  template_id UUID NOT NULL,               -- output_templates id（doc_type='customer'）
  whitelist_version TEXT,                  -- 本次映射使用的 F029 白名单版本（审计/追溯）
  status TEXT NOT NULL CHECK (status IN ('SCANNING','MAPPING','PENDING_CONFIRMATION','CONFIRMED','EXPORTED','FAILED')),
  error_message TEXT,
  created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
)

nonstandard_mapping_slots (
  id UUID PK,
  job_id UUID NOT NULL REFERENCES nonstandard_mapping_jobs(id) ON DELETE CASCADE,
  slot_ref TEXT NOT NULL,                  -- 表格坐标/占位符标识（如 Sheet1!B2）
  detected_text TEXT NOT NULL,             -- 模板原文（如「响应总报价」）
  mapped_field_key TEXT,                   -- FK 语义：field_dictionaries.field_key
  confidence NUMERIC(4,3),                 -- 0-1；< 阈值 → NEEDS_CONFIRMATION
  transform_rule TEXT,                     -- direct/formula/semantic/conditional/capture（F029 同枚举）
  status TEXT NOT NULL CHECK (status IN ('AUTO','NEEDS_CONFIRMATION','CONFIRMED','REJECTED')),
  corrected_field_key TEXT,                -- 人工纠正后的 field_key
  corrected_by UUID, corrected_at TIMESTAMPTZ,
  UNIQUE (job_id, slot_ref)
)

synonym_library (
  id UUID PK,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_text TEXT NOT NULL,               -- 客户模板常见表述（如「投标报价」「响应价」）
  field_key TEXT NOT NULL,                 -- 目标抽象字段（O6）
  confidence NUMERIC(4,3) DEFAULT 0.90,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, source_text)
)
```

**流程语义**：
1. **扫描**：解析 docx/xlsx 的表格表头、标题、空位与关键词（价/额/公司/大写/交付等）。
2. **语义对齐**：`synonym_library` 精确命中优先；否则按 `field_dictionaries.business_name` 与模板文字做相似度打分（关键词/编辑距离/可选向量，待确认），产出 `confidence`。
3. **变量填充**：仅白名单字段可填充；特殊换算按 `transform_rule`（如 `grand_total / (1+tax_rate)` 倒求不含税价、`total_in_words` 大写、`promo_list` 条文扩写）。
4. **低置信确认**：`confidence < 阈值` → `NEEDS_CONFIRMATION`；人工确认/纠正后写回 `synonym_library` 草稿。
5. **数字一致性校验**：渲染后重算 `Σ(line_items) == grand_total`（四舍五入到分，容差 0.01 待确认）；不一致 → 阻断导出、列出槽位。
6. **隐藏字段隔离**：若模板槽位语义命中 `internal_*`/隐藏字段 → 填充「/」或报错（材料：客户模板有成本项必须自动填「/」或报错，严禁输出）；白名单投影在前，内部字段永不进入渲染。

### 3.3 状态机

```
任务：SCANNING → MAPPING → PENDING_CONFIRMATION（存在低置信槽位）
                ↘ CONFIRMED（无低置信槽位 或 全部确认完成）→ EXPORTED
      任一步失败 → FAILED（可重试；错误信息保留）

槽位：AUTO / NEEDS_CONFIRMATION → CONFIRMED / REJECTED（纠正后写回同义词库草稿）

导出前置条件：CONFIRMED + 数字一致性通过 + 快照一致(F034) + 无隐藏字段冲突
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 20 份真实模板低置信人工确认率 ≥30%（硬门失败） | 同义词库迭代：每轮人工确认回流 → 二次映射置信提升；先 5 份试点再放量；同义词库覆盖率作为发布/上线前检查项 |
| 语义误填（高置信但映射错误） | 高置信才直填；阈值保守（0.90）；映射结果可预览回退；确认记录留痕可审计 |
| 内部字段泄漏 | 白名单物理隔离（F029）+ 模板含成本槽位填「/」或报错；E2E 断言导出件无 internal_* 键/值 |
| 数字不一致（明细≠总价） | 渲染前一致性校验阻断，列出差异槽位；容差 0.01 |
| 模板解析失败（乱表/合并单元格/PDF） | 明确错误提示 + 人工上传兜底；PDF 本期不支持（待确认） |
| AI 语义依赖导致成本/不稳定 | 先同义词库+规则匹配（可测、离线）；AI 语义增强（F012）作为可选后置，失败降级人工确认 |
| 客户模板版本漂移 | 模板与快照在任务创建时固化；重复使用同一模板+同一报价版本结果一致 |

---

## 4. 视觉锚点

### 4.1 参考页面
- 主设计 F036/SC2（流程与验收）
- 需求材料「非标报价单 AI 处理映射清单」「语义比对机制」示例表（同义词→变量→置信度）
- 现状 `app/contracts/[id]/page.tsx`（文件上传/预览交互）、知识库模板上传（`knowledge_pages type='template'`）

### 4.2 组件
- 客户模板上传/解析预览（表格结构高亮、槽位标记）
- 映射任务进度条（扫描→对齐→填充→确认→导出）
- 槽位确认面板：模板原文 / 建议字段 / 置信度 / 纠正下拉（来自字段字典白名单） / 拒绝
- 一致性校验结果面板（明细合计 vs 总价，差异槽位定位）
- 同义词库管理（草稿/发布/回滚，配置中心 Tab）

### 4.3 禁止偏离
- 禁止把内部字段（成本/底价/毛利/审批人/审批意见）填入客户模板（白名单物理隔离 + 成本槽位填「/」/报错）
- 禁止静默跳过低置信槽位（必须人工确认后才能导出）
- 禁止数字不一致仍导出（一致性校验为硬门）
- 禁止不经过 F030/F029 直接消费模板与字段（复用配置对象，不另建第二套字段/模板）
- 禁止把语义映射与标准模板渲染（F030）混在同一个包

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | 同义词库匹配/相似度打分/置信度阈值；特殊换算（不含税倒求、大写、话术扩写）；隐藏字段处理（成本槽位→「/」或报错）；数字一致性函数（含容差 0.01） | 「投标报价/响应价/最终报价」→ `grand_total`；「供应商名称（加盖公章）」→ `supp_full_name`；置信度计算稳定可断言；含隐藏字段槽位不产出值；明细≠总价返回不一致 |
| 接口测试 | 任务创建/进度/槽位确认/导出；同义词库 CRUD+发布 | 低置信槽位未确认时导出返回 409；确认后导出成功且记录 corrected_field_key/操作人；数字不一致返回 422 并列出槽位；同义词库草稿发布后二次映射置信提升 |
| E2E | 真实客户模板（Word/Excel）上传→扫描→填充→低置信确认→导出；含成本槽位模板阻断；数字不一致阻断 | 全流程跑通；导出件不含任何隐藏字段键/值（**打印/导出内部信息零泄漏**）；数字不一致模板无法导出；快照缺失/不一致（F034）返回 409 |
| 人工验收（硬门） | 20 份真实客户模板全流程 | 低置信需人工确认的模板 **<6 份（<30%）**；无需人工确认的模板导出后人工核对数字一致性 100% 通过；人工确认后的纠正回流同义词库，同类模板二次映射确认率下降 |

---

## 6. 实现记录

### 6.1 涉及文件
```
(开发后回填，每行加 REQ:F036 标记)
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
| `REQ_REGISTRY.yml` F036 | 待更新 | |
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
