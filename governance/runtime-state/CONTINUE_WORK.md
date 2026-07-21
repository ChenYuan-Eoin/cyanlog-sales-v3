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

- 唯一 Active：`WP04`（`contract-center-ia`）。
- 当前步骤：先以无合同、单版本、已有 ReviewRun、多版本四类状态审计起草、上传审核、继续审核、版本比对四个入口；随后修复真实上传在 `source identity` 和 `source_page_map` 就绪前提前启动 ReviewRun 的顺序与幂等问题。
- Next：`WP07` 合同起草闭环；进入门是 WP04 四入口与任务身份复验通过。
- WP00 已由提交 `18dad230bbc12a6cf664e5868cc25d57bbb65fd3` 固化完成；唯一 G/WP/F/IN/DG/HG 命名空间和六门 Harness 已通过本地门禁。
- WP01 已由实现提交 `5a22f769ac03baf80d7436eecf79fe57a24c509b` 与收口提交 `4269840fbc798eb9a92faee44d6e467a250033b4` 完成；六对象、Provider 安全、五任务 UI、Preview 与桌面/iPad 证据见 `product-truth/product-code/output/evidence/wp01/README.md`。
- WP02 已由提交 `c25ec17a8e51ec6476432ccccf9c30ee0dd9553b` 完成；五个业务用点均由已发布路由驱动，本地 Gemma、云端模型、降级、token、`model_invocations`、不可漂移计划、真实合同 ReviewRun 与桌面/iPad 证据见 `product-truth/product-code/output/evidence/wp02/README.md`。现有规则无效和缺独立金标使准确率仍明确阻断。
- WP03 已由提交 `ebdb3c59f0205f1ed20b8a2bf4c2a67e5a29f4b5` 完成；空白组织可配置、测试、发布并真实触发规则，R001-R015 保持可编辑预置业务数据。
- WP05 交互纠偏已由提交 `12b977fa` 完成；默认审查、风险定位、DOCX/PDF 正文连续阅读与桌面/iPad 证据见 `product-truth/product-code/output/evidence/wp05/workbench-interaction-acceptance.md`。准确率和循环复审仍未关闭。
- 旧混合任务 `P0-ONLINE-SYNC-RULE-COLLECTION-RESET` 已拆为 WP01、WP03、WP09，不再执行。
- WP04 需按当前代码和 Preview 数据重新建立入口与上传编排证据；WP05 准确率/循环复审仍为 `NO-GO`；WP06 只完成历史 Preview 候选；WP08 激活前必须拆成独立子包。

## WP04 退出门禁

- 起草、上传并审核、继续/查看审核、选择版本比对四个入口在四类数据状态下分别说明对象、前置条件、目标 URL 和下一步，不能互相代替。
- 上传只创建一个合同版本；原文件身份、哈希、解析文本和当前 `source_page_map` 全部就绪后，才启动且只启动一次正式 ReviewRun。
- 上传回调、解析完成通知和页面重试幂等；失败停在明确步骤并可恢复，不制造重复版本、重复审核或假完成。
- 合同列表和工作台显示当前版本、ReviewRun 状态和业务下一步；入口参数表达用户任务，不能把运行状态误作页面选择。
- 目标/全量测试、lint、typecheck、build、桌面/iPad 真实 DOCX/PDF、Preview 数据读回与清理、文档治理和独立复审通过。

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
- 只修改 WP04 `allowed_paths`；不得重做 WP01-WP03 模型/规则底座，不得把起草编辑器、对比算法、循环复审或 Production 发布混入本批。
