---
doc_id: index
name: 产品真相层索引
module: index
---

# 产品真相层索引

## 目录结构说明

| 目录 | 状态 | 说明 |
|------|------|------|
| `01-business-truth/` | **active** | 业务真相层，包含业务地图、各模块需求文档（P0-P2） |
| `02-technical-truth/` | **active** | 技术真相层，包含技术架构、备忘设计文档 |
| `03-implementation-truth/` | reserved | 预留：实现真相层（API契约、数据模型精粹） |
| `prd-产品需求文档/` | reserved | 预留：产品需求文档（PRD 总纲目录） |
| `product-code-产品开发代码/` | reserved | 预留：产品开发代码（代码真相层入口） |
| `REQ_REGISTRY.yml` | **active** | 统一需求注册表，F001-F028 需求状态管理 |

## 01-业务真相层 (active)

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
