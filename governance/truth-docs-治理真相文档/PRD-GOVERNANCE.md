# 治理架构（兼容入口）

> 状态：`superseded`（2026-07-20）
> 原“奇偶四门”设计已经退役，本文件不再定义可执行 Harness 规则。

当前治理真相由以下三处共同组成：

- 规则与责任边界：[guide-harness治理指南.md](../guide-harness治理指南.md)
- 六阶段配置：[settings-claude运行配置.json](../runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json)
- 机械执行映射：[harness-core.js](../runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-core.js)

命名固定为 `HG0 intake`、`HG1 research`、`HG2 contract_review`、`HG3 execute`、`HG4 verify`、`HG5 approval`。产品组合目标 `G1-G11` 不得被 Harness 复用。旧四门内容保留在 Git 历史中供审计，不得继续作为开发依据。
