---
req_id: F022
type: design-asset
status: superseded
superseded_by: F012
superseded_at: "2026-07-20"
historical_evidence_only: true
---

# F022 AI 降级 - 历史设计资产（已废弃）

> 本文件只保留 2026-06-02 旧版三级降级页面的视觉追溯，不再指导产品、代码、测试或发布。现行真相是 `product-truth/feature-packets/F012-ai-runtime-config.md`：业务功能选择已发布 AI 能力，模型候选由 RoutePolicy 管理，规则引擎不属于模型降级链。

## 历史视觉规范（不可复用为现行产品拓扑）

### Level 卡片颜色

| Level | Token | 含义 |
|-------|-------|------|
| Level 1 | `emerald-50/100/200/700` | 默认/绿色（健康） |
| Level 2 | `blue-50/100/200/700` | 备用/蓝色（兜底 1） |
| Level 3 | `slate-50/100/200/700` | 兜底/灰色（规则） |

### 路由阈值表

- 测试用例实时计算 `determineStartLevel` / `determineStrategy`
- 用 `emerald-50` badge 显示起始 Level
- 用 `blue-700` mono 字体显示策略名

### 降级历史（v1 静态）

- Level 1 → `emerald-50`
- Level 2 → `blue-50`
- Level 3 → `slate-100`

## 与 F020/F021 一致性

- 顶部无锚点导航（4 章节直接在页面滚动）
- 卡片圆角/边框风格统一
- 表格横向滚动、padding 与 F021 一致
