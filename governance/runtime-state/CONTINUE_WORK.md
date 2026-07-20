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

- 唯一 Active：`WP00`（`goal-baseline-consolidation`）。
- 当前步骤：统一 REQ_REGISTRY、主文档、F099、Active/Inbox、F027/DG 和发布候选 Harness；本批不修改产品代码。
- Next：`WP01`（平台模型接入、模型目录、AI 应用和业务用点底座）。
- 旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆为 WP01、WP03、WP09，不再执行。
- WP01、WP03 的旧整包验收为 `acceptance_disputed`；WP02 缺当前真实运行证据；WP04 需重验；WP05 为 `NO-GO`；WP06 只完成历史 Preview 候选；WP08 激活前必须拆成独立子包。

## WP00 退出门禁

- REQ_REGISTRY、主文档、F099、active-task 对 G/WP/F/IN/DG/HG 定义和映射一致。
- 当前 Active/Next/Ready/Parked 不使用 G 或带 slug 的长 WP ID。
- F027 正式产品目标只使用 G1-G11，历史批次卡只使用 DG0-DG7。
- Harness 当前配置和运行状态只使用 HG0-HG5；旧 G0-G5 仅保留在历史证据中。
- 根工作区受保护 dirty 快照不变；release 分支能独立运行相同 scheduler。
- JSON/YAML/Markdown、scheduler validate/check 与 Git diff 检查通过。
- 通过后 WP00 结束，再把 WP01 设为唯一 Active；不得在同一批顺带开发规则 UX 或执行 Production 发布。

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
- 不得以治理整合为名改动本批 allowed paths 之外的产品代码。
