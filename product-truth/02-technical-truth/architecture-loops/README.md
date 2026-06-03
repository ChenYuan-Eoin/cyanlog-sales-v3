# 架构循环图 (Architecture Loops)

本目录包含 5 类关键循环架构图，用于指导系统设计和故障排查。

## 循环清单

| 编号 | 循环名称 | 文件 | 参考来源 | 检查脚本 |
|------|----------|------|----------|----------|
| 1 | 用户反馈循环 | [LOOP-01-feedback.md](./LOOP-01-feedback.md) | ONES 需求-复盘循环, Supabase Realtime | `check-06-feedback-loop.sh` |
| 2 | 健康检查循环 | [LOOP-02-healthcheck.md](./LOOP-02-healthcheck.md) | 12-Factor App, K8s Probes | `check-07-healthcheck.sh` |
| 3 | 错误处理循环 | [LOOP-03-error-handling.md](./LOOP-03-error-handling.md) | 12-Factor Logs, Sentry | `check-08-error-handling.sh` |
| 4 | 业务闭环循环 | [LOOP-04-business-loop.md](./LOOP-04-business-loop.md) | ONES 完整闭环, PRD 驱动开发 | `check-09-business-loop.sh` |
| 5 | CI/CD 回路 | [LOOP-05-ci-cd-loop.md](./LOOP-05-ci-cd-loop.md) | 12-Factor Build-Release-Run, GitHub Actions | `check-10-ci-cd-loop.sh` |

## 循环图结构

每个循环图包含以下部分：

1. **节点流向图** - ASCII 可视化，带方向和回路标识
2. **参考来源标注** - 显式标注参考的业界最佳实践（ONES / Supabase / 12-Factor / Sentry 等）
3. **实际代码路径** - 对应代码的具体位置，标注实现状态
4. **失败时可观测输出** - 故障时的输出位置和现象
5. **人工介入触发条件** - 何时需要人工响应

## 运行检查

```bash
# 运行所有循环检查
cd /Users/nsss/Price-v3
bash governance/ai-behavior-准则/checks/check-06-feedback-loop.sh
bash governance/ai-behavior-准则/checks/check-07-healthcheck.sh
bash governance/ai-behavior-准则/checks/check-08-error-handling.sh
bash governance/ai-behavior-准则/checks/check-09-business-loop.sh
bash governance/ai-behavior-准则/checks/check-10-ci-cd-loop.sh
```

## 设计原则

1. **闭环优先** - 每个循环必须有明确的回路，不能是单向流程
2. **可观测** - 每个节点都必须有输出或日志，便于故障排查
3. **人工兜底** - 关键故障点必须定义人工介入条件
4. **参考业界** - 显式标注参考的业界实践，便于追溯设计依据
