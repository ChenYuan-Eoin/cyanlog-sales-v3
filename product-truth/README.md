---
doc_id: index
name: 产品真相层索引
module: index
---

# 产品真相层索引

## 真相线状态说明

| 目录 | 状态 | 说明 |
|------|------|------|
| `product-code/` | **active** | 代码执行域，唯一可运行代码位置 |
| `01-business-truth/` | frozen | 冻结业务背景，只保留模块级业务语义，不再作为实现主入口 |
| `02-technical-truth/` | **active** | 技术真相层，非实现期参照 |
| `03-design-truth/` | **active** | 视觉真相层，视觉锚点来源 |
| `04-implementation-truth/` | reserved | 实现真相层预留（API契约、数据模型精粹）|
| `feature-packets/` | **active** | 功能闭环包，当前唯一功能开发入口 |
| `REQ_REGISTRY.yml` | **active** | 统一需求注册表，唯一状态源 |

## 开发入口冻结规则

- **母文档** (`PROJECT-主文档.md`): frozen — 只当源头母本，不直接驱动开发；阶段性纠偏只回写稳定的目标、边界和对象摘要
- **01-business-truth/**: frozen — 只保留业务背景，不再回填实现细节
- **治理文档**: 只能位于 `governance/truth-docs-治理真相文档/`
- **当前唯一 active 入口**:
  - `REQ_REGISTRY.yml` — 需求状态/映射
  - `Feature Packet` — 具体功能闭环规则
  - `03-design-truth` — 视觉锚点
  - repo 执行真相 — governance/code

### Feature Packet 约束补充

- `REQ` 没有被取消，也不能被删除
- `REQ_REGISTRY.yml` 仍然是当前开发的核心索引与状态源
- `Feature Packet` 是每个 REQ 的展开执行单，不替代 REQ 本身
- 单个 `REQ` 必须对应自己的 `Feature Packet`
- 跨多个 `REQ` 的共享领域架构，允许沉淀为一个共享 `Feature Packet`
- 共享 `Feature Packet` 只负责架构边界，不替代具体 `REQ Packet`
- 禁止再用“组合稿”代替多个独立 `REQ` 的 active truth

**因此当前正确链路是**：
`主文档母本 -> REQ_REGISTRY.yml -> Feature Packet -> design / implementation truth -> code`

`REQ-F009-F012.md` 被降级，并不表示 `F009-F012` 这些 REQ 被删掉；相反，是把原来错误的“组合稿”拆回到各自独立 REQ 上。

## 当前纠偏目标入口（2026-06-30）

本轮线上问题重开后，需求、Bug 和研发目标按以下路径查阅，不再按临时聊天结论或零散修复标题推进。

| 要查什么 | 权威位置 | 作用 |
|----------|----------|------|
| 第一阶段主目标与 G1-G11 子目标 | `00-master/PROJECT-主文档.md#0.4` | 说明当前产品纠偏的主目标、子目标、完成标准和合并规则 |
| 问题域 PD01-PD10 与需求缺口 | `REQ_REGISTRY.yml#audit_supplement` | 把产品愿景、模块目标、F0xx、验收证据和问题域绑定起来 |
| 结构化需求清单 | `feature-packets/F027-remediation-governance.md#0.1` | 把用户反馈、主文档和 F0xx 整理成可验收需求 |
| Bug 修复清单 | `feature-packets/F027-remediation-governance.md#0.2` | 记录 Bug ID、问题域、关联 REQ、证据、修复方向、验收标准和状态 |
| 用户原始 A-G 问题映射 | `feature-packets/F027-remediation-governance.md#0.2.3` | 保留原始反馈来源，避免合并后看不见用户问题 |
| 执行批次 | `feature-packets/F027-remediation-governance.md#0.2.2` | 按 B0-B5 批次推进，不以“改了代码”作为完成信号 |
| 当前执行看板 | `feature-packets/F027-remediation-governance.md#0.2.2.1` | 区分本地已验证、线上待复验、设计缺口、收尾缺口和下一步出口 |

判断完成时必须同时看 `REQ_REGISTRY.yml` 的需求状态、F027 的 Bug/批次状态、对应 F0xx 的研发依据、代码事实和验收证据。单个位置显示“已修复”不能单独证明产品闭环完成。

## 以后只能往哪回写

| 信息类型 | 回写位置 |
|----------|----------|
| 需求状态 / 代码映射 | `REQ_REGISTRY.yml` |
| 功能闭环规则 | `Feature Packet` |
| 视觉调整 | 对应 visual baseline |
| 执行链规则 | `governance/` + `CLAUDE.md` |

### 主文档回写阈值

- **不会日常回写主文档**：页面细节、交互补充、局部 API 细节、实现期约束，优先写入 `Feature Packet` / `03-design-truth` / `04-implementation-truth`
- **会阶段性回写主文档**：当模块边界、核心对象、状态机、跨模块消费关系、系统级能力域发生稳定变化时，再把稳定结论摘要回写到母文档
- **设计文档可以比主文档更细**：这是允许的；主文档负责“骨架和边界”，详设负责“展开和落地”
- **禁止双真相**：如果详设已经推翻主文档原判断，必须在阶段收口时同步修正母文档摘要，不允许长期并存两套相反说法

**禁止继续派生，除非有明确归宿。**

---

## 01-业务真相层 (frozen - 只读背景)

> 本目录不再承载治理文档，也不再作为功能开发主真相。
> 当前开发、验收、回写统一以 `REQ_REGISTRY.yml` + `feature-packets/` + `03-design-truth/` 为准。

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
| [销售赋能与考核中心.md](01-business-truth/销售赋能与考核中心.md) | sales-enablement-center | P2 | 附录Y7 |

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
