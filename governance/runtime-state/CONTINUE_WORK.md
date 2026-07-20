# 继续工作指令

## 触发词

在任意 AI 开发会话中输入：`继续工作`。

## 唯一恢复流程

1. 读取 `governance/runtime-state/active-task.json`。
2. 读取 `governance/runtime-state/demand-inbox.jsonl`。
3. 运行 `project-registry.js scheduler-validate`，确认 Active/Next 使用短 WP ID、Inbox ID 唯一、队列无重复。
4. 执行 `git status --short --branch`，核对 `protected_snapshot`，不得清理、stash、reset 或覆盖既有 dirty 状态。
5. 只继续 `active_task.current_step`；新需求默认进入 Inbox，不得自动替换 Active。
6. 修改文件前运行：

   ```bash
   node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js scheduler-check <path...>
   ```

## 编号合同（2026-07-20）

- `G1-G11`：不可变长期产品组合目标，不直接排队。
- `WP00-WP09`：可排序、可独立验收的开发工作包；同一时刻只有一个 Active。
- `F`：Feature Packet；`IN`：需求输入；`DG`：历史交付门禁；`HG0-HG5`：Harness 执行门禁。
- WP ID 只存 `WP00` 这类短编号；名称和 slug 单独存放。
- WP 完成不自动关闭 G；完成证据必须绑定目标版本、WP、Git SHA、环境以及浏览器或真实文件产物。
- 历史执行别名 `G1-G9` 映射为 `WP01-WP09`；F027 旧 `G0-G7` 映射为 `DG0-DG7`；Harness 旧 `G0-G5` 映射为 `HG0-HG5`。历史证据原文和文件名不改。

## 当前恢复点

- 唯一 Active：`WP02`（`ai-runtime-truth`）。
- 当前步骤：审计旧 ModelPolicy、环境变量与 failover 的真实消费路径，建立新六对象图到不可漂移运行快照的唯一编译边界；再用可用 Provider 跑通真实调用、token、`model_invocations`、ReviewRun 与降级证据。
- Next：`WP03`（规则集、问题分类、具体规则与规则详情）。
- WP00 已由提交 `18dad230bbc12a6cf664e5868cc25d57bbb65fd3` 固化完成；唯一 G/WP/F/IN/DG/HG 命名空间和六门 Harness 已通过本地门禁。
- WP01 已由实现提交 `5a22f769ac03baf80d7436eecf79fe57a24c509b` 与收口提交 `4269840fbc798eb9a92faee44d6e467a250033b4` 完成；六对象、Provider 安全、五任务 UI、Preview 与桌面/iPad 证据见 `product-truth/product-code/output/evidence/wp01/README.md`。
- 旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆为 WP01、WP03、WP09，不再执行。
- WP03 的旧整包验收为 `acceptance_disputed`；WP02 缺当前真实运行证据；WP04 需重验；WP05 为 `NO-GO`；WP06 只完成历史 Preview 候选；WP08 激活前必须拆成独立子包。

## WP02 退出门禁

- 所有纳入验收的业务调用点只从已发布 BusinessUsePoint 解析到唯一完整发布图，不被环境变量或旧 ModelPolicy 静默旁路。
- 至少两个可用模型完成真实 Provider 调用和最小生成，并持久化 provider、model、输入输出 token、耗时、状态和失败原因。
- 真实合同 ReviewRun 绑定不可漂移的应用、路由、模型和规则快照，`model_invocations` 与 ReviewRun 可双向追溯。
- 主模型不可用或输出无效时按 RoutePolicy 顺序降级，全失败动作和原因在运行证据与用户界面一致。
- 同一真实合同由多个模型按冻结输入运行并与独立验收口径比较；缺金标时不得声称准确率完成。
- 目标/全量测试、lint、typecheck、build、桌面/iPad、Preview 读回与清理通过，并同步 F012、REQ、主文档和 F099。

## 新输入路由

| 输入类型 | 行动 |
|---|---|
| 当前实现澄清或验收反馈 | 归入 Active |
| 新需求、普通 Bug、技术线索 | 拆分后进入 Inbox |
| 会推翻方向或造成重大返工 | 先给影响评估，再由用户批准是否切换 |
| 生产/数据/安全事故 | 可作为中断候选 |
| 普通问题或信息请求 | 回答或只读调研，不自动产生开发任务 |

## 安全边界

- Production 数据库继续只读；未经批准不部署 Production。
- 持续或按量付费依赖默认淘汰。
- 不得用配置存在、页面能打开或旧环境证据冒充当前模型/文件/Production 验收。
- 不得越过 WP01 的 allowed paths，也不得把规则 UX、真实模型运行证明或 Production 发布混入本批。
