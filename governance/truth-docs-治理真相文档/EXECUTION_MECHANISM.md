# Harness 执行机制（兼容入口）

> 状态：`superseded`（2026-07-20）
> 原“HG1 编辑 / HG2 审查 / HG3 修复 / HG4 复核”的奇偶四门说明与现行运行时不一致，已停止使用。

现行执行链为：

`HG0 intake → HG1 research → HG2 contract_review → HG3 execute → HG4 verify → HG5 approval`

可执行事实只取自：

- [guide-harness治理指南.md](../guide-harness治理指南.md)
- [settings-claude运行配置.json](../runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json)
- [harness-core.js](../runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-core.js)
- [project-registry.js](../runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js)

历史四门流程仍可从 Git 查看，但不得再生成 `G*` 或旧四门状态。
