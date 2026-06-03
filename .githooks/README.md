# Git Hooks 设置说明

本项目使用 AI 行为硬约束检查作为 pre-commit 钩子。

## 一次性设置

克隆项目后，运行：

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

## 验证设置

```bash
git config core.hooksPath
# 应输出: .githooks

ls -la .githooks/
# 应看到 pre-commit 且有 x 权限
```

## 手动运行检查

```bash
# 运行所有检查
bash .githooks/pre-commit

# 严格模式（CI 推荐）
STRICT=1 bash .githooks/pre-commit

# 软失败模式（仅警告）
SOFT=1 bash .githooks/pre-commit

# 跳过所有检查
SKIP_CHECKS=1 git commit ...
```

## 行为模式

| 模式 | 触发条件 | 失败时 |
|------|----------|--------|
| **strict** | CI / 非交互环境 / `STRICT=1` | 🚫 阻断 |
| **interactive** | 本地终端（默认） | ❓ 询问 |
| **soft** | `SOFT=1` | ⚠️ 警告 |

## 检查项（10项）

**基础检查（5项）**：
1. TypeScript 类型检查
2. ESLint 代码检查
3. 单元测试
4. 导航集成检查
5. Git 提交质量

**循环测试（5项）**：
6. 用户反馈循环
7. 健康检查循环
8. 错误处理循环
9. 业务闭环循环
10. CI/CD 回路

详细检查逻辑在 `governance/ai-behavior-准则/checks/`
