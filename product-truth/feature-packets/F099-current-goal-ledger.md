# F099-当前开发工作包账本

**Status**: active_work_package_ledger
**Updated**: 2026-09-10（当前队列指针；下文阶段证据保留历史日期）
**Ledger Version**: v2026-07-22.01
**Portfolio Goal Source**: `product-truth/REQ_REGISTRY.yml#goal_governance`
**Active Queue Source**: `governance/runtime-state/active-task.json`

---

## 0. 编号合同

- `G1-G11` 是不可变长期产品组合目标，不进入 Active。
- `WP00-WP99` 是可排序、可独立验收的开发工作包；ID 永远只存短编号，名称和 slug 单独存放。
- `F` 是 Feature Packet，`IN` 是需求输入，`DG` 是历史交付门禁，`HG0-HG5` 是 Harness 执行门禁。
- WP 完成不等于 G 完成；证据必须绑定目标版本、WP、Git SHA、环境及浏览器或真实文件产物。
- 2026-07-10 至 2026-07-18 的执行账本旧别名 `G1-G9` 依次映射为 `WP01-WP09`；F027 旧 `G0-G7` 依次映射为 `DG0-DG7`；Harness 历史证据旧 `G0-G5` 依次映射为 `HG0-HG5`。历史原文、路径和文件名不改。

## 1. 当前工作包

当前唯一 Active 是 WP10（报价域完整形态与换机可迁移基座）；WP09 已暂停。最新执行与发布证据看 worktree 的 codex-runtime。下表和后续详细叙述中，7月已完成阶段为历史证据，不能外推到当前 Production。

| WP | Slug | 主要 G | 当前状态 | 边界 |
|---|---|---|---|---|
| WP00 | goal-baseline-consolidation | G1/G10/G11 | Completed / `18dad230` | 已统一编号、真相源、Harness 和候选分支治理快照 |
| WP01 | ai-platform-foundation | G4；支撑 G3/G7 | Completed / `4269840f` | Provider、模型目录、AI 应用、业务用点、绑定、路由 |
| WP02 | ai-runtime-truth | G3；支撑 G7/G10 | Completed / `c25ec17a` | 五业务用点、真实 invocation/token、ReviewRun、降级、route/pinned 证据 |
| WP03 | rule-collection | G3/G4；支撑 G7/G10 | Completed / `ebdb3c59` | 规则集→问题分类→具体规则→规则详情→属性/判定/处理 |
| WP04 | contract-center-ia | G6；支撑 G8 | Completed / `a987f85d` | 四类合同任务、源文件身份、上传幂等编排与真实 Preview 工作台复验 |
| WP05 | multiformat-review-cycle | G2；支撑 G3/G6/G8/G10 | interaction_completed / `12b977fa`; accuracy_cycle_pending | 默认审查、风险定位和正文滚动已完成；准确率与循环复审仍独立受门禁 |
| WP06 | document-compare | G6；支撑 G7/G8/G10 | completed_preview_candidate_not_production | 历史 Preview 候选状态保留；当前候选与 Production 仍需 WP09 绑定复验 |
| WP07 | contract-drafting | G6；支撑 G2/G8/G10 | queued | 可编辑草稿、版本、DOCX 导出、转审核/对比 |
| WP08 | experience-umbrella | G5/G8 | must_split_before_activation | 激活前拆为品牌主题、组织交互、响应式 Shell |
| WP09 | release-acceptance | G7/G8/G9/G10/G11 | parked / waiting_wp10 | 托管路由投影、业务可读 AI 配置、唯一候选与 Preview 验收；Production 仍受门禁 |
| WP10 | quote-domain-complete-migration | 当前Active以调度源为准 | active | 报价域完整形态、换机与发布收口；不代表Production已验收 |

2026-07-22 历史执行顺序为 `WP00（已完成） -> WP01（已完成） -> WP02（已完成） -> WP03（已完成） -> WP05 交互纠偏（已完成） -> WP04（已完成） -> WP09（Active） -> WP07`。WP09 本批只处理托管环境 AI 路由、业务可读配置和同一 release commit 的 Preview 验收；规则业务数据、合同工作台、准确率和循环复审不混入。旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆回独立工作包，不再作为 Active。

## 2. 候选边界

WP00 已由提交 `18dad230bbc12a6cf664e5868cc25d57bbb65fd3` 固化；WP01 已由实现提交 `5a22f769ac03baf80d7436eecf79fe57a24c509b` 与收口提交 `4269840fbc798eb9a92faee44d6e467a250033b4` 重新验收完成；WP02 已由实现提交 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b` 完成；WP03 已由提交 `ebdb3c59f0205f1ed20b8a2bf4c2a67e5a29f4b5` 完成；WP05 交互纠偏已由提交 `12b977fa` 独立完成；WP04 已由提交 `a987f85d5701a38a13a245e0ebc5484cadecb3ab` 固化，并由隔离 Preview deployment `dpl_2P11eFtwxutsQXMUoU8R46XdDGUx` 完成真实入口和滚动复验。WP05 的旧“本地完成”总括结论仍无效，准确率和循环复审必须继续按当前 Git SHA、独立金标和真实版本链分别验收。WP06 仅保留“历史免费 Preview 候选”状态，不代表本分支或 Production 已重新验证。

Production 数据库继续只读；WP01-WP05 的上述候选均未部署 Production，也未覆盖根工作区受保护 dirty 快照。

## 3. WP01 完成证据（2026-07-20）

最终候选已完成下列控制面范围：

- 六个独立对象：`ProviderConnection`、`ModelCatalogEntry`、`AIApplication`、`BusinessUsePoint`、`ApplicationBinding`、`RoutePolicy`；
- 唯一解析方向：`BusinessUsePoint → ApplicationBinding → AIApplication → RoutePolicy → ModelCatalogEntry → ProviderConnection`；
- 业务用点由代码注册，Provider 不包含模型/合同阶段/规则引擎；
- 草稿、发布依赖、不可变发布版本、新草稿修订和草稿历史回滚；
- 配置页五任务工作区，移除造成白色空洞的异高 Grid / CSS columns 路径；
- `connection` 与 `model` 两种草稿参数 probe 口径；probe 只是当次请求结果，不持久化连接健康，不写 `model_invocations`，不代表生产可用或真实业务调用。

门禁结果：独立 API/安全与 UI 复审均为 GO；182 个测试文件 / 1255 项测试、lint、typecheck、75/75 build、桌面 1440×900、iPad 1024×768、0/1/14/50 发布筛选、50 卡自然高度、Provider Bearer 探测、两个模型最小生成、完整发布图、能力不匹配负向门禁、草稿历史回滚和 Preview 零残留均通过。证据索引为 `product-code/output/evidence/wp01/README.md`。

**WP01 退出结论**：六对象/API、Provider 安全、旧版控制面五任务 UI、工程门禁、桌面/iPad、隔离 Preview 六对象闭环，以及旧 `AI_CONFIG / ModelPolicy` 的只读保留与回滚追溯已通过，WP01 已转 completed。正式业务不再消费旧 ModelPolicy 的运行切换由 WP02 完成，不属于 WP01 的“兼容回退”。隔离 Preview `vsfropnfsmnonkotywsx` 已应用 `secure_ai_config_control_plane`；动态 bearer canary 与最终读回证明当前记录可持有凭据、历史版本无凭据且临时记录清理完成。此结论不外推到 Production。

## 4. WP02 完成证据（2026-07-21）

- 五个业务用点只从六对象发布图编译不可变运行计划，页面当前汇总为 `5 / 5 / 5 / 0`；
- LM Studio `google/gemma-4-e4b` 按实际 8K 上下文运行，云端 `gpt-5.5` 完成降级和长上下文标书解析；
- route/pinned、`execution_id`、连续 attempt、plan snapshot、Provider reported model、token 与 ReviewRun 均有数据库约束和反向测试；
- 真实 15,686 字合同沿当前发布 route 生成 ReviewRun `910d67ad-d109-444e-b009-4fa60352df66`；
- 195 files / 1342 tests、lint、typecheck、75-page build、桌面/iPad 浏览器、0 console error/warning通过；
- 审核准确率仍明确阻断：没有事前独立人工金标，且现有已发布规则资产编译无效，不能把模型可运行解释为审核质量通过。

证据索引：`product-code/output/evidence/wp02/README.md`。WP02 完成提交为 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b`。

**当前与下游门禁**：WP03 已完成规则资产和规则集合产品模型；WP05 交互纠偏已完成，独立金标准确率与循环复审继续分别受门禁；WP04 已完成四类合同任务入口和上传编排；Active WP09 先关闭 Hosted 路由短路、业务可读配置和同一 release commit 的 Preview 运行证据。Production 前的专用事务/RPC、RLS 和正式发布仍保持独立门禁。

## 5. WP03 完成证据（2026-07-21）

- 领域模型已固定为 `RuleSet → ProblemCategory → Rule → RuleDetail → 业务属性 → 判定与处理`；问题分类只组织问题，模型只在运行时读取已定义属性和原文证据。
- 隔离 Preview 的新组织已从空白创建“合同金额不得低于 5 万元”：金额/CNY、`< 50000` 风险、`>= 50000` 正常、缺失/冲突人工处理，五条用例通过后原子发布；R001-R015 保持另一组织的可编辑预置业务数据，未自动发布。
- 真实 DOCX 经已发布规则与 AI 路由生成 ReviewRun `92d0a165-ce85-4b5b-9bd1-b1f7a8653f9f`，本地 `google/gemma-4-e4b` 调用记录 `607/561/1168` token，并产生绑定规则快照、原文位置和 `30000 CNY` 的风险事实。
- 全量门禁为 `201` 个测试文件 / `1437` 项测试通过（另有 `2` 文件 / `5` 个真实 live 测试按默认策略跳过），WP03 目标 `15` 文件 / `206` 测试、lint、typecheck、76-page build、桌面 1440×900、iPad 1024×768 与独立复审通过。
- 证据索引：`product-code/output/evidence/wp03/generic-configuration-runtime-acceptance.md`；历史预置数据审计：`product-code/output/evidence/wp03/r001-r015-business-confirmation-candidates.md`（确认门结论已废止）。

**WP03 退出结论**：系统支持项与业务数据已分离。没有预置数据的新组织可由业务人员使用“规则集—问题分类—具体规则—业务属性—判定与处理”完成配置、测试、发布和真实触发；R001–R015 只是可选预置草稿。此结论证明配置及运行链真实，不证明合同审核准确率，独立金标仍是 WP05 后续门禁。

## 6. WP05 交互子批完成证据（2026-07-21）

- 默认入口：运行状态只决定下一步提示，不决定用户进入哪个面板；无 `panel` 时始终进入“审查”，只有用户显式切换才把面板写入 URL。
- 风险定位：文档阅读区必须由视口约束并拥有唯一纵向滚动轴；点风险只滚动文档，不滚动浏览器窗口，定位后滚轮、触控、键盘和连续风险切换仍可用。
- 真实长 DOCX 在桌面与 iPad 均保持唯一文档滚动轴；点击末页风险只改变正文容器位置，滚轮继续有效，浏览器窗口不跳动。
- 文本 PDF 与扫描 PDF 均使用受约束的浏览器原生阅读区；文本 PDF 明示原生阅读器不能可靠跳转字符偏移，扫描 PDF 明示 OCR 只辅助定位，两者均不伪造“已定位”。
- 无 `panel`、显式证据、刷新、前进与后退的 URL/页签状态一致；运行状态不再替用户选择页面。
- 目标 `6` 文件 / `47` 测试与全量 `203` 文件 / `1459` 测试、lint、typecheck、76-page build、桌面/iPad、真实 DOCX/PDF 均通过；证据索引为 `product-code/output/evidence/wp05/workbench-interaction-acceptance.md`，完成提交为 `12b977fa`。

**WP05 子批退出结论**：默认审查入口、风险定位和正文连续阅读已完成。此结论只关闭交互纠偏，不证明审核准确率、风险迁移、循环复审或最终交付完成。

## 7. WP04 完成证据（2026-07-22）

- 四个业务任务必须分别可理解：`起草合同`、`上传并发起风险审核`、`继续/查看已有审核`、`选择两个版本进行文档比对`；入口说明对象、前置条件、目标页和下一步，不允许全部退回上传页。
- 入口矩阵覆盖无合同、单版本、已有 ReviewRun、多版本四类状态；URL 只表达用户选择的任务，不用运行状态暗中切换页面。
- 上传编排固定为：建立合同与唯一版本身份 → 保存原文件与哈希 → 解析文本 → 建立当前 `source_page_map` → 启动且只启动一次正式 ReviewRun。
- 重复上传回调、解析完成通知和页面重试必须幂等；失败停留在可解释步骤并可恢复，不能先生成 `SOURCE_IDENTITY_MISSING` 的失败审核再补数据。
- 提交 `a987f85d5701a38a13a245e0ebc5484cadecb3ab` 通过 pre-commit：237 个测试文件通过、2 个跳过；1743 项测试通过、5 项跳过，并完成 lint、typecheck 与治理校验。
- 隔离 Preview `dpl_2P11eFtwxutsQXMUoU8R46XdDGUx` 的真实合同列表链接不再强制 `panel=evidence`；桌面 1440×1000 与 iPad 1180×820 均默认进入“审查”。
- 选中第 45 页风险后，DOCX 内部正文 `scrollTop` 可继续变化，`window.scrollY` 保持不动；临时风险与短期认证 token 均按精确 ID 清理为 0。Production 未写入或部署。

## 8. WP09 历史批次（2026-07-22，现暂停）

- 产品链不变：平台层管理 Provider、模型目录、可复用 AI 应用和路由；业务模块只选择已发布应用；合同规则集与问题分类仍由 F009 管理。
- 页面主任务必须让业务人员依次看懂“接入了什么模型能力 → 哪些产品功能在使用 → 管理员配置的主备顺序 → 当前环境实际会执行什么”，内部表名、环境变量和机器编码只能作为次级审计信息。
- 同一路由在本机可按 `local → cloud` 执行；在 Hosted 环境必须排除只能从用户电脑访问的 local Provider，并把 cloud 作为第 1 次真实尝试。环境排除不是 Provider 失败，不得生成 local invocation 或标记为降级。
- `AIRuntimePlanSnapshot` 同时保存管理员配置顺序和当前环境有效顺序；有效顺序必须是配置顺序的有序子序列，历史快照继续兼容。
- 本批退出必须由同一个 release commit 的隔离 Preview 证明：真实 cloud Provider、真实业务用点、ReviewRun、`model_invocations`、token、桌面/iPad 与工程门禁。Production 继续只读且不部署。
