# F005v2 - 合同中心第一阶段业务骨架

**REQ ID**: F005 / F005v2
**Status**: confirmed
**Based on**: `PROJECT-主文档.md#第5章：合同审核（核心）` + F005 历史派生文档 + 合同中心原型
**Upstream**: `product-truth/03-design-truth/合同中心/` 原型文件
**Target Phase**: 第一阶段商业产品业务骨架，不代表终版商业产品

> **本文档是 F005 的研发执行真相。**
> 合同中心不是单线程“上传 -> 审核 -> 报告”页面，而是合同版本、审核运行、风险处理、销售谈判、客户反馈、批注输出和审计复盘共同组成的工作台。
>
> 旧原型和旧派生文档可作为视觉与历史资产，但不得覆盖本文档定义的对象边界、状态流和研发验收。

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

## 0. 第一阶段产品口径

### 0.1 本阶段目标

第一阶段要建立可继续迭代的合同审核业务骨架：

```
合同版本
  -> ReviewRun
  -> RiskFinding
  -> 人工复核 / 销售谈判 / 客户反馈
  -> Word 批注文件 + 审核报告
  -> 审计归档
```

同时消费外部控制面：

```
F009 已发布规则
  + 知识库模板/条款库
  + F012 模型策略
  -> F006 SkillBundle
  -> F005 ReviewRun
```

### 0.2 本阶段不做但必须预留

| 能力 | 本阶段处理 |
|------|------------|
| 客户门户 | 不实现门户，但 `CustomerFeedback` 必须能记录客户接受、拒绝、反建议 |
| 批量审核 | 不实现批量入口，但 `ReviewRun` 不能假设一份合同只有一次审核 |
| 复杂审批编排 | 不实现全量流程编排，但 `RiskFinding` 必须支持分派、升级、豁免 |
| 商业化套餐 | 不实现计费，但权限点和能力边界不能写死 |
| 历史学习闭环 | 不自动训练模型，但审核结果要能进入知识沉淀候选 |
| 多语言合同 | 不作为第一阶段验收，但模板和输出字段不应写死中文文案 |

### 0.3 不允许的实现取巧

- 不允许把合同审核主入口做成粘贴文本框。
- 不允许合同审核依据来自通用 prompt 自由判断。
- 不允许风险项只存在报告文本里。
- 不允许 Word 批注失败后静默当作成功。
- 不允许客户反馈和销售谈判被简化为“客户点同意/不同意”。
- 不允许把配置中心规则改动直接影响历史 ReviewRun。
- 不允许把 AI 模型配置写死在业务代码中。

---

## 1. 设计原则与约束

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **首页即工作台** | `/contracts` 是合同版本、待处理风险、谈判任务、输出文件和审计的工作入口 |
| **多流审核工作台** | 同时承载合同版本流、风险项流、复核流、谈判流、客户反馈流 |
| **批注为主，报告为辅** | 主产物是原文件新版本 + Word 原生批注；报告只做辅助、兜底、归档 |
| **规则/Skill 驱动** | 合同中心只消费 F006 SkillBundle，不直接实现通用审核逻辑 |
| **销售谈判纳入链路** | 必须谈判的风险项生成谈判任务，并给销售依据、话术、底线 |
| **配置消费边界** | F005 不维护规则和模型配置，只读取 F009/F012 已发布配置或快照 |
| **AI 可解释可追溯** | `ONES 业务运营` 只基于当前合同、规则、模板、证据和模型调用记录辅助 |

### 1.2 与现有系统的集成

| 现有系统 | 集成方式 |
|---------|---------|
| 报价中心 (F002) | 起草时关联报价单，自动带入客户/产品/金额 |
| 配置中心 (F009/F010) | 消费合同规则、税率规则、审批规则的已发布版本 |
| 组织架构 (F011) | 审批路由、权限控制 |
| 知识库 (F015-F017) | 审核时引用标准模板、条款库、案例和话术，并保存引用快照 |
| AI 运行时 (F012) | 消费模型配置、降级策略 |
| Skill 运行时 (F006) | 创建 ReviewRun 时绑定已发布 SkillBundle |

---

## 2. 用户角色与旅程

### 2.1 角色矩阵

| 角色 | 核心页面 | 职责 | 不能做什么 |
|------|---------|------|------------|
| **销售 Owner** | 合同工作台、风险任务、谈判区 | 上传合同、查看风险、处理谈判任务、记录客户反馈、下载批注文件 | 修改规则、修改模型策略 |
| **法务 Reviewer** | 审核工作台、风险复核、批注确认 | 复核风险、确认批注、决定豁免/升级、维护规则草案 | 直接覆盖历史 ReviewRun 依据 |
| **财务 Reviewer** | 风险任务 | 处理付款、税率、发票、收款相关风险 | 处理非财务规则归属 |
| **交付 Reviewer** | 风险任务 | 处理 SLA、交付、验收、售后相关风险 | 修改合同基础版本 |
| **销售经理/负责人** | 谈判升级、风险看板 | 处理销售谈判升级和让步边界 | 旁路关闭法务强制风险 |
| **管理员/法务运营** | 配置中心 | 发布规则、模板、Skill、模型策略 | 在合同工作台直接改配置 |
| **ONES 业务运营** | AI 辅助区 | 解释风险、生成谈判建议、辅助报告/批注 | 作为规则事实来源或自动最终决策 |

### 2.2 核心旅程与并发流

**旅程 A：销售发起合同审核，不是文本粘贴**
```
首页 (/contracts)
  ├─ 上传客户回传合同或选择已有合同版本
  ├─ 系统创建 ContractVersion
  ├─ 选择或自动匹配合同类型/模板/场景
  └─ 点击「发起审核」
    │
    ▼
创建 ReviewRun
  ├─ 绑定 ContractVersion
  ├─ 绑定 F006 SkillBundle
  ├─ 绑定 F009 RuleSnapshot
  ├─ 绑定 F012 ModelPolicy
  └─ 进入审核工作台
```

**旅程 B：风险项复核与分派**
```
ReviewRun 完成
  ├─ 生成 RiskFinding 列表
  ├─ 法务确认风险等级、证据、建议
  ├─ 财务/交付处理所属风险
  ├─ 必须谈判项生成 NegotiationTask
  └─ 可直接修改项生成 CommentPatch
```

**旅程 C：销售谈判与客户反馈**
```
NegotiationTask
  ├─ 销售查看风险依据、让步边界、建议话术
  ├─ 与客户谈判
  ├─ 记录客户反馈：接受 / 拒绝 / 反建议
  ├─ 客户回传新版本时创建 ContractVersion
  └─ 触发再审核或升级
```

**旅程 D：批注输出与归档**
```
风险项确认
  ├─ 生成 CommentPatch
  ├─ F007 写入 Word 原生批注
  ├─ 生成 AnnotatedDocument
  ├─ 同步生成 ReviewReport
  └─ 归档 ReviewRun 证据链
```

---

## 3. 页面设计

### 3.0 合同审核工作台信息架构

第一阶段页面必须围绕业务对象组织，不按单个“审核表单”组织。

| 区域 | 承载对象 | 用户动作 |
|------|----------|----------|
| 合同版本区 | `ContractVersion` | 上传、切换、查看原文件/客户回传版/批注版 |
| 原文与批注区 | `ContractVersion` + `CommentPatch` | 查看原文定位、批注意图、降级说明 |
| 风险队列 | `RiskFinding` | 复核、分派、关闭、升级、豁免 |
| 销售谈判区 | `NegotiationTask` | 查看谈判依据、记录客户反馈、发起再审核 |
| `ONES 业务运营` 辅助区 | 当前 ReviewRun 证据 | 解释风险、生成话术、生成报告摘要 |
| 输出区 | `AnnotatedDocument` + `ReviewReport` | 下载批注文件、下载报告、查看输出一致性 |
| 审计区 | `ReviewEvidence` | 查看规则快照、Skill、模型调用和处理人 |

`/admin/rule-review` 只能作为配置/沙箱类后台入口，不能作为合同审核产品主入口。

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

**布局：多流工作台（左任务与证据 / 中原文与批注 / 右风险与谈判）**

```
┌──────────────┬──────────────────────────────┬────────────────────────┐
│ ReviewRun证据 │ 原文 / 批注 / 版本             │ 风险 / 复核 / 谈判       │
│              │                              │                        │
│ 合同版本 V2   │ [原文] 第二条 费用与结算       │ 🔴 R001 付款节奏         │
│ Skill v4     │    [批注意图: 首款低于红线]    │ 负责人: 销售Owner        │
│ 规则快照 v12  │                              │ 状态: NEEDS_NEGOTIATION │
│ 模型策略 v3   │ [原文] 第七条 违约责任         │ [谈判依据] [客户反馈]    │
│              │                              │                        │
│ ONES业务运营  │ [批注版] [报告] [降级原因]      │ 🟡 R006 滞纳金偏离       │
│              │                              │ [复核] [关闭] [升级]     │
└──────────────┴──────────────────────────────┴────────────────────────┘
```

**组件清单：**
- `ReviewEvidencePanel` — 左侧证据面板（合同版本/规则快照/Skill/模型策略）
- `ContractPreview` — 中间原文预览（带批注高亮）
- `VersionSwitcher` — 合同版本切换（原文件/客户回传/批注版）
- `RiskCardPanel` — 右侧风险卡片列表
- `RiskCard` — 单条风险卡片（等级/证据/建议/责任人/状态）
- `NegotiationPanel` — 销售谈判依据、让步边界、客户反馈
- `ONESOpsAssistant` — `ONES 业务运营` 辅助解释与话术
- `OutputPanel` — 批注文件、报告、降级说明

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

### 4.0 第一阶段核心对象

本节给研发拆解对象边界，具体 SQL 可复用现有表或在迁移中补齐，不要求机械照抄字段名。

| 对象 | 必须字段/关系 | 说明 |
|------|---------------|------|
| `Contract` | `id`, `org_id`, `owner_id`, `source_type`, `current_version_id`, `status` | 合同业务主对象 |
| `ContractVersion` | `contract_id`, `version_no`, `file_path`, `parsed_text`, `source`, `parent_version_id` | 每次上传、客户回传、批注生成都形成版本 |
| `ReviewRun` | `contract_id`, `contract_version_id`, `skill_bundle_id`, `rule_snapshot_id`, `model_policy_id`, `status` | 一次审核运行；历史运行不得随配置变化漂移 |
| `RiskFinding` | `review_run_id`, `rule_id`, `rule_code`, `rule_version`, `evidence`, `owner_role`, `owner_id`, `status` | 风险项可分派、可复核、可谈判、可关闭 |
| `NegotiationTask` | `risk_finding_id`, `sales_owner_id`, `bottom_line`, `script`, `customer_feedback_status` | 必须谈判风险项的销售动作 |
| `CustomerFeedback` | `contract_version_id`, `risk_finding_id`, `feedback_type`, `content`, `next_action` | 客户接受/拒绝/反建议触发再审核或升级 |
| `ReviewEvidence` | `review_run_id`, `rule_snapshot`, `skill_snapshot`, `model_invocations`, `template_references` | 审计和复盘证据 |

现有 `contracts`, `contract_reviews`, `contract_risk_cards`, `contract_clauses`, `contract_annotations`, `contract_analysis_jobs` 等资产应优先复用；缺字段时通过迁移补齐，不另起一套平行系统。

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

### 4.3 智能风险审核

```sql
-- 已有: contract_reviews (扩展字段)
-- 新增: 风险卡片表

CREATE TABLE contract_risk_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  review_id UUID REFERENCES contract_reviews(id) ON DELETE CASCADE,
  
  -- 风险信息
  level TEXT NOT NULL CHECK (level IN ('red', 'yellow', 'green', 'white')),  -- white = 待补
  title TEXT NOT NULL,
  description TEXT,
  suggestion TEXT,                  -- 修复建议
  auto_fixable BOOLEAN DEFAULT false,  -- 是否支持一键修复
  fix_action JSONB,                 -- 一键修复的自动化动作
  
  -- 位置信息
  clause_ref TEXT,                  -- 关联条款编号, e.g. "第2条"
  position_start INTEGER,          -- 在原文中的起始位置
  position_end INTEGER,             -- 在原文中的结束位置
  
  -- 来源
  detected_by TEXT DEFAULT 'ai',    -- ai / rule / manual
  confidence DECIMAL(3,2),          -- AI 置信度
  
  -- 状态
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'accepted', 'ignored')),
  fixed_by UUID REFERENCES users(id),
  fixed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
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

> 所有权说明：本节保留旧合同中心原型中的策略配置资产清单，只作为 F009 的历史输入。第一阶段研发时，规则配置、发布、回滚、测试和规则快照归 `F009-contract-rule-config.md`；F005 只消费 F006 发布的 SkillBundle 和风险事实。

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
| GET | `/api/contracts/:id/review` | 获取审核结果（风险卡片 + AI 摘要） | contract:review |
| GET | `/api/contracts/:id/risk-cards` | 获取风险卡片列表 | contract:review |
| PATCH | `/api/contracts/:id/risk-cards/:cardId` | 更新风险卡片状态 | contract:review |
| POST | `/api/contracts/:id/risk-cards/:cardId/fix` | 一键修复 | contract:review |
| POST | `/api/contracts/:id/ai-chat` | AI 对话咨询 | contract:review |
| GET | `/api/contracts/:id/ai-chat` | 获取对话历史 | contract:review |

### 5.4 文档精准比对

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/contracts/:id/compare` | 发起比对 | contract:compare |
| GET | `/api/comparisons/:id` | 获取比对结果 | contract:compare |
| GET | `/api/comparisons/:id/diffs` | 获取差异列表 | contract:compare |
| GET | `/api/comparisons/:id/ai-summary` | AI 变更解读 | contract:compare |

### 5.5 策略配置中心

> 所有权说明：以下 API 归 F009/F006 拆解确认后实现。F005 合同中心不得直接提供规则修改入口。

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
| 风险审核 | `/contracts/:id/review` | `ContractReviewPage` | 三段式布局 |
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
    ├── ContractPreview.tsx    # 合同原文预览（带批注）
    ├── RiskCardPanel.tsx      # 风险卡片面板
    ├── RiskCard.tsx           # 单条风险卡片
    ├── AIChatSidebar.tsx      # AI 对话面板
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

## 7. 第一阶段实施计划

> 旧版 Phase 1-5 “已完成”只代表曾经存在页面或占位资产，不作为本阶段验收结论。

### Phase A: 业务骨架与数据绑定
- [ ] 合同中心首页改为工作台：合同版本、待处理风险、谈判任务、批注/报告输出
- [ ] `ContractVersion` 与现有合同上传、解析、客户回传、批注版本建立关系
- [ ] `ReviewRun` 绑定合同版本、F006 SkillBundle、F009 规则快照、F012 模型策略
- [ ] 风险卡片从展示文本升级为 `RiskFinding` 业务对象

### Phase B: 风险处理与销售谈判
- [ ] 风险项支持责任人、责任角色、状态、关闭/豁免/升级
- [ ] 必须谈判风险项生成 `NegotiationTask`
- [ ] `ONES 业务运营` 只能基于当前证据生成谈判建议和话术
- [ ] 支持记录客户反馈并触发再审核或升级

### Phase C: 批注输出与审计
- [ ] F007 返回的批注文件、报告和降级原因进入合同工作台
- [ ] 风险项、批注、报告使用同一 `RiskFinding` ID
- [ ] ReviewRun 证据链可查看：规则快照、Skill、模型调用、模板引用、处理人

### Phase D: 与配置中心/Skill/模型联调
- [ ] 合同中心不直接读取草稿规则，只读取已发布 SkillBundle
- [ ] 审核运行不允许使用无版本的通用 prompt
- [ ] 规则、模板、模型配置变化不影响历史 ReviewRun

---

## 8. 验收标准

| 编号 | 场景 | 验收标准 |
|------|------|---------|
| TC-01 | 销售上传合同 | 生成 `ContractVersion`，不是只保存文本；页面可查看当前版本 |
| TC-02 | 发起审核 | 创建 `ReviewRun`，并绑定合同版本、SkillBundle、规则快照、模型策略 |
| TC-03 | 风险生成 | 每个风险是 `RiskFinding`，带规则版本、证据、责任人、状态 |
| TC-04 | 法务复核 | 法务可确认、关闭、豁免、升级风险，操作写入审计 |
| TC-05 | 销售谈判 | 必须谈判风险生成任务，销售可查看依据/话术/底线并记录客户反馈 |
| TC-06 | 客户回传 | 客户反建议或新文件形成新 `ContractVersion`，可触发再审核 |
| TC-07 | 批注输出 | 可下载带 Word 原生批注的文件；批注和风险项 ID 一致 |
| TC-08 | 报告辅助 | 报告与批注使用同一审核事实；批注失败时展示降级原因 |
| TC-09 | `ONES 业务运营` | 回答和建议只引用当前合同、规则、模板、证据，不自由编造依据 |
| TC-10 | 历史追溯 | 历史 ReviewRun 显示当时的规则快照、Skill、模型策略和处理人 |
| TC-11 | 配置边界 | 合同中心没有修改规则和模型配置入口 |
