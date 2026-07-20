<!--
文件名: SKILLS.md
用途: Skill 详细规范 - 专业化审查 Agent 的定义和调用方式
所属层: 治理层
创建者: AI Assistant
更新规则: Skill 定义变更时更新
REQ: GOV-SKL-001
-->

# Skill 详细规范

> 专业化审查 Agent 的定义和调用方式

---

## /skill-socrates（苏格拉底提问）

### 用途
在小需求合并到主干需求时，强制触发深度思考，帮助用户发现遗漏。

### 触发条件（满足任一）
```yaml
triggers:
  - type: file_change
    path: product/docs/REQUIREMENTS.md
    pattern: 'F[0-9]{3}.*状态.*已确认'
```

### 工具清单（限制级）
```yaml
tools:
  - AskUserQuestion    # 唯一交互工具
  - Read               # 读取上下文
  - Grep               # 搜索关联需求
```

**禁止工具**：Edit, Write, Bash, Agent

### 提问策略

```typescript
interface SocraticQuestion {
  category: 'technical' | 'risk' | 'alignment' | 'edge-case' | 'maintenance';
  question: string;
  context: string;
}

// 提问模板库
const questionTemplates: SocraticQuestion[] = [
  {
    category: 'technical',
    question: '这个需求的实现方式，是否已经考虑到数据量和性能瓶颈？如果用户量增长10倍，这个设计还能工作吗？',
    context: '检查技术可行性'
  },
  {
    category: 'risk',
    question: '如果 {dependency} 服务不可用，这个功能会如何表现？是否有降级方案？',
    context: '依赖风险分析'
  },
  {
    category: 'alignment',
    question: '这个需求与已确认的 {related_req} 是否存在冲突？例如数据模型是否需要重复定义？',
    context: '需求一致性检查'
  },
  {
    category: 'edge-case',
    question: '考虑这些边界情况：1) 网络中断 2) 数据为空 3) 并发操作。当前设计如何处理？',
    context: '边界情况检查'
  },
  {
    category: 'maintenance',
    question: '这个实现需要多少持续的维护工作？配置复杂吗？文档是否足够让新人接手？',
    context: '维护成本评估'
  }
];
```

### 执行流程

```
1. 读取 REQUIREMENTS.md 找到刚确认的需求 Fxxx
2. 读取 PRD-PRODUCT.md 找到对应条目
3. 使用 Grep 搜索关联需求
4. 从 questionTemplates 随机选择 3-5 个问题
5. 使用 AskUserQuestion 工具一次性提问
6. 等待用户回答
7. 生成审查报告（通过/需补充）
```

### 输出格式

```markdown
## 苏格拉底审查报告

**目标需求**: F001 价盘管理

**提问**:
1. [技术] ...
2. [风险] ...
3. [对齐] ...

**用户回答**:
1. ...
2. ...
3. ...

**审查结论**: ✅ 通过 / ⚠️ 需补充以下事项

**建议**:
- ...
```

---

## /skill-req-review（需求审查）

### 用途
自动检查需求文档的完整性和一致性。

### 触发条件
```yaml
triggers:
  - type: git_hook
    event: pre-commit
    files:
      - product/docs/REQUIREMENTS.md
      - product/PRD-PRODUCT.md
```

### 工具清单（只读！）
```yaml
tools:
  - Read
  - Grep
  - Glob
```

### 检查项

| 编号 | 检查内容 | 失败行为 |
|------|---------|---------|
| R1 | 所有 Fxxx 都有唯一 REQ ID | exit 2 |
| R2 | 状态符合流程：草稿→待确认→已确认 | exit 2 |
| R3 | 已确认需求有代码位置追踪（非"-"） | warning |
| R4 | REQUIREMENTS.md 和 PRD-PRODUCT.md 同步 | exit 2 |
| R5 | 无孤儿子需求 | exit 2 |

### 输出格式

```markdown
## 需求审查报告

**检查时间**: 2026-05-14 16:00
**检查文件**: REQUIREMENTS.md

| 检查项 | 状态 | 详情 |
|--------|------|------|
| R1 REQ ID 唯一性 | ✅ | 26个需求，无重复 |
| R2 状态流程合规 | ⚠️ | F003 跳过"待确认"直接"已确认" |
| ... | | |

**结论**: 阻止提交 / 警告通过
```

---

## /skill-code-review（代码审查）

### 用途
检查代码是否符合项目规范。

### 触发条件
```yaml
triggers:
  - type: git_hook
    event: pre-commit
    files:
      - product/src/**/*.ts
      - product/src/**/*.tsx
```

### 工具清单（只读！）
```yaml
tools:
  - Read
  - Grep
```

### 检查项

| 编号 | 检查内容 | 失败行为 |
|------|---------|---------|
| C1 | 文件头包含 `// REQ:{ID}` | exit 2 |
| C2 | 无 TODO/FIXME 遗留 | warning |
| C3 | 错误处理完整（try/catch 或 返回值检查） | warning |
| C4 | 变量命名规范（camelCase） | warning |

---

## 调用方式

### 方式1：Hook 自动触发
```bash
# Git commit 时自动触发
git commit -m "feat: F001 价盘管理"
# → 自动触发 skill-req-review
# → 自动触发 skill-code-review
```

### 方式2：手动调用
本项目当前 **不提供** “/skill-xxx 作为可执行命令”的独立调度器。

文档中出现的 `/skill-xxx` 仅作为 **概念标识**（代表一个治理检查/审查能力），其实际执行入口必须落在：
1. Git hooks（如 `pre-commit`）
2. `.claude/settings.json` hooks（如 `UserPromptSubmit` / `PreToolUse` / `SessionEnd`）
3. 受控脚本（如 `scripts/run_managed_hook.py <hook-id>`）

否则会出现“文档写了可手动触发，但机器实际上无入口”的治理幻觉。

### 方式3：Gate 阶段强制触发
```
# HG2 门（审查阶段）自动调用
Executing: /skill-req-review
[Agent] Reading REQUIREMENTS.md...
[Agent] Checking R1-R5...
[Agent] Exit 0 (passed)
```

---

## Skill Agent 定义文件

### skill-socrates.json

```json
{
  "name": "skill-socrates",
  "description": "小需求合并主干时的苏格拉底式提问",
  "model": "claude-opus-4-6",
  "tools": ["AskUserQuestion", "Read", "Grep"],
  "forbidden_tools": ["Edit", "Write", "Bash", "Agent"],
  "system_prompt": "你是一个苏格拉底式提问专家...",
  "triggers": {
    "file_change": "product/docs/REQUIREMENTS.md",
    "pattern": "F[0-9]{3}.*状态.*已确认"
  }
}
```

### skill-req-review.json

```json
{
  "name": "skill-req-review",
  "description": "需求文档自动审查",
  "model": "claude-sonnet-4-6",
  "tools": ["Read", "Grep", "Glob"],
  "forbidden_tools": ["Edit", "Write", "AskUserQuestion"],
  "system_prompt": "你是一个需求审查专家...",
  "checks": ["R1", "R2", "R3", "R4", "R5"]
}
```
