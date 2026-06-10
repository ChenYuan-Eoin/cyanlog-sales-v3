# 项目完整度评估 vs 5步框架

## 评估日期
2026-06-07

---

## 01 现象与问题引入 ✅ 已做到

| 文件 | 实现内容 |
|------|---------|
| lib/ai/failover.ts | 展示AI降级的现实问题：本地模型超时、云端连接失败 |
| lib/schema-check.ts | 展示schema漂移导致的运行时故障 |
| app/admin/health/page.tsx | 可视化展示系统健康状态和列漂移检测 |

---

## 02 深度根因剖析 ✅ 已补充（2026-06-07）

### 已编写的ADR文档

| ADR | 决策 | 根因剖析要点 |
|-----|------|------------|
| [ADR-001](../../../product-truth/02-technical-truth/architecture-decisions/ADR-001-ai-failover-chain.md) | AI多级降级链 | 本地超时=推理慢+显存；云端失败=网络/计费/配额；规则引擎vs AI=确定性vs语义 |
| [ADR-002](../../../product-truth/02-technical-truth/architecture-decisions/ADR-002-jwt-db-token.md) | Token双轨存储 | 纯JWT无吊销能力；Redis增加依赖；DB支持审计 |
| [ADR-003](../../../product-truth/02-technical-truth/architecture-decisions/ADR-003-sse-streaming.md) | SSE流式 | WebSocket双向过度；EventSource不支持POST；CDN/防火墙友好 |
| [ADR-004](../../../product-truth/02-technical-truth/architecture-decisions/ADR-004-rbac-scope.md) | RBAC+Scope | ABAC过度设计；Casbin增加依赖；硬编码不可配置 |
| [ADR-005](../../../product-truth/02-technical-truth/architecture-decisions/ADR-005-middleware-layering.md) | Middleware分层 | API内校验易遗漏；3次DB查询是统一性的必要代价 |

### 评分提升
- 修复前: 50/100（无根因文档）
- 修复后: 80/100（5个核心ADR + INDEX索引）

### 仍缺失
- 性能基准数据（应在ADR中引用实测数字）
- 季度评审机制尚未建立
- ADR-006~010 尚未编写（数据库选型、状态管理、ORM等）

---

## 02 深度根因剖析（旧版-已修复）

~~### 当前状态~~
~~代码中有问题处理逻辑，但缺少根因分析文档。~~

~~### 缺失部分~~
~~- 为什么本地模型会超时？（推理慢、显存瓶颈、并发限制）~~
~~- 为什么规则引擎能兜底但AI不行？（语义理解 vs 结构化规则的确定性）~~
~~- 为什么middleware需要串行token验证？（必须先获取user_id才能查询权限）~~

~~### 建议改进~~
~~补充 `product-truth/02-technical-truth/architecture-decisions/` 目录存放ADR（架构决策记录）。~~

---

## 03 分层防御体系 ✅ 已做到

### AI降级链（4级）
```
local model (45s超时)
  ↓ 失败
cloud model (15s超时)
  ↓ 失败
rule-engine (1s纯本地规则)
  ↓ 失败
manual-fallback (静态降级响应)
```

### 权限验证层（3层）
```
Token有效性验证 (auth_tokens表)
  ↓
用户状态验证 (users表: must_change_password)
  ↓
权限匹配验证 (user_roles + roles表)
```

### Schema验证层（2层）
```
表存在性检查
  ↓
关键列完整性检查 (REQUIRED_COLUMNS)
```

### Gateway层
- Host重定向（quote.cyanlog.icu → /quotes）
- 路径级权限拦截（/admin, /configs）

---

## 04 技术选型与利弊权衡 ⚠️ 已补充（2026-06-07）

### 已添加技术选型注释的模块

| 文件 | 选型点 | 解释内容 |
|------|--------|----------|
| lib/ai/failover.ts | Vercel AI SDK | 统一流式接口 vs 直接调用SDK |
| lib/ai/failover.ts | LM Studio | 数据不出境 vs Ollama轻量 |
| lib/ai/failover.ts | 规则引擎兜底 | 确定性可解释 vs 云端AI便宜 |
| lib/sse/client.ts | SSE流式 | 单向足够 vs WebSocket双向复杂 |
| lib/sse/client.ts | fetch+ReadableStream | 自定义header vs 原生EventSource |
| lib/validation.ts | Zod校验 | TypeScript集成 vs Yup生态 |
| middleware.ts | Edge Middleware | 统一拦截 vs API Route内校验 |
| middleware.ts | PostgreSQL存Token | 支持失效 vs 纯JWT无状态 |
| middleware.ts | RBAC+数据范围 | 简单可优化 vs ABAC灵活复杂 |
| lib/schema-check.ts | 运行时检查 | 贴近查询场景 vs 元数据查询 |

### 评分提升
- 修复前: 30/100（完全没有解释）
- 修复后: 70/100（关键模块已解释）

### 仍缺失
- 细粒度实现决策（如为什么是60秒TTL而不是30秒）
- 性能基准对比数据
- 架构决策记录(ADR)文档

---

## 04 技术选型与利弊权衡（旧版-已修复）

~~### 关键缺失（需要在代码注释或文档中补充）~~

~~| 选型点 | 当前选择 | 缺失的解释 |~~
~~|--------|---------|-----------|~~
~~| 流式传输 | SSE | 为什么不是WebSocket？（SSE单向、浏览器原生EventSource、HTTP兼容） |~~
~~| 校验库 | Zod | 为什么不是Valibot/Yup？（TypeScript原生推导、Next.js社区标准） |~~
~~| AI兜底 | 规则引擎 | 为什么不用更便宜的AI模型？（确定性、可解释性、合规审计） |~~
~~| 本地模型 | LM Studio | 为什么不是ollama.gguf？（API兼容性、生态支持） |~~

### 建议改进
在关键模块添加 header 注释，说明选型理由和权衡：
```typescript
// lib/ai/failover.ts
// 技术选型：Vercel AI SDK + 多级降级
// 权衡：SDK提供统一的流式接口，但增加了bundle体积
// 备选：直接请求OpenAI API（节省~15KB，但代码复杂度上升）
```

---

## 05 局限性认知与未来展望 ⚠️ 基本做到

### 当前状态
- REQ_REGISTRY.yml 标记了 P2/P3 优先级
- 27维度评估已回写母文档 (X.100.7节)
- Harness状态记录为 `permissive` 模式（非严格管控）

### 仍可改进
- 缺少系统性的"已知局限"文档
- 某些溢价实现（RAG、Agent多轮对话）无真实数据喂入

### 建议改进
补充 `product-truth/04-implementation-truth/LIMITATIONS.md`：
```markdown
## 已知局限

| 功能 | 局限 | 计划改进 |
|------|------|---------|
| 多模态视觉 | 未接入真实CV模型，仅预留接口 | P2: 接入Qwen-VL或GPT-4V |
| RAG知识库 | 空表运行，无量化评估数据 | P2: 导入历史合同案例 |
| Agent多轮对话 | state-machine存在但无UI入口 | P3: 合同审核追问交互 |
```

---

## 本次修复的关键问题

### 已修复（性能/正确性）

| 文件 | 问题 | 修复前 | 修复后 |
|------|------|--------|--------|
| lib/schema-check.ts | N+1查询 | 36表×5列=180+串行查询 | 批量并行，5并发限制 |
| middleware.ts | 串行DB调用 | 3次串行（token→user→roles×2） | 并行2次查询 |
| lib/ai/failover.ts | 递归无限制 | 每次重试重新走完整降级链 | 记录已尝试provider，避免重复 |

### 待修复（非紧急）

| 文件 | 问题 | 建议方案 |
|------|------|---------|
| app/api/admin/org/route.ts | TOCTOU竞态条件 | 使用upsert替代检查+插入 |
| lib/schema-check.ts | 字符串类型列名 | 使用supabase-generated-types |
| lib/ai/failover.ts handleAIChunk | JSON.parse每行有性能开销 | 使用状态机累积解析 |

---

## 总体评分

| 维度 | 初始 | 当前 | 说明 |
|------|------|------|------|
| 01 现象引入 | 85/100 | 85/100 | 代码展示问题，但缺少业务场景描述 |
| 02 根因剖析 | 50/100 | 80/100 | +30 补充5个ADR文档 |
| 03 分层防御 | 90/100 | 90/100 | 4级AI降级+3层权限完整 |
| 04 技术选型 | 30/100 | 70/100 | +40 关键模块header注释 |
| 05 局限认知 | 70/100 | 70/100 | 有TODO标记，无系统局限文档 |
| **平均** | **65/100** | **79/100** | +14分 |

**已落地**：
- 5个ADR文档 + 1个索引（882行）
- 5个关键模块header注释
- N+1查询、串行DB、递归重试等性能问题修复

**待继续打磨**：
- 05局限性认知 - 编写LIMITATIONS.md
- ADR-006~010 补充其他技术决策
- P2/P3功能实现优先级排序
