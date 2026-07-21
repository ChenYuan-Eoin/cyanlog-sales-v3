# Feature Packet: F022-AI 服务降级（历史，已由 F012 取代）

**Created**: 2026-06-02
**Superseded**: 2026-07-20
**Clarified**: 2026-07-22
**REQ ID**: F022
**Status**: `superseded`
**Superseded By**: `F012`
**Current Truth**: `F012-ai-runtime-config.md`
**Runtime Evidence**: `WP02`
**Release Acceptance**: `WP09`

---

## 1. 为什么这个 packet 不再作为开发依据

F022 曾把 AI 运行固定描述成“本地模型 → 云端模型 → 规则引擎”三级链，并把页数阈值、固定超时和 `forceCloud` 当作业务接口能力。这种模型同时混淆了四类不同对象：

- 模型服务如何接入；
- 某个 Provider 下有哪些模型；
- 产品功能选择哪个 AI 应用；
- 合同规则引擎如何做确定性判定。

这正是配置页面曾经出现“模型、合同场景、规则兜底混在一起”的根因。自 2026-07-20 起，F022 只保留历史追溯，不得继续指导代码、界面、测试或发布结论。

## 2. 现行产品模型

模型平台唯一链路由 F012 定义：

`业务用点 → 应用绑定 → AI 应用 → 路由策略 → 模型目录 → Provider 连接`

| 业务问题 | 现行对象 | 业务人员看到的结果 |
|---|---|---|
| 如何访问一个模型服务 | `ProviderConnection` | 本地/云端、地址、认证与连接测试 |
| 这个服务提供哪些模型能力 | `ModelCatalogEntry` | 可用模型及文本生成、结构化、长上下文等能力 |
| 哪些产品功能使用 AI | `BusinessUsePoint + ApplicationBinding` | 合同审核、合同起草、标书解析等功能选择已发布应用 |
| 主模型失败后怎么办 | `RoutePolicy` | 有序模型候选与“转人工/停止”动作 |
| 合同规则如何判定 | F009 规则集合 | 问题分类、具体规则、业务属性、判定与处理 |

`rule-engine` 不是 Provider、模型或 AI 降级层。它可以独立返回自身能证明的确定性结果，但不能制造 `model_invocations`，也不能冒充 AI 调用成功。

## 3. 环境感知路由

管理员配置的是一个可在不同执行环境中投影的有序路由：

- 本机环境可以执行：`本地模型 → 云端模型`；
- Hosted 环境不能访问用户电脑的 `127.0.0.1`，因此排除 local Provider，并从第一个 cloud Provider 开始真实调用；
- 环境排除不是一次 Provider 失败，不生成虚假的 invocation，不标记为 fallback；
- Hosted 路由若全部是 local Provider，则失败关闭并提示管理员补充公网可达模型；
- 运行快照同时保存管理员配置顺序和本环境实际执行顺序，历史证据不可改写。

## 4. 当前实现与验收归属

- **F012 / WP01**：六对象控制面、草稿/发布/修订、Provider probe 与旧版控制面交互；
- **WP02**：业务调用只消费已发布运行计划，记录 route/pinned、Provider、模型、token、`model_invocations` 与 ReviewRun；
- **WP09（当前）**：现行业务五任务、Hosted 环境路由投影、配置顺序与实际顺序的业务可读展示，以及同一 release commit 的 Preview 真实运行验收；
- **F009 / WP03**：合同规则集合、问题分类、业务属性、判定与处理；
- **WP05**：审核准确率与循环复审，不由“模型能返回”替代。

## 5. 历史资产处理

旧 `/ai-fallback` 静态页、固定 L1/L2/L3 文案、`forceCloud`、`ai_fallback_log` 设想和 `lib/ai-fallback/*` 只作为历史审计线索。若代码中仍有残留，必须先判断是否被现行业务消费；不得为了保留旧设计重新接回正式运行链。
