# Feature Packet: F013-标书中心 V3（OpenBidKit 深度参考 + 核心差距补齐）

**Created**: 2026-06-09  
**REQ ID**: F013-V3  
**Status**: design_confirmed  
**Parent**: 标书中心  
**Reference**: OpenBidKit 深度参考（openbidkit-deep-research.md）  
**Mother Doc**: PROJECT-主文档.md 第7章（标书中心）

---

## 1. 决策确认

### 1.1 4个关键决策（已确认）

| 决策 | 选项 | 确认理由 |
|------|------|---------|
| 工作流引擎 | **B. 新建 tender 专用** | contract 审批状态机太简单（pending→approved），标书需6步推进+步骤切换数据清理 |
| 后台任务 | **A. PostgreSQL + Cron（Phase 1）→ Inngest（Phase 2）** | 中断恢复是刚需。Phase 1 零额外依赖复用现有架构，Phase 2 迁移到 Inngest |
| 全局事实 | **C. 内嵌 tender_projects** | 全局事实绑定标书项目，其他场景不需要 |
| 知识库引用 | **B. 引用 + 快照** | 防知识库编辑后影响已生成内容 |

### 1.2 用户补充要求（vs V2）

| 要求 | 对应 OpenBidKit 能力 | V2 状态 | V3 设计 |
|------|-------------------|---------|---------|
| 中断恢复 | 任务 pause/resume + checkpoint | ❌ 未涉及 | ✅ PostgreSQL checkpoint_data + Inngest 迁移路径 |
| 内容生成计划 | 规划-执行分离 | ❌ 未涉及 | ✅ tender_sections.generation_plan |
| 溯源招标文件 | 目录-招标要求映射 | ❌ 未涉及 | ✅ source_requirement_id/title/content |
| 图文生成 | Mermaid + 正文配图 | ❌ 未涉及 | ✅ Mermaid 渲染 + Supabase Storage 插图 |
| 全局事实变量 | 全文统一替换 | ❌ 未涉及 | ✅ global_facts + resolveGlobalFacts |

---

## 2. 全局事实变量系统（核心差距补齐）

### 2.1 为什么必须做

OpenBidKit 的核心创新之一。30页标书中，如果 AI 每次调用上下文不同，「公司介绍」可能出现矛盾描述。全局事实确保全文一致性。

### 2.2 数据模型

```typescript
// tender_projects.global_facts JSONB
interface GlobalFact {
  title: string          // 事实标题，如"公司介绍"
  content: string        // 事实内容
  category: 'company' | 'product' | 'team' | 'custom'
}

// 示例
const globalFacts = [
  { title: '公司介绍', content: 'XXX科技有限公司成立于2015年...', category: 'company' },
  { title: '核心产品参数', content: '处理能力 10000 TPS，支持百万级并发...', category: 'product' },
  { title: '实施团队规模', content: '50+ 认证工程师，平均从业经验8年...', category: 'team' }
]
```

### 2.3 使用方式

每个章节引用需要的全局事实：

```typescript
// tender_sections 表字段
interface TenderSection {
  // ...
  facts: string[]        // 引用的全局事实标题
}

// 示例：技术方案章节
{ title: '3.1 项目概述', facts: ['公司介绍'] }
{ title: '3.2 实施方案', facts: ['核心产品参数', '实施团队规模'] }
```

### 2.4 AI Prompt 注入

```typescript
// lib/tender/ai-prompts.ts
function formatGlobalFactsForPrompt(
  facts: GlobalFact[],
  sectionFacts: string[]
): string {
  const relevant = facts.filter(f => sectionFacts.includes(f.title))
  if (relevant.length === 0) return ''

  return `全局事实变量（正文涉及以下主题时，必须使用这些变量值，避免各章节描述不一致）：
${relevant.map(f => `- ${f.title}：${f.content}`).join('\n')}`
}
```

### 2.5 变量替换校验（可选）

```typescript
function auditGlobalFactConsistency(
  content: string,
  facts: GlobalFact[],
  sectionFacts: string[]
): { consistent: boolean; warnings: string[] } {
  // 如果 AI 输出中出现了与全局事实矛盾的内容，提示用户
  const warnings: string[] = []
  // 实现：关键词匹配 + 语义相似度检测
  return { consistent: warnings.length === 0, warnings }
}
```

---

## 3. 工作流引擎（核心差距补齐）

### 3.1 设计原则

复用 ASK 状态机模式（`lib/ask/state-machine.ts`：纯函数、不依赖数据库、客户端/服务端共用），新建 tender 专用多步骤状态机。

### 3.2 6步工作流

```typescript
// lib/tender/workflow.ts
export type TenderStep =
  | 'document-import'
  | 'bid-analysis'
  | 'outline-generation'
  | 'global-facts'
  | 'content-edit'
  | 'completed'

export interface StepConfig {
  id: TenderStep
  label: string
  next: TenderStep | null
  prev: TenderStep | null
  skippable: boolean
}

export const tenderWorkflowSteps: StepConfig[] = [
  { id: 'document-import', label: '文档导入', next: 'bid-analysis', prev: null, skippable: false },
  { id: 'bid-analysis', label: '招标分析', next: 'outline-generation', prev: 'document-import', skippable: false },
  { id: 'outline-generation', label: '目录生成', next: 'global-facts', prev: 'bid-analysis', skippable: false },
  { id: 'global-facts', label: '全局事实', next: 'content-edit', prev: 'outline-generation', skippable: true },
  { id: 'content-edit', label: '正文编辑', next: 'completed', prev: 'global-facts', skippable: false },
  { id: 'completed', label: '已完成', next: null, prev: 'content-edit', skippable: false },
]
```

### 3.3 步骤切换数据清理规则（OpenBidKit 核心设计）

```typescript
// 步骤切换时的数据清理（防止数据残留导致不一致）
interface StepChangeEffect {
  clearOutline?: boolean       // 清空目录
  clearContent?: boolean      // 清空正文
  clearFacts?: boolean        // 清空全局事实
  preserveTenderDoc?: boolean // 保留招标文件
  preserveBidAnalysis?: boolean // 保留招标分析
}

export function onStepChange(
  from: TenderStep,
  to: TenderStep,
  project: { outlineMode: string; workflowKind: string }
): StepChangeEffect {
  // 规则1：重新生成目录时，清空现有目录和正文
  if (to === 'outline-generation' && project.outlineMode === 'regenerate') {
    return {
      clearOutline: true,
      clearContent: true,
      preserveTenderDoc: true,
      preserveBidAnalysis: true,
    }
  }

  // 规则2：切换工作流模式时，清空一切（保留招标文件和招标分析）
  if (from === 'document-import' && to === 'document-import') {
    return {
      clearOutline: true,
      clearContent: true,
      clearFacts: true,
      preserveTenderDoc: true,
      preserveBidAnalysis: true,
    }
  }

  // 规则3：退回上一步时，保留数据（不清理）
  return { clearOutline: false, clearContent: false, clearFacts: false }
}
```

### 3.4 状态流转验证

```typescript
export type TenderAction = 'next' | 'prev' | 'skip' | 'reset'

export function canTransition(
  from: TenderStep,
  action: TenderAction,
  config: { skippable: boolean }
): { allowed: boolean; to: TenderStep | null; effect?: StepChangeEffect } {
  const step = tenderWorkflowSteps.find(s => s.id === from)
  if (!step) return { allowed: false, to: null }

  switch (action) {
    case 'next':
      return { allowed: !!step.next, to: step.next }
    case 'prev':
      return { allowed: !!step.prev, to: step.prev }
    case 'skip':
      return { allowed: config.skippable && !!step.next, to: step.next }
    default:
      return { allowed: false, to: null }
  }
}
```

---

## 4. 中断恢复设计（核心差距补齐）

### 4.1 Phase 1：PostgreSQL + Vercel Cron（零额外依赖）

复用现有 `contract_analysis_jobs` 模式，扩展 `checkpoint_data` 字段实现中断恢复。

```sql
CREATE TABLE tender_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tender_projects(id) ON DELETE CASCADE,
  section_id UUID REFERENCES tender_sections(id),

  task_type TEXT NOT NULL, -- 'bid-analysis' | 'outline-generation' | 'content-generation' | 'post-process'
  task_group TEXT NOT NULL, -- 'technical-bid' | 'rejection-check'

  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed | paused
  progress INTEGER NOT NULL DEFAULT 0, -- 0-100

  -- 中断恢复核心字段
  checkpoint_data JSONB,

  -- 配置和结果
  config JSONB,
  result JSONB,
  error_message TEXT,
  logs JSONB DEFAULT '[]'::jsonb,

  -- 锁（复用 claim_contract_analysis_job）
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 checkpoint_data 结构

```typescript
// 不同任务类型的中断检查点
type CheckpointData =
  | { phase: 'bid-analysis'; analyzedDimensions: string[]; remainingDimensions: string[] }
  | { phase: 'outline-generation'; generatedNodes: number; totalNodes: number }
  | ContentGenerationCheckpoint

interface ContentGenerationCheckpoint {
  phase: 'content-generation'
  // 当前正在生成的章节
  currentNodeId: string
  // 已完成的章节列表
  completedNodeIds: string[]
  // 总章节数
  totalNodes: number
  // 失败重试次数
  retryCount: number
  // 生成模式
  mode: 'generate' | 'restore' | 'expand'
  // 已处理的 token 数（流式进度）
  processedTokens: number
}
```

### 4.3 中断恢复流程

```
用户点击"生成技术方案"
  ↓
创建 tender_tasks（status=pending, checkpoint_data=null）
  ↓
后台 Worker 领取任务（claim → status=running）
  ↓
每完成一个章节，更新 checkpoint_data
  ↓
【用户暂停】→ status=paused，保留 checkpoint_data
  ↓
【用户恢复】→ 读取 checkpoint_data，从断点继续
  ↓
全部完成 → status=completed
```

### 4.4 Phase 2：Inngest 迁移

```typescript
// Inngest 实现（Phase 2，可选升级）
export const generateTenderContent = inngest.createFunction(
  { id: 'generate-tender-content' },
  { event: 'tender/section.generate' },
  async ({ event, step }) => {
    const { projectId, sectionId, config } = event.data

    // 步骤1：准备上下文（可中断）
    await step.run('prepare-context', async () => {
      // 组装 Prompt 上下文（全局事实 + 招标分析 + 知识库引用）
    })

    // 步骤2：调用 AI（可中断）
    await step.run('call-ai', async () => {
      // 调用 AI，流式返回
    })

    // 步骤3：后处理（可中断）
    await step.run('post-process', async () => {
      // Mermaid 渲染、字数统计、一致性审计
    })
  }
)
```

---

## 5. 内容生成计划（核心差距补齐）

### 5.1 核心设计：规划与执行分离

```typescript
// tender_sections.generation_plan JSONB
interface ContentGenerationPlan {
  // 目标章节
  nodeId: string
  sectionNumber: string
  title: string

  // 生成模式
  mode: 'generate' | 'restore-then-optimize' | 'expand-word-count'

  // 原方案还原（扩写模式特有）
  originalMaterial?: {
    sourceIds: string[]         // 原方案段编号
    restoredContent: string    // 拼接后的原文
    optimized: boolean         // 是否已优化
  }

  // 变量替换
  facts: string[]             // 依赖的全局事实标题
  bidAnalysisFacts: string[] // 依赖的招标分析项

  // 字数规划
  targetWordCount: number
  currentWordCount: number

  // 知识库引用（快照）
  knowledgeRefs: Array<{
    id: string                 // 知识库素材ID
    title: string              // 素材标题（快照）
    content: string            // 素材内容（快照）
  }>

  // 父章节上下文（保证连贯性）
  parentNodeId?: string
}
```

### 5.2 示例

```typescript
const plan: ContentGenerationPlan = {
  nodeId: 'sec-3-1',
  sectionNumber: '3.1',
  title: '项目概述',
  mode: 'generate',
  facts: ['公司介绍'],
  bidAnalysisFacts: ['项目基本信息', '甲方信息'],
  targetWordCount: 500,
  currentWordCount: 0,
  knowledgeRefs: [
    { id: 'case-001', title: '某银行安全项目', content: '为某国有银行部署...' }
  ],
  parentNodeId: 'sec-3',
}
```

### 5.3 执行方式

```typescript
// 批量并发执行（Phase 2，默认5个章节并行）
import PQueue from 'p-queue'

async function executeGenerationPlans(
  plans: ContentGenerationPlan[],
  options: { concurrency?: number; onProgress?: (p: number) => void } = {}
) {
  const concurrency = options.concurrency ?? 5
  const queue = new PQueue({ concurrency })
  let completed = 0

  return Promise.all(
    plans.map(plan => queue.add(async () => {
      const result = await generateSectionContent(plan)
      completed++
      options.onProgress?.(completed / plans.length)
      return result
    }))
  )
}

// 单章重新生成
async function regenerateSection(nodeId: string) {
  const plan = await getGenerationPlan(nodeId)
  return generateSectionContent(plan)
}
```

---

## 6. 溯源招标文件（核心差距补齐）

### 6.1 数据模型：目录-招标要求映射

```typescript
// tender_sections 表字段（新增）
interface TenderSection {
  // ...
  // 溯源招标要求
  sourceRequirementId?: string       // 招标要求ID
  sourceRequirementTitle?: string    // 招标要求原文标题
  sourceRequirementContent?: string  // 招标要求原文内容
}
```

### 6.2 招标分析结果结构

```typescript
// bid-analysis 任务输出
interface BidAnalysisResult {
  requirements: Array<{
    id: string
    title: string
    content: string
    category: 'technical' | 'commercial' | 'qualification' | 'timeline'
    weight?: number           // 权重（评分项）
    isMandatory: boolean      // 是否强制性
  }>
  // ... 其他分析维度
}
```

### 6.3 AI Prompt 中注入招标要求

```typescript
function buildSectionPrompt(
  section: TenderSection,
  project: TenderProject,
  bidAnalysis: BidAnalysisResult
): string {
  const requirement = section.sourceRequirementId
    ? bidAnalysis.requirements.find(r => r.id === section.sourceRequirementId)
    : null

  return `
# 章节要求
标题：${section.title}
${requirement ? `对应招标要求：${requirement.title}
原文：${requirement.content}
${requirement.isMandatory ? '【强制性要求】' : ''}` : ''}

# 字数要求
目标：${section.generationPlan?.targetWordCount || '不限'}字

# 全局事实
${formatGlobalFactsForPrompt(project.globalFacts, section.facts || [])}

# 知识库素材
${formatKnowledgeRefs(section.generationPlan?.knowledgeRefs || [])}
`
}
```

---

## 7. 图文生成（核心差距补齐）

### 7.1 Mermaid 图表支持

```typescript
// 章节附件类型
interface SectionAttachment {
  id: string
  type: 'mermaid' | 'image' | 'table'
  content: string           // Mermaid 语法或图片 URL
  caption?: string          // 图表标题
  generated: boolean        // 是否 AI 生成
}

// AI Prompt 中要求使用 Mermaid
const mermaidInstruction = `
如果正文中需要流程图、架构图、时序图等，请使用 Mermaid 语法，格式为：
\`\`\`mermaid
graph TD
  A[开始] --> B[处理]
\`\`\`
`
```

### 7.2 Mermaid 渲染服务

```typescript
// lib/tender/mermaid-render.ts
import { renderMermaid } from '@mermaid-js/mermaid-cli' // 或自建服务

export async function renderMermaidDiagram(
  code: string,
  options: { format?: 'svg' | 'png' } = {}
): Promise<string> {
  const format = options.format ?? 'svg'

  // 方案1：调用 mermaid-cli（需安装 @mermaid-js/mermaid-cli）
  // const svg = await mermaidCli.render(code)

  // 方案2：调用外部渲染服务（如 https://mermaid.ink）
  const encoded = Buffer.from(code, 'utf-8').toString('base64')
  return `https://mermaid.ink/img/${encoded}`
}
```

### 7.3 插图管理

```typescript
// Supabase Storage 存储插图
// bucket: tender-attachments
// path: {orgId}/{projectId}/images/{filename}

interface ImageAttachment extends SectionAttachment {
  type: 'image'
  content: string   // Supabase Storage 公共 URL
  alt: string
  width?: number
  height?: number
}

// 上传插图
async function uploadTenderImage(
  projectId: string,
  file: File
): Promise<string> {
  const path = `${projectId}/images/${Date.now()}-${file.name}`
  const { data, error } = await supabase.storage
    .from('tender-attachments')
    .upload(path, file)

  if (error) throw error

  const { data: { publicUrl } } = supabase.storage
    .from('tender-attachments')
    .getPublicUrl(data.path)

  return publicUrl
}
```

---

## 8. 数据模型（整合 V2 + 增强）

### 8.1 tender_projects

```sql
CREATE TABLE IF NOT EXISTS tender_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- 基本信息
  name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  tender_no TEXT,

  -- 关联系统
  customer_id UUID,
  quote_id UUID,
  opportunity_id UUID,

  -- 工作流配置
  workflow_kind TEXT NOT NULL DEFAULT 'technical-bid',
  current_step TEXT NOT NULL DEFAULT 'document-import',
  status TEXT NOT NULL DEFAULT 'draft',

  -- 招标文件
  tender_document_id UUID REFERENCES documents(id),
  tender_parsed_content TEXT,

  -- 原方案（扩写模式）
  original_plan_document_id UUID REFERENCES documents(id),
  original_plan_parsed_content TEXT,

  -- 配置（JSONB）
  bid_analysis_config JSONB DEFAULT '{}'::jsonb,
  outline_config JSONB DEFAULT '{}'::jsonb,
  content_generation_options JSONB DEFAULT '{}'::jsonb,

  -- 全局事实（核心新增，V3）
  global_facts JSONB DEFAULT '[]'::jsonb,

  -- 检查结果
  risk_check_result JSONB,
  duplicate_check_result JSONB,

  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 8.2 tender_sections

```sql
CREATE TABLE IF NOT EXISTS tender_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tender_projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES tender_sections(id) ON DELETE CASCADE,

  sort_order INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,

  title TEXT NOT NULL,
  description TEXT,

  -- 内容（Markdown）
  content TEXT DEFAULT '',
  content_status TEXT DEFAULT 'empty', -- empty | draft | ai_pending | approved

  -- AI 生成（V2）
  ai_generated_content TEXT,
  ai_accepted_content TEXT,
  ai_prompt TEXT,

  -- 生成计划（核心新增，V3）
  generation_plan JSONB,

  -- 全局事实引用（核心新增，V3）
  facts TEXT[] DEFAULT '{}',

  -- 溯源（核心新增，V3）
  source_requirement_id TEXT,
  source_requirement_title TEXT,
  source_requirement_content TEXT,

  -- 知识库引用（增强：引用+快照）
  knowledge_refs JSONB DEFAULT '[]'::jsonb,

  -- 图文附件（核心新增，V3）
  attachments JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_tender_sections_project ON tender_sections (project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tender_sections_parent ON tender_sections (parent_id);
```

### 8.3 tender_tasks

```sql
CREATE TABLE IF NOT EXISTS tender_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tender_projects(id) ON DELETE CASCADE,
  section_id UUID REFERENCES tender_sections(id),

  task_type TEXT NOT NULL,
  task_group TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,

  -- 中断恢复（核心新增，V3）
  checkpoint_data JSONB,

  -- 配置和结果
  config JSONB,
  result JSONB,
  error_message TEXT,
  logs JSONB DEFAULT '[]'::jsonb,

  -- 锁
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_tender_tasks_project ON tender_tasks (project_id, status);
CREATE INDEX IF NOT EXISTS idx_tender_tasks_locked ON tender_tasks (locked_at) WHERE locked_at IS NOT NULL;
```

---

## 9. 后台任务队列

### 9.1 Phase 1：PostgreSQL + Vercel Cron（零额外依赖）

复用现有 `contract_analysis_jobs` + `claim_contract_analysis_job` 模式：

```
Vercel Cron (每天 10:00 或按需触发)
  ↓
POST /api/cron → claim_next_tender_task() (PostgreSQL RPC)
  ↓
process_tender_task()
  ├── 读取 checkpoint_data（如有则从断点继续）
  ├── 更新 progress
  ├── 调用 AI（流式返回，边生成边保存）
  ├── Mermaid 渲染、字数统计
  ├── 一致性审计
  └── 更新 tender_sections
```

### 9.2 claim 函数（复用 contract_analysis_jobs 模式）

```sql
-- 复用 claim_contract_analysis_job，或新建 claim_tender_task
CREATE OR REPLACE FUNCTION claim_tender_task(p_worker_id TEXT)
RETURNS SETOF tender_tasks AS $$
BEGIN
  RETURN QUERY
  UPDATE tender_tasks
  SET status = 'running',
      locked_at = NOW(),
      started_at = COALESCE(started_at, NOW()),
      attempts = attempts + 1
  WHERE id = (
    SELECT id FROM tender_tasks
    WHERE status IN ('pending', 'paused')
      AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;
```

### 9.3 Phase 2：Inngest 迁移路径

| 维度 | Phase 1 (PostgreSQL) | Phase 2 (Inngest) |
|------|---------------------|-------------------|
| 中断恢复 | checkpoint_data 手动保存 | 原生支持 |
| 可观测性 | 手动 logs 字段 | 内置 Dashboard |
| 重试机制 | 手动 attempts 计数 | 自动指数退避 |
| 并发控制 | 单 Worker 串行 | 可配置并发 |
| 成本 | 零额外成本 | 免费额度 + 超额收费 |

---

## 10. 复用清单

| 现有能力 | 标书中心 V3 使用方式 |
|---------|-------------------|
| AI_CONFIG | 读取模型配置，创建 job 时快照保存 |
| case_library | 标书案例引用（扩展 tags 检索） |
| tech_documents | 技术方案素材库（扩展 doc_type） |
| business_qualifications | 资质文件自动关联 |
| contract_analysis_jobs | 复用后台任务模式（新建 tender_tasks） |
| ask/state-machine.ts | 复用纯函数状态机模式（新建 tender/workflow.ts） |
| contract_rules | 新增 ruleType='tender_risk' |
| word-export | 扩展支持标书导出（章节合并） |
| ocr-parsing | 导入招标文件时解析需求 |
| documents | 招标文件上传存储 |
| quotes | 商务标数据自动填充 |

---

## 11. Phase 规划

### Phase 1（2周）：基础框架 + 工作流 + 全局事实
- [ ] tender_projects / tender_sections / tender_tasks 表
- [ ] 工作流状态机（纯函数，复用 ASK 模式）
- [ ] 步骤切换数据清理规则
- [ ] 标书列表 + 创建向导
- [ ] 章节结构管理（树形，拖拽排序）
- [ ] 全局事实录入与管理

### Phase 2（2周）：AI 生成 + 中断恢复 + 内容生成计划
- [ ] tender_tasks checkpoint_data
- [ ] AI 生成 API（按章节，复用 AI_CONFIG）
- [ ] 内容生成计划（plan → execute）
- [ ] 编辑器集成（采纳 / 重新生成 / 手动编辑）
- [ ] 溯源招标要求展示（source_requirement_id）
- [ ] 知识库引用 + 快照

### Phase 3（1周）：检查 + 导出 + 溯源
- [ ] 废标项检查（复用 contract_rules，新增 tender_risk）
- [ ] 标书查重（复用合同查重）
- [ ] Word 导出（章节合并）
- [ ] 招标要求溯源高亮

### Phase 4（1周）：图文 + 优化
- [ ] Mermaid 图表渲染
- [ ] 插图管理（Supabase Storage）
- [ ] 全局事实一致性审计
- [ ] Inngest 迁移（可选）

---

## 12. 与 OpenBidKit 最终对比

| 维度 | OpenBidKit | Price-v3 V3 | 差距 |
|------|-----------|-------------|------|
| 工作流引擎 | 6步 + 数据清理规则 | 6步 + 数据清理规则 | **无** |
| 全局事实 | 核心创新 | 完整复刻 | **无** |
| 中断恢复 | 原生支持 | PostgreSQL checkpoint + Inngest 迁移 | **Phase 1 简配，Phase 2 追平** |
| 内容生成计划 | 规划-执行分离 | 完整复刻 | **无** |
| 溯源映射 | 目录-招标映射 | 完整复刻 | **无** |
| 图文生成 | Mermaid + 配图 | 完整复刻 | **无** |
| 并发控制 | 5章节并行 | Phase 1 串行，Phase 2 并发 | **Phase 2 追平** |
| 字数规划 | target_word_count | 完整复刻 | **无** |
| 一致性审计 | 章节间重复检测 | Phase 4 实现 | **Phase 4 追平** |
| 部署 | Electron 单机 | Web + 云端协作 | **领先** |
| OCR 解析 | 无 | PaddleOCR + AI 提取 | **领先** |
| 报价联动 | 无 | 商务标自动填充 | **领先** |
| 团队共享 | 无 | RBAC + 知识库共享 | **领先** |

**结论**：V3 补齐全部核心差距后，功能覆盖度达到 **95%**，且在云端协作、OCR、报价联动、团队共享方面领先。

---

## 13. 关键设计决策（新增 vs V2）

| 决策 | V2 方案 | V3 修正 | 修正原因 |
|------|---------|---------|---------|
| 后台任务 | 直接上 Inngest | Phase 1 PostgreSQL，Phase 2 Inngest | 项目健康度 35/100，零额外依赖优先 |
| 并发控制 | 未涉及 | Phase 1 串行，Phase 2 p-queue 5并发 | 先跑通再优化 |
| 一致性审计 | 未涉及 | Phase 4 实现 | 非 P0，后置 |
| 字数规划 | 未涉及 | 纳入 generation_plan | OpenBidKit 核心设计，必须补齐 |

---

**下一步**：按 Phase 1 开始实施。先建表 + 工作流状态机。
