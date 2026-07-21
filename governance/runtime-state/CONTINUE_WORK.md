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

- 唯一 Active：`WP03`（`rule-collection`）。
- 当前步骤：盘点隔离 Preview 的 15 条规则、39 个发布规则快照、34 个发布规则集快照、13 个规则文档和 23 个 SkillBundle，复现 v21 的 15 个无效快照并逐条归因；随后以 forward-only 方式建立和修复“规则集→问题分类→具体规则→规则详情→业务属性→判定与处理”。
- Next：`WP05` 的工作台交互纠偏子批，仅处理正文滚动与默认页签；准确率和循环复审仍受独立金标与产品门禁约束。
- WP00 已由提交 `18dad230bbc12a6cf664e5868cc25d57bbb65fd3` 固化完成；唯一 G/WP/F/IN/DG/HG 命名空间和六门 Harness 已通过本地门禁。
- WP01 已由实现提交 `5a22f769ac03baf80d7436eecf79fe57a24c509b` 与收口提交 `4269840fbc798eb9a92faee44d6e467a250033b4` 完成；六对象、Provider 安全、五任务 UI、Preview 与桌面/iPad 证据见 `product-truth/product-code/output/evidence/wp01/README.md`。
- WP02 已由提交 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b` 完成；五个业务用点均由已发布路由驱动，本地 Gemma、云端模型、降级、token、`model_invocations`、不可漂移计划、真实合同 ReviewRun 与桌面/iPad 证据见 `product-truth/product-code/output/evidence/wp02/README.md`。现有规则无效和缺独立金标使准确率仍明确阻断。
- 旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆为 WP01、WP03、WP09，不再执行。
- WP03 的旧整包验收为 `acceptance_disputed`，本批必须以当前代码和 Preview 数据重新建立证据；WP04 需重验；WP05 准确率/循环复审仍为 `NO-GO`，但已定位的滚动和默认标签作为后续独立子批；WP06 只完成历史 Preview 候选；WP08 激活前必须拆成独立子包。

## WP03 退出门禁

- 规则域必须明确区分规则集、问题分类、具体规则、规则详情、通用业务属性、判定和处理动作；树只用于导航，不能充当领域模型。
- 金额、比例、时间、枚举、布尔和文本等属性使用白名单类型、运算符、单位与未知路径；配置时不暴露 Prompt，也不以模糊语义指令替代规则。
- 当前 15 个无效快照逐条有可复核原因；历史发布快照不改写，新版本通过 forward-only Preview 迁移/API 发布为不可变且可编译的候选。
- SkillBundle 能编译完整规则引用；真实合同 ReviewRun 同时绑定有效规则快照和 WP02 运行计划，受控样本输出预期的命中、未命中与证据不足结果。
- 规则管理 UI 以业务问题而非机器字段组织，桌面和 iPad 无白块、遮罩、横向溢出或不可达操作。
- 目标/全量测试、lint、typecheck、build、Preview 数据读回与清理、文档治理和独立复审通过；缺独立金标时不得声称准确率完成。

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
- 只修改 WP03 `allowed_paths`；不得重做 WP01/WP02 模型底座，不得把工作台滚动、循环复审或 Production 发布混入本批。
