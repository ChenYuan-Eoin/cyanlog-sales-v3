# F021 技术架构

<!--
状态变更：drafting → in_progress → completed
回写：REQ_REGISTRY.yml / 本 packet / 03-design-truth / 04-implementation-truth
-->

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F021 |
| **Name** | 技术架构 |
| **Module** | 技术架构 |
| **Branch** | `feature/F021-tech-architecture` |
| **Owner** | (待认领) |
| **Created** | 2026-06-02 |
| **Status** | `completed` |

---

## 2. 需求反讲

### 2.1 AI 复述

技术架构页面是系统设计层的"全景导航"，让开发者、新成员在单一页面内：
- 看清 9 个架构章节的服务关系
- 理解 7 类核心事件在 EventBus 中的流向
- 掌握 API 网关路由规则（6 类路径）
- 看到性能、安全、MVP 三大约束
- 了解本地开发 vs 生产部署的差异

来源：`product-truth/02-technical-truth/技术架构.md`（已 frozen 章节）。

### 2.2 待确认问题

- [ ] 技术架构页面是否需要包含"已实现/未实现"标记？**答：v1 静态展示，Phase 2 可考虑**
- [ ] API 网关路由的可点击跳转？**答：跳转到对应 API 文档（暂未实现文档，所以不跳）**

### 2.3 本轮边界

**做**：
- 技术架构单页（`/tech-architecture`）
- 9 个章节分卡片展示
- 服务调用电路图（SVG）
- API 网关路由表
- 事件总线表格
- 缓存策略层级表
- 部署架构对比
- 性能/安全约束汇总
- 集成到侧边栏

**不做**：
- 实时架构健康度（v1）
- 动态生成的电路图
- 架构师协作编辑

---

## 3. 技术方案

### 3.1 接口设计

无新 API（静态展示页）。

### 3.2 数据模型

所有内容来自 `lib/tech-architecture/data.ts` 静态配置，无数据库表。

### 3.3 状态机

无（只读视图）。

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 9 个章节内容过长 | 折叠卡片 + 顶部锚点导航 |
| 移动端表格过宽 | 表格自动横向滚动 |
| 架构更新后不同步 | 单一来源 data.ts |

---

## 4. 视觉锚点

### 4.1 参考页面

参考 `03-design-truth/` 中的设计 token，与 F020 业务地图保持视觉一致。

### 4.2 组件

- 复用：现有 Card / Button
- 新建：`ArchitectureDiagram` (SVG) / `ApiRouteTable` / `EventBusTable`

### 4.3 禁止偏离

- 不引入图表库
- 不使用 mermaid（避免客户端水合问题）

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | `lib/tech-architecture/data.ts` | 6 路由、7 事件、9 章节、4 缓存层齐全 |
| 组件测试 | 页面渲染 | 各 section 可见 |
| E2E | `/tech-architecture` 加载 | 200 状态 |
| 人工验收 | iPad 横向 | 表格横向滚动、卡片双列 |

---

## 6. 实施记录

### 2026-06-02

- 创建页面骨架 `app/tech-architecture/page.tsx`
- 创建数据源 `lib/tech-architecture/data.ts`
- 添加导航入口

### 代码位置

- `app/tech-architecture/page.tsx`
- `lib/tech-architecture/data.ts`
- `lib/tech-architecture/data.test.ts`
- `components/layout/sidebar.tsx`（修改）

---

## 7. 状态变更日志

| 日期 | 状态 | 变更说明 |
|------|------|---------|
| 2026-06-02 | drafting → in_progress | 开始实施 |
| 2026-06-02 | in_progress → completed | 完成 9 章节静态视图 |
