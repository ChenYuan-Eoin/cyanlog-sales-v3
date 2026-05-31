<!--
文件名: EXECUTION_MECHANISM.md
用途: 治理规则执行机制 - Hook与Gate的实际运行流程
所属层: 治理层
创建者: AI Assistant
更新规则: 执行机制变更时更新
REQ: GOV-EXE-001
-->

# 治理规则执行机制

## 核心架构

```
用户输入 / Git操作
     │
     ▼
┌─────────────────────────────┐
│         Hook 层              │
│  ┌───────────────────────┐  │
│  │ pre-commit (Git)      │  │ ──┐
│  │ ├─ H001: 需求确认检查  │  │   │
│  │ ├─ H002: REQ ID 追踪  │  │   │
│  │ ├─ H003: 隔离检查     │  │   │ 失败 → exit 2
│  │ └─ H006: 配置检查     │  │   │
│  └───────────────────────┘  │ ──┘
│                             │
│  ┌───────────────────────┐  │
│  │ .claude/settings.json │  │ ──┐
│  │ ├─ user-prompt-submit │  │   │
│  │ ├─ pre-tool-use       │  │   │ 触发 → Skill/通知
│  │ └─ stop               │  │   │
│  └───────────────────────┘  │ ──┘
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         Gate 层              │
│  ├─ G1 (奇数执行): 代码编辑  │
│  ├─ G2 (偶数审查): 只读检查  │
│  ├─ G3 (奇数修复): 代码修复  │
│  └─ G4 (偶数复核): 只读确认  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         Skill 层             │
│  ├─ /skill-socrates         │
│  ├─ /skill-req-review       │
│  ├─ /skill-code-review      │
│  └─ /skill-validator        │
└─────────────────────────────┘
```

---

## 执行流程详解

### 流程1：代码提交 (git commit)

```bash
$ git commit -m "feat: F001 价盘管理"

1. Pre-commit Hook 触发
   ├── H001: 检查需求是否已确认
   │   └── 读取 REQUIREMENTS.md
   │   └── F001 状态 = "已确认" ✅
   │
   ├── H002: 检查文件 REQ 标记
   │   └── product/src/app/prices/page.tsx
   │   └── 文件头包含 "// REQ:F001" ✅
   │
   ├── H003: 检查层隔离
   │   └── product/src/ 无 governance/ 引用 ✅
   │
   └── H006: 检查配置安全
       └── 无敏感信息泄露 ✅

全部通过 → 提交成功
```

### 流程2：需求确认触发 (用户输入)

```
用户: "F001 已确认"
     │
     ▼
.claude/settings.json
  user-prompt-submit Hook
  检测到 "F[0-9]{3}.*已确认"
     │
     ▼
  触发 /skill-socrates
     │
     ▼
  AskUserQuestion (3-5个问题)
     │
     ▼
  等待用户回答
     │
     ▼
  生成苏格拉底审查报告
```

### 流程3：文件编辑 (pre-tool-use)

```
用户请求: 编辑 product/src/app/quotes/page.tsx

Hook: pre-tool-use:Edit
  ├── 执行 check-req-confirmed.js
  │   └── 读取页面tsx 获取 REQ ID
  │   └── 检查 REQUIREMENTS.md F002 状态
  │   └── "已确认" ✅
  │
  └── 通过 → 允许 Edit
```

---

## 失败处理

### 错误码定义

| 退出码 | 含义 | 行为 |
|--------|------|------|
| 0 | 通过 | 继续执行 |
| 1 | 警告 | 继续执行，输出警告信息 |
| 2 | 阻止 | 打断当前操作，输出错误和解决方案 |

### 失败恢复流程

```
阻止场景：尝试提交包含 F999（不存在）的文件

❌ 提交失败
   原因：REQ ID F999 在 REQUIREMENTS.md 中不存在
   解决方案：
     1. 如果需求漏记：先在 REQUIREMENTS.md 添加 F999
     2. 如果 REQ ID 错误：修改文件头的 REQ:F999 → REQ:F001
     3. 如果临时测试：添加 --no-verify（不推荐）

用户操作 → 问题解决 → 重新提交 → 通过 ✅
```

---

## 权限矩阵

| 阶段 | 可用工具 | 禁止工具 | 用途 |
|------|---------|---------|------|
| G1 执行 | Edit, Write, Bash | - | 编写代码 |
| G2 审查 | Read, Grep, Glob | Edit, Write, Bash | 需求审查 |
| G3 修复 | Edit, Write, Bash | - | 修复问题 |
| G4 复核 | Read, Grep | Edit, Write, Bash | 最终确认 |

---

## 执行状态机

```
            ┌─────────────┐
     启动 → │   G1 执行   │
            │  (Edit工具) │
            └──────┬──────┘
                   │ 结束
                   ▼
            ┌─────────────┐
            │   G2 审查   │◄──────────┐
            │ (Read工具)  │           │
            └──────┬──────┘           │
                   │ 通过             │
          ┌────────┴────────┐         │
          │                 │ 失败     │
          ▼                 ▼         │
   ┌─────────────┐   ┌─────────────┐  │
   │   验收通过   │   │   G3 修复   │  │
   └─────────────┘   │  (Edit工具) │──┘
                     └─────────────┘
```

---

## Hook 安装与维护

### 安装命令

```bash
# 项目初始化时执行
make install-hooks
# 或
./governance/harness/scripts/install-hooks.sh
```

### hooks 安装脚本

```bash
#!/bin/bash
# governance/harness/scripts/install-hooks.sh

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_SRC="$REPO_ROOT/governance/harness/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

echo "Installing Price V2 governance hooks..."

# 安装 pre-commit
cp "$HOOKS_SRC/pre-commit" "$HOOKS_DST/pre-commit"
chmod +x "$HOOKS_DST/pre-commit"
echo "✅ pre-commit installed"

# 验证安装
if [ -x "$HOOKS_DST/pre-commit" ]; then
    echo "✅ All hooks installed successfully"
else
    echo "❌ Installation failed"
    exit 1
fi
```

### 验证 Hook 运行

```bash
# 测试 Hook 是否生效
echo "// test" > product/src/test.txt
git add product/src/test.txt
git commit -m "test"
# 预期：失败，缺少 REQ ID

rm product/src/test.txt
git reset HEAD product/src/test.txt
```

---

## 执行检查清单

### 新建开发者

- [ ] 执行 `make install-hooks` 或 `./scripts/install-hooks.sh`
- [ ] 验证 pre-commit hook 存在 (`cat .git/hooks/pre-commit`)
- [ ] 测试提交失败场景（故意提交无 REQ ID 的文件）

### 每次提交前

- [ ] 文件头包含 REQ ID
- [ ] REQ ID 在 REQUIREMENTS.md 中存在且状态正确
- [ ] 无敏感信息硬编码
- [ ] 无 governance/ 的违规引用

### Session 结束时

- [ ] CHANGELOG 自动生成
- [ ] 需求状态同步更新

---

## 例外处理

### 紧急修复 (Hotfix)

```bash
# 在明确知晓风险的情况下
# 使用 --no-verify 绕过检查

git commit -m "HOTFIX: 修复生产故障" --no-verify

# ⚠️ 必须在提交后立即：
# 1. 补充 REQUIREMENTS.md 记录
# 2. 补充 REQ ID 标记
# 3. 发送邮件说明原因
```

**紧急修复模板**：

```markdown
## 紧急提交说明
- 提交: abc1234
- 原因: 生产环境报价计算错误
- 绕过检查: --no-verify
- 后续补全:
  - [ ] REQUIREMENTS.md 更新
  - [ ] REQ ID 标记添加
  - [ ] Code Review
```

---

**执行原则**：
> 约束应该是保护开发者，而不是阻碍开发者。
> 当约束成为阻碍时，有明确的例外通道，但有问责机制。
