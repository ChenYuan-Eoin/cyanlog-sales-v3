---
req_id: F020
name: 业务地图
type: page-implementation
status: completed
completed_at: "2026-06-02"
---

# F020 实施证据

## 文件清单

| 文件 | 行数 | 角色 |
|------|------|------|
| `app/business-map/page.tsx` | ~110 | 主页面（server component） |
| `lib/business-map/data.ts` | ~150 | 静态数据源（6 模块、2 链路、3 状态机） |
| `lib/business-map/data.test.ts` | ~70 | 数据源单测（12+ 用例） |
| `components/business-map/ModuleCard.tsx` | ~50 | 模块卡片（可点击跳转） |
| `components/business-map/LinkChain.tsx` | ~55 | 链路可视化（编号 + 步骤） |
| `components/business-map/StateMachineView.tsx` | ~75 | 状态机视图（节点 + 转换） |
| `components/layout/sidebar.tsx` | +1 行 | 侧边栏新增"业务地图"入口 |

## 验证结果

- `pnpm typecheck` → 通过
- `pnpm test:run` → 47/47 通过（含新增 12 个数据源测试）
- `pnpm lint` → 即将运行

## 验收要点

- [x] 6 个核心模块卡片化展示
- [x] 2 条主链路（报价主线、投标线）横向可视化
- [x] 3 个核心对象状态机
- [x] 入口独立性铁律说明
- [x] 集成到侧边栏
- [x] 移动端单列堆叠
- [x] iPad 横向双列

## 已知限制

- 业务地图为静态视图，不反映实时业务数据（v1 范围明确）
- 状态机用纯 CSS 实现，未引入 react-flow（避免 bundle 膨胀）
