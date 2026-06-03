---
req_id: F021
type: design-asset
status: implemented
---

# F021 技术架构 - 设计资产

## 视觉规范

### 颜色使用

| 元素 | Token | 用途 |
|------|-------|------|
| 章节标题 | `slate-900` + 表情 icon | 视觉锚点 |
| 表格头 | `slate-50` | 表头底色 |
| API 路由 | `blue-700` (mono) | 路径前缀 |
| 事件名 | `purple-700` (mono) | 事件标识 |
| 缓存技术 | `emerald-700` (mono) | 技术栈 |
| 性能目标 | `emerald-50/700` | 达标值 |
| 表格行 | `border-slate-100` | 行分隔 |

### 章节结构

每个章节统一结构：
- 标题：`text-xl font-semibold + icon`
- 卡片：`rounded-lg border bg-white`
- 表格：`overflow-x-auto` 保证移动端可滚动
- 锚点：`scroll-mt-4` 配合顶部导航

## 与 F020 一致性

- 顶部锚点导航胶囊样式保持一致
- 卡片视觉风格（圆角、边框、padding）统一
- 颜色 token 全部复用
- 不引入新的图表库
