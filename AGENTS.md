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
