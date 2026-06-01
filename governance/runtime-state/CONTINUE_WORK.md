# 继续工作指令

## 触发词
在任意新 Claude 会话中输入：
> **继续工作**

## AI 执行流程
1. 读取 `governance/runtime-state/active-task.json`
2. 读取当前 Feature Packet（`active_task.packet_path`）
3. 执行 `git status` 查看工作区状态
4. 根据 `active_task.status` 决定下一步

## 状态 → 行动映射

| 当前状态 | AI 行动 |
|---------|---------|
| `drafting` | 继续需求反讲，列出待确认问题 |
| `pm_review` | 等待人类 PM 确认，不做编码 |
| `tech_review` | 等待人类 Dev 评审技术方案 |
| `test_review` | 等待人类 QA 评审测试方案 |
| `coding` | 开始/继续编码，读取 Packet 技术方案 |
| `code_review` | 等待人类 Dev 代码审查 |
| `qa_acceptance` | 等待人类 QA/PM 验收 |
| `ready_to_release` | 等待发布指令 |
| `rejected` | 回到对应前序状态重新处理 |

## 示例会话

**用户**：继续工作

**AI**：（读取 active-task.json）
当前活跃任务：**F008 OCR 招标文件解析**
状态：**drafting**（需求反讲中）
分支：**feature/F008-ocr-tender**

（读取 F008 Packet）
需求反讲要点：...

（git status）
工作区：干净 / 有未提交的修改...

**AI**：当前处于需求反讲阶段，以下是 AI 对 F008 需求的复述和待确认问题...
（列出 2.1 需求反讲 + 2.2 待确认问题）

**AI**：请 PM 确认以上理解是否正确？如有遗漏请补充。
