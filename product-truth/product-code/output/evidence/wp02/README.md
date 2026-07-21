# WP02 真实 AI 运行验收

本目录记录的是运行事实，不是“已配置”或“连接测试成功”的替代证明。

## 结论

- 平台模型运行已从合同规则和旧 `ModelPolicy` 中拆出，正式链路固定为“业务用点 → 应用绑定 → AI 应用 → 有序路由 → 模型 → Provider → 不可变计划快照 → model_invocations”。
- LM Studio 实际加载 `google/gemma-4-e4b`，context 为 8,192；平台原先误填 131,072，已在隔离 Preview 以不可变修订改正。
- `contract.review.semantic`、`contract.review.chat`、`contract.draft.generate`、`tender.document.extract`、`generic.ai.analyze` 五个已发布业务用点都通过当前 route 真实调用，页面汇总为 `5 / 5 / 5 / 0`（业务用点 / 可编译 / 真实通过 / 阻断）。
- route 与 pinned 是数据库一等事实。指定模型探测永远不计入发布路由验证；同一次降级严格共享 `execution_id`、连续 `attempt_no` 和同一个计划快照。
- 15,686 字真实合同的新 route ReviewRun 为 `910d67ad-d109-444e-b009-4fa60352df66`，本地 Gemma 返回 2,471 token 并绑定完整源文件身份；历史双模型固定探测仍只用于模型横向证据。
- 标书应用不再让 8K 本地模型冒充 `long_context`：Preview 路由修订为仅使用已声明长上下文能力的云端模型后，真实文本文件解析成功。
- 模型运行链已经闭合，但审核准确率没有独立事前人工金标，且当前规则快照无效；准确率声明必须保持 `blocked_without_independent_gold`，规则问题移交 WP03。
- 所有写入仅发生在隔离 Supabase Preview `vsfropnfsmnonkotywsx`；Production 未写入、未部署。浏览器临时 token 已从数据库、cookie 与 localStorage 清理。

## 可视与工程证据

- `desktop-runtime.png` / `desktop-runtime-viewport.png`：1280×720，页面无横向溢出，标题不再被四指标挤成逐字竖排，运行汇总为 5/5。
- `ipad-runtime.png`：1024×1366，页面 `scrollWidth === clientWidth === 1024`，移动侧栏不残留白色或黑色遮罩。
- 浏览器控制台 0 error / 0 warning。
- 配置域 26 files / 231 tests、WP02 runtime 10 files / 63 tests、全量 TypeScript、目标 ESLint、75-page build 与 `git diff --check` 均通过；最终布局及 live-test 增量又通过 10 项目标测试。

结构化标识、token 与迁移证据见 `runtime-acceptance.json`。
