# F005v2 - ONES Contract Center 合同中心 V2

**REQ ID**: F005v2
**Status**: design_confirmed
**Based on**: F005-derive.md + 合同中心 PRD (2026-06-18) + 架构评审 (Tier 1-4)
**Upstream**: `product-truth/03-design-truth/合同中心/` 原型文件
**Target Phase**: Phase 1-5 全部完成

> **本文档是 F005 的 V2 升级版本**，基于合同中心 PRD 和 7 个原型文件，重构现有合同中心。
> **架构评审结论**: 45/100 → 通过阻塞项补齐后满足 Tier 1-4 要求

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
| **三段式审核** | 左摘要导航 / 中原文批注 / 右风险卡片 |
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
  ├─ 三段式布局
  ├─ 查看风险卡片
  ├─ 与 AI 对话咨询
  └─ 点击「一键修复」采纳建议
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

**布局：三段式（左摘要 / 中原文 / 右风险）**

```
┌──────────┬────────────────────┬────────────────────────────┐
│ AI 摘要   │ 合同正文            │ 风险卡片                    │
│          │                    │                            │
│ 🏢 签约主体 │ [原文] 第二条      │ ┌────────────────────────┐ │
│ 甲方:卧安  │ 费用与结算         │ │ 🔴 风险等级: 偏离        │ │
│ 乙方:复临  │                    │ │ 位置: 第2条              │ │
│            │ (高亮风险段落)     │ │ 描述: 付款条款偏离策略   │ │
│ 💰 交易核心 │                    │ │ 建议: 调整为 30% 以上    │ │
│ 总计:¥118k │ [原文] 第三条      │ │ [采纳建议]               │ │
│ 结算:3-4-3 │ 知识产权保护       │ └────────────────────────┘ │
│            │                    │                            │
│ ⚠️ 关键风险 │ [原文] 第七条      │ ┌────────────────────────┐ │
│ 🔴 违约缺失 │ 违约责任           │ │ 🟡 风险等级: 注意        │ │
│ 🟡 账期偏离 │                    │ │ 位置: 第7条              │ │
│            │                    │ │ ...                     │ │
│ 🤖 AI 助手 │                    │ └────────────────────────┘ │
│ [输入问题] │                    │                            │
└──────────┴────────────────────┴────────────────────────────┘
```

**组件清单：**
- `AIExtractPanel` — 左侧摘要面板（签约主体/交易核心/关键风险）
- `ContractPreview` — 中间原文预览（带批注高亮）
- `RiskCardPanel` — 右侧风险卡片列表
- `RiskCard` — 单条风险卡片（等级/描述/建议/采纳按钮）
- `AIChatSidebar` — AI 合同助理对话面板
- `AutoFixButton` — 一键修复按钮

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

## 7. 实施计划

### Phase 1: 首页 + 起草 UI (2 周) ✅ 已完成
- [x] 合同中心首页（金刚区 + 资产看板 + 任务流）
- [x] 智能起草页面（参数配置 + 实时预览）
- [x] 合同草稿数据模型
- [x] API: 草稿 CRUD、AI 生成

### Phase 2: 风险审核重构 (2 周) ✅ 已完成
- [x] 三段式审核布局（左摘要/中原文/右风险）
- [x] 风险卡片组件 + 一键修复
- [x] AI 对话面板
- [x] 风险卡片数据模型

### Phase 3: 文档比对 (1 周) ✅ 已完成
- [x] 比对任务数据模型
- [x] 比对 API（占位实现）
- [x] 双栏对比 UI 框架

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
| TC-03 | 法务审核合同 | 三段式布局 → 查看风险卡片 → 一键采纳建议 → 状态更新 |
| TC-04 | 销售比对文档 | 上传 2 份文档 → 查看语义对齐差异 → 查看 AI 解读 |
| TC-05 | 管理员配置规则 | 创建规则 → 设置 Level A/B/C → 模拟测试 → 保存即生效 |
| TC-06 | 规则版本管理 | 修改规则 → 生成新版本 → 查看影响分析 → 回滚 |
| TC-07 | CRM 联动 | 起草时选择报价单 → 自动带入客户/产品/金额 |
| TC-08 | AI 对话 | 在审核页输入问题 → AI 引用合同条款回答 |
| TC-09 | 一键修复 | 点击风险卡片「采纳」→ 合同文本自动更新 |
| TC-10 | 权限控制 | 销售看不到配置中心；法务只能看到自己组织的规则 |
