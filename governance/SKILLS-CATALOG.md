<!--
文件名: SKILLS-CATALOG.md
用途: Skill 市场目录 - 统一安装、统一调用
所属层: governance/
更新规则: 新增/更新 Skill 时同步更新
REQ: GOV-SKL-002
-->

# Skill 市场目录

> Price-v3 统一 Skill 管理系统
> 害怕不工作，又害怕乱工作 → 用治理约束 Skill 边界

---

## 目录

- [第一层：治理核心（必须）](#第一层治理核心必须)
- [第二层：开发辅助（推荐）](#第二层开发辅助推荐)
- [第三层：业务增强（选配）](#第三层业务增强选配)
- [安装指南](#安装指南)
- [调用方式](#调用方式)

---

## 第一层：治理核心（必须）

### 1. skill-socrates（苏格拉底提问）

**用途：** 需求确认时强制触发深度思考，帮助发现遗漏

**触发条件：**
- 自动：检测到 `F[0-9]{3}.*已确认` 模式
- 手动：`/skill-socrates F001`

**工具清单：**
```yaml
allowed: [AskUserQuestion, Read, Grep]
forbidden: [Edit, Write, Bash, Agent, Skill]
```

**配置位置：** `governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json`

---

### 2. skill-req-review（需求审查）

**用途：** 自动检查需求文档完整性和一致性

**触发条件：**
- pre-commit hook：修改 `product-truth/REQ_REGISTRY.yml`

**检查项：**
| 编号 | 检查内容 | 失败行为 |
|------|---------|---------|
| R1 | Fxxx 唯一性 | exit 2 |
| R2 | 状态流程合规 | exit 2 |
| R3 | 已确认需求有代码位置 | warning |
| R4 | 主文档与注册表同步 | exit 2 |
| R5 | 无孤儿子需求 | warning |

**工具清单：**
```yaml
allowed: [Read, Grep, Glob]
forbidden: [Edit, Write, AskUserQuestion, Bash, Agent, Skill]
```

---

### 3. skill-code-review（代码审查）

**用途：** 检查代码是否符合项目规范

**触发条件：**
- pre-commit hook：修改 `product-truth/product-code/` 下的 ts/tsx 文件

**检查项：**
| 编号 | 检查内容 | 失败行为 |
|------|---------|---------|
| C1 | 文件头包含 `// REQ:{ID}` | exit 2 |
| C2 | 无 TODO/FIXME 遗留 | warning |
| C3 | 错误处理完整 | warning |
| C4 | 命名规范 (camelCase) | warning |

**工具清单：**
```yaml
allowed: [Read, Grep]
forbidden: [Edit, Write, AskUserQuestion, Bash, Agent, Skill]
```

---

## 第二层：开发辅助（推荐）

### 4. skill-security-audit（安全审计）

**用途：** 扫描安全漏洞和敏感信息泄露

**触发条件：**
- pre-commit hook
- 手动：`/skill-security-audit`

**检查项：**
| 编号 | 检查内容 | 严重级别 |
|------|---------|---------|
| S1 | 无硬编码密钥 | error |
| S2 | 无 console.log 遗留 | warning |
| S3 | SQL 注入风险检查 | error |
| S4 | XSS 风险检查 | error |
| S5 | 依赖漏洞扫描 | warning |

---

### 5. skill-test-gen（测试生成）

**用途：** 基于代码自动生成单元测试

**触发条件：** 手动 `/skill-test-gen <file>`

**功能：**
- 分析函数输入输出
- 生成边界测试用例
- 生成 vitest 测试代码

---

### 6. skill-doc-sync（文档同步）

**用途：** 检查代码与文档是否同步

**触发条件：**
- pre-commit hook
- CI 检查

**检查项：**
| 编号 | 检查内容 |
|------|---------|
| D1 | 新增 API 是否有文档 |
| D2 | 修改代码是否更新 ADR |
| D3 | REQ ID 是否在代码中标记 |

---

### 7. skill-commit-msg（提交信息规范）

**用途：** 检查 git commit message 格式

**触发条件：** commit-msg hook

**规范：**
```
<type>(<scope>): <subject>

<body>

Refs: Fxxx
```

---

### 8. skill-perf-check（性能检查）

**用途：** 检测性能回归

**触发条件：** CI / 手动

**检查项：**
-  bundle 大小变化
- 依赖重复引入
- 大图/大文件检测

---

## 第三层：业务增强（选配）

### 9. skill-validator（机械验证器）

**用途：** PRD 与代码实现的机械对比

**触发条件：** G3 Gate（修复阶段）

**文档中提到但未实现，需要补充**

---

### 10. skill-context7（代码语义检索）

**用途：** 基于语义的代码库检索

**触发条件：** 手动 `/skill-context7 <query>`

**依赖：** context7 @claude-plugins-official（已在 settings 中启用）

---

## 安装指南

### 方式一：全自动安装（推荐）

```bash
# 运行 Skill 安装脚本
cd /Users/nsss/Price-v3
node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/install-skills.js
```

### 方式二：手动安装

**Step 1: 复制 Skill JSON 定义**
```bash
cp governance/skills/*.json skill/
```

**Step 2: 更新 settings.json**
编辑 `.claude/settings.json`，确保 `skills` 字段包含目标 Skill

**Step 3: 验证安装**
```bash
# 检查 Skill 是否加载
head -1 skill/skill-*.json
```

---

## 调用方式

### 方式 1：Hook 自动触发
```bash
git commit -m "feat: F001 价盘管理"
# → 自动触发 skill-req-review
# → 自动触发 skill-code-review
# → 自动触发 skill-security-audit
```

### 方式 2：手动调用
```
/skill-socrates F001
/skill-test-gen app/api/quotes/route.ts
/skill-security-audit
```

### 方式 3：Gate 阶段触发
```
G1 (编辑门) → 完成编辑
G2 (审查门) → skill-req-review, skill-code-review
G3 (修复门) → skill-test-gen (补测试)
G4 (复核门) → skill-socrates
```

---

## Skill 状态总览

| Skill | 文档 | JSON定义 | Settings配置 | 状态 |
|-------|------|----------|--------------|------|
| skill-socrates | ✅ | ✅ | ✅ | **运行中** |
| skill-req-review | ✅ | ✅ | ✅ | **运行中** |
| skill-code-review | ✅ | ✅ | ✅ | **运行中** |
| skill-security-audit | ✅ | ✅ | ✅ | **运行中** |
| skill-test-gen | ✅ | ✅ | ✅ | **运行中** |
| skill-doc-sync | ✅ | ✅ | ✅ | **运行中** |
| skill-commit-msg | ✅ | ✅ | ✅ | **运行中** |
| skill-perf-check | ✅ | ✅ | ✅ | **运行中** |
| skill-validator | ✅ | ✅ | ✅ | **运行中** |

---

## 待办事项

- [x] 恢复 skill-req-review（从 legacy 复制 + 更新 settings）
- [x] 恢复 skill-code-review（从 legacy 复制 + 更新 settings）
- [x] 创建 skill-security-audit
- [x] 创建 skill-test-gen
- [x] 创建 skill-doc-sync
- [x] 创建 skill-commit-msg
- [x] 创建 skill-perf-check
- [x] 创建 skill-validator（PRD-GOVERNANCE.md 中提到）

---

*文档版本: 2025-06-16*
*所属: governance/SKILLS-CATALOG.md*
