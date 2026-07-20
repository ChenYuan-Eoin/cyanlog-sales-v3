# F099-当前开发工作包账本

**Status**: active_work_package_ledger
**Updated**: 2026-07-20
**Ledger Version**: v2026-07-20.01
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
| WP00 | goal-baseline-consolidation | G1/G10/G11 | **Active** | 统一编号、真相源、Harness 和候选分支治理快照；不改产品代码 |
| WP01 | ai-platform-foundation | G4；支撑 G3/G7 | Next / acceptance_disputed | Provider、模型目录、AI 应用、业务用点 |
| WP02 | ai-runtime-truth | G3；支撑 G7/G10 | needs_current_runtime_proof | 当前 probe、真实 invocation/token、ReviewRun、降级 |
| WP03 | rule-collection | G3/G4；支撑 G7/G10 | acceptance_disputed | 规则集→问题分类→具体规则→规则详情→属性/判定/处理 |
| WP04 | contract-center-ia | G6；支撑 G8 | needs_reacceptance | 合同中心入口、任务身份、版本和下一步 |
| WP05 | multiformat-review-cycle | G2；支撑 G3/G6/G8/G10 | parked / NO-GO | 新源文件、事前独立金标、文件版本、风险迁移与循环复审 |
| WP06 | document-compare | G6；支撑 G7/G8/G10 | completed_preview_candidate_not_production | 历史 Preview 候选状态保留；当前候选与 Production 仍需 WP09 绑定复验 |
| WP07 | contract-drafting | G6；支撑 G2/G8/G10 | queued | 可编辑草稿、版本、DOCX 导出、转审核/对比 |
| WP08 | experience-umbrella | G5/G8 | must_split_before_activation | 激活前拆为品牌主题、组织交互、响应式 Shell |
| WP09 | release-acceptance | G7/G8/G9/G10/G11 | queued | 唯一候选、测试/build、桌面/iPad、真实文件、Preview/Production |

执行顺序为 `WP00 -> WP01 -> WP02 -> WP03 -> WP04 -> WP05（恢复门禁满足后）/WP07 -> WP08 子包 -> WP09`。旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆回 WP01、WP03、WP09，不再作为 Active。

## 2. 候选边界

本分支只在 WP00 完成后才是可继续开发的治理候选。WP01-WP04 的旧“本地完成”总括结论已被用户验收推翻；局部代码和历史证据可复用，但必须在各 WP 内按当前 Git SHA 与环境重新验收。WP06 仅保留“历史免费 Preview 候选”状态，不代表本分支或 Production 已重新验证。

Production 数据库继续只读；WP00 不部署 Production，不覆盖根工作区受保护 dirty 快照。
