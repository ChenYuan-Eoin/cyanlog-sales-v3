# Price V3 Codex 调度入口

在本仓库执行任何任务前，先读取：

1. `governance/runtime-state/active-task.json`
2. `governance/runtime-state/demand-inbox.jsonl`

## 强制调度规则

- 同时只能有一个 `execution_queue.active`。
- `G1-G11` 只表示不可变产品组合目标；可执行批次必须使用短 ID `WP00`-`WP99`，名称与 slug 单独存放，禁止把 G、P0 或带名称的长 WP ID 写入 Active/Next。
- `F` 表示 Feature Packet，`IN` 表示需求输入，`DG` 表示历史交付门禁，`HG0-HG5` 表示 Harness 执行门禁；不得跨命名空间复用编号。
- 用户新输入默认进入 Inbox，不得自动替换 Active。
- 当前实现的澄清或验收反馈可以归入 Active；新需求、普通 Bug、技术线索和后续优化必须先评估。
- 一条输入包含多个意图时，拆成多个关联事项，不得扩张成混合开发任务。
- 只有生产/数据/安全事故、继续会造成重大返工、证据推翻当前方向，或用户看过影响评估后明确批准，才允许插队。
- 修改文件前运行：

  `node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js scheduler-check <path...>`

- 校验失败时不得修改目标文件；先更新 Inbox、给出影响评估或请求用户批准切换 Active。
- `product_baseline.status` 不是 `active` 时，禁止修改 `product-truth/product-code`。
- 不得删除、覆盖、stash 或 reset `protected_snapshot` 中的既有 dirty 状态。
- 未经用户批准不得 push、创建 PR 或部署 Production。

## 执行授权边界

- 产品方向、目标和安全边界已经批准后，AI 对范围内可逆的技术选择、工具调用、Preview 写入、测试、排错和实现步骤承担决策责任，不得逐项向用户索要技术授权。
- 只有下列情况才停下来请示：会改变产品结果或方案方向的取舍；尚未批准的重大业务、法律或持续成本影响；不可逆或无法安全回滚的外部动作；证据冲突足以推翻当前产品基线。
- 需要用户判断时，必须先给出推荐结论、证据、影响和备选方案；不得把只存在于 AI 内部上下文的技术细节直接交给用户盲选。
- 既有明确禁令仍然有效，例如保护 dirty 快照以及未经批准不得 push、创建 PR 或部署 Production；技术执行授权不能暗中扩大产品范围。
- 持续付费依赖默认放弃；只有单次、确实绕不过去且影响已量化的费用才进入用户决策，不得把付费基础设施当作默认技术前提。

产品需求真相仍由 `product-truth/REQ_REGISTRY.yml` 与对应 Feature Packet 管理；本文件只管理 AI 如何读取和执行队列。

## 强制交付闭环

- `G` 只定义业务结果，`WP` 只承载一个可演示的用户任务；预计超过一个工作日、跨两个独立业务域或含两个可独立验收结果时，必须拆批。
- 每个缺陷先建立复现胶囊：候选 SHA、部署 URL、viewport、初始状态、操作、期望、实际、截图或 DOM/API 证据。没有复现证据不得直接按截图表象改 CSS 或代码。
- 固定顺序为：`复现 → 根因 → 最小实现 → 目标回归 → 同 SHA Preview 真实用户路径 → main 收敛`。任一步失败都回到最近有事实证据的步骤，不得继续堆补丁。
- 60 秒没有新增事实证据时必须换验证手段；同一路径失败两次必须记录阻断或改变方法，禁止无证据循环。
- 测试分层：微修复只跑目标测试与精确浏览器路径；WP 关闭前跑受影响套件、typecheck、build；主干集成前再跑全量测试、lint、typecheck、build 和安全/文件门禁。禁止在同一 hook 中重复执行同一套全量检查。
- Validator、hook 和反馈收集器不得修改 tracked 文件。运行日志必须写入 `git rev-parse --git-path codex-runtime` 对应的 worktree 独立目录。
- Harness 的目标合同、阶段和证据同样属于运行态，默认写入每个 worktree 的 `codex-runtime/harness`；`active-task.json` 只保留静态目标状态、分支策略、必需检查和阻断项，不得写入当前 HEAD、Preview deployment 或动态完成状态。
- Active WP 最多允许 3 个阻断当前验收的微修复胶囊；普通 Bug 和新需求仍进 Inbox。微修复不得借机扩大产品范围。
- 交付状态只能依次为 `executing → code_green → clean_preview_green → integration_ready → main_integrated`；`production_released` 是独立且需批准的下一状态。不得再用笼统的 “completed” 同时代表代码、Preview、main 和 Production。
- 代码、Preview、发布隔离和缺陷复验先用 `delivery-record` 写入 worktree 独立运行证据，再用 `delivery-transition <state>` 按顺序推进；主干收敛前用 `delivery-seal` 将证据绑定到当前 SHA 的 `refs/notes/price-v3-delivery`，并推送该 note ref。Git note 不改变 HEAD，也不得包含秘密。
- 每次状态推进后运行：

  `node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js delivery-check <state>`

- `clean_preview_green` 必须绑定一个已提交且干净的 SHA，并执行真实操作链；页面能打开、静态层数为零或历史 Preview 通过不能替代本次用户路径。
- `integration_ready` 必须满足：当前 SHA 的 Preview 已重放阻断路径且 Git note/runtime attestation 将缺陷标记为 verified、`origin/main` 仍是候选祖先、Vercel Production Branch 已与 `main` 解耦。仅有 Inbox `resolves` 文本不能关闭缺陷。`main_integrated` 后必须重新 fetch，确认 `origin/main == candidate SHA` 且 Production 部署未变化。
