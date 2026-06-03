---
req_id: F022
name: AI 服务降级
type: feature-implementation
status: completed
completed_at: "2026-06-02"
---

# F022 实施证据

## 文件清单

| 文件 | 行数 | 角色 |
|------|------|------|
| `lib/ai-fallback/types.ts` | ~30 | 类型定义 |
| `lib/ai-fallback/local-model.ts` | ~60 | Level 1 客户端 |
| `lib/ai-fallback/cloud-model.ts` | ~60 | Level 2 客户端 |
| `lib/ai-fallback/rule-engine.ts` | ~60 | Level 3 规则引擎 |
| `lib/ai-fallback/orchestrator.ts` | ~120 | 降级链调度器 |
| `lib/ai-fallback/orchestrator.test.ts` | ~200 | 16 个单测 |
| `app/api/ai/analyze/route.ts` | ~60 | REST API |
| `app/ai-fallback/page.tsx` | ~250 | 监控展示页 |
| `components/layout/sidebar.tsx` | +1 行 | 侧边栏入口 |

## 核心能力

### 1. 3 级降级链
- **Level 1** - 本地 LM Studio（Ollama 兼容，45s 超时）
- **Level 2** - 云端 AI（中转站，45s 超时）
- **Level 3** - 规则引擎（永远可用，<1s）

### 2. 路由决策
- 页数 ≤ 15 → 整体送入本地
- 15 < 页数 ≤ 40 → 分段送入本地
- 页数 > 40 → 强制云端
- forceCloud=true → 跳过本地

### 3. 失败处理
- 网络超时 → 自动降级
- HTTP 4xx/5xx → 立即降级
- 429 限流 → 立即降级
- Level 3 兜底 → 返回规则结果 + 降级提示

### 4. 可观测性
- 每次分析返回 `attempts: FallbackAttempt[]`
- 包含每级尝试的 success、duration、error

## 验证结果

- `pnpm typecheck` → 0 错误
- `pnpm test:run` → 95+ 通过（含新增 16 个降级链测试）
- `pnpm lint` → 0 警告

## 测试覆盖

| 测试类 | 用例 |
|--------|------|
| determineStartLevel | 3 个（页数 / forceCloud） |
| determineStrategy | 3 个（3 个区间） |
| FallbackOrchestrator | 8 个（成功/降级/兜底/跳过/页数/forceCloud/attempts/耗时） |
| RuleEngineClient | 4 个（匹配/严重度/无匹配/降级提示） |

## 已知限制

- 降级历史 v1 为静态示例，未接入数据库
- 无自动健康检查调度（on-demand 即可）
- 规则集仅 5 条硬编码（Phase 2 可配置化）
