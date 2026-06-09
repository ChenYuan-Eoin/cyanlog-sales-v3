# OpenBidKit 深度调研报告 + Price-v3 对照分析

**调研时间**: 2026-06-09  
**调研范围**: client/electron/services/*, client/electron/ipc/*, task_plan.md, SQLite schema  
**调研深度**: 代码级（非README层面）

---

## 一、OpenBidKit 核心架构全景

### 1.1 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)                                    │
│  - 页面路由 /features/technical-plan/*                      │
│  - 状态管理：通过 IPC 调用 Main 层                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC（Electron）
┌──────────────────────▼──────────────────────────────────────┐
│  Main (Node.js)                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ IPC Layer          │  Service Layer                 │   │
│  │ - technicalPlanIpc │  - technicalPlanStore          │   │
│  │ - taskIpc          │  - taskService                 │   │
│  │ - knowledgeBaseIpc │  - contentGenerationTask       │   │
│  │ - ...              │  - aiService                   │   │
│  └────────────────────┴─────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ SQLite (better-sqlite3)
┌──────────────────────▼──────────────────────────────────────┐
│  Data Layer                                                 │
│  - technical_plan_meta (1行，当前状态)                      │
│  - technical_plan_tasks (多行，任务历史)                    │
│  - technical_plan_outline_nodes (目录树)                    │
│  - technical_plan_bid_items (招标解析项)                    │
│  - technical_plan_reference_docs (参考文档关联)             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 技术方案工作流（核心）

**6步工作流**（严格阶段推进）：

```
Step 1: document-analysis (招标文件解析)
   ├─ 导入 tender.md（招标文件）
   ├─ 导入 original-plan.md（如有，已有方案扩写模式）
   └─ 输出：markdown文本

Step 2: bid-analysis (招标项解析)
   ├─ 任务类型：key/full/custom
   ├─ 预置12个分析维度（项目信息、甲方、交付要求等）
   └─ 输出：结构化招标事实

Step 3: outline-generation (目录生成)
   ├─ 模式 A：aligned（严格对齐招标结构）
   ├─ 模式 B：free（自由编排）
   ├─ 支持拖拽排序
   └─ 输出：树形目录结构

Step 4: global-facts (全局事实设定)
   ├─ 用户录入全局变量（公司介绍、产品参数等）
   └─ 输出：全局事实表（用于正文变量替换）

Step 5: content-edit (正文编辑/生成)
   ├─ 子模式A：生成技术方案（从零生成）
   ├─ 子模式B：已有方案扩写（原方案还原+扩写）
   ├─ 并发控制：默认5个章节并行
   ├─ 支持插图/Mermaid图表
   └─ 输出：章节正文 + contentGenerationPlans

Step 6: expand (扩写/精修)
   └─ 字数扩充、一致性审计、原文覆盖审计
```

### 1.3 关键数据结构设计

#### SQLite Schema（精简核心）

```sql
-- 技术方案元数据（单行，当前工作区状态）
technical_plan_meta (
  workflow_kind TEXT,     -- 'technical-plan' | 'existing-plan-expansion'
  step TEXT,              -- 当前步骤
  bid_analysis_mode TEXT, -- 'key' | 'full' | 'custom'
  outline_mode TEXT,      -- 'aligned' | 'free'
  content_generation_options_json TEXT, -- 生成配置
  ...
);

-- 目录节点（树形结构）
technical_plan_outline_nodes (
  node_id TEXT PRIMARY KEY,
  parent_node_id TEXT,    -- 自引用，支持树形
  sort_order INTEGER,     -- 同级排序
  level INTEGER,          -- 层级
  title TEXT,
  content TEXT,           -- 正文内容
  knowledge_item_ids_json TEXT, -- 关联知识库素材
  source_requirement_id TEXT,   -- 溯源招标要求
  ...
);

-- 任务状态（支持中断恢复）
technical_plan_tasks (
  type TEXT PRIMARY KEY,  -- 'bid-analysis' | 'outline-generation' | ...
  status TEXT,            -- idle | running | success | error
  progress INTEGER,
  logs_json TEXT,         -- 执行日志
  pause_requested INTEGER -- 0 | 1，支持中断
);
```

#### 内容生成计划（核心设计）

```typescript
interface ContentGenerationPlan {
  node_id: string;
  section_number: string;
  title: string;
  
  // 生成模式
  mode: 'generate' | 'restore-then-optimize' | 'expand-word-count';
  
  // 原方案还原（模式B特有）
  original_material?: {
    source_ids: string[];      // 原方案段编号
    restored_content: string;  // 拼接后的原文
    optimized: boolean;        // 是否已优化
  };
  
  // 变量替换
  facts: string[];           // 用到的全局事实标题
  bid_analysis_facts: string[]; // 用到的招标分析项
  
  // 字数规划
  target_word_count: number;
  current_word_count: number;
}
```

### 1.4 任务系统设计

**任务定义元数据**（集中配置）：

```javascript
const taskDefinitions = {
  'bid-analysis': {
    label: '招标文件解析',
    group: 'technical-plan',
    step: 2,
    lockPolicy: 'group-exclusive',  // 排他锁
    stateKey: 'technicalPlan',
    field: 'bidAnalysisTask',
  },
  'content-generation': {
    label: '正文生成',
    group: 'technical-plan',
    step: 5,
    lockPolicy: 'group-exclusive',
    concurrency: 5,               // 并发数
  },
  // ...
};
```

**任务调度特性**：
- 支持中断（pause_requested）
- 支持恢复（检查 progress）
- 并发控制（content_generation 默认5个章节并行）
- 失败重试（Mermaid图表渲染3次尝试）

### 1.5 AI 集成设计

**Prompt 工程结构**：

```
系统指令
  ├─ 角色定义（技术方案撰写专家）
  ├─ 输出格式（Markdown + 图表要求）
  └─ 约束条件（字数、表格数量等）

上下文注入
  ├─ 招标文件相关章节
  ├─ 全局事实变量（resolveGlobalFactsByTitles）
  ├─ 招标分析事实（formatBidAnalysisFactsForPrompt）
  └─ 父章节上下文（保证连贯性）

章节专属
  ├─ 本章标题 + 描述
  ├─ 关联招标要求
  ├─ 选定知识库素材
  └─ 字数目标
```

**生成后处理**：
- Markdown 规范化（br 标签处理）
- Mermaid 渲染（ink 服务）
- 字数统计（countReadableWords）
- 一致性审计（章节间重复检测）

---

## 二、Price-v3 现有架构对照

### 2.1 现有能力盘点

| 模块 | 现状 | 与 OpenBidKit 对比 |
|------|------|-------------------|
| **AI_CONFIG** | 配置中心统一管理模型 | ✅ OpenBidKit 内置多模型，需要适配其配置结构 |
| **knowledge** | cases + documents + qualifications 三表 | ⚠️ OpenBidKit 是本地文件 + SQLite，需要设计云端化方案 |
| **contracts** | 合同审核 + Word导出 | ⚠️ 有文档解析(OCR)和导出，但无工作流引擎 |
| **quotes** | 报价单管理 | ✅ 商务标数据来源，OpenBidKit 无此模块 |
| **documents** | 通用文档管理 | ⚠️ 需要增强为「工作区文档」概念 |
| **configs** | 主题配置等 | ❌ 无技术方案相关配置 |

### 2.2 架构差异矩阵

| 维度 | OpenBidKit | Price-v3 | 迁移策略 |
|------|-----------|----------|---------|
| **部署** | Electron 桌面单机 | Next.js + Supabase 云端 | 完全重写部署层 |
| **存储** | SQLite + 本地文件 | PostgreSQL + Supabase Storage | 数据模型云端化 |
| **协作** | 单人 | 团队 RBAC | 全部表加 org_id |
| **状态** | 内存 + SQLite 实时 | React Query + Server State | 需要状态持久化设计 |
| **任务** | 本地进程 | Serverless/Vercel | 需要后台任务队列 |
| **AI调用** | 直接 HTTP | 通过 AI_CONFIG 配置代理 | 复用现有配置系统 |

### 2.3 不能直接复用的原因（详细）

#### 1. 工作流状态机（OpenBidKit 核心优势）

```javascript
// OpenBidKit 的工作流是 native 的
initialState = {
  workflowKind: 'technical-plan',
  step: 'document-analysis',
  // ...
}

// 状态切换有严格的业务规则
switchWorkflowKind(kind) {
  // 清空目录、全局事实、正文、保留招标文件和解析结果
}
```

**Price-v3 现状**：无工作流引擎，需要新建。

#### 2. 本地文件系统依赖

OpenBidKit 重度依赖：
- `userData/technical-plan/tender.md`（招标文件）
- `userData/technical-plan/original-plan.md`（原方案）
- `userData/images/`（插图缓存）

**Price-v3**：使用 Supabase Storage，需要重新设计文件管理。

#### 3. 后台任务中断恢复

```javascript
// OpenBidKit 支持中断
task = {
  status: 'running',
  pause_requested: 0,
  progress: 45,
}
// 可以随时中断，重新加载状态继续
```

**Price-v3**：Vercel Serverless 无法长时间运行，需要：
- 方案 A：使用 Supabase Background Tasks
- 方案 B：使用外部队列（Inngest/Trigger.dev）
- 方案 C：流式响应 + 前端轮询（简配版）

#### 4. SQLite 外键和事务

```sql
-- OpenBidKit 使用严格的外键约束
FOREIGN KEY (parent_node_id) 
REFERENCES technical_plan_outline_nodes(node_id) 
ON DELETE CASCADE
```

**Price-v3**：需要 careful 的 PostgreSQL 迁移。

---

## 三、可借鉴的设计（价值所在）

### 3.1 内容生成计划模式（强烈推荐）

```typescript
// 核心创新：分离规划与执行
interface ContentGenerationPlan {
  node_id: string;           // 目录节点
  mode: 'generate' | 'restore' | 'expand';
  facts: string[];           // 依赖的全局事实
  target_word_count: number;
  // ...
}

// 执行时按 plan 生成，支持
// - 单章重新生成
// - 批量并发生成
// - 中断后继续
```

### 3.2 全局事实变量系统

```typescript
// 全局事实：全文统一的变量
const globalFacts = [
  { title: '公司介绍', content: 'XXX科技有限公司成立于...' },
  { title: '核心产品参数', content: '处理能力 10000 TPS...' }
];

// 章节引用其中部分
const sectionFacts = ['公司介绍', '核心产品参数'];

// AI Prompt 中注入
const globalFactsText = formatGlobalFactsForPrompt(globalFacts);
// "全局事实变量（正文涉及时优先使用这些变量值，避免各章节随机变化）：..."
```

### 3.3 招标项分析预置模板

```javascript
// OpenBidKit 预置 12 个分析维度
const bidAnalysisTasks = [
  { id: 'projectInfo', label: '项目基本信息', required: true },
  { id: 'partAInfo', label: '甲方（招标人）信息', required: true },
  { id: 'deliveryRequirements', label: '交货和服务要求', required: false },
  // ...
];
```

### 3.4 目录-招标要求映射

```typescript
interface OutlineNode {
  title: string;
  source_requirement_id: string;    // 溯源到招标要求的章节
  source_requirement_title: string; // 原文标题（用于Prompt）
}
```

### 3.5 任务锁与并发控制

```javascript
// 排他锁设计
type LockPolicy = 'group-exclusive' | 'none';

// 正文生成：5个章节并发，但同组任务互斥
// 防止同时运行 内容生成 + 目录编辑
```

---

## 四、迁移实施策略

### 4.1 第一阶段：数据模型云端化

**核心表设计（Supabase）**：

```sql
-- 标书项目（对应 technical_plan_meta）
CREATE TABLE tender_projects (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  
  -- 工作流配置
  workflow_kind TEXT NOT NULL DEFAULT 'technical-bid', -- 'technical' | 'existing-plan'
  current_step TEXT NOT NULL DEFAULT 'document-import',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | generating | reviewing | completed
  
  -- 招标文件
  tender_document_id UUID REFERENCES documents(id),
  tender_parsed_content TEXT,
  
  -- 原方案（扩写模式）
  original_plan_document_id UUID REFERENCES documents(id),
  original_plan_parsed_content TEXT,
  
  -- 配置（JSON）
  bid_analysis_config JSONB DEFAULT '{}'::jsonb,
  outline_config JSONB DEFAULT '{}'::jsonb,
  content_generation_options JSONB DEFAULT '{}'::jsonb,
  global_facts JSONB DEFAULT '[]'::jsonb,
  
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 标书目录（对应 technical_plan_outline_nodes）
CREATE TABLE tender_sections (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES tender_projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES tender_sections(id) ON DELETE CASCADE,
  
  sort_order INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  
  title TEXT NOT NULL,
  description TEXT,
  
  -- 内容
  content TEXT DEFAULT '',
  content_status TEXT DEFAULT 'empty', -- empty | draft | ai_pending | approved
  
  -- 溯源
  source_requirement_id TEXT,
  source_requirement_title TEXT,
  
  -- 知识库引用（JSON数组）
  knowledge_refs JSONB DEFAULT '[]'::jsonb,
  
  -- 生成计划（快照）
  generation_plan JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 后台任务（对应 technical_plan_tasks）
CREATE TABLE tender_tasks (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES tender_projects(id) ON DELETE CASCADE,
  
  task_type TEXT NOT NULL, -- 'bid-analysis' | 'outline-generation' | 'content-generation'
  task_group TEXT NOT NULL, -- 'technical-bid' | 'rejection-check' | ...
  
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | success | error | paused
  progress INTEGER NOT NULL DEFAULT 0,
  
  -- 配置和结果
  config JSONB,
  result JSONB,
  error_message TEXT,
  logs JSONB DEFAULT '[]'::jsonb,
  
  -- 中断恢复
  checkpoint_data JSONB,
  
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 第二阶段：工作流引擎

**借鉴 OpenBidKit 状态机设计**：

```typescript
// lib/tender/workflow.ts
export const tenderWorkflow = {
  steps: [
    { id: 'document-import', label: '文档导入', next: 'bid-analysis', prev: null },
    { id: 'bid-analysis', label: '招标分析', next: 'outline-generation', prev: 'document-import' },
    { id: 'outline-generation', label: '目录生成', next: 'global-facts', prev: 'bid-analysis' },
    { id: 'global-facts', label: '全局事实', next: 'content-edit', prev: 'outline-generation' },
    { id: 'content-edit', label: '正文编辑', next: 'completed', prev: 'global-facts' },
  ],
  
  // 步骤切换时的数据清理规则（对应 OpenBidKit switchWorkflowKind）
  onStepChange(from, to, project) {
    if (to === 'outline-generation' && project.outline_mode === 'regenerate') {
      // 清空现有目录和正文
      return { clearOutline: true, clearContent: true };
    }
    // ...
  }
};
```

### 4.3 第三阶段：后台任务队列

**三种实现方案对比**：

| 方案 | 复杂度 | 成本 | 中断恢复 | 推荐度 |
|------|-------|------|---------|--------|
| Supabase Background Tasks | 中 | 低 | ✅ | ⭐⭐⭐⭐ |
| Inngest | 低 | 中 | ✅ | ⭐⭐⭐⭐⭐ |
| Vercel + 前端轮询 | 低 | 低 | ❌ | ⭐⭐（MVP） |

**推荐 Inngest 实现**：

```typescript
// inngest/tender.ts
export const generateSectionContent = inngest.createFunction(
  { id: 'generate-section-content' },
  { event: 'tender/section.generate' },
  async ({ event, step }) => {
    const { sectionId, config } = event.data;
    
    // 可中断的检查点
    await step.run('prepare-context', async () => {
      // 组装 Prompt 上下文
    });
    
    await step.run('call-ai', async () => {
      // 调用 AI，流式返回
    });
    
    await step.run('post-process', async () => {
      // Mermaid 渲染、字数统计
    });
  }
);
```

---

## 五、文档补全计划

### 5.1 母文档更新

**现有母文档**：`product-truth/00-master/MASTER-DOC.md`

**需要补全章节**：

```markdown
## X. 标书中心（Tender Center）

### X.1 业务定位
对标 OpenBidKit 技术方案工作流，为复杂招投标场景提供：
- 招标文件智能解析
- 技术方案目录生成
- AI 正文生成（从零/扩写双模式）
- 废标项检查
- 标书查重

### X.2 与现有模块关系
- 依赖 AI_CONFIG：AI 模型配置
- 依赖 knowledge：技术文档、案例库引用
- 依赖 documents：招标文件上传解析
- 依赖 quotes：商务标数据填充

### X.3 核心概念
- 工作流（Workflow）：document-import → bid-analysis → outline → global-facts → content-edit
- 全局事实：全文统一变量系统
- 内容生成计划：规划与执行分离

### X.4 技术要点
- 需要工作流状态机
- 需要后台任务队列（Inngest）
- 需要支持中断恢复
```

### 5.2 派生文档清单

| 文档编号 | 文档名称 | 优先级 | 依赖 |
|---------|---------|-------|------|
| F013-V3 | 标书中心设计文档（修正版） | P0 | 母文档 X 章节 |
| F013-DATA | 标书数据模型详细设计 | P0 | F013-V3 |
| F013-WORKFLOW | 工作流引擎设计 | P0 | F013-V3 |
| F013-AI | AI 生成 Prompt 工程 | P1 | F013-V3 |
| F013-TASK | 后台任务队列设计 | P1 | F013-WORKFLOW |
| F013-API | API 接口设计 | P2 | F013-DATA |
| F013-UI | 页面交互设计 | P2 | F013-WORKFLOW |
| REQ-TENDER-001 | 需求规格：招标文件解析 | P1 | - |
| REQ-TENDER-002 | 需求规格：正文生成 | P1 | - |
| REQ-TENDER-003 | 需求规格：废标检查 | P2 | - |

### 5.3 文档产出顺序

```
Week 1:
  ├─ 母文档 X 章节（业务定位、概念定义）
  ├─ F013-V3 标书中心设计文档（框架）
  └─ F013-DATA 数据模型设计

Week 2:
  ├─ F013-WORKFLOW 工作流引擎设计
  ├─ F013-TASK 后台任务队列设计
  └─ REQ-TENDER-001 招标文件解析需求

Week 3:
  ├─ F013-AI AI Prompt 工程设计
  ├─ REQ-TENDER-002 正文生成需求
  └─ 评审与修订

Week 4:
  ├─ F013-API 接口设计
  ├─ F013-UI 交互设计
  └─ 技术评审
```

---

## 六、关键决策点

### 6.1 必须做出的决策

| 决策 | 选项 | 影响 |
|------|------|------|
| **工作流引擎** | A. 复用 contract 状态机<br>B. 新建 tender 专用<br>C. 通用 workflow 引擎 | 影响 F013-WORKFLOW 设计范围 |
| **后台任务** | A. Inngest（推荐）<br>B. Supabase BG Tasks<br>C. 前端轮询 | 影响技术栈和成本 |
| **全局事实** | A. 复用 configs<br>B. 新建 tender_global_facts 表<br>C. 内嵌 tender_projects | 影响数据模型设计 |
| **知识库引用** | A. 直接存知识库ID<br>B. 引用 + 快照共存 | 影响数据一致性 |

### 6.2 我的推荐决策

| 决策 | 推荐 | 理由 |
|------|------|------|
| 工作流引擎 | B. 新建 tender 专用 | contract 状态机太简单，需要步骤推进和数据清理规则 |
| 后台任务 | A. Inngest | 中断恢复是刚需，有免费额度，开发成本低 |
| 全局事实 | C. 内嵌 tender_projects | 全局事实绑定标书项目，其他场景不需要 |
| 知识库引用 | B. 引用 + 快照 | 防知识库编辑后影响已生成内容 |

---

## 七、总结

### 7.1 深度调研发现（vs 初步调研）

| 维度 | 初步调研（50%） | 深度调研（90%） |
|------|----------------|----------------|
| **工作流** | 知道有6步 | 知道有严格的步骤切换数据清理规则 |
| **内容生成** | 知道有AI生成 | 知道有计划-执行分离、双模式、并发控制 |
| **任务系统** | 没提 | 知道有中断恢复、排他锁、任务调度元数据 |
| **数据模型** | 简化为扩展 tech_documents | 知道需要完整的项目-目录-任务三层模型 |
| **全局事实** | 没提 | 知道是核心创新（变量系统） |
| **云端化** | 简单说「需要重写存储层」 | 知道需要 Inngest 等任务队列方案 |

### 7.2 复用价值评估

| 组件 | 复用价值 | 实施成本 |
|------|---------|---------|
| 内容生成计划模式 | ⭐⭐⭐⭐⭐ | 中（需适配云端） |
| 全局事实变量系统 | ⭐⭐⭐⭐⭐ | 低（概念借鉴） |
| 招标项分析模板 | ⭐⭐⭐⭐ | 低（复制+本地化） |
| 目录-招标映射 | ⭐⭐⭐⭐ | 低（数据模型借鉴） |
| 任务锁设计 | ⭐⭐⭐ | 中（需配合队列） |
| AI Prompt 模板 | ⭐⭐⭐ | 高（需要改造为云端流式） |
| 工作流状态机 | ⭐⭐⭐ | 高（需重建） |

### 7.3 下一步行动

1. **确认决策点**（6.1）→ 我给出推荐（6.2），需要你确认
2. **启动文档编写** → 按 5.3 顺序产出
3. **技术预研** → Inngest 集成 POC

---

**调研完成时间**: 2026-06-09  
**调研文档版本**: v1.0  
**下一步**: 确认决策点后，开始 Mother Doc 补全和 F013-V3 设计文档编写
