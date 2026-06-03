---
req_id: F022
type: design-asset
status: implemented
---

# F022 AI 降级 - 设计资产

## 视觉规范

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
