---
req_id: F020
type: design-asset
status: implemented
---

# F020 业务地图 - 设计资产

## 视觉规范

### 颜色使用

| 元素 | Token | 用途 |
|------|-------|------|
| 模块卡片 | 6 色调色板 | 区分模块类别 |
| 链路 A | `blue-500/50/900` | 主线流程 |
| 链路 B | `purple-500/50/900` | 投标链路 |
| 状态机 - 进行中 | `slate-100/blue-50/amber-50` | 中间状态 |
| 状态机 - 成功 | `emerald-50/300` | 终态/成功态 |
| 状态机 - 失败 | `rose-50/300` | 拒绝/失败态 |

### 组件复用

- `Card` 模式：`rounded-lg border bg-white p-{4,5,6}`
- 锚点导航：`rounded-full bg-slate-100`
- 状态徽章：`font-mono text-xs border rounded px-2.5 py-1`

### 移动端断点

- `< 640px`：单列堆叠
- `640-1024px`：双列
- `> 1024px`：三列
- 链路视图：始终横向滚动（`overflow-x-auto`）

## 与现有 token 的关系

- 全部使用 `03-design-truth/colors_and_type.css` 中的语义色
- 未引入新的设计 token
- 未偏离现有卡片/按钮/导航的视觉风格
