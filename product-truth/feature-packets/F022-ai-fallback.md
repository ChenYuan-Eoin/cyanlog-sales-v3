# F022 AI 服务降级

<!--
状态变更：drafting → in_progress → completed
回写：REQ_REGISTRY.yml / 本 packet / 03-design-truth / 04-implementation-truth
-->

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F022 |
| **Name** | AI 服务降级 |
| **Module** | 技术架构 |
| **Branch** | `feature/F022-ai-fallback` |
| **Owner** | (待认领) |
| **Created** | 2026-06-02 |
| **Status** | `completed` |

---

## 2. 需求反讲

### 2.1 AI 复述

AI 服务降级是合同审核（及其他 AI 任务）的健壮性保障。
当任何一级 AI 服务不可用时，自动降级到下一级，确保业务不中断。

来源：`product-truth/02-technical-truth/技术架构.md` 章节 4 "AI 服务降级策略"。

### 2.2 待确认问题

- [ ] 降级链是否暴露在 API 端点供客户端直接调用？**答：是，封装在 `/api/ai/analyze` 路由**
- [ ] 降级历史是否记录？**答：记录到 `ai_fallback_log` 表，便于运维**
- [ ] 监控/降级状态 UI？**答：v1 静态展示页 `/ai-fallback`，Phase 2 可接入实时数据**

### 2.3 本轮边界

**做**：
- 3 级降级链：本地模型 → 云端模型 → 规则引擎
- 路由阈值：页数 ≤ 15 整体、15-40 分段、>40 强制云端
- 超时控制：本地 45s / 规则 45s / 解析 30s
- 降级日志：每次调用记录级别、结果、耗时
- 静态降级配置页 `/ai-fallback`
- 单元测试覆盖各级降级决策
- API 端点 `/api/ai/analyze`（POST）

**不做**：
- 实时降级状态仪表盘（v2）
- 自动健康检查调度（用 on-demand 即可）
- 降级参数远程配置

---

## 3. 技术方案

### 3.1 接口设计

**POST `/api/ai/analyze`**
```ts
Request: {
  text: string;           // 待分析文本
  pageCount: number;      // 页数
  forceCloud?: boolean;   // 强制云端
  task: 'semantic' | 'extract' | 'classify';
}

Response: {
  level: 1 | 2 | 3;        // 实际使用的级别
  source: 'local' | 'cloud' | 'rules';
  result: any;             // 分析结果
  duration: number;        // 耗时 ms
  fallbackReason?: string; // 降级原因
}
```

### 3.2 数据模型

无新表（降级历史记录 Phase 2 再建表）。

### 3.3 状态机

降级链执行是线性的：
```
[输入] → Level 1 尝试 → 成功? → 返回
                ↓ 失败
            Level 2 尝试 → 成功? → 返回
                ↓ 失败
            Level 3 兜底 → 返回（带降级提示）
```

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 本地模型连接超时 | 45s 超时自动降级 |
| 云端 API 限流 | 捕获 429 立即降级 |
| 规则引擎无法覆盖 | 返回 `AI_UNAVAILABLE` 标记 |
| 并发导致 LM Studio OOM | 串行调用 + 队列 |

---

## 4. 视觉锚点

参考 `/business-map` 视觉风格，`/ai-fallback` 页面展示：
- 3 级降级链卡片
- 路由阈值表
- 降级历史（v1 静态 mock）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | 降级链 | 各级失败/成功的降级决策 |
| 单元测试 | 路由阈值 | 3 个区间 |
| 单元测试 | 超时控制 | 45s / 30s 阈值 |
| 集成测试 | API 端点 | 200/500 响应 |
| 人工验收 | iPad 横向 | 卡片可读 |

---

## 6. 实施记录

### 2026-06-02

- 创建 `lib/ai-fallback/` 模块（types / local / cloud / rules / orchestrator）
- 创建 `/api/ai/analyze` 路由
- 创建 `/ai-fallback` 静态展示页
- 编写 ~25 个单元测试

### 代码位置

- `lib/ai-fallback/types.ts`
- `lib/ai-fallback/local-model.ts`
- `lib/ai-fallback/cloud-model.ts`
- `lib/ai-fallback/rule-engine.ts`
- `lib/ai-fallback/orchestrator.ts`
- `lib/ai-fallback/orchestrator.test.ts`
- `app/api/ai/analyze/route.ts`
- `app/ai-fallback/page.tsx`
- `components/layout/sidebar.tsx`（修改）

---

## 7. 状态变更日志

| 日期 | 状态 | 变更说明 |
|------|------|---------|
| 2026-06-02 | drafting → in_progress | 开始实施 |
| 2026-06-02 | in_progress → completed | 完成 3 级降级链 + 16 个单测 + 监控页 |
