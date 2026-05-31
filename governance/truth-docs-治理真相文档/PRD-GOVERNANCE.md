<!--
文件名: PRD-GOVERNANCE.md
用途: 治理规则定义 - Harness + Hook + Skill 约束系统
所属层: 治理层
创建者: AI Assistant
更新规则: 治理架构变更时更新
REQ: GOV-ARCH-001
-->

# 治理架构：约束系统（Harness + Hook + Skill）

> 核心原则：**指令改变不了 AI 行为（遵从率 ~20%），但机械约束可以（执行率 100%）**

> 治理规则 vs 业务规则：
> - 治理规则：强制 AI/人类遵守的**开发流程**（如：需求确认前阻止提交）
> - 业务规则：产品运行时的**业务逻辑**（如：销售只能看自己的报价）

---

## 一、架构概述

```
┌─────────────────────────────────────────────────────────────┐
│                      HARNESS (约束茧房)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Session    │  │   ToolUse    │  │    Stop      │       │
│  │   Start      │  │   Hook       │  │   Hook       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│           │               │               │                 │
│           └───────────────┼───────────────┘                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              State Machine Gates                    │   │
│  │  偶数门审查 ┤ Midpoint Review（强制中断）              │   │
│  │  奇数门执行 ┤ Execution Phase（工具锁定）              │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Specialized Skills（专业化审查）              │   │
│  │  ├─ /skill-req-review   需求审查（只读）              │   │
│  │  ├─ /skill-code-review  代码审查（只读）              │   │
│  │  ├─ /skill-socrates     苏格拉底提问（交互）          │   │
│  │  └─ /skill-validator    验证器（机械检查）            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、Hook 定义（生命周期拦截）

| Hook 名称 | 触发时机 | 执行者 | 输出 | 失败行为 |
|-----------|---------|--------|------|---------|
| `H001` ReqConfirmed | `git commit` 时 | Pre-commit Hook | `exit 0` 放行 / `exit 2` 阻止 | 提交失败，提示需求未确认 |
| `H002` ReqIdTraced | `git commit` 时 | Pre-commit Hook | 检查文件头 `// REQ:{ID}` | 无 REQ ID 阻止提交 |
| `H003` IsolationCheck | `git commit` 时 | Pre-commit Hook | 检查 `product/` 无 `import from governance/` | 违反隔离阻止提交 |
| `H004` SocraticGate | 小需求合并主干时 | Skill 触发 AskUserQuestion | 苏格拉底式提问 | 用户确认前阻止合并 |
| `H005` ChangeLogGate | 变更文档生成时 | Pre-generation Hook | 检查 REQUIREMENTS.md 状态一致性 | 不一致时阻止 |

### Hook 注入协议

```bash
# exit 0 + stdout → 放行并注入上下文
# exit 2 + stderr → 阻止操作并注入反馈
# exit 1 → 硬阻断
```

---

## 三、状态机门控（State Machine Gates）

门控决定当前阶段能做什么，从工具清单层面物理隔离。

| 门类型 | 门编号 | 阶段 | Agent 工具权限 | 行为 |
|--------|--------|------|---------------|------|
| 奇数门 | G1 | 执行阶段 Edit/Write/Bash（全开） | 可改代码 |
| 偶数门 | G2 | 审查阶段 只读工具（Grep/Read/Glob） | 只能审查，不能改 |
| 奇数门 | G3 | 修复阶段 Edit/Write/Bash（全开） | 可改代码 |
| 偶数门 | G4 | 复核阶段 只读工具 | 独立审查 |

> **关键**：偶数门的 Agent 在 frontmatter 中声明 `tools: [Read, Grep, Glob]`，物理上无法越权

---

---

## 四、苏格拉底提问策略（H004: SocraticGate）

### 触发条件（精确匹配，不漂移）

```yaml
hook: H004_SocraticGate
triggers:
  - type: pattern_match
    pattern: "F[0-9]{3}.*状态.*已确认"
    files:
      - product/docs/REQUIREMENTS.md
    description: "当需求从'待确认'变为'已确认'时触发"

  - type: manual
    command: "/socrates F001"
    description: "手动触发对F001的苏格拉底提问"

  - type: branch_merge
    source: "feature/*"
    target: "main"
    description: "小需求分支合并到主干时触发"

execution:
  tool: AskUserQuestion
  behavior: blocking
  description: "用户未回答前，阻止所有后续操作"
```

### 提问策略（5维度10问题库）

用户提1-3，我补4-10，触发苏格拉底提问时从这10个问题中根据场景选择3-5个。

**维度1：技术选型**
| 编号 | 问题模板 | 触发条件 |
|------|---------|---------|
| Q1 | 如果用户量增长10倍，数据量增长100倍，这个设计还能正常工作吗？ | 涉及数据库/存储 |
| Q2 | 这个功能的核心依赖是什么？如果依赖不可用，有降级方案吗？ | 涉及外部服务 |

**维度2：潜在风险**
| 编号 | 问题模板 | 触发条件 |
|------|---------|---------|
| Q3 | 如果业务规则变化（如税率从13%改为9%），需要改几处代码？ | 涉及计算逻辑 |
| Q4 | 这个功能的数据一致性如何保证？分布式场景下会出问题吗？ | 涉及事务/状态 |

**维度3：需求对齐**
| 编号 | 问题模板 | 触发条件 |
|------|---------|---------|
| Q5 | 这个需求与 {related_req} 之间是否存在数据模型重复或逻辑冲突？ | 有关联需求时 |
| Q6 | 这个需求的边界在哪里？和已有功能的职责划分清晰吗？ | 所有场景 |

**维度4：边界情况**
| 编号 | 问题模板 | 触发条件 |
|------|---------|---------|
| Q7 | 考虑这些场景：网络中断/数据为空/并发操作/用户重复点击。当前设计如何处理？ | 所有场景 |
| Q8 | 如果这个操作中途失败（如断电），数据会处于什么状态？能恢复吗？ | 涉及写入操作 |

**维度5：维护成本**
| 编号 | 问题模板 | 触发条件 |
|------|---------|---------|
| Q9 | 改一个业务规则需要动几处代码？新来的人能看懂并安全修改吗？ | 涉及配置/规则 |
| Q10 | 这个功能上线后，你需要做哪些运维工作？有监控和告警吗？ | 所有场景 |

### 提问选择算法

```typescript
function selectQuestions(context: RequirementContext): Question[] {
  const questions = [];

  // 必问：需求对齐
  questions.push(Q6);

  // 根据需求类型选择
  if (context.hasDatabase) questions.push(Q1);
  if (context.hasExternalDependency) questions.push(Q2);
  if (context.hasCalculation) questions.push(Q3);
  if (context.hasTransaction) questions.push(Q4);

  // 必问：边界情况
  questions.push(Q7);

  // 根据风险选择
  if (context.isHighRisk) questions.push(Q8);
  if (context.hasBusinessRule) questions.push(Q9);

  // 必问：维护成本
  questions.push(Q10);

  return questions.slice(0, 5); // 最多5个
}
```

---

## 五、需求全生命周期流程（识别→补全→合并→开发→测试→验收）

### 阶段1：需求识别（用户说1-3，我识别）

```
用户输入 → 需求识别器 → REQ ID生成
```

**输入形式**：
- 自然语言描述（"我要一个报价系统"）
- 文档引用（"参考PDF第2章"）
- 竞品参考（"像XX那样的功能"）

**输出形式**：
```yaml
demand:
  raw_input: "用户原始输入"
  extracted_needs: ["需要1", "需要2", "需要3"]
  suggested_reqs: ["F001-价盘管理", "F002-报价编制"]
  status: "待确认"
```

### 阶段2：需求补全（你提1-3，我补4-10）

**用户明确给出1-3时，自动补全4-10**：

| 用户输入 | 我的动作 | 输出 |
|---------|---------|------|
| F001 价盘管理 (1-3项) | 补充4-10项详细设计问题 | 完整F001定义，状态"待确认" |
| F002 报价编制 (1-3项) | 补充4-10项详细设计问题 | 完整F002定义，状态"待确认" |

**补全模板**：
```
你的输入（1-3）：
1. XXX
2. YYY
3. ZZZ

待确认（4-10）：
| 序号 | 问题 | 建议方案 | 你的决策 |
| 4 | XXXX | 建议 | [待确认] |
| ... | ... | ... | ... |
```

**触发苏格拉底提问**：当所有4-10项都被用户确认为"已确认"时，触发/skill-socrates提问。

### 阶段3：需求合并（小需求→主干）

**合并触发条件**：
```yaml
merge_trigger:
  - type: status_change
    from: "待确认"
    to: "已确认"

  - type: branch_ready
    pattern: "feature/F[0-9]{3}"
    checklist_completed: true
```

**合并前强制检查清单**：
```yaml
pre_merge_checklist:
  - REQ ID 已分配
  - 4-10 项已确认
  - /skill-socrates 已通过
  - 代码位置已标注
  - 测试用例已定义
```

**合并流程**：
```
分支 feature/F001
  ↓ 提交代码（强制 REQ ID）
  ↓ pre-commit hook 检查
  ↓ PR 创建
  ↓ /skill-req-review 自动审查
  ↓ /skill-socrates 提问（如未执行）
  ↓ 用户回答通过
  ↓ 合并到 main
  ↓ 自动生成 CHANGELOG 条目
```

### 阶段4：开发（代码级）

**代码规范（强制）**：
```typescript
// 文件头强制注释
// REQ: F001
// 用途: 价盘管理服务
// 作者: ChenYuan
// 创建时间: 2026-05-14
```

**开发流程**：
1. **奇数门G1（执行）**：获得Edit/Write权限，编写代码
2. **偶数门G2（审查）**：触发/skill-code-review，只读工具审查
3. **奇数门G3（修复）**：修复审查问题
4. **偶数门G4（复核）**：确认修复完成

### 阶段5：测试（验证级）

**测试矩阵**：
| 类型 | 触发条件 | 工具 | 通过标准 |
|------|---------|------|---------|
| 单元测试 | domain/ 文件变更 | 自动生成框架 | 覆盖率>80% |
| 集成测试 | API变更 | /skill-test-runner | 用例全部通过 |
| 治理测试 | 任何提交 | pre-commit hook | 无阻止项 |

**测试检查项**：
- [ ] 单元测试文件存在（domain/*.test.ts）
- [ ] 边界情况覆盖（空值、超大值、并发）
- [ ] 错误处理测试（异常路径）

### 阶段6：验收（交付级）

**验收标准（Definition of Done）**：
```yaml
acceptance_criteria:
  code:
    - REQ ID 标记完整
    - 通过 skill-code-review
    - 测试覆盖率达标

  docs:
    - REQUIREMENTS.md 状态"已完成"
    - CHANGELOG.md 已生成条目
    - 代码注释完整

  governance:
    - 通过 pre-commit 所有检查
    - 通过 skill-req-review
    - 通过 skill-socrates（如触发）
```

**验收流程**：
```
功能开发完成
  ↓ 自测通过
  ↓ 提交PR（触发全量检查）
  ↓ /skill-req-review 审查
  ↓ /skill-code-review 审查
  ↓ 测试用例执行
  ↓ 全部通过 → 验收通过
  ↓ 合并到主干
  ↓ 自动生成文档更新
```

---

## 六、需求审查详细流程（/skill-req-review）

### 需求识别算法

```typescript
function identifyRequirements(input: string): Requirement[] {
  // 1. 提取关键词
  const keywords = extractKeywords(input);

  // 2. 匹配现有需求库
  const existingMatches = keywords.map(k =>
    findInRequirementPool(k)
  );

  // 3. 识别新需求
  const newNeeds = keywords.filter(k =>
    !existingMatches.some(m => m.matches(k))
  );

  // 4. 生成建议
  return newNeeds.map(need => ({
    id: generateReqId(),
    raw: need,
    status: 'draft',
    confidence: calculateConfidence(need)
  }));
}
```

### 需求补全算法

```typescript
function completeRequirement(
  userInput: UserInput,
  reqId: string
): CompletedRequirement {
  // 1. 解析用户的1-3项
  const coreItems = parseUserInput(userInput); // 1-3

  // 2. 根据需求类型选择补全模板
  const template = selectTemplate(reqId);

  // 3. 生成4-10项
  const extendedItems = template.questions.map((q, i) => ({
    id: i + 4,
    question: q.text,
    suggestion: q.suggestion,
    userDecision: '[待确认]'
  }));

  // 4. 组装完整需求
  return {
    id: reqId,
    core: coreItems,
    extended: extendedItems,
    status: 'pending_confirmation',
    triggerSocrates: false
  };
}

// 当所有项确认为"已确认"时
template.onAllConfirmed = () => {
  triggerSkill('skill-socrates', reqId);
};
```

### 需求合并算法

```typescript
function mergeRequirement(
  branchReq: Requirement,
  mainReq: Requirement
): MergeResult {
  // 1. 冲突检测
  const conflicts = detectConflicts(branchReq, mainReq);

  if (conflicts.length > 0) {
    return {
      status: 'conflict',
      conflicts,
      action: 'manual_resolution_required'
    };
  }

  // 2. 预检查
  const checks = runPreMergeChecks(branchReq);
  if (!checks.allPassed) {
    return {
      status: 'checks_failed',
      failedChecks: checks.failed,
      action: 'fix_and_retry'
    };
  }

  // 3. 执行合并
  const merged = merge(branchReq, mainReq);

  // 4. 触发后置流程
  if (!branchReq.socratesCompleted) {
    triggerSkill('skill-socrates', merged.id);
  }

  return {
    status: 'merged',
    mergedRequirement: merged,
    action: 'generate_changelog'
  };
}
```

---

### Skill 2: /skill-req-review（需求审查）

**触发条件**：
- Git pre-commit 检测到 REQUIREMENTS.md 变更
- 手动执行 `/skill-req-review`

**工具清单（只读！）**：
- `Read` - 读取文件
- `Grep` - 搜索 REQ ID
- `Glob` - 文件列表

**禁止工具**：
- `Edit` / `Write` / `NotebookEdit` ❌

**检查项**：
- [ ] 所有 Fxxx 都有对应的 REQ ID
- [ ] 状态变更符合流程（草稿→待确认→已确认）
- [ ] 已确认需求有代码位置追踪
- [ ] 无孤儿需求（无父需求的子需求）

**输出**：
- 审查报告（通过/失败）
- 失败时列出具体问题

---

### Skill 3: /skill-code-review（代码审查）

**触发条件**：
- Git pre-commit 检测到 product/src/ 文件变更
- 手动执行 `/skill-code-review`

**工具清单（只读！）**：
- `Read` - 读取代码
- `Grep` - 搜索模式

**检查项**：
- [ ] 文件头包含 `// REQ:{ID}`
- [ ] 变量命名符合项目规范
- [ ] 无 TODO/FIXME 遗留
- [ ] 错误处理完整

---

### Skill 4: /skill-validator（机械验证器）

**运行方式**：周期性守护进程

**自动检查（无需人类参与）**：
```yaml
validators:
  - name: req_doc_sync
    check: REQUIREMENTS.md 变更后，PRD-PRODUCT.md 是否同步
    interval: on_change
    
  - name: code_req_match
    check: REQ ID 在代码和需求文档中是否一一对应
    interval: pre_commit
    
  - name: test_coverage
    check: domain/ 下 .ts 是否有同名 .test.ts
    interval: pre_commit
    severity: warning
```

---

## 五、文件结构（Harness 实现）

```
/Users/nsss/Price-v2/
├── .claude/
│   └── settings.json              ← Hook 配置（见下）
│
├── governance/
│   ├── PRD-GOVERNANCE.md          ← 本文件（规则定义）
│   ├── SKILLS.md                  ← Skill 详细规范
│   │
│   └── harness/                   ← 物理约束代码
│       ├── hooks/
│       │   ├── pre-commit         ← Git hook（本地强制）
│       │   ├── check-req-confirmed.ts
│       │   ├── check-req-id-in-code.ts
│       │   └── check-import-isolation.ts
│       │
│       ├── skills/                ← 专业化 Agent 定义
│       │   ├── skill-socrates.json
│       │   ├── skill-req-review.json
│       │   └── skill-code-review.json
│       │
│       └── validators/
│           ├── req-sync.ts
│           └── test-coverage.ts
│
└── product/                       ← 业务代码（物理隔离）
    └── src/
```

---

## 六、Hook 配置（.claude/settings.json）

```json
{
  "hooks": {
    "user-prompt-submit": {
      "command": "cat $LAST_USER_PROMPT | grep -E 'F[0-9]{3}' && echo '检测到需求ID，触发 /skill-socrates'"
    },
    "pre-tool-use": {
      "Edit": {
        "command": "node governance/harness/hooks/check-req-confirmed.js $FILE_PATH"
      },
      "Write": {
        "command": "node governance/harness/hooks/check-req-id-in-code.js $FILE_PATH"
      }
    }
  },
  "skills": {
    "skill-socrates": {
      "trigger": "file_change:product/docs/REQUIREMENTS.md",
      "auto_run": true
    }
  }
}
```

---

## 七、变更记录自动化

### 问题
CHANGELOG.md 目前手动维护，容易过期。

### 解决方案
让变更记录**机械生成**，而非人工编写。

```yaml
change_log:
  source_of_truth: CHANGELOG.md
  
  generators:
    - name: req_changes
      trigger: REQUIREMENTS.md 变更
      format: "| {timestamp} | {username} | {Fxxx}状态{old}→{new} |"
      
    - name: code_changes
      trigger: git commit
      format: "| {timestamp} | {commit_hash} | {files_changed} |"
      
    - name: governance_changes
      trigger: governance/ 变更
      format: "| {timestamp} | {username} | 治理规则更新: {desc} |"
```

### 变更记录结构

```markdown
# 变更记录

## 自动生成表

| 时间 | 用户 | 类型 | 详情 | REQ ID |
|------|------|------|------|--------|
| 2026-05-14 14:32 | ChenYuan | 需求确认 | F001 价盘管理 待确认→已确认 | F001 |
| 2026-05-14 15:10 | ChenYuan | 代码提交 | product/src/app/quotes/new/page.tsx | F002 |

## 核心设计文件索引

| 文件 | 作用 | 最后更新 |
|------|------|---------|
| SYSTEM.md | 系统入口、文件地图 | - |
| governance/PRD-GOVERNANCE.md | 治理规则定义 | - |
| product/docs/REQUIREMENTS.md | 需求池（唯一状态源） | - |
| product/PRD-PRODUCT.md | 产品PRD | - |
```

---

## 九、文档头部注释治理条款（强制）

### 治理规则 D001：所有核心文档必须包含头部注释

**适用范围**：所有 `.md`、`.ts`、`.tsx`、`.json` 文件

**触发条件**：
- `pre-commit` 检查
- `/skill-doc-review` 审查

**头部注释模板**：

```html
<!--
文件名: {filename}
用途: {一句话说明文件做什么}
所属层: {治理层|业务层}
创建者: {AI Assistant|User}
更新规则: {什么情况下更新}
REQ: {GOV-XXX-001|REQ-XXX-001}
-->
```

**检查项**：

| 字段 | 必填 | 检查规则 |
|------|------|---------|
| `文件名` | 是 | 必须与实际文件名一致 |
| `用途` | 是 | 不能为空，一句话概括 |
| `所属层` | 是 | 必须是"治理层"或"业务层" |
| `REQ` | 是 | 必须符合 `XXX-XXX-000` 格式 |

**失败行为**：
```bash
exit 2
stderr: "❌ 文件缺少头部注释或格式错误: {filepath}"
```

### 执行脚本

```typescript
// governance/harness/hooks/check-doc-header.ts

interface HeaderValidation {
  valid: boolean;
  missing: string[];
  errors: string[];
}

function validateDocHeader(filePath: string): HeaderValidation {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').slice(0, 10);

  // 检查 HTML 注释开始
  if (!lines[0].includes('<!--')) {
    return { valid: false, missing: ['header'], errors: ['Missing <!--'] };
  }

  // 提取注释内容
  const headerEnd = lines.findIndex(l => l.includes('-->'));
  const headerLines = lines.slice(0, headerEnd + 1).join('\n');

  // 检查必填字段
  const required = ['文件名', '用途', '所属层', 'REQ'];
  const missing = required.filter(field =>
    !headerLines.includes(`${field}:`)
  );

  return {
    valid: missing.length === 0,
    missing,
    errors: missing.map(m => `Missing field: ${m}`)
  };
}
```

### REQ ID 分配规则

| 层 | 前缀 | 范围 | 说明 |
|----|------|------|------|
| 治理层 | GOV | GOV-001 ~ GOV-999 | 治理规则、Skill、Hook |
| 业务层 | REQ | REQ-001 ~ REQ-999 | 业务需求 F001-F026 |
| 文档级 | DOC | DOC-001 ~ DOC-999 | 纯文档，无代码 |

---

## 八、下一步（治理层建设清单）

- [ ] **H1** 创建 `.claude/settings.json` Hook 配置
- [ ] **H2** 编写 `governance/harness/hooks/pre-commit`
- [ ] **S1** 定义 `/skill-socrates` Skill 文件
- [ ] **S2** 定义 `/skill-req-review` Skill 文件
- [ ] **V1** 实现变更记录自动生成
- [ ] **T1** 测试 Hook 拦截效果

---

## 附录：与业务规则的区分

| 类型 | 例子 | 放哪里 |
|------|------|--------|
| **治理规则** | 需求确认前阻止提交、代码必须有REQ ID | governance/PRD-GOVERNANCE.md |
| **业务规则** | 销售只能看到自己的报价、15天有效期 | product/PRD-PRODUCT.md |

> 治理规则：强制 AI/人类遵守的开发流程
> 业务规则：产品运行时的业务逻辑
