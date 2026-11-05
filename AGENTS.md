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
- 在用户已确定的产品范围内，通过必要检查后由 AI 自动 push、创建 PR、部署 Production 并完成正式站复验，无需逐候选再次请求批准。不得把推送或部署本身当成验收通过。

## 执行授权边界

- 产品方向、目标和安全边界已经批准后，AI 对范围内可逆的技术选择、工具调用、Preview 写入、测试、排错和实现步骤承担决策责任，不得逐项向用户索要技术授权。
- 只有下列情况才停下来请示：会改变产品结果或方案方向的取舍；尚未批准的重大业务、法律或持续成本影响；不可逆或无法安全回滚的外部动作；证据冲突足以推翻当前产品基线。
- 需要用户判断时，必须先给出推荐结论、证据、影响和备选方案；不得把只存在于 AI 内部上下文的技术细节直接交给用户盲选。
- 保护 dirty 快照、真实顺丰下单由用户核对确认等明确边界仍然有效；自动发布权限不扩大生产数据写入、迁移、付费或安全授权。已有明确授权可继续执行，不重复请示。
- 持续付费依赖默认放弃；只有单次、确实绕不过去且影响已量化的费用才进入用户决策，不得把付费基础设施当作默认技术前提。

产品需求真相仍由 `product-truth/REQ_REGISTRY.yml` 与对应 Feature Packet 管理；本文件只管理 AI 如何读取和执行队列。

## 强制交付闭环

- **所有功能共同原则（IN-20261105-020/021/022）：开发前回溯与本次改动相关的用户拓扑、案例、边界和现有实现，先复用、再补真实缺口。审查规模与改动相称，不要求先穷尽全项目案例和全部状态才能写代码，不另建同义模型、服务或页面。**
- **开发可以分轮未完成，交付按承诺范围闭环。** 一轮上下文、一次提交、一个内部实现步骤不等于一个业务交付；允许先模型/接口、后界面/异常处理，允许TODO、受控桩和未开放中间态，记录已做、未做、依赖与下一步后跨轮继续。不因尚未开发完成而停止范围内实现或重复请示。
- 涉及用户流程和状态的设计，要辨明入口、角色、条件、操作影响、可见结果及下一步；过程中逐步补齐异常路径，准备开放或宣称完成时核对承诺任务及其必要失败/取消/重试/刷新/重复操作路径。状态语义不能只靠后台字段名表达。
- **死胡同红线只针对拟开放或宣称完成的用户任务：**其必要步骤没有可达出口、状态与行为矛盾，或普通操作只能靠开发者改库/脚本收尾，不得把这项任务作为可用成果发布/验收；可以继续开发、修复和受控验证，也可交付不受影响的独立范围。无关历史缺陷按Inbox治理，不自动冻结全项目。合法拒绝/不可逆终态需解释原因及影响，不绕权限或虚构回滚。
- “后面再补”用于内部开发顺序、明确未开放的能力、独立后续功能和非必要增强是正常排期；不得用它掩盖本次承诺任务缺少必要步骤。组织架构可以分轮实现部门、人员和关系，但宣称整套同步可用时应按整体关系验收。
- 实现后逐项回放原案例及上述异常路径，核对 UI/API/持久化/刷新回读一致。测试、构建、Preview、部署或审核文档不能替代业务证据；运行审查结果写入 worktree 的 codex-runtime，机器检查只证明其实际覆盖范围。详细模板见 `governance/runtime-state/main-chain-governance-charter.md`。
- `G` 只定义业务结果，`WP` 只承载一个可演示的用户任务；预计超过一个工作日、跨两个独立业务域或含两个可独立验收结果时，必须拆批。
- 每个缺陷先建立复现胶囊：候选 SHA、部署 URL、viewport、初始状态、操作、期望、实际、截图或 DOM/API 证据。没有复现证据不得直接按截图表象改 CSS 或代码。
- 用户可见的 Production 缺陷固定顺序为：`sales.cyanlog.icu 线上复现 → 根因 → 最小实现 → 目标回归 → 精确 SHA 的 Production 部署证据 → 用户现有 Chrome 在 sales.cyanlog.icu 重放 → main 包含已发布提交`。Preview 只可作为风险隔离或诊断中间层，不能替代 Production 部署与线上验收；不得为了验收新建本地浏览器、标签页或浏览器上下文。
- 60 秒没有新增事实证据时必须换验证手段；同一路径失败两次必须记录阻断或改变方法，禁止无证据循环。
- 测试分层：微修复先跑目标测试；WP 关闭前跑受影响套件、typecheck、build；主干集成前再跑全量测试、lint、typecheck、build 和安全/文件门禁。用户可见 Production 结果只能由用户现有 Chrome 在 `https://sales.cyanlog.icu` 的真实路径证明；本地或 Preview 浏览器结果只能记录为诊断证据。禁止在同一 hook 中重复执行同一套全量检查。
- Validator、hook 和反馈收集器不得修改 tracked 文件。运行日志必须写入 `git rev-parse --git-path codex-runtime` 对应的 worktree 独立目录。
- Harness 的目标合同、阶段和证据同样属于运行态，默认写入每个 worktree 的 `codex-runtime/harness`；`active-task.json` 只保留静态目标状态、分支策略、必需检查和阻断项，不得写入当前 HEAD、Preview deployment 或动态完成状态。
- Active WP 最多允许 3 个阻断当前验收的微修复胶囊；普通 Bug 和新需求仍进 Inbox。微修复不得借机扩大产品范围。
- 交付状态只能依次为 `executing → code_green → clean_preview_green → integration_ready → main_integrated → production_released`；`clean_preview_green` 仅表示隔离候选通过，`main_integrated` 仅表示代码收敛，只有 `production_released` 才允许表达用户可见线上已经更新。不得再用笼统的 “completed” 同时代表代码、Preview、main 和 Production。
- 代码、Preview、发布隔离和缺陷复验先用 `delivery-record` 写入 worktree 独立运行证据，再用 `delivery-transition <state>` 按顺序推进；主干收敛前用 `delivery-seal` 将证据绑定到当前 SHA 的 `refs/notes/price-v3-delivery`，并推送该 note ref。Git note 不改变 HEAD，也不得包含秘密。
- 每次状态推进后运行：

  `node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js delivery-check <state>`

- `clean_preview_green` 必须绑定一个已提交且干净的 SHA，并执行真实操作链；它只是发布前证据，页面能打开、静态层数为零或历史 Preview 通过不能替代本次用户路径，更不能宣称 Production 已修复。
- `integration_ready` 必须满足：当前 SHA 的隔离候选已重放阻断路径且 Git note/runtime attestation 将缺陷标记为 verified、`origin/main` 仍是候选祖先、Vercel Production Branch 已与 `main` 解耦。仅有 Inbox `resolves` 文本不能关闭缺陷。`main_integrated` 后必须重新 fetch 并确认 `origin/main` 已包含候选；不得把 push 当作部署。
- `production_released` 必须同时绑定远端 `production` 分支精确 SHA、Vercel READY/PROMOTED Production deployment、`https://sales.cyanlog.icu` 域名指向、Production 环境的真实运行证据，以及用户现有 Chrome 的同路径受信操作员验收。Git、Vercel 和域名属于机器证据；现有 Chrome 只能作为操作员证明，Harness 只能校验声明结构与防篡改绑定，不能伪称机器证明了人类会话。`localhost`、Preview URL、`*.vercel.app` 与 `output/playwright` 均不能作为最终 Production 浏览器证据，Preview 的 Provider probe、ReviewRun、model_invocations 或 token 也不能证明 Production 模型链。Production 数据写入、迁移与安全门禁独立判断，不得因 code-only 发布自动获得授权。
