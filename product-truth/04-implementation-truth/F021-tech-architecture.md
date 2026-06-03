---
req_id: F021
name: 技术架构
type: page-implementation
status: completed
completed_at: "2026-06-02"
---

# F021 实施证据

## 文件清单

| 文件 | 行数 | 角色 |
|------|------|------|
| `app/tech-architecture/page.tsx` | ~280 | 主页面（9 章节） |
| `lib/tech-architecture/data.ts` | ~150 | 静态数据源 |
| `lib/tech-architecture/data.test.ts` | ~80 | 数据源单测 |
| `components/layout/sidebar.tsx` | +1 行 | 侧边栏新增"技术架构" |

## 验收要点

- [x] 9 个章节全部覆盖
- [x] API 网关路由表（6 条）
- [x] 事件总线表（7 个事件）
- [x] 4 层缓存表
- [x] 3 种调用模式 + 代码示例
- [x] 开发 vs 生产部署对比
- [x] 性能目标表
- [x] 安全约束列表
- [x] 集成到侧边栏

## 验证结果

- `pnpm typecheck` → 0 错误
- `pnpm test:run` → 80+ 通过（含新增 ~15 个）
- `pnpm lint` → 0 警告

## 已知限制

- 服务调用电路图用纯文本字符（非 SVG），便于维护但视觉较弱
- 无实时架构健康度（v1 静态视图）
