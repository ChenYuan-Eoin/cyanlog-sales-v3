# Harness 治理指南

## 当前治理真相范围

本目录归集项目中的 AI 运行配置、技能配置、历史治理文档、hook、validator 与 guard 代码。

## 长期维护范围

> 约定：本项目长期维护的 Markdown 真相文档仅有 1 份治理文档，即当前文件。

本目录中其他内容虽然不是“长期维护文档”，但仍属于需要持续维护的运行资产，包括：
- `.claude` 兼容入口对应的运行配置
- skills / agents 配置
- hooks / validators / guards / scripts
- 与治理运行直接相关的环境变量、路径和入口约定

## 非文档但必须维护的资产

以下内容不属于“维护文档数量”的统计范围，但必须持续保持可用：

1. Git 相关基础设施
   - `.git/`
   - `.github/`
   - Pull Request 模板、工作流、提交约束

2. 运行配置与环境变量
   - `.claude/settings.json`
   - skills / agents 配置
   - 根目录 `.env.example`（工作区参考模板）
   - `cyanlog-sales-v3/.env.example`（业务应用 SoT 模板）
   - `runtime-config-AI运行配置/config-配置文件/env-registry-环境变量注册表.json`
   - `runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json`
   - 需要人工维护的环境变量约定与部署侧真实 secret

3. 运行脚本与校验器
   - `scripts/`
   - hooks / validators / guards
   - 文档目录生成与校验脚本

原则：
- 这些资产要维护，但不当作“持续撰写型文档”维护。
- 它们的变化应以运行正确、入口不失效、兼容路径可追溯为准。

## 环境变量治理入口

环境变量相关内容以“模板 + 注册表 + 说明文档”三件套管理：

1. 模板文件
   - `cyanlog-sales-v3/.env.example`
   - 用途：业务应用当前生效的环境变量 SoT 模板

2. 工作区参考模板
   - 根目录 `.env.example`
   - 用途：让根目录文档 / 脚本 / 基础设施说明与当前默认本地端口保持同步

3. 注册表
   - `runtime-config-AI运行配置/config-配置文件/env-registry-环境变量注册表.json`
   - 用途：机器可读地描述必填性、敏感级别、归属层、存储位置

4. 说明文档
   - `truth-docs-治理真相文档/CONFIGURATION.md`
   - 用途：说明治理原则、使用方式、预提交检查和部署注意事项

5. 项目治理注册表
   - `runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json`
   - 用途：统一声明被管理文档、兼容入口、hook 命令与默认目标文档

约束：
- 真实 secret 不进入 git。
- 新增业务运行变量时，必须同时更新 `cyanlog-sales-v3/.env.example` 和注册表；若根目录 `.env.example` 也对外说明该项，则同步更新根目录参考模板。
- 若变量只存在于个人 shell、Vercel 或供应商控制台，也必须在注册表中声明其来源。

## 数据结构治理入口

后端数据层目前还没有在活动业务仓内形成真正生效的 schema/migration 资产，因此需要单独维护一份治理入口：

1. `truth-docs-治理真相文档/DB_SCHEMA_GOVERNANCE.md`
2. 未来实际落在 `cyanlog-sales-v3` 内的 schema 与 migration 目录
3. `truth-docs-治理真相文档/CONTROL_CHAIN_GOVERNANCE.md`

约束：
- 主文档里的 Prisma/SQL 示例在对应可执行文件落地前，只能视为设计材料，不视为运行真相。
- 任何正式表结构变更都必须同时满足“治理规范更新 + 可执行迁移提交”两个条件。
- 如果后端最终不用 Prisma，也必须在该治理文档中显式改写真相入口，不允许工具口径悬空。

## 改名与迁移同步

如果主文档、治理文档、TOC 脚本、`.claude` 设置入口发生改名或换位置，不再逐处手工修路径，而是按以下顺序处理：

1. 修改 `project-governance-项目治理注册表.json`
2. 如文档本身被纳管，同时更新 `guide-文档维护指南.md` 里的 `yaml` 清单
3. 执行：

```bash
python3 ./scripts/sync_governance.py
```

该命令会同步根目录兼容入口，包括：
- `PRD_MAINTENANCE_GUIDE.md`
- `scripts/generate_toc.sh`
- `scripts/generate_toc.py`
- `.claude/settings.json`

## 治理边界

1. 本目录负责 AI 开发行为治理，不负责承载产品真相。
2. `.claude` 中的运行配置与技能配置应以本目录中的归集版本为准。
3. 历史治理真相文档保留为参考来源，不直接视为产品真相。

## 当前归集内容

### 1. 运行配置
- `settings-claude运行配置.json`
- `agents-Agent配置/`
- `legacy-skills/` (已弃用，skills 现内联于 settings.json)

备注（SoT 约定）：
1. **Skills 配置现已内联于 `settings-claude运行配置.json`** 的 `skills` 字段，不再使用 `legacy-skills/` 目录。
2. `legacy-skills/` 目录保留仅作历史参考，实际运行以 settings.json 内联配置为准。
3. 如需新增 skill，直接修改 `settings-claude运行配置.json`，无需创建单独文件。

## 长任务 Harness 运行契约

长任务 Harness 的职责不是描述产品如何实现，而是控制 AI 在收到目标后的工作方式。

### 目标入口

用户输入目标后，AI 不应直接进入实现。必须先形成目标合约：

1. `objective`：要达成的可验证结果
2. `successCriteria`：完成判定
3. `nonGoals`：明确不做的范围
4. `researchPlan.researchable`：可由 AI 自行调研的事实
5. `researchPlan.askUser`：只能由用户意图决定的问题
6. `autonomyBudget.level`：自治级别
7. `boundaries`：可碰、不可碰、高风险范围
8. `stopConditions`：必须停下的条件
9. `evidence.required`：收尾必须提供的证据

机器可读目标合约由 `runtime-state/goal-contract.json` 承载；空闲时该文件可以不存在。

Codex 项目 hook 在识别到目标型 prompt 且当前没有活跃长任务时，应自动进入 `A0/intake`，写入初始目标合约，并阻止命令执行和编辑，直到目标合约被审查并显式 approve。

例外：当 prompt 明确声明为只读验证/复验，并同时声明不修改、不提交、不推送、不部署时，Codex hook 可以直接进入 `G4/verify`。该模式只允许读取和本地验证命令，仍然禁止编辑、部署、远程写入和破坏性命令，用于新会话/新 worktree 的 post-push 验证，避免验证任务被普通 A0 intake 卡死。

### 自治级别

| 级别 | 名称 | 可自治范围 | 必须停下 |
|---|---|---|---|
| A0 | intake_read_only | 读文件、梳理目标、提出问题 | 任何编辑、命令执行、外部副作用 |
| A1 | bounded_local_work | 已批准合约内的本地编辑和本地验证 | 部署、数据库、账单、认证、远程 git、破坏性命令 |
| A2 | broad_local_work | 更宽的本地实现与验证 | 生产/外部写入/敏感数据/依赖大改 |
| A3 | release_sensitive_work | 发布相邻准备工作 | 真正发布、生产变更、供应商侧写入 |

自治级别只放宽本地工作，不授权生产、副作用或破坏性操作。

### 阶段门

| 阶段 | Gate | 目的 | 写权限 |
|---|---|---|---|
| intake | G0 | 目标澄清和边界识别 | 否 |
| research | G1 | 只读调研和低风险本地检查 | 否 |
| contract_review | G2 | 合约审查与用户意图确认 | 否 |
| execute | G3 | 已批准合约内执行 | 是，受自治级别和风险策略限制 |
| verify | G4 | 验证与证据收集 | 否 |
| approval | G5 | 高风险动作等待用户确认 | 否 |

进入 `execute/G3` 必须满足：目标合约有效、合约状态为 `approved` 或 `active`、自治级别允许编辑。

同时还必须满足 intake readiness：

1. `successCriteria` 已定义，不能用“改了代码”代替完成判定。
2. 允许编辑时必须定义 `boundaries.allowedScopes`。
3. `researchPlan.blocked` 为空。
4. `researchPlan.askUser` 中的每个问题都必须有 `user-answer:<问题>` 或等价证据。
5. `researchPlan.researchable` 中的每个问题都必须有 `research:<问题>` 或等价证据。
6. 默认 `researchPlan.requiredChecks` 必须有证据：`repo-pattern-scan`、`reuse-or-library-scan`、`best-practice-check`、`user-intent-boundary-check`。

因此，调研、询问、假设和停止条件不是写在总结里的建议，而是进入执行门前的机器条件。

默认 required checks 的含义：

| 检查 | 机器证据 key | 含义 |
|---|---|---|
| repo-pattern-scan | `research-check:repo-pattern-scan` | 先查现有代码、文档、脚本、治理配置和本地模式 |
| reuse-or-library-scan | `research-check:reuse-or-library-scan` | 先找已有 helper、库、平台能力，不重复造轮子 |
| best-practice-check | `research-check:best-practice-check` | 对易过期或非显然技术选择，优先使用权威本地文档或一手外部文档 |
| user-intent-boundary-check | `research-check:user-intent-boundary-check` | 意图、权限、范围、风险无法安全推断时，必须问用户或停下 |

### 目标主权

Harness 的目标合约必须保留用户原始目标：

- `sourceGoal` 保存原始输入。
- `sovereignty.originalGoalHash` 保存原始目标哈希。
- `sovereignty.agentMayRedefineGoal` 必须为 `false`。
- 如需改变目标、缩小范围或删除完成条件，必须形成用户批准的 revision；代理不得用“我本轮只做了这些”重定义完成。

完成审计会检查目标主权。若 `sourceGoal` 被改写、`objective` 与原始目标不一致且没有用户批准 revision，或缺少目标哈希，则不得 complete。

### 风险硬拦截

以下操作不得在自治过程中直接执行：

- 递归强制删除、批量删除
- `git reset --hard`、`git clean -f`、force push、远程 push
- 部署、发布、生产环境写入
- 数据库 schema/data 破坏性变更
- 账单、认证、消息供应商写入
- 权限弱化、`sudo`、读取未授权 secret

这些风险由 `harness-core.js` 统一定义，Codex adapter、Claude gate enforcer 和 doctor 必须调用同一套策略。

### 高影响动作评估矩阵

Harness 不得在执行高影响动作后再解释理由。所有工具调用必须先进入机器评估矩阵，再决定允许、拦截或要求审批。

| 评估项 | 机器判定 | 不满足时动作 |
|---|---|---|
| 目标对象 | 动作是否属于当前目标对象，例如 Harness 控制面、业务应用、外部供应商或远程 Git | 目标漂移时拦截 |
| 动作类型 | 工具和命令被归类为 read、edit、command、deploy、external write、destructive、control-plane | 高风险进入拦截或 G5 |
| 自治等级 | A0/A1/A2/A3 是否允许该动作类别 | 不允许则拒绝 |
| 阶段门 | 当前 G0-G5 是否允许该工具 | 不允许则拒绝 |
| 作用域 | 文件路径或命令目标是否落在 `allowedScopes` | 越界则拒绝或要求确认 |
| 外部副作用 | 是否会创建部署、远程写、数据库/账单/鉴权变更 | 默认拒绝，除非目标合约显式授权 |
| 控制面保护 | 是否直接改 runtime state、goal、evidence、hooks 或 Harness 策略文件 | runtime state 永久拒绝；控制面需显式 scope |
| 文档治理 | 新增 Markdown 是否属于注册表文档、注册表目录或允许文档族 | 不符合则拒绝 |
| 可回滚性 | 高影响动作是否有 rollback note | Stop 前必须提示缺口 |
| 证据要求 | 是否记录 command、result、target、risk、commit/deployment/thread 等证据 | Stop 前必须提示缺口 |

当当前目标是 Harness 长任务治理时，Vercel、业务应用、Supabase、Stripe、Resend、远程 Git 写入等动作都属于目标漂移，必须拦截并输出 `target drift`。这条规则用于防止把 Harness 部署错误扩展成业务应用部署。

### 执行入口

| 入口 | 文件 | 职责 |
|---|---|---|
| Core policy | `runtime-code-运行代码/scripts-脚本/harness-core.js` | 合约、阶段、自治、风险、证据的唯一运行策略 |
| Goal CLI | `runtime-code-运行代码/scripts-脚本/harness-goal.js` | start/approve/phase/evidence/status/clear |
| Doctor | `runtime-code-运行代码/scripts-脚本/harness-doctor.js` | 检查执行链和运行态一致性 |
| Selftest | `runtime-code-运行代码/scripts-脚本/harness-selftest.js` | 离线验证核心策略 |
| Codex adapter | `.codex/hooks/harness-adapter.js` | Codex 生命周期事件接入 |
| Claude enforcer | `runtime-code-运行代码/hooks-钩子/claude-pretool-gate-enforcer.js` | Claude PreToolUse 接入 |

### 生效判定

不得把“文件已修改”或普通 doctor 的 `0 failure(s)` 当成 Harness 已生效。

本 Harness 的“部署”是治理运行时部署：项目配置被 Codex 加载、hook 被信任、变更被提交并推送到远端分支、推送后可在新 Codex 会话中复查。它不是产品应用的 Vercel/生产发布；只有用户明确要求产品发布时，才允许进入生产部署流程。

Harness ready 必须同时满足：

1. `npm test` 通过，证明核心策略离线自洽
2. `npm run ready` 通过，等价于 `harness-doctor.js --strict`
3. Codex 项目 hooks 已在 `/hooks` 中被用户审查并信任
4. `harness-goal status` 显示目标契约和阶段门处于预期状态
5. 当前会话或新会话实际触发过 `UserPromptSubmit` / `PreToolUse` / `Stop` 生命周期接入
6. 最终交付时，Harness 相关文件已经与业务脏改分离，并以独立 commit 推送到远端分支
7. worktree 继承脚本不得写死本机绝对路径；Codex hooks/config 与 Claude settings 必须能在新 worktree 中复现
8. 新 worktree 若要通过 Codex `ready --strict`，必须登记 Codex project trust 和 hook trust；使用 `codex-trust-worktree.js` 生成或写入 trust 配置

任一条件缺失时，只能说“代码级 Harness 已准备/结构检查通过”，不能说“已部署、生效、可自治挂机”。

新 worktree 迁移推荐入口：

```bash
bash governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/setup-worktree-harness.sh <worktree-path> --trust-codex
```

如只想查看需要写入的 trust 配置，不修改用户全局配置：

```bash
node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/codex-trust-worktree.js --target <worktree-path>
```

### 收尾证据

长任务结束时必须说明：

1. 改了哪些文件
2. 跑了哪些验证，结果是什么
3. 哪些内容没有验证
4. 剩余风险和回滚路径
5. 是否触发过高风险拦截或人工确认

### 完成审计

Harness 完成不是自然语言声明，而是 `harness-goal audit` 和 `harness-goal complete` 的结果。

`complete` 前必须同时满足：

1. 目标合约有效。
2. 目标主权检查通过。
3. intake readiness 通过。
4. 所有 checkpoint 为 `pass/done/complete/completed`。
5. 每条 `successCriteria` 都有 `status=pass` 且 `satisfies` 命中的证据。
6. 每类 `evidence.required` 都有对应证据。
7. 没有未解决的 `status=fail` 证据。
8. 当前阶段已经进入 `verify`、`evidence` 或 `complete`。

`phase complete` 不能绕过审计；审计失败时必须保持目标未完成。`Stop` hook 每次收尾都会输出 completion audit 行，用于证明当前是“继续推进中”还是“可完成”。

推荐证据写入方式：

```bash
node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-goal.js evidence \
  --status pass \
  --type command \
  --summary "selftest passed" \
  --satisfies "validation commands and results,selftest passes"
```

checkpoint 更新必须通过 CLI：

```bash
node governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-goal.js checkpoint \
  --name "verification evidence collected" \
  --status pass
```

## Claude 插件（Marketplace Plugins）治理

本项目的 Claude Code 插件能力来自 Claude Marketplace（项目级 scope）。

关键约束：
1. 插件“安装状态”默认落在用户机器的 `~/.claude/plugins/installed_plugins.json`，**不在仓库内**。
2. 为了让治理可迁移，本仓库必须同时维护一份“期望启用插件清单”（写入治理文件），并提供可复现的安装方式。
3. **高侵入插件默认禁用**：凡是会注册 `SessionStart` / 大量 Hook、或注入整套方法论流程的插件（例如 superpowers / hookify / security-guidance），默认不启用，除非明确评估并通过。

当前项目级已启用插件（由 `settings-claude运行配置.json` 的 `enabledPlugins` 约束）包括：
- `frontend-design@claude-plugins-official`
- `context7@claude-plugins-official`
- `code-review@claude-plugins-official`
- `code-simplifier@claude-plugins-official`
- `feature-dev@claude-plugins-official`
- `pr-review-toolkit@claude-plugins-official`
- `claude-md-management@claude-plugins-official`
- `session-report@claude-plugins-official`
- `claude-code-setup@claude-plugins-official`
- `typescript-lsp@claude-plugins-official`
- `pyright-lsp@claude-plugins-official`
- `playwright@claude-plugins-official`
- `serena@claude-plugins-official`
- `github@claude-plugins-official`（需要 `GITHUB_PERSONAL_ACCESS_TOKEN`）
- `commit-commands@claude-plugins-official`（需要本机 `gh` 已登录）
- `playground@claude-plugins-official`

### 2. 运行代码
- `hooks-钩子/`
- `scripts-脚本/`
- `validators-校验器/`
- `guards-守卫/`

### 3. 治理真相文档
- `truth-docs-治理真相文档/`
- `truth-docs-治理真相文档/DB_SCHEMA_GOVERNANCE.md`
- `truth-docs-治理真相文档/CONTROL_CHAIN_GOVERNANCE.md`

## 维护规则

1. 新的 AI 运行配置进入根目录前，应先在本目录归档。
2. 历史 hooks/validators/guards 的迁移应以“可追溯”为前提，不得覆盖产品真相层。
3. 若根目录兼容入口仍存在，则归集文件变更后必须保证兼容路径不失效。
