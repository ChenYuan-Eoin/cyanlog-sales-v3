---
doc_id: index
name: 产品真相层索引
module: index
---

# 产品真相层索引

## 真相线状态说明

| 目录 | 状态 | 说明 |
|------|------|------|
| `01-business-truth/` | **active** | 业务真相层，验证期 truth 入口 |
| `02-technical-truth/` | **active** | 技术真相层，非实现期参照 |
| `03-implementation-truth/` | reserved | 预留：实现真相层（API契约、数据模型精粹）|
| `prd-产品需求文档/` | frozen | 冻结：旧派生文档体系，不再更新 |
| `product-code-产品开发代码/` | frozen | 冻结：旧代码 truth 占位，内容已迁移 |
| `REQ_REGISTRY.yml` | **active** | 统一需求注册表，唯一状态源 |
| **打开 Issue 或者 项目讨论 追踪** | | 当前功能闭环 feature packet |

## 开发入口冻结规则

- **母文档** (`PROJECT-主文档.md`): frozen — 只当源头母本，不直接驱动开发
- **旧派生文档**: frozen — 整标记为 `legacy` 或 `frozen`，不再回填实现细节
- **当前唯一 active 入口**:
  - `REQ_REGISTRY.yml` — 需求状态/映射
  - `Feature Packet` — 具体功能闭环规则
  - `visual baseline` — 视觉锚点
  - repo 执行真相 — hook/registry/code

## 以后只能往哪回写

| 信息类型 | 回写位置 |
|----------|----------|
| 需求状态 / 代码映射 | `REQ_REGISTRY.yml` |
| 功能闭环规则 | `Feature Packet` |
| 视觉调整 | 对应 visual baseline |
| 执行链规则 | `governance/` + `CLAUDE.md` |

**禁止继续派生，除非有明确归宿。**

---

## 01-业务真相层 (active - 参照用)

| 文档 | 模块 | 优先级 | 对应主文档章节 |
|------|------|--------|---------------|
| [业务地图.md](01-business-truth/业务地图.md) | business-map | P0 | 第1章、第2章 |
| [Account.md](01-business-truth/Account.md) | account | P0 | 第3章 |
| [报价中心.md](01-business-truth/报价中心.md) | quotes-center | P0 | 第4章 |
| [合同审核.md](01-business-truth/合同审核.md) | contract-review | P0 | 第5章 |
| [配置中心.md](01-business-truth/配置中心.md) | config-center | P1 | 第6章 |
| [标书中心.md](01-business-truth/标书中心.md) | tender-center | P1 | 第7章 |
| [知识库管理.md](01-business-truth/知识库管理.md) | knowledge-base | P2 | 第8章 |
| [日程管理.md](01-business-truth/日程管理.md) | schedule-management | P2 | 第9章 |

## 02-技术真相层

| 文档 | 模块 | 优先级 | 对应主文档章节 |
|------|------|--------|---------------|
| [技术架构.md](02-technical-truth/技术架构.md) | technical-architecture | P0 | 第10章 |
| [AUTH-DESIGN.md](02-technical-truth/AUTH-DESIGN.md) | account | P0 | 第3章（备忘暂存） |

## 文档命名规范

- **模块简称-功能** 命名法
- 业务文档使用中文
- 技术文档使用英文
- 索引文件统一用 `README.md`
