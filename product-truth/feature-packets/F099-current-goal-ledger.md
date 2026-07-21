# F099-当前开发工作包账本

**Status**: active_work_package_ledger
**Updated**: 2026-07-21
**Ledger Version**: v2026-07-21.02
**Portfolio Goal Source**: `product-truth/REQ_REGISTRY.yml#goal_governance`
**Active Queue Source**: `governance/runtime-state/active-task.json`

---

## 0. 编号合同

- `G1-G11` 是不可变长期产品组合目标，不进入 Active。
- `WP00-WP09` 是可排序、可独立验收的开发工作包；ID 永远只存短编号，名称和 slug 单独存放。
- `F` 是 Feature Packet，`IN` 是需求输入，`DG` 是历史交付门禁，`HG0-HG5` 是 Harness 执行门禁。
- WP 完成不等于 G 完成；证据必须绑定目标版本、WP、Git SHA、环境及浏览器或真实文件产物。
- 2026-07-10 至 2026-07-18 的执行账本旧别名 `G1-G9` 依次映射为 `WP01-WP09`；F027 旧 `G0-G7` 依次映射为 `DG0-DG7`；Harness 历史证据旧 `G0-G5` 依次映射为 `HG0-HG5`。历史原文、路径和文件名不改。

## 1. 当前工作包

| WP | Slug | 主要 G | 当前状态 | 边界 |
|---|---|---|---|---|
| WP00 | goal-baseline-consolidation | G1/G10/G11 | Completed / `18dad230` | 已统一编号、真相源、Harness 和候选分支治理快照 |
| WP01 | ai-platform-foundation | G4；支撑 G3/G7 | Completed / `4269840f` | Provider、模型目录、AI 应用、业务用点、绑定、路由 |
| WP02 | ai-runtime-truth | G3；支撑 G7/G10 | Completed / `c25ec17a` | 五业务用点、真实 invocation/token、ReviewRun、降级、route/pinned 证据 |
| WP03 | rule-collection | G3/G4；支撑 G7/G10 | **Active** / repair_invalid_published_rule_assets | 规则集→问题分类→具体规则→规则详情→属性/判定/处理 |
| WP04 | contract-center-ia | G6；支撑 G8 | needs_reacceptance | 合同中心入口、任务身份、版本和下一步 |
| WP05 | multiformat-review-cycle | G2；支撑 G3/G6/G8/G10 | parked / NO-GO | 新源文件、事前独立金标、文件版本、风险迁移与循环复审 |
| WP06 | document-compare | G6；支撑 G7/G8/G10 | completed_preview_candidate_not_production | 历史 Preview 候选状态保留；当前候选与 Production 仍需 WP09 绑定复验 |
| WP07 | contract-drafting | G6；支撑 G2/G8/G10 | queued | 可编辑草稿、版本、DOCX 导出、转审核/对比 |
| WP08 | experience-umbrella | G5/G8 | must_split_before_activation | 激活前拆为品牌主题、组织交互、响应式 Shell |
| WP09 | release-acceptance | G7/G8/G9/G10/G11 | queued | 唯一候选、测试/build、桌面/iPad、真实文件、Preview/Production |

执行顺序为 `WP00（已完成） -> WP01（已完成） -> WP02（已完成） -> WP03（Active） -> WP05 交互纠偏子批 -> WP04/WP07 -> WP08 子包 -> WP09`。WP05 的准确率和循环复审闭环仍受独立金标门禁约束，但正文滚动和默认任务页签不再因此冻结。旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆回 WP01、WP03、WP09，不再作为 Active。

## 2. 候选边界

WP00 已由提交 `18dad230bbc12a6cf664e5868cc25d57bbb65fd3` 固化；WP01 已由实现提交 `5a22f769ac03baf80d7436eecf79fe57a24c509b` 与收口提交 `4269840fbc798eb9a92faee44d6e467a250033b4` 重新验收完成；WP02 已由实现提交 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b` 完成。WP03-WP05 的旧“本地完成”总括结论仍无效，必须在各 WP 内按当前 Git SHA 与环境重新验收。WP06 仅保留“历史免费 Preview 候选”状态，不代表本分支或 Production 已重新验证。

Production 数据库继续只读；WP01/WP02 未部署 Production，也未覆盖根工作区受保护 dirty 快照。

## 3. WP01 完成证据（2026-07-20）

最终候选已完成下列控制面范围：

- 六个独立对象：`ProviderConnection`、`ModelCatalogEntry`、`AIApplication`、`BusinessUsePoint`、`ApplicationBinding`、`RoutePolicy`；
- 唯一解析方向：`BusinessUsePoint → ApplicationBinding → AIApplication → RoutePolicy → ModelCatalogEntry → ProviderConnection`；
- 业务用点由代码注册，Provider 不包含模型/合同阶段/规则引擎；
- 草稿、发布依赖、不可变发布版本、新草稿修订和草稿历史回滚；
- 配置页五任务工作区，移除造成白色空洞的异高 Grid / CSS columns 路径；
- `connection` 与 `model` 两种草稿参数 probe 口径；probe 只是当次请求结果，不持久化连接健康，不写 `model_invocations`，不代表生产可用或真实业务调用。

门禁结果：独立 API/安全与 UI 复审均为 GO；182 个测试文件 / 1255 项测试、lint、typecheck、75/75 build、桌面 1440×900、iPad 1024×768、0/1/14/50 发布筛选、50 卡自然高度、Provider Bearer 探测、两个模型最小生成、完整发布图、能力不匹配负向门禁、草稿历史回滚和 Preview 零残留均通过。证据索引为 `product-code/output/evidence/wp01/README.md`。

**WP01 退出结论**：六对象/API、Provider 安全、五任务 UI、工程门禁、桌面/iPad、隔离 Preview 六对象闭环以及旧 `AI_CONFIG / ModelPolicy` 兼容回退已通过，WP01 已转 completed。隔离 Preview `vsfropnfsmnonkotywsx` 已应用 `secure_ai_config_control_plane`；动态 bearer canary 与最终读回证明当前记录可持有凭据、历史版本无凭据且临时记录清理完成。此结论不外推到 Production。

## 4. WP02 完成证据（2026-07-21）

- 五个业务用点只从六对象发布图编译不可变运行计划，页面当前汇总为 `5 / 5 / 5 / 0`；
- LM Studio `google/gemma-4-e4b` 按实际 8K 上下文运行，云端 `gpt-5.5` 完成降级和长上下文标书解析；
- route/pinned、`execution_id`、连续 attempt、plan snapshot、Provider reported model、token 与 ReviewRun 均有数据库约束和反向测试；
- 真实 15,686 字合同沿当前发布 route 生成 ReviewRun `910d67ad-d109-444e-b009-4fa60352df66`；
- 195 files / 1342 tests、lint、typecheck、75-page build、桌面/iPad 浏览器、0 console error/warning通过；
- 审核准确率仍明确阻断：没有事前独立人工金标，且现有已发布规则资产编译无效，不能把模型可运行解释为审核质量通过。

证据索引：`product-code/output/evidence/wp02/README.md`。WP02 完成提交为 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b`。

**当前与下游门禁**：Active WP03 修复规则资产和规则集合产品模型；WP05 恢复后处理交互纠偏与独立金标准确率；WP09 在 Production 前验收专用事务/RPC 或强类型表、RLS、Hosted 路由和正式发布。
