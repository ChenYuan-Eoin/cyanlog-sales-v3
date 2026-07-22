# F005v2 - ONES Contract Center 合同中心 V2

**REQ ID**: F005v2
**Status**: in_progress
**Local implementation**: G5 Preview safety/file/runtime/source chains and multiformat matrix passed; facts_v1 extraction/coverage/deterministic adjudication, immutable provenance, and atomic evidence staging implemented at zero recurring cost
**Release acceptance**: NO-GO; blocked by product-approved 15-rule fact contracts, whole-document absence/external-fact semantics, candidate-start and risk materialization/ReviewRun completion, a new immutable bundle, blind real-contract accuracy, legal decision/re-review, current-output Microsoft Word GUI, and Production read-only release review
**Based on**: F005-derive.md + 合同中心 PRD (2026-06-18) + 架构评审 (Tier 1-4)
**Upstream**: `product-truth/03-design-truth/合同中心/` 原型文件
**Target Phase**: Phase 1-5 全部完成

> **本文档是 F005 的 V2 升级版本**，基于合同中心 PRD 和 7 个原型文件，重构现有合同中心。
> **架构评审结论**: 45/100 → 通过阻塞项补齐后满足 Tier 1-4 要求

---

## 0. 当前阶段执行目标（2026-07-16）

> 当前 9 个执行目标的唯一账本：`product-truth/feature-packets/F099-current-goal-ledger.md` v2026-07-18.22。本节只展开合同中心相关目标。

历史 Phase 勾选只代表原型或代码曾经覆盖过对应页面，不代表当前线上体验已经通过验收。本阶段以“合同产品线可真实使用”为准，先收敛以下目标。

| 目标卡 | 产品目标 | 验收口径 |
|---|---|---|
| G4 合同中心入口 | 首页只表达三个独立产品能力：合同起草、合同审核、文档对比；继续审核、查看批注、再审核属于合同任务内部动作 | `/contracts` 入口顺序为起草、审核、对比；任务卡必须标记模块、版本号、下一步 |
| G5 Word/PDF 多格式源文件批注 | 销售视角从“看报告”转为“谈判辅助”：风险任务、策略选择、反馈填回、高还原审阅预览和源文件增量批注交付形成闭环 | DOC/DOCX/DOCM 与文本/扫描 PDF 进入统一工作台；Word 已有修订/批注可见；DOCX/DOCM/PDF 从不可变源文件副本增量生成原生批注版，DOC 导出前要求另存为 DOCX |
| G6 文档对比 | 对比是独立能力：上传旧文件和新文件，版本流只是属性辅助，不抢占上传主路径 | 第一屏以旧/新文件上传为主；结果页支持原文页码定位、独立/同步滚动、缩放和差异报告导出 |
| G7 合同起草 | 起草是独立能力：从需求生成可编辑合同草稿，而不是上传审核或版本对比的变体 | 生成草稿带版本标记，可预览、可导出 DOCX，并可转审核/对比 |

设计约束：
- 合同审核不在单次审核时选择规则集版本；审核只消费配置中心已发布的规则与模型策略。
- 文档对比不替代审核结论；红线或需谈判变化应回到审核工作台触发复审。
- 所有页面必须保留返回上下文，不允许从对比返回到错误的继续审核页面。
- 线上不能复验时，对应目标保持未完成。

---

## 目录

1. 设计原则与约束
2. 用户角色与旅程
3. 页面设计
4. 数据模型 (Schema)
5. API 设计
6. 前端路由与组件
7. 实施计划
8. 验收标准
9. 架构评审与修正记录

---

## 1. 设计原则与约束

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **首页即工作台** | `/contracts` 不再只是列表，而是工作流入口 |
| **三轴联动审核** | 左风险任务导航 / 中源文件主轴 / 右策略执行轨道；风险、原文锚点和处理策略必须联动 |
| **填空式起草** | CRM 数据自动带入，参数配置实时预览 |
| **语义级比对** | 跨段落位置变动也能对齐，AI 解读变更意图 |
| **策略配置中心** | 规则原子化 + 3 级阈值 + 动作绑定 |
| **AI 降级链路** | 保持 4 层降级（本地 → 云端 → 规则引擎 → 人工） |

### 1.2 与现有系统的集成

| 现有系统 | 集成方式 |
|---------|---------|
| 报价中心 (F002) | 起草时关联报价单，自动带入客户/产品/金额 |
| 配置中心 (F009/F010) | 消费税率规则、审批规则、AI 配置 |
| 组织架构 (F011) | 审批路由、权限控制 |
| 知识库 (F015-F017) | 审核时引用案例库、术语库 |
| AI 运行时 (F012) | 消费模型配置、降级策略 |

### 1.3 G5 审核工作台硬约束（2026-07-14）

这组约束用于纠正“只换布局、丢掉历史有效交互”的问题。当前版本中已有价值的 `客户已同意 / 客户有反馈 / 要求特批 -> 重新审核 -> 导出批注` 必须保留；AI 对话是辅助能力，不得替代谈判引导主链路。

1. **比例是响应式基线，不是固定像素**：桌面以 `15% / 55% / 30%` 为起点；左栏允许在 220-280px 内收缩，右栏允许在 360-480px 内伸缩，中栏获得剩余空间。iPad 必须保持“源文件 + 策略轨道”并行，风险导航可收起为抽屉或窄轨。
2. **三栏各自只有一个主职责**：左栏只负责定位与批量进度，中栏只负责源文件、页码、条款和锚点，右栏只负责当前风险的诊断、谈判策略、反馈和批注预览。摘要、模型证据、版本资产不得重复占据三栏。
3. **联动以稳定锚点为准**：点击左侧风险后，中栏把 `page + source range` 定位到可视区中心，右栏切换到同一 `risk_id`。不使用跨栏绝对坐标硬绑“像素级水平线”，而用锚点状态、可见连接提示和吸顶卡片保证不同缩放与 iPad 下仍稳定。
4. **决策采用购物车草稿**：每次选择策略只写业务状态 `DRAFT_SELECTED`（数据库值 `draft_selected`），即时更新批注预览，不弹成功提示、不整页刷新；默认提供“自动进入下一条”开关，用户可关闭后留在当前风险。
5. **批量提交才触发复审**：所有草稿结论由“一键提交全部结论”形成新的 ReviewRun；提交前执行跨条款冲突检查，发现冲突时明确指出页码、风险项和冲突策略，不能静默覆盖。
6. **策略来源必须可追溯**：选项来自 G3 已发布规则资产的处理动作、谈判底线和模板，不在前端硬编码。AI 只负责把“原文上下文 + 已选 Option + 法务模板”转译为客户可读批注，不能绕开选项自行生成处理结论。
7. **交付仍以源文件为事实源**：网页渲染只负责高还原预览、定位和交互，不是交付原件。DOCX/DOCM 在源文件副本上增量写入 Word 原生批注，PDF 在源 PDF 副本上写入标准 annotation；DOC 仅保留原件和预览，生成 AI 批注版前要求另存为 DOCX。不得从预览 rendition 重建交付物、重排源材料或把内部 UUID、规则快照、source range、OCR 中间值或模型日志暴露给客户。
8. **长合同使用聚焦而非遮蔽信息**：支持页级风险分布轨和聚光灯模式；聚光灯默认降低非聚焦内容对比度，但必须可关闭，且不能妨碍上下文阅读和辅助功能。

### 1.4 G5 多格式源文件批注合同（2026-07-16）

1. **支持源文件**：`.doc / .docx / .docm / .pdf`。独立图片不进入本期；扫描生成且页面内容为图片的 PDF 仍属于必须支持的 PDF。
2. **统一页面批注层**：所有格式进入同一页面模型，批注锚点至少支持 `text / region / point`。区域与位置使用归一化坐标，必须在缩放、桌面和 iPad 下保持稳定。
3. **OCR 是增强而非前置条件**：文本 PDF 直接提取文本；扫描 PDF 尝试 OCR。低置信结果必须标记并要求人工确认；OCR 失败时仍可人工框选区域或放置批注钉，不得拒绝审核。
4. **输入与交付能力分级**：DOCX、DOCM、DOC 都可作为 Word 输入；DOCX/DOCM 使用浏览器 OOXML 审阅预览，支持经典批注和插入/删除修订，但不承诺 Word 像素级分页。DOCM 宏永不执行，导出时宏相关部件必须字节级保持；legacy DOC 的 P0 能力止于保留原件和明确兼容边界，生成 AI 原生批注版前要求用户另存为 DOCX，不伪造高保真预览。
5. **源副本增量交付**：DOCX/DOCM 在不可变源文件副本上保留既有修订/批注并新增 Word 原生 AI 批注；PDF 在源 PDF 副本上新增标准 annotation。浏览器 PDF/页图只作预览，任何情况下都不得反向重建 Word/PDF 交付件。
6. **外部 Office 解耦**：CSPP、WPS WebOffice、OnlyOffice、在线正文编辑与实时协同均不属于 G5。Word、WPS、PDF 阅读器只用于最终文件验收。
7. **ReviewRun 冻结产品真相**：审核启动时必须冻结唯一 `skill_bundle_id + version + model_policy_id + rule_snapshot_ids`。风险查看、单项决策和批量提交只能复用该历史包，不得用“当前最新规则”重解释旧结果。
8. **风险与原文证据分开**：AI 标题、说明、建议和规则代码只是候选线索。只有在当前源文本中唯一逐字命中的 `source_quote` 可升级为精确文本锚点；其余必须保持未定位并要求 PDF 人工点/区域或重新审核 Word。
9. **冻结规则绑定不得猜测**：Provider 返回 `rule_code` 不等于已绑定法务快照。只有实际执行 ReviewRun 冻结快照并返回精确 snapshot 身份时，才能提供客户同意 Option；否则保持 `unbound`。
10. **状态机和锁序是产品合同**：单项决策保存与批量提交均必须事务化，同合同必须先锁定 `contract/page`，再进入 ReviewRun、风险和草稿。启动响应丢失只能凭本次唯一 request id 恢复，不得认领相似任务。

---

## 2. 用户角色与旅程

### 2.1 角色矩阵

| 角色 | 核心页面 | 操作权限 |
|------|---------|---------|
| **销售** | 首页、起草、比对 | 上传合同、AI 起草、发起比对、查看风险 |
| **法务** | 审核、配置中心 | 审核合同、处理 ASK、维护规则 |
| **财务** | 审核 | 处理付款/税率相关 ASK |
| **交付** | 审核 | 处理 SLA/交付相关 ASK |
| **管理员** | 配置中心 | 规则配置、版本管理、灰度发布 |

### 2.2 核心旅程

**旅程 A：销售发起合同审核**
```
首页 (/contracts)
  ├─ 金刚区 → 点击「合同审核」
  └─ 任务流 → 找到待审核合同 → 点击「去审核」
    │
    ▼
审核页 (/contracts/:id/review)
  ├─ 左侧选择风险任务
  ├─ 中间定位源文件页码与原文证据
  ├─ 右侧选择谈判策略或记录客户反馈/特批
  ├─ 即时预览客户侧批注草稿
  └─ 一键提交全部结论 → 冲突检查 → 重新审核 → 导出源文件批注版
```

**旅程 B：销售 AI 智能起草**
```
首页 (/contracts)
  ├─ 金刚区 → 点击「AI 智能起草」
    │
    ▼
起草页 (/contracts/draft)
  ├─ 左侧：参数配置面板
  ├─ 右侧：实时预览区
  ├─ AI 对话框：输入自然语言诉求
  └─ 生成合同 → 保存 / 直接发起审核
```

**旅程 C：销售比对文档差异**
```
首页 (/contracts) 或 审核页
  ├─ 点击「文档精准比对」
    │
    ▼
比对页 (/contracts/:id/compare)
  ├─ 上传标准模板 + 客户回传件
  ├─ 查看差异列表（语义对齐）
  └─ 查看 AI 变更解读
```

---

## 3. 页面设计

### 3.1 首页 (/contracts) — 合同工作站

**布局：顶部通栏 + 金刚区 + 资产看板 + 任务流**

```
┌─────────────────────────────────────────────────────────────┐
│ 合同中心                              [搜索] [🔔] [+上传]    │
├─────────────────────────────────────────────────────────────┤
│ 🟣 AI 智能起草   🔴 极速风险审核   🟢 文档精准比对            │
│  500+模板       80+类风险         语义级差异                 │
├─────────────────────────────────────────────────────────────┤
│ 📊 资产看板                                                  │
│  合同总数 1,284    待处理 24    🔴高风险 3    AI提效 420h   │
├─────────────────────────────────────────────────────────────┤
│ 📋 最近任务记录                                               │
│  合同名称                     类型    AI摘要        状态    操作│
│  ONES服务续费_V2.docx        服务类  🔴x1 🟡x3   待审核   [去]│
│  买断合同_复临科技.docx      买断类  🟢通过      已通过   [下载]│
└─────────────────────────────────────────────────────────────┘
```

**组件清单：**
- `HeroSection` — 金刚区 3 卡片
- `StatsDashboard` — 资产看板 4 指标
- `TaskStream` — 任务流列表（支持筛选）
- `GlobalSearch` — 全量搜索（合同+条款+知识库）
- `QuickUpload` — 快捷上传弹窗

### 3.2 AI 智能起草 (/contracts/draft)

**布局：左右分栏（左参数配置 / 右实时预览）**

```
┌────────────────────────┬────────────────────────────────────┐
│ 合同参数配置            │ 实时预览 (Live Preview)            │
├────────────────────────┤                                    │
│ 📋 基础信息             │ ┌──────────────────────────────┐  │
│ 甲方: [下拉选择]        │ │      系统服务协议               │  │
│ 乙方: [输入]            │ │                                │  │
│ 金额: [¥ 0.00]          │ │  甲方：卧安科技（深圳）有限公司  │  │
│                         │ │  乙方：深圳复临科技有限公司      │  │
│ ⚙️ 业务参数             │ │                                │  │
│ 付款方式: [3-4-3▼]      │ │  第二条 费用与结算               │  │
│ 部署方式: [公有云▼]     │ │  总金额：¥118,935.00            │  │
│                         │ │  付款方式：3-4-3 分期           │  │
│ 🔒 条款开关             │ │                                │  │
│ ☑ 知识产权加强           │ │  (高亮动态生成内容)             │  │
│ ☐ 交付违约金补偿         │ │                                │  │
│                         │ └──────────────────────────────┘  │
│ 🤖 AI 增补诉求          │                                    │
│ [请输入自然语言...]     │  [生成合同] [保存草稿] [直接审核] │
│ [AI智能转换]            │                                    │
└────────────────────────┴────────────────────────────────────┘
```

**组件清单：**
- `DraftConfigPanel` — 参数配置面板
- `PartySelector` — 甲方/乙方选择（CRM 联动）
- `BusinessParams` — 业务参数（枚举/开关）
- `ClauseToggles` — 条款开关组
- `LivePreview` — 实时预览区（变量高亮）
- `AINaturalInput` — AI 自然语言输入框

### 3.3 智能风险审核 (/contracts/:id/review)

**布局：三轴联动（左风险导航 / 中智能原文 / 右策略执行）**

桌面基线比例为 `15% / 55% / 30%`，实际使用最小/最大宽度约束，不把比例写死。中间源文件是唯一主滚动轴，左侧导航保持稳定，右侧当前策略卡吸顶并随 `risk_id` 联动。

```
┌──────────────┬────────────────────────────────┬──────────────────────┐
│ 风险导航 15% │ 源文件主轴 55%                 │ 策略执行轨道 30%     │
│ 8 项 / 3 待办│ 页码、条款、原文锚点            │ 当前：间接损失        │
│              │                                │ AI 诊断（受规则约束） │
│ 🔴 间接损失  │ 第 38 页                       │ ○ 限额 50%（推荐）    │
│ 🔴 SLA 赔偿  │ ……高亮原文……                  │ ○ 客户有反馈          │
│ 🟢 付款方式  │                                │ ○ 要求特批            │
│ 🟡 税率      │                                │ ○ 在线改写（辅助）    │
│              │                                │ 批注草稿即时预览      │
│ 风险分布轨   │                                │ AI 对话（可折叠）     │
│ 已选 3/待办5 │                                │                      │
│ [提交全部]   │                                │                      │
└──────────────┴────────────────────────────────┴──────────────────────┘
```

**交互状态机：**

```
OPEN -> DRAFT_SELECTED | CUSTOMER_FEEDBACK | EXCEPTION_REQUESTED
     -> BATCH_SUBMITTED -> CONFLICT_CHECKED
     -> RE_REVIEW_RUNNING -> READY_TO_EXPORT | NEEDS_MANUAL_REVIEW
```

- 点击风险：更新统一 `focusedRiskId`，中栏定位锚点，右栏加载同一风险策略。
- 选择策略：本地乐观保存草稿并刷新批注预览，不创建新 ReviewRun。
- `客户已同意 / 客户有反馈 / 要求特批` 是主操作；`在线改写` 和 AI 对话只在需要解释或措辞时展开。
- 一键提交：汇总所有草稿选择，先跑确定性冲突检查，再启动复审；未处理风险必须显式保留为待办，不能当作通过。

**策略与批注约束：**

```json
{
  "risk_id": "R001",
  "position": { "page": 38, "line_start": 450, "line_end": 455 },
  "rule_release_id": "release-id",
  "diagnosis": "间接损失无限责任风险",
  "strategies": [
    {
      "id": "LIMIT_50",
      "label": "限额 50%",
      "description": "法务建议的最佳对冲方案",
      "action_type": "FIX_TEMPLATE",
      "comment_template_id": "comment-template-id"
    },
    {
      "id": "SPECIAL_APPROVAL",
      "label": "要求特批",
      "action_type": "WORKFLOW_START",
      "workflow_id": "WF_002"
    }
  ],
  "status": "DRAFT_SELECTED",
  "selected_option_id": "LIMIT_50"
}
```

AI 批注输入必须包含规则发布版本、原文证据、选项 ID 和模板 ID；输出经过长度、禁泄漏字段、证据锚点和语气校验后才能进入预览。模型失败时保留确定性模板草稿并标记“待人工确认”，不得输出无来源的建议。

**组件清单：**
- `RiskNavigationRail` — 左侧风险筛选、任务列表、风险分布轨与购物车进度。
- `SourceDocumentViewport` — 中间源 DOCX/PDF 页级预览、条款锚点、缩放与聚光灯。
- `ResolutionStrategyPanel` — 右侧当前风险诊断、策略选项、客户反馈、特批和批注预览。
- `DecisionDraftStore` — 无刷新草稿保存、失败重试和待同步标记。
- `ConflictInspector` — 批量提交前的跨条款确定性冲突检查。
- `AIChatDrawer` — 可折叠合同助理，不占据默认主流程焦点。
- `BatchReviewBar` — 待办/已选计数、一键提交、复审状态与导出状态。

### 3.4 文档精准比对 (/contracts/:id/compare)

**布局：顶部操作栏 + 差异统计 + 双栏对比**

```
┌─────────────────────────────────────────────────────────────┐
│ 比对: 标准模板 vs 客户回传件       [双栏视图] [合并视图] [导出]│
├─────────────────────────────────────────────────────────────┤
│ 🟥 删除: 3处  🟩 新增: 4处  🟦 移动/语义: 1处               │
├──────────────┬────────────────────┬───────────────────────────┤
│ 变更列表     │ 标准模板 (A)       │ 客户回传件 (B)            │
│             │                    │                          │
│ 🔴 第2条-删除│ [原文]            │ [原文]                   │
│   "5个工作日│                    │                          │
│   内支付..." │ [删除高亮]        │                          │
│             │                    │                          │
│ 🟢 第5条-新增│                    │ [新增高亮]               │
│   差旅费用  │                    │ "乙方需承担..."          │
│             │                    │                          │
│ 🔵 第8条-移 │ [虚线对齐]        │ [虚线对齐]               │
│   动        │                    │                          │
├──────────────┴────────────────────┴───────────────────────────┤
│ 🤖 AI 解读: "对方将争议解决地改为上海，且删除了甲方违约上限"  │
└─────────────────────────────────────────────────────────────┘
```

**组件清单：**
- `DiffToolbar` — 顶部操作栏（视图切换/导出）
- `DiffStatsBar` — 差异统计条
- `DiffListPanel` — 左侧变更列表导航
- `DiffPaneA` / `DiffPaneB` — 双栏对比面板
- `DiffHighlight` — 差异高亮组件
- `AIInterpretation` — AI 变更解读面板

### 3.5 策略配置中心 (/admin/contract-policies)

**布局：左侧分类导航 + 右侧规则列表 + 编辑器弹窗**

```
┌─────────────────────────────────────────────────────────────┐
│ ONES 配置中心 v2.0                                          │
├──────────┬──────────────────────────────────────────────────┤
│ 01-付款  │ 01-付款条款规则集 (12条规则生效中)                │
│ 06-税率  │ ┌──────────────────────────────────────────────┐ │
│ 08-比对  │ │ #RULE-01-01 首期款比例                          │ │
│ 10-产品  │ │ 比例类(%)  [编辑] [删除]                        │ │
│ 12-DPA   │ │ Level A: >= 30%  🟢 通过                       │ │
│ 13-SLA   │ │ Level B: 25-30%   🟡 偏离（建议换取对价）       │ │
│ 15-争议  │ │ Level C: < 25%    🔴 红线（必须修改）           │ │
│          │ └──────────────────────────────────────────────┘ │
│ [+新增]  │ ┌──────────────────────────────────────────────┐ │
│          │ │ #RULE-01-02 账期上限                            │ │
│          │ │ 时限类(Day)                                    │ │
│          │ │ ...                                             │ │
│          │ └──────────────────────────────────────────────┘ │
├──────────┴──────────────────────────────────────────────────┤
│ [+ 新增审计规则]  [模拟运行测试]  [版本历史]                  │
└─────────────────────────────────────────────────────────────┘
```

**组件清单：**
- `PolicyCategoryNav` — 左侧分类导航
- `RuleCard` — 规则卡片（含 Level A/B/C 显示）
- `RuleEditor` — 规则详情编辑器（弹窗/抽屉）
- `LogicMatrix` — 风险阈值矩阵编辑器
- `SandboxRunner` — 模拟运行测试
- `VersionHistory` — 版本历史面板

---

## 4. 数据模型 (Schema)

### 4.1 合同中心首页

**无需新增表**，消费现有 `contracts` 表，按状态聚合。

### 4.2 智能起草

```sql
-- 新增: 合同草稿表
CREATE TABLE contract_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- 基础信息
  title TEXT,
  party_a_name TEXT,              -- 甲方
  party_b_name TEXT,              -- 乙方
  party_b_contact TEXT,           -- 乙方联系人
  contract_amount DECIMAL(15,2),  -- 合同金额
  tax_amount DECIMAL(15,2),       -- 税额
  
  -- CRM 联动
  quote_id UUID REFERENCES quotes(id),      -- 关联报价
  customer_id UUID,                           -- 关联客户
  
  -- 业务参数 (JSON)
  business_params JSONB DEFAULT '{}',         -- {payment_method, deployment_type, ...}
  
  -- 条款开关 (JSON)
  clause_toggles JSONB DEFAULT '{}',          -- {ip_protection: true, penalty_compensation: false, ...}
  
  -- AI 增补 (JSON)
  ai_additions JSONB DEFAULT '[]',            -- [{text, clause_type, inserted_at}]
  
  -- 生成的合同内容
  generated_content TEXT,                     -- 生成的完整合同文本
  
  -- 状态
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'submitted_for_review')),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 新增: 合同模板参数表
CREATE TABLE contract_template_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  
  param_key TEXT NOT NULL,          -- 参数标识, e.g. "payment_method"
  param_type TEXT NOT NULL CHECK (param_type IN ('enum', 'toggle', 'text', 'number', 'date')),
  param_label TEXT NOT NULL,        -- 显示名称
  param_options JSONB,              -- 枚举选项 [{value, label}]
  default_value JSONB,              -- 默认值
  required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.3 智能风险审核与决策草稿

```sql
-- ReviewRun 产生的风险事实。事实与销售决策分离，避免一次点击覆盖审核证据。
CREATE TABLE contract_risk_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  review_id UUID REFERENCES contract_reviews(id) ON DELETE CASCADE,

  -- 审核事实与规则来源
  rule_id UUID,
  rule_release_id UUID,
  level TEXT NOT NULL CHECK (level IN ('red', 'yellow', 'green', 'white')),  -- white = 待补
  title TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  evidence_text TEXT,
  negotiation_goal TEXT,

  -- 源文件锚点。字符范围只负责文本定位，页码和渲染框负责浏览器联动。
  clause_ref TEXT,                  -- 关联条款编号, e.g. "第2条"
  source_anchor JSONB NOT NULL,     -- {kind:text|region|point,page,text offsets?,exactText?,quads?,rect?,point?,ocrConfidence?}

  -- 审核来源与质量
  detected_by TEXT DEFAULT 'ai',    -- ai / rule / manual
  confidence DECIMAL(3,2),
  available_strategies JSONB NOT NULL DEFAULT '[]', -- 发布规则在本次 ReviewRun 的策略快照

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 销售对风险的处理草稿。选择策略自动暂存，不改变 finding，也不立即触发复审。
CREATE TABLE contract_risk_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES contract_risk_findings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'draft_selected', 'customer_feedback', 'exception_requested', 'submitted', 'resolved'
  )),
  selected_option_id TEXT,
  selected_option_snapshot JSONB,
  feedback_text TEXT,
  decision_payload JSONB NOT NULL DEFAULT '{}',
  comment_draft TEXT,               -- 客户侧批注文案预览；与具体 Word/PDF 导出器解耦
  revision_draft JSONB,             -- 可确定修改的 OOXML 修订草稿
  version INTEGER NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (finding_id, user_id)
);

-- 一次批量提交形成一份不可变决策快照，再触发冲突检查和新的 ReviewRun。
CREATE TABLE contract_review_decision_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  source_review_id UUID NOT NULL REFERENCES contract_reviews(id),
  submitted_by UUID NOT NULL REFERENCES users(id),
  decision_snapshot JSONB NOT NULL,
  conflict_report JSONB NOT NULL DEFAULT '[]',
  next_review_id UUID REFERENCES contract_reviews(id),
  status TEXT NOT NULL CHECK (status IN ('checking', 'blocked', 'submitted', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 新增: AI 对话记录表
CREATE TABLE contract_ai_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- 对话内容
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  
  -- 引用上下文
  context JSONB,                    -- {referenced_clauses: [], risk_ids: []}
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.4 文档精准比对

```sql
-- 新增: 比对任务表
CREATE TABLE contract_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- 比对双方
  baseline_type TEXT NOT NULL CHECK (baseline_type IN ('template', 'previous_version', 'uploaded')),
  baseline_doc_id UUID,             -- 基准文档 ID
  compare_doc_id UUID,              -- 对比文档 ID
  
  -- AI 解读
  ai_summary TEXT,                  -- AI 变更总结
  ai_recommendation TEXT,           -- AI 建议
  
  -- 状态
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 新增: 比对差异项表
CREATE TABLE comparison_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id UUID NOT NULL REFERENCES contract_comparisons(id) ON DELETE CASCADE,
  
  -- 差异类型
  diff_type TEXT NOT NULL CHECK (diff_type IN ('deleted', 'added', 'modified', 'moved')),
  
  -- 位置信息
  baseline_position JSONB,          -- {paragraph: 2, start: 100, end: 200}
  compare_position JSONB,           -- {paragraph: 3, start: 150, end: 250}
  
  -- 内容
  baseline_text TEXT,
  compare_text TEXT,
  
  -- 语义分析
  semantic_change TEXT,             -- AI 语义解读
  risk_level TEXT CHECK (risk_level IN ('red', 'yellow', 'green')),
  
  -- 排序
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.5 策略配置中心

```sql
-- 已有: rules 表 (F009)，扩展以下字段支持原子化规则

-- 新增: 规则集表
CREATE TABLE contract_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  
  code TEXT NOT NULL UNIQUE,        -- 规则集编码, e.g. "PAYMENT"
  name TEXT NOT NULL,                -- 显示名称, e.g. "付款条款规则集"
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  
  -- 状态
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 已有 rules 表扩展字段 (新增列)
-- ALTER TABLE rules ADD COLUMN rule_set_id UUID REFERENCES contract_rule_sets(id);
-- ALTER TABLE rules ADD COLUMN attribute_type TEXT CHECK (attribute_type IN ('ratio', 'amount', 'duration', 'enum', 'text'));
-- ALTER TABLE rules ADD COLUMN scope_tags JSONB DEFAULT '[]';        -- 业务标签 ["私有部署", "买断"]
-- ALTER TABLE rules ADD COLUMN workflow_bindings JSONB DEFAULT '[]'; -- 审批路由绑定 [{role: "finance", required: true}]
-- ALTER TABLE rules ADD COLUMN level_a JSONB;                        -- Level A 配置
-- ALTER TABLE rules ADD COLUMN level_b JSONB;                        -- Level B 配置
-- ALTER TABLE rules ADD COLUMN level_c JSONB;                        -- Level C 配置
-- ALTER TABLE rules ADD COLUMN counterparty TEXT;                    -- 对价策略映射
-- ALTER TABLE rules ADD COLUMN话术库_id UUID;                         -- 关联话术库

-- level_a/b/c 结构示例:
-- {
--   operator: ">=",          -- 判定操作符
--   threshold: "30%",        -- 阈值
--   label: "🟢 通过",        -- 显示标签
--   action: "auto_approve"   -- 动作
-- }

-- 新增: 策略版本表
CREATE TABLE contract_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  
  version INTEGER NOT NULL,
  config_snapshot JSONB NOT NULL,    -- 完整的规则配置快照
  
  -- 发布信息
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ,
  release_note TEXT,
  
  -- 灰度信息
  is_gray_release BOOLEAN DEFAULT false,
  gray_end_at TIMESTAMPTZ,
  
  -- 状态
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'rolled_back')),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 新增: 策略影响分析报告表
CREATE TABLE contract_policy_impact_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES contract_policy_versions(id) ON DELETE CASCADE,
  
  -- 影响分析
  affected_contracts INTEGER DEFAULT 0,    -- 影响的合同数
  pass_rate_change DECIMAL(5,2),          -- 通过率变化
  risk_level_change JSONB,                -- 风险等级分布变化
  
  -- 报告内容
  report_content TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.6 完整 ER 图

```
contracts (已有)
├── contract_drafts (新)
├── contract_risk_cards (新)
├── contract_ai_chats (新)
├── contract_comparisons (新)
│   └── comparison_diffs (新)
└── contract_reviews (已有扩展)

contract_rule_sets (新)
├── rules (已有扩展)
│   └── contract_policy_versions (新)
│       └── contract_policy_impact_reports (新)
└── contract_template_params (新)
```

---

## 5. API 设计

### 5.1 合同中心首页

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/contracts/dashboard` | 首页仪表盘数据（统计 + 最近任务） | contract:view |
| GET | `/api/contracts?status=&risk_level=&limit=` | 合同列表（支持筛选） | contract:view |
| POST | `/api/contracts` | 创建合同（上传） | contract:upload |

### 5.2 智能起草

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/quotes?status=approved` | 获取可关联的报价单 | quote:view |
| GET | `/api/customers` | 获取客户列表（CRM 联动） | customer:view |
| POST | `/api/contracts/drafts` | 创建合同草稿 | contract:create |
| GET | `/api/contracts/drafts/:id` | 获取草稿详情 | contract:view |
| PATCH | `/api/contracts/drafts/:id` | 更新草稿参数 | contract:edit |
| POST | `/api/contracts/drafts/:id/generate` | AI 生成合同 | contract:generate |
| POST | `/api/contracts/drafts/:id/submit` | 提交草稿进入审核 | contract:submit |
| GET | `/api/contracts/templates/:id/params` | 获取模板参数定义 | contract:view |

### 5.3 智能风险审核

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/contracts/:id/review` | 获取当前 ReviewRun、风险事实、源文件锚点、策略快照与决策草稿 | contract:review |
| PATCH | `/api/contracts/:id/risks/:riskId/decision` | 无刷新暂存策略选择、客户反馈或特批申请 | contract:review |
| POST | `/api/contracts/:id/review/check-conflicts` | 批量提交前检查跨条款、金额、责任和期限冲突 | contract:review |
| POST | `/api/contracts/:id/review/submit-decisions` | 固化全部决策并创建新的 ReviewRun | contract:review |
| GET | `/api/contracts/:id/review/export-preview` | 返回客户侧修订/批注预览及导出门禁 | contract:review |
| POST | `/api/contracts/:id/annotations` | 新建文本、区域或位置批注草稿，绑定源版本与哈希 | contract:review |
| PATCH | `/api/contracts/:id/annotations/:annotationId` | 更新批注文案、锚点或处理状态 | contract:review |
| POST | `/api/contracts/:id/export` | 从源文件副本生成 DOCX/DOCM/PDF 原生批注版；DOC 返回需另存为 DOCX | contract:review |
| POST | `/api/contracts/:id/ai-chat` | AI 对话咨询（辅助入口，不替代策略选择） | contract:review |
| GET | `/api/contracts/:id/ai-chat` | 获取对话历史 | contract:review |

### 5.4 文档精准比对

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/contracts/:id/compare` | 发起比对 | contract:compare |
| GET | `/api/comparisons/:id` | 获取比对结果 | contract:compare |
| GET | `/api/comparisons/:id/diffs` | 获取差异列表 | contract:compare |
| GET | `/api/comparisons/:id/ai-summary` | AI 变更解读 | contract:compare |

### 5.5 策略配置中心

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/contract-policies/rule-sets` | 规则集列表 | config:read |
| POST | `/api/contract-policies/rule-sets` | 创建规则集 | config:write |
| GET | `/api/contract-policies/rule-sets/:id/rules` | 规则集下的规则 | config:read |
| POST | `/api/contract-policies/rules` | 创建规则 | config:write |
| PATCH | `/api/contract-policies/rules/:id` | 更新规则（保存即生效） | config:write |
| DELETE | `/api/contract-policies/rules/:id` | 软删除规则 | config:write |
| GET | `/api/contract-policies/rules/:id/versions` | 版本历史 | config:read |
| POST | `/api/contract-policies/rules/:id/versions/:versionId/publish` | 发布版本 | config:write |
| POST | `/api/contract-policies/rules/:id/versions/:versionId/rollback` | 回滚版本 | config:write |
| POST | `/api/contract-policies/rules/:id/test` | 模拟测试 | config:read |
| GET | `/api/contract-policies/rules/:id/stats` | 命中率统计 | config:read |

---

## 6. 前端路由与组件

### 6.1 页面路由

| 页面 | 路径 | 组件 | 说明 |
|------|------|------|------|
| 合同中心首页 | `/contracts` | `ContractCenterPage` | 金刚区 + 资产看板 + 任务流 |
| 智能起草 | `/contracts/draft` | `ContractDraftPage` | 左右分栏：参数 + 预览 |
| 智能起草 (继续) | `/contracts/draft/:id` | `ContractDraftPage` | 编辑已有草稿 |
| 风险审核 | `/contracts/:id/review` | `ContractReviewPage` | 三轴联动：风险导航 / 源文件 / 策略执行 |
| 文档比对 | `/contracts/:id/compare` | `ContractComparePage` | 双栏对比 |
| 比对结果 | `/contracts/:id/compare/:comparisonId` | `ContractCompareResultPage` | 查看比对结果 |
| 策略配置 | `/admin/contract-policies` | `ContractPoliciesPage` | 规则集 + 规则列表 |
| 规则编辑 | `/admin/contract-policies/rules/:id` | `ContractRuleEditorPage` | 规则详情编辑器 |
| 版本历史 | `/admin/contract-policies/rules/:id/versions` | `ContractRuleVersionsPage` | 版本管理 |
| 沙箱测试 | `/admin/contract-policies/rules/:id/sandbox` | `ContractRuleSandboxPage` | 模拟运行测试 |

### 6.2 共享组件

```
app/contracts/
├── page.tsx                    # 首页 (ContractCenterPage)
├── draft/
│   └── page.tsx                # 智能起草 (ContractDraftPage)
├── [id]/
│   ├── review/
│   │   └── page.tsx            # 风险审核 (ContractReviewPage)
│   └── compare/
│       └── page.tsx            # 文档比对 (ContractComparePage)
└── components/
    ├── HeroSection.tsx         # 金刚区
    ├── StatsDashboard.tsx      # 资产看板
    ├── TaskStream.tsx         # 任务流列表
    ├── DraftConfigPanel.tsx   # 起草参数配置
    ├── LivePreview.tsx        # 实时预览
    ├── AIExtractPanel.tsx     # 摘要提取面板
    ├── RiskNavigationRail.tsx # 风险任务、页级分布轨和购物车进度
    ├── SourceDocumentViewport.tsx # 源文件页级预览、锚点、缩放和聚光灯
    ├── ResolutionStrategyPanel.tsx # 当前风险策略、反馈、特批和批注预览
    ├── DecisionDraftStore.ts  # 无刷新决策草稿、失败重试和待同步状态
    ├── ConflictInspector.tsx  # 批量提交前跨条款冲突检查
    ├── BatchReviewBar.tsx     # 待办/已选计数、提交复审和导出门禁
    ├── AIChatDrawer.tsx       # AI 对话抽屉（辅助入口）
    ├── DiffPane.tsx           # 比对双栏
    ├── DiffHighlight.tsx      # 差异高亮
    └── AIInterpretation.tsx   # AI 变更解读

app/admin/
├── contract-policies/
│   ├── page.tsx                # 策略配置首页
│   ├── rules/
│   │   └── [id]/
│   │       ├── page.tsx        # 规则编辑
│   │       ├── versions/
│   │       │   └── page.tsx    # 版本历史
│   │       └── sandbox/
│   │           └── page.tsx      # 沙箱测试
│   └── components/
│       ├── RuleCard.tsx
│       ├── RuleEditor.tsx
│       ├── LogicMatrix.tsx
│       ├── SandboxRunner.tsx
│       └── VersionHistory.tsx
```

---

## 7. 实施计划

### Phase 1: 首页 + 起草 UI (2 周) ✅ 已完成
- [x] 合同中心首页（金刚区 + 资产看板 + 任务流）
- [x] 智能起草页面（参数配置 + 实时预览）
- [x] 合同草稿数据模型
- [x] API: 草稿 CRUD、AI 生成

### Phase 2: G5 合同审核与源文件批注闭环（本地安全候选已形成，发布验收未完成）

下方第一组勾选只表示“当前工作树的代码事实已进入本地候选”，不等于 Preview、真实文件或 Production 验收。

#### 本地实现候选

- [x] 风险事实、决策草稿和批量提交快照分离
- [x] 15/55/30 响应式三轴布局；iPad 保持源文件与策略轨道并行的代码路径
- [x] 风险点击联动页码/条款锚点与当前策略卡片
- [x] `客户已同意 / 客户有反馈 / 要求特批` 与规则策略选项统一成决策草稿
- [x] 选择即暂存、可选自动顺延、批量提交前冲突检查
- [x] AI 仅转译已选策略；失败时使用可追溯模板并进入人工确认
- [x] ReviewRun 冻结唯一规则包、模型策略和快照身份；展示/保存/提交均复用该历史版本
- [x] 只有唯一逐字 `source_quote` 可形成精确文本锚点；未定位或 unbound 风险不输出客户法务 Option
- [x] 单项决策原子保存与批量提交共用一致首锁；exact request 恢复覆盖 queued/running/completed/failed 三表一致状态
- [x] DOC/DOCX/DOCM 与文本/扫描 PDF 的统一页级预览与 `text/region/point` 批注数据模型
- [x] 扫描 PDF 在无文本层或 OCR 失败时仍可人工区域/位置批注
- [x] DOCX/DOCM 原生 Word 批注导出候选；DOCM 输入/输出同时通过 ZIP 资源与歧义门禁、完整 OPC/VBA/vbaData 关系图、真实 OLE stream 解析和宏资产前后哈希校验
- [x] DOC 保留原件并可预览；导出在任何 Storage 下载或生成器调用前返回 `LEGACY_DOC_REQUIRES_DOCX`，不静默转换
- [x] PDF 标准 annotation 导出候选
- [x] AI 对话保留为辅助抽屉，不替代谈判引导

#### 未完成的发布验收

- [x] 关闭隔离 Preview 的 Storage owner/org/path 隔离、不可覆盖、容量和 DOCM MIME 的 P0 门禁；Production 不从 Preview 结果推断安全
- [x] 在隔离 Preview 按唯一候选顺序应用迁移并完成 SQL/RPC 动态回滚链：源身份、lease fencing、幂等、过期恢复和 UTF-16 偏移通过且 fixture 残留为零
- [ ] 完成真实双标签页 save+submit、重叠引用、NULL `detected_by` 与长文 stage 的浏览器并发验收
- [x] 在隔离、可审计且与当前 lock importer 直接版本一致的依赖闭包完成 Next.js 14.2.35 build
- [x] 受控真实 DOCX 在 Preview 完成上传、双模型审核及桌面 1440×900 / iPad 1180×820 完整浏览器验收；2/2 修订、1 条既有批注和模型风险可见，无横向溢出或 console error
- [x] 真实两文件连续上传队列在 Preview 只创建/合并两个独立合同、只推进一次并跳到第二个审核页；两个 parsed text 均落库，验收后数据库及正式/临时 Storage 残留为 0
- [x] 使用 Word 生成的真实 DOCM 与固定 Apache POI DOCM 完成宏包真实性、原生批注和宏资产不变的本地文件级验收
- [x] 真实 DOCM、文本 PDF、扫描 PDF 已接入 Preview create/chunk/merge、预览、锚点、源文件副本原生批注导出与独立阅读器主链；该文件矩阵不代表法律决策/复审链或 Word GUI 已关闭
- [x] 用户裁定停止 legacy DOC 同格式引擎研发；适配器只保留为历史研究资产，不进入 Production 路由或 G5 退出门禁
- [x] 本地文件级 PDF 输出在至少两种独立阅读器中显示标准 annotation
- [x] 两个免费本地模型使用机器现有权重完成同一三条款样本的协议直调，返回闭合 JSON、逐字 `source_quote` 和非空 token
- [x] 隔离 Preview 建立明确 `not_release_eligible` 的双本地 Provider/runtime plumbing fixture；`published/current` 只表示运行解析状态，不表示模型已连接或可发布
- [x] 两个模型分别完成 Preview `evidence_saved/runtime_config_match` probe，并在同一受控真实合同上形成可直接联接的 completed、非降级 `model_invocations`、非空 token 与 ReviewRun；该项只关闭运行前置，不代表准确率或发布通过

#### 2026-07-16 v08 本地门禁证据

- 当前 lock importer 的全部直接依赖在隔离闭包中为 `0` 版本错配、`0` 断链；3 个小文件密集包通过 npm 官方精确版本恢复，`3270/3270` 文件与 pnpm store 的 SHA-512 索引一致。Next.js `14.2.35` build 退出码为 `0`，静态页为 `81/81`；`tsc --noEmit` 通过。
- Vitest 为 `62 files / 407 tests`，Python Word/PDF 文件测试为 `10/10`。新增测试使用真实 PDF Image XObject 构造无文本层扫描页，验证原图字节保持、区域高亮、区域备注与点备注同时存在。
- 同一份图片型扫描 PDF 批注输出已在 macOS Preview 与 Safari PDF 阅读器显示；两者均读取到“扫描 PDF 人工区域批注”和“扫描 PDF 人工点批注”。Chrome 同时显示高亮和备注图标。该证据关闭本地文件级双阅读器门禁，但不冒充远端 Storage/SaaS 全链路验收。
- `.doc` 导出路由在任何 Storage 下载或生成器调用前返回 `422 / LEGACY_DOC_REQUIRES_DOCX`；这是一条产品能力边界，不再是等待 DOC 适配器完成的临时错误。

#### 2026-07-16 v09 DOCM 初步真实性门禁（已被 v10/v11 加固）

- v09 修复了“普通 DOCX 改名 `.docm` 时空宏哈希集合也能通过”的第一层假阳性，但随后独立复审证明只检查 CFB 头、relationship basename、部分 Content-Type 会放过空壳 OLE、穿越 target、缺少 `vbaData` 与 ZIP 重名等伪包；因此 v09 只保留为发现过程，不再作为当前关闭依据。
- 本机 Microsoft Word 16.111 生成的真实 DOCM 含 12,288 字节 CFB `vbaProject.bin`。写入 1 个原生中文批注后，`vbaProject.bin`、`vbaData.xml`、`vbaProject.bin.rels` 三个相关部件的 SHA-256 全部不变；Word 从磁盘重新打开输出并显示 `1/1` 批注线程和完整中文批注文案。
- 固定 Apache POI 提交 `4554f204cbbf00ecbcaed134fe57e43a1779a612` 的 `SimpleMacro.docm`（Git blob `123b8157f3dacb7fb678460a35e57315d0777c94`）仅做静态解包和批注写入，未执行宏；输出同样保持 3 个 VBA 相关部件哈希不变。Python Word/PDF 文件测试增至 `12/12`，新增 DOCX 改后缀与非 CFB VBA 两个负向用例。

#### 2026-07-16 v10 DOCM 加固候选与 DOC 适配器决策

- v10 在任何解压前增加 ZIP 资源/路径/重名门禁，并加入 OPC Override 优先、精确 VBA/vbaData 关系和 `olefile` OLE stream 检查；未修改 part 改为流式复制。随后两轮独立复审仍复现 VBA 内容清零、package root 缺失、孤立/未声明 Content-Type、relationship source/target 悬空、大小写等价 Override 冲突和伪主文档等假阳性，因此 v10 的 `18/18` 只保留为收敛历史，不作为当前关闭依据。
- 真实 Apache POI 二进制 `SimpleMacro.doc` 的本地 LibreOffice 原型已输出同格式 DOC；正文逐字不变、渲染页逐像素相同、全部 10 个 `Macros/...` OLE streams 字节一致，并含 1 条原生中文批注。v12 已确认这只能作为可信 fixture 的格式证明，不能证明生产安全、转换路径宏未执行或含对象 DOC 保真；当时路由保持 `DOC_ADAPTER_NOT_PROVEN`，已在 v13 被稳定产品边界 `LEGACY_DOC_REQUIRES_DOCX` 取代。

#### 2026-07-16 v11 受支持形态 DOCM 文件门禁

- 每个实际 part 必须有有效 Content-Type；Override 按 OPC 大小写等价唯一且精确对应实际 part。relationship part 只能位于规范 `_rels` 位置，非根 source 和 Internal target 必须存在，package metadata 不得成为 relationship source/target；package root 必须唯一内部指向 `/word/document.xml`，主 XML 必须安全解析且根为 `w:document`。
- 存在 VBA Project 时，除完整 `vbaProject.bin -> vbaData.xml` OPC 图外，还必须由固定 `olefile==0.47` 与 `oletools==0.60.2` 静态解压解析 `PROJECT`、固定 `_VBA_PROJECT` 头、`VBA/dir` 和所有模块流；模块声明与 OLE streams 必须一致，检查依赖缺失、空/清零/损坏内容或任一包不变量失败均 fail closed。该过程不启动 Office、不执行宏。宏启用但零 VBA Project 的合法文件明确允许。
- 固定 Apache fixture 和 Microsoft Word 16.111 生成的真实 DOCM 均通过输入/输出校验；最新输出保留原文锚点并在 Word 显示 `1/1` 原生中文批注，3 个 VBA 相关 part 哈希逐项不变。源、输出、截图、SHA-256 和观察记录已归档到 `product-code/output/evidence/g5-v11`。全新 venv 按 `requirements.txt` 安装后，`PYTHON_PATH=<venv>/bin/python pnpm test:g5-file` 为 `30/30`；未安装固定解析依赖的默认 Python 会按设计 fail closed。

#### 2026-07-16 v12 DOC 对象红灯与止血边界

- 固定 Apache POI `word_with_embeded.doc`（117,248 bytes，SHA-256 `206acf1f7eb7b7d2075e04015d005ae9bb56f025560f2583ad3878257bc4c7`）包含 2 个 Excel、1 个 PowerPoint、1 个 Word 嵌入对象和 27 个 `ObjectPool/**` streams。LibreOffice 往返会重编号对象 storage，并在真实页面渲染中丢失 PowerPoint 与至少一个 Excel 预览；当前回归必须返回 `DOC_OBJECT_STREAM_CHANGED` 且不得发布输出，不能通过忽略 storage 名称放宽。
- 安全复审确认当前 Node 只是在宿主启动 Python，`olefile`、`pypdf`、`python-docx` 解析不可信内容仍在 LibreOffice 沙箱外；bubblewrap 原型的 `--ro-bind / /` 也会暴露宿主只读文件与 Unix socket。因此现有适配器已改为 `trusted-fixture-local-proof`，`NODE_ENV=production` 无条件拒绝启用。真正生产 Worker 必须把 Python、LibreOffice 与全部校验器一起放入最小只读容器/微虚机，仅挂只读输入与空输出、无网络、非 root、无宿主凭据/socket，并加全任务内存/CPU/pids/输出/并发限制。
- Worker 成功 proof 已改为严格 schema：所有哈希、宏/对象计数、页几何、批注数量、隔离后端与 proof scope 必填；`anchored === native_comments_added` 且 `unlocated` 必须为空。路由临时输入和成功输出为 `0600`，日志有 256 KiB 上限；转换路径没有宏 canary，结果明确记录为 `not-proven`，不再用常量冒充“从未执行”。
- 当前门禁：Vitest `63 files / 411 tests`、`pnpm tsc --noEmit`、Next.js 14.2.35 build `81/81 / exit 0`；`pnpm test:g5-file` 为 39 项通过、3 个真实集成跳过，显式 macOS 本地证明集成为 `9/9`。这些结果关闭的是止血代码和红灯回归，不关闭 DOC 产品能力。
- 正向同格式 DOC、对象型 DOC 源/失败渲染、SHA-256、proof 边界、测试与构建摘要已归档到 `product-code/output/evidence/g5-v12`；失败往返 DOC 不作为客户产物归档，固定源 fixture 与重现测试位于 `lib/export/fixtures`。
- v12 的 A/B/C 决策已于 2026-07-17 关闭：用户目标不是构建旧 DOC 转换引擎，而是高还原预览与源文件副本新增 AI 批注。P0 不启动 Aspose/OnlyOffice/CSPP，也不继续扩大 legacy DOC Worker；DOC 原件保留并可预览，生成 AI 批注版前要求另存为 DOCX。

#### 2026-07-17 v13 高还原预览与既有批注保留证明

- 当前 Word 预览继续使用 LibreOffice 生成 PDF rendition，以页式布局而非 HTML 重排供浏览器查看；官方 `ExportNotesInMargin` 参数使源文件既有批注在页边可见，修订标记同时显示。该 rendition 只用于预览和定位。
- 仓内 `controlled-revisions-comments-proof.docx` 含 2 个 `w:ins`、2 个 `w:del` 和 1 条既有批注。向同一源文件副本新增 1 条 AI 原生批注后，修订计数保持 2/2、原批注仍在、批注总数变为 2，页眉与页脚 SHA-256 不变；可视预览同时显示两条批注。
- `docx-preview` 的修订与批注渲染仍由其项目标记为 experimental，且 HTML 分页不能提供与 Word 相同的版式，因此不引入。在线 Office 编辑器也不是该目标的依赖。

#### 2026-07-17 v14 浏览器 OOXML 主链（覆盖 v13 的 SaaS 预览选择）

- v13 的 LibreOffice rendition 仅保留为离线文件验收路线，不再是 SaaS Word 运行依赖。当前浏览器以客户端动态加载的 `docx-preview 0.4.0` 直接消费私有源文件 ticket，服务端 Word 页图接口固定返回 422，避免把转换图冒充原文。
- 同一受控 DOCX 在桌面与 1180×820 iPad 均显示 2 个插入、2 个删除和 1 条既有经典批注；批注可键盘聚焦、点击展开并以 Escape 关闭。请求没有进入 `/source/pages`，也没有访问文档来源外部主机。实验性渲染限制仍需在 UI 中诚实表达，但不再据此否认已经采用的浏览器链。

#### 2026-07-17 v15 免费 PDF、认证与双模型增量证据

- 免费 `pypdfium2==5.8.0` Worker 替代当前环境整体挂起的 Poppler，文本 PDF 页图/文本抽取与无文本层扫描 PDF 渲染通过目标用例，随后 `tsc --noEmit` 和 Next.js 81/81 build 通过。真实 PDF 的 Preview 上传—预览—锚点—导出—阅读器闭环仍未完成。
- 认证查询增加 8 秒边界并区分依赖故障与身份失败：前者返回 503，缺失、过期或查无 token 仍返回 401；上传页显示结构化服务端错误。认证包装器的 try/catch 已与业务 handler 分离，业务异常不再被改写成 401 或匿名重跑；多文件上传完成回调改用唯一同步游标，关闭第二个文件被旧闭包重复创建/上传的循环。四个目标测试文件 31/31、typecheck 与 build 通过，Preview 浏览器复验待补。
- Qwen3.5-9B 与 Gemma-4-E4B 直接使用机器已有权重顺序调用，无下载、账号、API Key 或费用。两者对同一三条款样本均返回闭合 JSON、3 条逐字源文引用和非空 token；证据位于 `output/evidence/g5-v12/local-model-dual-probe-20260717.md`。这不是 Preview `evidence_saved` probe、`model_invocations` 或 ReviewRun，不能进入审核精确度结论。

#### 2026-07-17 v16 上传会话与 Preview runtime fixture

- 三个合同上传入口已统一到 4MiB 分片/50MiB 总量协议；每次运行绑定 UUID upload session 与整文件 SHA-256，服务器校验安全整数、精确边界、块数、块长和最终摘要。正式 Storage 对象及合同记录均成功前不删除临时块；创建等待期双击、末项不进入终态、失败后删当前项复用旧合同、确定性 4xx 重试和暂停被回写为失败均已关闭。专项 6 文件/36 用例、`tsc --noEmit` 与 Next.js 81/81 build 通过；真实 Preview 双文件与 PDF 浏览器链仍待复验。
- 隔离 Preview 已有 3 个 PUBLISHED config、1 个 current model policy 和 1 个明确 `not_release_eligible` 的 current bundle。两个 Provider 均指向本机 `127.0.0.1:12345`，bundle 的规则/规则集/文档/模板快照均为 0；19:00 实时 SQL 中 `model_invocations=0`、ReviewRun=0。因此它只证明本机应用连接 Preview 时所需的运行解析夹具已就绪，不证明托管 Preview 可访问本地模型、模型已运行、规则可发布或审核准确。证据位于 `output/evidence/g5-v12/preview-runtime-fixture-20260717.md`。

#### 2026-07-17 v17 受控 Word、双模型与源身份闭环（覆盖 v16 的零调用状态）

- 受控 DOCX 经真实 create/chunk/merge API 进入 Preview 合同 `6603fd5c-8d6d-4267-9e66-bee8b1e0235f`。系统从源 OOXML 当前正文提取 53 字，保留 `30 天 / 12 个月 / SLA`，排除删除修订中的 `120 天 / 24 个月`；旧直传路径固定返回 `410 / CHUNK_UPLOAD_REQUIRED`。
- Qwen ReviewRun `c29bd4e1-5979-41b7-8f89-cde001667fa6` 为 328/201/529 tokens、8.856 秒、1 条逐字 SLA 风险；Gemma ReviewRun `bcfa78dd-6497-440e-8065-b0c3a3e657e9` 为 337/1528/1865 tokens、34.710 秒、3 条合理逐字风险。两者均 completed、`degraded=false`、直接绑定各自 job/invocation，并共享相同 source/source-text hash。两个真实 provider probe 均为 `evidence_saved=true / runtime_config_match=true / tokens>0`。
- 同一实际审核页在桌面 1440×900 与 iPad 1180×820 显示 2 个插入、2 个删除、1 条既有批注和 3 条 Gemma 风险，无横向溢出、alert 或 console error。截图位于 `output/evidence/g5-v12/controlled-word-review-desktop-20260717.png` 与 `controlled-word-review-ipad-20260717.png`。
- Preview 迁移 `20260717202000_fence_contract_page_map_source.sql` 拒绝陈旧 storage path、陈旧 source-text hash 和源替换并发中的旧 page-map 写入；无死锁，current-source upsert 成功，fixture residue=0。目标 Word/upload 测试 7 文件/40 用例、source-render 8/8、`tsc --noEmit` 与 Next.js 81/81 build 通过。
- 真实 `/contracts/upload` 两文件队列恰好产生 2 次 create、2 次 chunk 与 2 次 merge，使用两个独立合同并只跳转到第二个审核页；两行 parsed text 均非空，浏览器阶段无 console error。证据截图为 `output/evidence/g5-v12/two-file-upload-queue-desktop-20260717.png`；测试合同、正式对象和临时块清理后残留均为 0。
- 全链零新增费用：Preview 报价为 0 美元/月，未注册付费账号、未购买服务、未下载新模型。v19 已执行真实可审计精度门禁并得到 NO-GO；本条当时记录的桌面原文缺口已由 v20 source-only canary 关闭，其余规则、盲测、决策/复审、当前输出 Word GUI 和 Production 门禁继续由 v21 更新。

#### 2026-07-17 v18 DOCM、文本 PDF、扫描 PDF 文件矩阵

- 固定 DOCM、8 页文本 PDF 和 1 页无文本层扫描 PDF 均通过真实 Preview create/chunk/merge、源 SHA/text SHA/page-map 绑定及桌面/iPad 审核页。
- DOCM 输出含 1 条原生批注，3 个 VBA parts 与源逐项同哈希；文本 PDF 保留 8/8 页并新增 `/Highlight + /Text`；扫描 PDF 保持原图像流并新增 1 个 `/Highlight`、2 个 `/Text`。macOS Preview 显示完整中文批注，LibreOffice 26.2.4.2 成功读取 DOCM。
- Python 3.14 的 `lxml.etree` 导入阻塞与 dev hot-reload 被确认是 60 秒假慢来源；换到免费 Python 3.11 production-mode 后 DOCM/扫描 PDF API 导出约 1.95/2.05 秒。Preview 数据库、正式对象、临时块和 token 残留均为 0。
- DOCM 当前批注是 service-role 文件引擎 fixture，不是完整法律决策链；Word 本机应用卡在 `_dyld_start`，当前输出 Word GUI 验收保持未完成。完整证据见 `output/evidence/g5-v12/preview-file-matrix-20260717.md`。

#### 2026-07-18 v19 精度门禁、输出不变量与清理

- Preview 性能迁移 `20260718023000_optimize_frozen_chunk_anchor_validation.sql` 保持 UTF-16/frozen-source fail closed；49 次 helper 为 17.612ms，49 条完整 stage 为 1483.046ms，混入伪造 source hash 时以 `23514` 整批拒绝。
- 最终零成本 Qwen 回归完成 11/11 invocation、50,702 tokens、ReviewRun/Job、冻结 bundle/policy 和 chunk/source 身份审计；结构诊断 `unbound/unlocated/invalid binding/source mismatch/duplicate/failed/skipped` 全为 0。v3 scorer 得到 TP42/FP4/FN3、P=.913/R=.933/F1=.923、anchor=1，但 severity=.833、negative specificity=.40、R004 recall=.60，`release_acceptance=false`。
- 普通直审与决策复审统一输出不变量：只有 red/yellow 可物化为客户风险卡，green/white 不进入待处理风险。目标单测 26/26、typecheck 和 Preview-bound Next.js 81/81 build 通过；该确定性修复不追溯修改已归档基准分数。
- 桌面 1440×900 与 iPad 1180×820 均显示 46/46 风险且无 body 横向溢出；iPad 显示真实第一页，桌面 `PAGE-01-ANCHOR-01` 在 60 秒边界内未出现，桌面源阅读器门禁保持未通过。截图为 `output/playwright/g5-review-ui/final-qwen-v22-desktop.png`（加载态）与 `final-qwen-v22-ipad.png`（真实第一页）。
- 6 个 50 页基准合同、6 ReviewRun/job/page-map、57 invocation、95 risk、6 个正式 Storage 对象和测试 token 已精确清理，目标计数均为 0；v21 SkillBundle、model policy、15 个规则快照与 13 个规则集快照完整保留。Production 未写、未 push、未部署。
- 禁止再跑同一已看过的重复合成 fixture。下一阶段必须发布新不可变规则包，补 conflict/specificity/default-unknown 机器字段，由确定性 adjudicator 生成等级，再以全新人工标注真实合同盲测小集验收。

#### 2026-07-18 v20 原文 canary 与确定性裁决底座

- 免费隔离 Preview 的 source-only canary 已关闭 v19 的桌面原文加载疑点：桌面 `1440×900` 与 iPad `1180×820` 均进入 `ready`，完整显示 50 个 section 并命中第 1/50 页锚点；根页面无横向溢出、无意外请求失败。该 canary 不调用模型、不产生费用，合同、Storage、page-map、token 与关联数据清理后残留为 0。
- 浏览器证据为 `output/evidence/g5-v12/g5-source-only-canary-browser-20260718.json`，配套桌面/iPad 截图位于 `output/playwright/g5-review-ui/g5-source-only-canary-*-20260718.png`；JSON、桌面图、iPad 图的 SHA-256 分别以 `451337ae`、`cad2e275`、`2b652808` 开头。它只验收源文件加载/页式可达，不替代审核精度证据。
- 确定性 adjudicator 与两份 Preview 迁移 `20260718040000_add_deterministic_adjudication_candidate_bundle.sql`、`20260718041000_bind_adjudication_trace_to_frozen_review.sql` 已验证；测试候选包与 trace 残留为 0，v21 bundle、model policy、15 个规则快照与 13 个规则集快照保持不变，Production 未写。
- 15 条 v21 规则只读审计确认：当前规则说明不能直接发布为机器合同。后续事实抽取必须输出有类型、可审计的事实；裁决仅使用白名单算子和互斥 A/B/C 包络，unknown 显式降级；R004 区间边界、R007/R013 特异性冲突和 R015 unknown 是首批必须由产品真相审核的规则缺口。
- G5 仍为 `NO-GO`。下一最小批次是事实抽取 runtime，再形成经产品真相审核的新不可变候选，最后使用全新人工标注真实合同小集盲测。不得重跑旧 fixture、直接发布审计草案、进入 G6、push 或部署 Production。

#### 2026-07-18 v21 facts_v1 本地底座与冻结溯源

- facts_v1 与 legacy risk 输出已显式隔离。模型只输出规则代码、逐字原文和类型化 facts；每个冻结 chunk 必须为每条冻结规则提交 `observed / not_observed / uncertain` coverage，不能输出 severity、标题、建议或物化 ID。
- 服务端已实现冻结 source/chunk 校验、完整唯一 `1..N` 合并、重叠去重、事实冲突整文拒绝、文档级 coverage 和确定性 A/B/C/unknown/冲突裁决。独立 provider path 强制完整运行身份、精确 invocation ID 与非零 token，但尚未被真实 ReviewRun worker 调用。
- Preview 的 042/043 迁移已动态验收：trace 为 1-based、service_role 仅可 SELECT/INSERT 且不能改删；criteria hash 由 PostgreSQL 生成；published rule/rule-set snapshot 和 bundle 内容不可变，仅 `is_current/updated_at` 指针字段可更新。事务内破坏演练整体回滚，probe/candidate channel/trace 残留均为 0，v21 legacy bundle 及 15+13 快照保持不变。
- 目标测试 6 文件 98/98、`tsc --noEmit` 和隔离 Next.js 14.2.35 build 81/81 通过。该结果不等于 facts-only ReviewRun、真实 provider、候选规则包或精度门禁已完成；本版当时记录的原子 trace/coverage staging 已由 v22 关闭，15 条事实合同与全新真实合同盲测仍未完成。G5 继续 `NO-GO`，Production 未改，不得进入 G6、push 或部署。

#### 2026-07-18 v22 facts_v1 原子证据 staging 与下一产品阻断

- `facts_v1` 在 invocation 成功前按冻结 schema 校验，并冻结事实对象、规则目录指纹和全量 chunk invocation 身份；trace 生成前重算候选/criteria 指纹并重放确定性裁决。提交、直接 Worker、决策 Worker 在风险物化链未完成前均 fail closed，禁止静默走 legacy。
- Preview 044 增加 append-only fact run、chunk、逐规则 coverage 与原子 service-role-only staging RPC；成功、精确幂等、错误租约、零 token、错误 raw hash、不完整 coverage、两 chunk 无候选、不可变性和资产删除负向演练全部完成并回滚，审计/候选/fixture 残留为 0。045 补齐三组复合外键覆盖索引，顾问复查无新增安全 WARN、无缺失外键索引。
- staging 明确不创建风险卡、不完成 ReviewRun、不发布或切换 bundle。当前 15 条 legacy 规则仍需按产品真相拆成可观测事实、整文缺失证据和外部事实；缺失条款不能通过伪造原文引用物化。下一批先关闭该合同，再接 candidate-start Worker、风险物化/ReviewRun 完成和全新真实合同盲测。
- 专项目标测试 4 文件 57/57、`tsc --noEmit` 与隔离 Next.js 14.2.35 build 81/81 通过。本批无模型调用、无账号注册、无购买和持续费用；Production 未改，不得进入 G6、push 或部署。

##### v22.1 文档级证据合同（候选前必须确认）

facts runtime 必须先陈述“拥有什么证据”，再由冻结规则决定是否构成风险。三种证据不可互相冒充：

| 证据类型 | 可审计依据 | 工作台与导出规则 |
|---|---|---|
| `source_span_candidates` | 当前冻结 source 中唯一逐字原文、位置、chunk/hash、invocation 与 facts | 可直接定位、高亮，并在通过用户决策后写入原生批注 |
| `complete_not_observed_coverage` | 完整 `1..N` 分块均执行且该规则全部为 `not_observed` | 只证明“本轮全文未观察到”，不自动等于法律缺失；规则明确声明缺失有风险时才形成文档级待办。不得伪造 source quote；用户选择插入点/段落或 PDF 点位前不得导出原生批注 |
| `uncertain_coverage` | 至少一个分块为 `uncertain`，且没有可用原文候选 | 只能进入待人工核验，不得输出红线断言或伪造锚点 |

15 条 v21 规则的推荐证据口径如下；这是产品真相审核草案，不是已发布法律规则：

| 规则 | 推荐模式 | 全文未观察到时的推荐动作 | 仍需确认的核心语义 |
|---|---|---|---|
| R001 付款节奏 | 原文 | 黄灯人工核验 | 缺付款安排是否本身构成风险；多阶段比例与尾款账期如何组合 |
| R002 终止退款 | 原文 | 不自动出卡 | “未消耗款项”与利息条件需同时判定 |
| R003 税率 | 原文 + 全文缺失 | 红灯候选 | 产品/服务类型与 6%/13%/混合分项的映射必须冻结 |
| R004 默示验收期 | 原文 | 黄灯人工核验 | 16–30 工作日空档；完全未写默示验收是否等同取消 |
| R005 验收不通过 | 原文 | 黄灯人工核验 | 整改次数、解除、退款和间接损失需拆成组合事实 |
| R006 违约金 | 原文 | 黄灯人工核验 | 乙方/甲方、单日费率、总上限及“违约金+实损”不可混为单阈值 |
| R007 间接损失 | 原文 + 全文缺失 | 黄灯文档级待办 | 规则已明确“未提及”为 B；人工定位前不导出批注 |
| R008 责任上限 | 原文 + 全文缺失 | 红灯文档级待办 | 双向/单向与百分比必须分别判定；无 Cap 已明确为红线 |
| R009 保密期 | 原文 | 黄灯人工核验 | 商业秘密永久保护需与普通保密永久期分开 |
| R010 主体·收款·金额 | 原文 + 外部对照 | 缺外部真相则黄灯核验 | 正确主体、官方账户、报价单/附件与模板版本必须有独立权威来源 |
| R011 IP 归属 | 原文 | 黄灯人工核验 | 产品 IP、二次开发、源码交付、转售/转让需拆开 |
| R012 数据安全 | 原文 + 外部对照 + 条件缺失 | 缺地域/主体/DPA 真相则黄灯核验 | 境内客户不得因缺 DPA 自动出风险；跨境、境外主体和个信处理条件需同时满足 |
| R013 SLA | 原文 + 产品形态 | 不自动出卡 | 公有云/私有部署、99.5/99.9、赔偿基数和 7×24 的冲突/特异性 |
| R014 续约 | 原文 | 不自动出卡 | 自动续期通知期、退出权、涨幅和永久锁价需拆开 |
| R015 争议解决 | 原文 | 黄灯人工核验 | 仲裁/法院、城市、适用法律三轴及未约定时的默认动作 |

本批推荐并锁定的通用产品行为是：缺失型发现先显示为“文档级待办”，不是伪造的原文风险；外部事实未提供时保持“待核验”，不是红线结论。只有规则自身的 A/B/C 业务阈值需要产品/法务确认，技术层不再为这些基础交互逐项请示。

#### 2026-07-18 v23 文档级裁决证据与 Worker 接缝

- `absence_decision` 已成为 Preview candidate 每条冻结规则的必填合同，只有 `ignore / yellow_review / red_risk` 三种合法值。`source_span_candidates` 仍按逐字原文裁决；`uncertain_coverage` 固定进入黄灯人工核验；`complete_not_observed_coverage` 只按冻结缺失语义裁决。三类证据不互相冒充，文档级待办不生成伪造原文或锚点。
- Preview 050 增加 append-only document run 与逐规则 adjudication outcome，并以规则目录、coverage 和最终裁决 hash 证明整文裁决确实执行过，0 outcome 也必须有 run header。`stage_contract_review_facts_v2` 在同一事务内写入 facts 证据和整文裁决，但明确不创建风险卡、不完成 ReviewRun；旧 v1 RPC 已从执行面撤销，匿名和登录用户也不能直接读写审计表。
- 050 的第一版把 raw candidate 数与去重后的 trace 数误设为相等，这会拒绝重叠 chunk 中合法的相同事实。Preview 接入 Worker 前已发现并以 051 向前修复，保留 observed/unobserved 与 source trace 的规则级不变量，没有篡改迁移历史。最终 Preview 的 fact/document/candidate 数据均为 0，v1 不可执行、v2 仅 service role 可执行，安全顾问无新增 WARN。
- Worker helper 已能在同一租约下完成 facts-only provider 调用、全 chunk 确定性合并、source trace/document outcome 构建、v2 staging 与 receipt 数量/状态对账。它暂不接入直接执行分支，因为当前 v2 是非终态；若 staging 后没有风险物化和 ReviewRun 完成，任务会遗留 running 并在重试时产生重复 invocation、冲突和不必要费用。直接分支因此继续 fail closed，而不是制造看似推进的半链路。
- 目标测试 5 文件 106/106、`tsc --noEmit` 和隔离 Next.js 14.2.35 build 81/81 通过；本批无模型调用、账号注册、购买或持续费用，Production 未修改。下一步只剩一个产品语义批次：按上表确认 15 条规则的类型化 facts、A/B/C 阈值及缺失/外部事实输出，再连续实现风险物化、ReviewRun 完成、非 current Preview 候选和全新真实合同盲测。

### Phase 3: G6 文档比对闭环（Preview 候选验收完成，Production 由 G9 复验）

产品结果是“上传旧/新原文件，在浏览器中高还原对照并定位真实差异，下载一份可审计报告”，不是在线 Office 编辑器，也不是把当前可变文本放进两个卡片。

- [x] 旧文件/新文件上传和替换入口绑定明确文件角色；比较创建事务冻结两侧组织、合同、存储路径、文件名、MIME、大小、文件 SHA-256、文本 SHA-256、解析文本、渲染模式与页映射
- [x] 历史比较只读取创建时快照；合同当前源、文本或 page-map 后续变化不得使结果漂移，快照不可 UPDATE/DELETE
- [x] 比较详情、旧/新源文件、页图与报告均经过组织边界校验；匿名/登录角色不可绕过服务端直接读取快照表
- [x] DOCX/DOCM 使用 G5 的浏览器 OOXML 高还原预览；PDF 使用应用可控页图，不以 iframe 冒充缩放、同步滚动和定位能力
- [x] 双栏旧/新角色清楚，支持 60%-180% 缩放、适宽、独立滚动/比例同步滚动切换，以及首尾差异双侧跳转
- [x] 差异算法对重复、移动、增删改文本有确定性正/负向测试；每条可见和可导出差异都绑定旧/新原文与页/段/offset/locator，不按数组序号猜配对
- [x] 文本 PDF 进入完整差异链；扫描 PDF 无可靠文本层时可高还原预览但明确降级，禁止伪造差异或报告
- [x] 导出真实 DOCX 差异报告，包含 comparison ID、旧/新文件身份与 SHA、完成时间、统计和逐项双侧原文/位置；身份或位置缺失时返回明确 409
- [x] 只选择性复用 Wave3 的查看器数学/布局和 R7 的源身份思想；不整分支合并，不引入 CSPP/WOPI、WPS WebOffice、OnlyOffice 或持续付费依赖
- [x] 免费隔离 Preview、目标测试、typecheck/build、桌面 1440×1000、iPad 1180×820、全新真实 DOCX/文本 PDF、报告独立阅读器验收全部通过；Production 继续只读，不 push/deploy

#### 2026-07-18 G6 Preview 候选验收证据

- 免费 Preview `vsfropnfsmnonkotywsx` 已应用三批 G6 forward migration；创建 RPC 以 active user + `user_organizations` 成员关系校验组织，不再把 `users.org_id` 当作唯一组织事实。事务探针通过合法第二组织成员路径、伪造源文本/SHA/冻结路径、伪造差异范围、快照/差异/父记录不可变、旧版直写和无文本层降级，并在 ROLLBACK 后留下 0 comparison/diff/source。
- 真实 Preview 链使用两份 DOCX 和两份文本 PDF：DOCX 识别 6 处差异，PDF 识别 4 处；当前合同文本在冻结后被改写，历史对比投影仍保持不变。桌面 `1440×1000` 与 iPad `1180×820` 均完成 60%-180% 缩放、适宽、独立/同步滚动与首尾差异跳转。
- 两份真实 DOCX 报告均通过 OOXML ZIP 回读和 LibreOffice 独立渲染逐页复核，报告 SHA-256 分别为 `168d8d099ebf6482bdc05da0283cc924e28ecb4925f420f1271ec025d9b17b45` 与 `a70317a19c50b79c472d6d4b5fe080e668481fb5ba6fa88656750223ceb2af0`。
- G6 目标测试为 9 文件/55 用例，`tsc --noEmit --incremental false` 与 Preview 环境 Next.js 81/81 build 通过。浏览器业务 API、request、HTTP 与 console 阻断项均为 0；只有本地 `next start` 下两个 Vercel 观测脚本 404 被精确列为 non-blocking，Production 不适用该豁免。
- 验收合同、comparison/diff/source、临时 token 和 8 个 Storage 对象已按 manifest 精确清理为 0，三道不可变 guard 仍启用。总证据位于 `product-code/output/evidence/g6/preview-browser-acceptance.json`，清理复核位于 `product-code/output/evidence/g6/preview-browser-cleanup-verification.json`，桌面/iPad 截图位于 `product-code/output/playwright/g6/`。
- 本批无付费账号、无按月或按量依赖，组织套餐为 Free；Production 未写，未 push、未创建 PR、未部署。G6 因此关闭为“可审计 Preview 产品线候选”，不是 Production 已发布声明。

### Phase 4: 策略配置中心 (2 周) ✅ 已完成
- [x] 规则原子化编辑（属性化列存储）
- [x] Level A/B/C 阈值配置 UI
- [x] 版本管理（发布/回滚）
- [x] 策略配置中心页面

### Phase 5: 集成与优化 (1 周) ✅ 已完成
- [x] Normalizer（归一化组件）
- [x] Auditor（确定性审计引擎）
- [x] 属性化规则存储（SQL迁移）

---

## 8. 验收标准

| 编号 | 场景 | 验收标准 |
|------|------|---------|
| TC-01 | 销售进入首页 | 看到金刚区 3 入口 + 4 项资产看板 + 最近任务列表 |
| TC-02 | 销售 AI 起草合同 | 左侧配置参数 → 右侧实时预览 → AI 对话增补 → 生成合同 |
| TC-03 | 销售处理审核风险 | 左侧选择风险 → 中栏定位页码/原文 → 右栏选择谈判策略、填写客户反馈或要求特批 → 草稿无刷新保存 |
| TC-04 | 销售比对文档 | 上传明确旧/新角色的 2 份真实文档 → 冻结双侧源身份/SHA → 高还原预览 → 缩放、独立/同步滚动与双侧差异定位 → 下载带双侧原文/位置/SHA 的真实 DOCX 报告 |
| TC-05 | 管理员配置规则 | 创建规则 → 设置 Level A/B/C → 模拟测试 → 保存即生效 |
| TC-06 | 规则版本管理 | 修改规则 → 生成新版本 → 查看影响分析 → 回滚 |
| TC-07 | CRM 联动 | 起草时选择报价单 → 自动带入客户/产品/金额 |
| TC-08 | AI 对话 | 在审核页输入问题 → AI 引用合同条款回答 |
| TC-09 | 批量提交与源文件交付 | 汇总草稿结论 → 冲突检查 → 新 ReviewRun 复审 → 客户侧预览不泄漏内部字段 → 从源文件副本生成 DOCX/DOCM/PDF 原生批注版；DOC 明确要求另存为 DOCX |
| TC-11 | 长合同定位 | 点击任意风险后在同一操作内完成页码定位、原文高亮与策略切换；50 页合同不需要人工翻页寻找证据 |
| TC-12 | iPad 审核 | 风险导航可收起，源文件与策略轨道保持并行可见；关键操作不掉到正文下方 |
| TC-13 | 扫描 PDF 批注 | 有文本层时可文本定位；无文本层或 OCR 失败时可框选区域/放置批注钉；导出 PDF 在阅读器中显示标准批注 |
| TC-14 | Word 文件族 | DOCX、DOCM、DOC 均可提审并高还原预览；已有修订/批注可见；DOCX/DOCM 导出保留既有内容并新增 AI 批注，DOCM 宏从未执行且资产一致；DOC 导出明确要求另存为 DOCX |
| TC-15 | 冻结规则溯源 | 审核后发布新规则包，旧 ReviewRun 仍使用自身冻结版本展示和提交；历史包缺失时显式停止，不改用当前包 |
| TC-16 | 原文锚点真实性 | description/title/suggestion 即使在别处唯一命中也不生成锚点；只有唯一 `source_quote` 得到 exact anchor，含 emoji 的 UTF-16 offset 仍与浏览器一致 |
| TC-17 | 并发保存与提交 | 两标签页同时保存单项草稿和批量提交时无死锁、无部分批次；旧版本只返回 409，不覆盖新结果 |
| TC-10 | 权限控制 | 销售看不到配置中心；法务只能看到自己组织的规则 |
