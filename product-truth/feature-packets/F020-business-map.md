# F020 业务地图

<!--
状态变更：drafting → in_progress → completed
回写：REQ_REGISTRY.yml / 本 packet / 03-design-truth / 04-implementation-truth
-->

## 1. Meta

| 字段 | 值 |
|------|-----|
| **REQ ID** | F020 |
| **Name** | 业务地图 |
| **Module** | 业务地图 |
| **Branch** | `feature/F020-business-map` |
| **Owner** | (待认领) |
| **Created** | 2026-06-02 |
| **Status** | `completed` |

---

## 2. 需求反讲

### 2.1 AI 复述

业务地图是销售系统的"全景导航"，让用户（销售、管理者、新员工）在一个页面内：
- 看到 6 个核心模块的分布与职责
- 理解两条主业务链路的全貌
- 掌握 3 个核心对象（报价/合同/审批）的状态机
- 知道 3 个一级入口的独立性规则

来源：`product-truth/01-business-truth/业务地图.md`（已 frozen 章节 1 业务地图总览）。

### 2.2 待确认问题

- [ ] 业务地图是否需要实时反映当前用户的业务数据（如我的未读报价数）？**答：Phase 1 静态展示，Phase 2 可考虑**
- [ ] 是否需要交互（如点击模块跳转）？**答：支持点击模块卡片跳转到对应页面**

### 2.3 本轮边界

**做**：
- 业务地图单页（`/business-map`）
- 系统总览：6 个核心模块卡片，可点击跳转
- 核心链路 A：报价→合同→交付（带阶段说明）
- 核心链路 B：招标文件→标书→中标
- 3 个核心对象状态机（报价/合同/审批）可视化
- 入口独立性铁律说明卡片
- 集成到侧边栏导航

**不做**：
- 实时数据联动（v1）
- 业务地图编辑器/管理后台
- 复杂的拖拽布局

---

## 3. 技术方案

### 3.1 接口设计

本功能为纯展示页面，无需新 API 端点。

### 3.2 数据模型

所有内容来自静态配置（业务真相文档 `业务地图.md`），无数据库表。

数据结构（在 `lib/business-map/data.ts` 中定义）：
```ts
type Module = { id, name, href, phase, description, icon, color }
type Link = { id, name, steps: LinkStep[] }
type StateMachine = { id, name, states, transitions }
```

### 3.3 状态机

无（业务地图本身无状态流转，是只读视图）。

### 3.4 风险与降级

| 风险 | 应对 |
|------|------|
| 页面过长，用户迷失 | 提供顶部锚点导航 + 折叠卡片 |
| 移动端显示拥挤 | 卡片单列堆叠，链路改纵向 |
| 模块信息更新后不同步 | 单一来源 `data.ts`，可后续接入文档同步脚本 |

---

## 4. 视觉锚点

### 4.1 参考页面

参考 `product-truth/03-design-truth/` 中的卡片设计 token：
- 卡片：使用现有 `bg-white border rounded-lg shadow-sm`
- 颜色：使用设计 token 中定义的 `primary/success/warning/danger` 语义色
- 间距：8px 栅格

### 4.2 组件

- 复用：`Card` / `Button` 等基础组件
- 新建：`BusinessMap` 容器 / `ModuleCard` / `LinkChain` / `StateMachineView`

### 4.3 禁止偏离

- 不引入新的图表库（react-flow 等），用纯 CSS/SVG 实现状态机连线
- 不在客户端组件中嵌入 large bundle

---

## 5. 测试计划

| 类型 | 范围 | 验收条件 |
|------|------|---------|
| 单元测试 | `lib/business-map/data.ts` 静态数据 | 至少 6 个模块、2 条链路、3 个状态机 |
| 组件测试 | `BusinessMap` / `ModuleCard` / `LinkChain` | 渲染、点击跳转 |
| E2E | `/business-map` 页面加载 | 200 状态，所有 6 卡片可见 |
| 人工验收 | iPad 横向 | 卡片双列，链路完整可见 |

---

## 6. 实施记录

### 2026-06-02

- 创建页面骨架 `app/business-map/page.tsx`
- 创建数据源 `lib/business-map/data.ts`
- 创建组件 `components/business-map/`
- 添加导航入口

### 代码位置

- `app/business-map/page.tsx`
- `lib/business-map/data.ts`
- `components/business-map/ModuleCard.tsx`
- `components/business-map/LinkChain.tsx`
- `components/business-map/StateMachineView.tsx`
- `components/layout/sidebar.tsx`（修改）

---

## 7. 状态变更日志

| 日期 | 状态 | 变更说明 |
|------|------|---------|
| 2026-06-02 | drafting → in_progress | 开始实施 |
| 2026-06-02 | in_progress → completed | 完成 v1 静态视图 |
